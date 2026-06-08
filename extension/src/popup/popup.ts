import {
  MESSAGE_VERSION,
  PopupInitMessage,
  PopupSignInMessage,
  PopupSignOutMessage,
  PopupSaveProfileMessage,
  TriggerExtractMessage,
  PopupConfirmSubmitMessage,
  DraftState,
  InitState,
  Response,
} from "../messages/types";

// ── Message helpers ───────────────────────────────────────────────────────────

type SwMessage =
  | PopupInitMessage
  | PopupSignInMessage
  | PopupSignOutMessage
  | PopupSaveProfileMessage
  | TriggerExtractMessage
  | PopupConfirmSubmitMessage;

function sendToSw<T>(message: SwMessage): Promise<Response<T>> {
  return chrome.runtime.sendMessage(message);
}

// ── State ─────────────────────────────────────────────────────────────────────

type PopupState =
  | { view: "loading" }
  | { view: "unauthenticated" }
  | { view: "setup" }
  | { view: "idle" }
  | { view: "extracting" }
  | { view: "reviewing"; draft: DraftState }
  | { view: "confirmed"; company: string; roleTitle: string; submittedAt: string }
  | { view: "error"; message: string };

let state: PopupState = { view: "loading" };
let activeTab: "resume" | "cover_letter" = "resume";

// ── Render ────────────────────────────────────────────────────────────────────

function render(): void {
  const root = document.getElementById("root")!;
  root.innerHTML = "";

  switch (state.view) {
    case "loading":      root.append(renderLoading()); break;
    case "unauthenticated": root.append(renderUnauthenticated()); break;
    case "setup":        root.append(renderSetup()); break;
    case "idle":         root.append(renderIdle()); break;
    case "extracting":   root.append(renderExtracting()); break;
    case "reviewing":    root.append(renderReviewing(state.draft)); break;
    case "confirmed":    root.append(renderConfirmed(state.company, state.roleTitle, state.submittedAt)); break;
    case "error":        root.append(renderError(state.message)); break;
  }
}

// ── Element factory ───────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function header(): HTMLElement {
  return el("div", { class: "header" }, el("span", { class: "logo" }, "◈"), " Job Apply Agent");
}

function spinner(label: string): HTMLElement {
  return el("div", { class: "spinner-wrap" },
    el("div", { class: "spinner" }),
    el("p", { class: "spinner-label" }, label)
  );
}

// ── Views ─────────────────────────────────────────────────────────────────────

function renderLoading(): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(header(), spinner("Loading…"));
  return frag;
}

function renderUnauthenticated(): DocumentFragment {
  const frag = document.createDocumentFragment();
  const btn = el("button", { class: "btn-primary btn-large" }, "Sign in with Google");
  btn.onclick = onSignIn;
  frag.append(
    header(),
    el("div", { class: "idle-body" },
      btn,
      el("p", { class: "hint" }, "Sign in to tailor your resume and apply to jobs.")
    )
  );
  return frag;
}

function renderSetup(): DocumentFragment {
  const frag = document.createDocumentFragment();
  const textarea = el("textarea", {
    class: "resume-input",
    placeholder: "Paste your base resume here…\n\nThis is your master copy — Claude will tailor it for each job.",
  }) as HTMLTextAreaElement;

  const save = el("button", { class: "btn-primary" }, "Save & Continue");
  save.onclick = () => onSaveProfile(textarea.value);

  frag.append(
    header(),
    el("div", { class: "setup-body" },
      el("p", { class: "setup-title" }, "Set up your resume"),
      el("p", { class: "hint" }, "Paste your base resume. Claude will tailor it for each job you apply to."),
      textarea,
      save
    )
  );
  return frag;
}

function renderIdle(): DocumentFragment {
  const frag = document.createDocumentFragment();
  const btn = el("button", { class: "btn-primary btn-large" }, "Extract Job Details");
  btn.onclick = onExtract;

  const signOut = el("button", { class: "btn-ghost" }, "Sign out");
  signOut.onclick = onSignOut;

  frag.append(
    header(),
    el("div", { class: "idle-body" },
      btn,
      el("p", { class: "hint" }, "Open a job posting, then click to extract and tailor your application."),
      signOut
    )
  );
  return frag;
}

function renderExtracting(): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(header(), spinner("Tailoring your application…"));
  return frag;
}

function renderReviewing(draft: DraftState): DocumentFragment {
  const frag = document.createDocumentFragment();

  const tabResume = el("button", { class: `tab ${activeTab === "resume" ? "tab-active" : ""}` }, "Resume");
  const tabCover = el("button", { class: `tab ${activeTab === "cover_letter" ? "tab-active" : ""}` }, "Cover Letter");
  tabResume.onclick = () => { activeTab = "resume"; render(); };
  tabCover.onclick = () => { activeTab = "cover_letter"; render(); };

  const content = el("pre", { class: "content-box" },
    activeTab === "resume" ? draft.resumeContent : draft.coverLetterContent
  );

  const confirmBtn = el("button", { class: "btn-primary" }, "Confirm & Submit Application");
  confirmBtn.onclick = () => onConfirm(draft);

  const retailorBtn = el("button", { class: "btn-secondary" }, "Re-tailor");
  retailorBtn.onclick = onExtract;

  frag.append(
    header(),
    el("div", { class: "meta" },
      el("div", { class: "meta-company" }, draft.company || "Unknown company"),
      el("div", { class: "meta-role" }, draft.roleTitle || "Unknown role")
    ),
    el("div", { class: "tabs" }, tabResume, tabCover),
    content,
    el("div", { class: "actions" }, confirmBtn, retailorBtn)
  );
  return frag;
}

function renderConfirmed(company: string, roleTitle: string, submittedAt: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const again = el("button", { class: "btn-secondary" }, "Apply to another job");
  again.onclick = () => { state = { view: "idle" }; render(); };

  frag.append(
    header(),
    el("div", { class: "confirmed-body" },
      el("div", { class: "confirmed-icon" }, "✓"),
      el("p", { class: "confirmed-title" }, "Application submitted"),
      el("p", { class: "confirmed-detail" }, `${roleTitle} at ${company}`),
      el("p", { class: "confirmed-time" }, `at ${new Date(submittedAt).toLocaleTimeString()}`)
    ),
    el("div", { class: "actions" }, again)
  );
  return frag;
}

function renderError(message: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const retry = el("button", { class: "btn-secondary" }, "Try again");
  retry.onclick = () => { state = { view: "idle" }; render(); };

  frag.append(
    header(),
    el("div", { class: "error-body" },
      el("p", { class: "error-msg" }, message),
      retry
    )
  );
  return frag;
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function onSignIn(): Promise<void> {
  state = { view: "loading" };
  render();

  const response = await sendToSw<InitState>({ version: MESSAGE_VERSION, type: "POPUP_SIGN_IN" });
  applyInitState(response);
  render();
}

async function onSignOut(): Promise<void> {
  await sendToSw<null>({ version: MESSAGE_VERSION, type: "POPUP_SIGN_OUT" });
  state = { view: "unauthenticated" };
  render();
}

async function onSaveProfile(resumeContent: string): Promise<void> {
  if (!resumeContent.trim()) return;

  const btn = document.querySelector<HTMLButtonElement>(".btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  const response = await sendToSw<null>({
    version: MESSAGE_VERSION,
    type: "POPUP_SAVE_PROFILE",
    payload: { resumeContent: resumeContent.trim() },
  });

  if (!response.ok) {
    state = { view: "error", message: response.error };
  } else {
    state = { view: "idle" };
  }
  render();
}

async function onExtract(): Promise<void> {
  state = { view: "extracting" };
  render();

  const response = await sendToSw<DraftState>({ version: MESSAGE_VERSION, type: "TRIGGER_EXTRACT" });
  if (!response.ok) {
    state = { view: "error", message: response.error };
  } else {
    state = { view: "reviewing", draft: response.data };
  }
  render();
}

async function onConfirm(draft: DraftState): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>(".btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }

  const response = await sendToSw<{ submittedAt: string }>({
    version: MESSAGE_VERSION,
    type: "POPUP_CONFIRM_SUBMIT",
    payload: { applicationId: draft.applicationId, variantId: draft.variantId },
  });

  if (!response.ok) {
    state = { view: "error", message: response.error };
  } else {
    state = {
      view: "confirmed",
      company: draft.company,
      roleTitle: draft.roleTitle,
      submittedAt: response.data.submittedAt,
    };
  }
  render();
}

function applyInitState(response: Response<InitState>): void {
  if (!response.ok) {
    state = { view: "error", message: response.error };
    return;
  }
  const { isAuthenticated, hasProfile, draft } = response.data;
  if (!isAuthenticated) {
    state = { view: "unauthenticated" };
  } else if (!hasProfile) {
    state = { view: "setup" };
  } else if (draft) {
    state = { view: "reviewing", draft };
  } else {
    state = { view: "idle" };
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const response = await sendToSw<InitState>({ version: MESSAGE_VERSION, type: "POPUP_INIT" });
  applyInitState(response);
  render();
}

document.addEventListener("DOMContentLoaded", init);
