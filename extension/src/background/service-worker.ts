import {
  MESSAGE_VERSION,
  PopupToSwMessage,
  ExtractJdMessage,
  FillFormMessage,
  DraftState,
  InitState,
  Response,
} from "../messages/types";
import { getToken, revokeToken } from "./auth";
import * as api from "./api";

const DRAFT_STORAGE_KEY = "pending_draft";
const JOB_TAB_KEY = "job_tab_id";
const USER_INFO_KEY = "user_info";

async function fetchAndCacheUserInfo(token: string): Promise<void> {
  try {
    const resp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return;
    const info = await resp.json() as { name?: string; email?: string };
    await chrome.storage.session.set({ [USER_INFO_KEY]: { name: info.name ?? "", email: info.email ?? "" } });
  } catch {}
}

async function getCachedUserInfo(): Promise<{ name: string; email: string }> {
  const result = await chrome.storage.session.get(USER_INFO_KEY);
  return (result[USER_INFO_KEY] as { name: string; email: string }) ?? { name: "", email: "" };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

async function storeDraft(draft: DraftState): Promise<void> {
  await chrome.storage.session.set({ [DRAFT_STORAGE_KEY]: draft });
}

async function loadDraft(): Promise<DraftState | null> {
  const result = await chrome.storage.session.get(DRAFT_STORAGE_KEY);
  return (result[DRAFT_STORAGE_KEY] as DraftState) ?? null;
}

async function clearDraft(): Promise<void> {
  await chrome.storage.session.remove(DRAFT_STORAGE_KEY);
}

// ── Tab helpers ───────────────────────────────────────────────────────────────

async function getActiveTabId(): Promise<number> {
  // lastFocusedWindow avoids grabbing the extension popup's window
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  return tab.id;
}

async function getJobTabId(): Promise<number | null> {
  const result = await chrome.storage.session.get(JOB_TAB_KEY);
  return (result[JOB_TAB_KEY] as number) ?? null;
}

async function sendToContentScript<T>(
  tabId: number,
  message: ExtractJdMessage | FillFormMessage
): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Content script not yet injected (tab was open before extension loaded) — inject and retry.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/content.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleInit(): Promise<Response<InitState>> {
  const token = await getToken(false);
  if (!token) return { ok: true, data: { isAuthenticated: false, hasProfile: false, draft: null } };

  try {
    const [profile, draft] = await Promise.all([api.getProfile(), loadDraft()]);
    return { ok: true, data: { isAuthenticated: true, hasProfile: profile !== null, draft } };
  } catch {
    return { ok: true, data: { isAuthenticated: true, hasProfile: false, draft: null } };
  }
}

async function handleSignIn(): Promise<Response<InitState>> {
  const token = await getToken(true); // interactive
  if (!token) return { ok: false, error: "Sign-in cancelled or failed" };

  await fetchAndCacheUserInfo(token);

  try {
    const profile = await api.getProfile();
    const draft = await loadDraft();
    return { ok: true, data: { isAuthenticated: true, hasProfile: profile !== null, draft } };
  } catch {
    return { ok: true, data: { isAuthenticated: true, hasProfile: false, draft: null } };
  }
}

async function handleSignOut(): Promise<Response<null>> {
  await revokeToken();
  await clearDraft();
  return { ok: true, data: null };
}

async function handleSaveProfile(resumeContent: string): Promise<Response<null>> {
  await api.upsertProfile(resumeContent);
  return { ok: true, data: null };
}

async function handleTriggerExtract(): Promise<Response<DraftState>> {
  try {
    const tabId = await getActiveTabId();
    await chrome.storage.session.set({ [JOB_TAB_KEY]: tabId });

    const extractMsg: ExtractJdMessage = { version: MESSAGE_VERSION, type: "EXTRACT_JD" };
    const extracted = await sendToContentScript<
      Response<{ jobDescription: string; company: string; roleTitle: string }>
    >(tabId, extractMsg);

    if (!extracted.ok) return extracted;

    const { jobDescription, company, roleTitle } = extracted.data;
    console.log("[extract] extracted:", { company, roleTitle, jdLength: jobDescription.length });

    const draft = await api.requestDraft({ jobDescription, company, roleTitle });
    await storeDraft(draft);
    return { ok: true, data: draft };
  } catch (e) {
    console.error("[extract] failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function handleConfirmSubmit(
  applicationId: string,
  variantId: string
): Promise<Response<{ submittedAt: string }>> {
  const draft = await loadDraft();
  if (!draft) return { ok: false, error: "No pending draft" };
  if (draft.applicationId !== applicationId || draft.variantId !== variantId) {
    return { ok: false, error: "Draft ID mismatch — possible stale state" };
  }

  try {
    const result = await api.confirmSubmit(applicationId, variantId);

    // Fill form fields and auto-submit — prefer the tab where we extracted the JD.
    const tabId = (await getJobTabId()) ?? await getActiveTabId().catch(() => null);
    if (tabId !== null) {
      const userInfo = await getCachedUserInfo();
      const fillMsg: FillFormMessage = {
        version: MESSAGE_VERSION,
        type: "FILL_FORM",
        payload: {
          company: draft.company,
          roleTitle: draft.roleTitle,
          resumeContent: draft.resumeContent,
          coverLetterContent: draft.coverLetterContent,
          userName: userInfo.name,
          userEmail: userInfo.email,
          autoSubmit: true,
        },
      };
      sendToContentScript(tabId, fillMsg).catch(() => {});
    }

    await clearDraft();
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Confirm failed" };
  }
}

// ── Message dispatcher ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
  const message = rawMessage as PopupToSwMessage;

  if (!message || (message as { version?: string }).version !== MESSAGE_VERSION) {
    sendResponse({ ok: false, error: "Version mismatch" } satisfies Response<never>);
    return false;
  }

  const err = (e: unknown): Response<never> => ({
    ok: false,
    error: e instanceof Error ? e.message : String(e),
  });

  switch (message.type) {
    case "POPUP_INIT":
      handleInit().then(sendResponse).catch((e) => sendResponse(err(e)));
      return true;

    case "POPUP_SIGN_IN":
      handleSignIn().then(sendResponse).catch((e) => sendResponse(err(e)));
      return true;

    case "POPUP_SIGN_OUT":
      handleSignOut().then(sendResponse).catch((e) => sendResponse(err(e)));
      return true;

    case "POPUP_SAVE_PROFILE":
      handleSaveProfile(message.payload.resumeContent).then(sendResponse).catch((e) => sendResponse(err(e)));
      return true;

    case "TRIGGER_EXTRACT":
      handleTriggerExtract().then(sendResponse).catch((e) => sendResponse(err(e)));
      return true;

    case "POPUP_CONFIRM_SUBMIT":
      handleConfirmSubmit(message.payload.applicationId, message.payload.variantId)
        .then(sendResponse).catch((e) => sendResponse(err(e)));
      return true;

    default:
      return false;
  }
});
