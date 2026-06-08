// Versioned message contract for the extension.
// All three contexts (popup, service worker, content script) must agree on this version.
// Bump MESSAGE_VERSION on any breaking change to the shape of any message below.
export const MESSAGE_VERSION = "v1" as const;
type Version = typeof MESSAGE_VERSION;

// ── Popup → Service Worker ────────────────────────────────────────────────────

export interface PopupInitMessage {
  version: Version;
  type: "POPUP_INIT";
}

export interface PopupSignInMessage {
  version: Version;
  type: "POPUP_SIGN_IN";
}

export interface PopupSignOutMessage {
  version: Version;
  type: "POPUP_SIGN_OUT";
}

export interface PopupSaveProfileMessage {
  version: Version;
  type: "POPUP_SAVE_PROFILE";
  payload: { resumeContent: string };
}

export interface TriggerExtractMessage {
  version: Version;
  type: "TRIGGER_EXTRACT";
}

export interface PopupConfirmSubmitMessage {
  version: Version;
  type: "POPUP_CONFIRM_SUBMIT";
  payload: { applicationId: string; variantId: string };
}

// ── Service Worker → Content Script ──────────────────────────────────────────

export interface ExtractJdMessage {
  version: Version;
  type: "EXTRACT_JD";
}

export interface FillFormMessage {
  version: Version;
  type: "FILL_FORM";
  payload: {
    company: string;
    roleTitle: string;
    resumeContent: string;
    coverLetterContent: string;
    userName: string;
    userEmail: string;
    autoSubmit: boolean;
  };
}

// ── Content Script → Service Worker ──────────────────────────────────────────

export interface JdExtractedMessage {
  version: Version;
  type: "JD_EXTRACTED";
  payload: {
    jobDescription: string;
    company: string;
    roleTitle: string;
    detectedFields: DetectedField[];
  };
}

// ── Shared payload types ──────────────────────────────────────────────────────

export interface DetectedField {
  selector: string;
  fieldType: "resume" | "cover_letter" | "name" | "email" | "phone" | "unknown";
  label: string;
}

export interface DraftState {
  applicationId: string;
  variantId: string;
  company: string;
  roleTitle: string;
  resumeContent: string;
  coverLetterContent: string;
}

export interface InitState {
  isAuthenticated: boolean;
  hasProfile: boolean;
  draft: DraftState | null;
}

// ── Union types ───────────────────────────────────────────────────────────────

export type PopupToSwMessage =
  | PopupInitMessage
  | PopupSignInMessage
  | PopupSignOutMessage
  | PopupSaveProfileMessage
  | TriggerExtractMessage
  | PopupConfirmSubmitMessage;

export type SwToContentMessage = ExtractJdMessage | FillFormMessage;

export type ContentToSwMessage = JdExtractedMessage;

// ── Response shapes ───────────────────────────────────────────────────────────

export interface OkResponse<T> {
  ok: true;
  data: T;
}

export interface ErrResponse {
  ok: false;
  error: string;
}

export type Response<T> = OkResponse<T> | ErrResponse;
