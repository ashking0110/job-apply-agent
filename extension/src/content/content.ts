import {
  MESSAGE_VERSION,
  SwToContentMessage,
  DetectedField,
  Response,
} from "../messages/types";

// ── DOM extraction ────────────────────────────────────────────────────────────

function extractText(selectors: string[]): string {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return "";
}

function extractJobTitle(): string {
  return (
    extractText([
      '[data-testid="job-title"]',
      ".job-title",
      ".posting-headline h2",
      'h1[class*="title"]',
      'h2[class*="title"]',
      "h1",
    ]) || document.title.split(/[-|·]/)[0].trim()
  );
}

function extractCompany(): string {
  const fromDom = extractText([
    '[data-testid="employer-name"]',
    ".company-name",
    '[itemprop="hiringOrganization"] [itemprop="name"]',
    '[itemprop="hiringOrganization"]',
    'meta[property="og:site_name"]',
    '[class*="company-name"]',
    '[class*="employer-name"]',
  ]);
  if (fromDom) return fromDom;

  // Fall back to hostname: "jobs.databricks.com" → "Databricks"
  const host = location.hostname.replace(/^www\.|^jobs\./, "");
  const domain = host.split(".")[0];
  return domain ? domain.charAt(0).toUpperCase() + domain.slice(1) : "";
}

function extractJobDescription(): string {
  const candidates = [
    '[data-testid="job-description"]',
    ".job-description",
    '[class*="description"]',
    "#job-description",
    "#jobDescriptionText",
    '[class*="jobDescription"]',
    "article",
    "main",
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent?.trim() ?? "";
      if (text.length > 200) return text.slice(0, 8000); // cap to avoid token blowout
    }
  }
  return document.body.textContent?.trim().slice(0, 8000) ?? "";
}

// ── Form field detection ──────────────────────────────────────────────────────

const FIELD_PATTERNS: Array<{ pattern: RegExp; fieldType: DetectedField["fieldType"] }> = [
  { pattern: /resume|cv|curriculum/i, fieldType: "resume" },
  { pattern: /cover.?letter/i, fieldType: "cover_letter" },
  { pattern: /full.?name|^name$|your name/i, fieldType: "name" },
  { pattern: /first.?name|given.?name|forename/i, fieldType: "name" },
  { pattern: /last.?name|family.?name|surname/i, fieldType: "name" },
  { pattern: /email/i, fieldType: "email" },
  { pattern: /phone|mobile|tel/i, fieldType: "phone" },
];

function classifyByText(text: string): DetectedField["fieldType"] {
  const lower = text.toLowerCase();
  for (const { pattern, fieldType } of FIELD_PATTERNS) {
    if (pattern.test(lower)) return fieldType;
  }
  return "unknown";
}

function getLabelText(el: Element): string {
  const parts: string[] = [];
  if (el.id) {
    const lbl = document.querySelector(`label[for="${el.id}"]`);
    if (lbl) parts.push(lbl.textContent ?? "");
  }
  parts.push(
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("placeholder") ?? "",
    el.getAttribute("name") ?? "",
    el.closest("label")?.textContent ?? "",
  );
  return parts.join(" ");
}

function detectFormFields(): DetectedField[] {
  const fields: DetectedField[] = [];
  const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="file"], textarea'
  );

  inputs.forEach((el) => {
    const labelText = getLabelText(el);
    const fieldType = classifyByText(labelText);
    if (fieldType === "unknown" && el.tagName === "INPUT") return;

    const label = labelText.trim() || el.getAttribute("name") || "unlabeled";
    const selector = el.id
      ? `#${el.id}`
      : el.getAttribute("name")
      ? `[name="${el.getAttribute("name")}"]`
      : el.tagName.toLowerCase();

    fields.push({ selector, fieldType, label });
  });

  return fields;
}

// ── Form filling ──────────────────────────────────────────────────────────────

function fillElement(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.focus();
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  nativeSetter?.call(el, value);
  el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: value }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

// Collect every text signal associated with an input: attributes + DOM context.
function getFieldContext(el: HTMLElement): string {
  const parts: string[] = [
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("placeholder") ?? "",
    el.getAttribute("name") ?? "",
    el.getAttribute("id") ?? "",
    el.getAttribute("autocomplete") ?? "",
    el.getAttribute("data-field-id") ?? "",
    el.getAttribute("data-qa") ?? "",
  ];

  // aria-labelledby → text of the referenced element
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(" ")) {
      parts.push(document.getElementById(id)?.textContent ?? "");
    }
  }

  // Explicit <label for="...">
  if (el.id) {
    parts.push(document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "");
  }

  // Enclosing <label>
  parts.push(el.closest("label")?.textContent ?? "");

  // Walk up the DOM and grab text from preceding siblings (div-based labels like Greenhouse)
  let node: Element = el;
  for (let depth = 0; depth < 5; depth++) {
    const parent = node.parentElement;
    if (!parent) break;
    let sib = node.previousElementSibling;
    while (sib) {
      const t = sib.textContent?.trim() ?? "";
      if (t && t.length < 120 && !sib.querySelector("input,textarea,select")) {
        parts.push(t);
        break;
      }
      sib = sib.previousElementSibling;
    }
    node = parent;
  }

  return parts.filter(Boolean).join(" ");
}

type FillData = {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  coverLetterContent: string;
  resumeContent: string;
};

function tryFill(el: HTMLInputElement | HTMLTextAreaElement, context: string, data: FillData): boolean {
  if ((el as HTMLInputElement).type === "file") return false;
  const c = context.toLowerCase();

  // autocomplete attribute is the most reliable signal
  const ac = el.getAttribute("autocomplete") ?? "";
  if (ac === "given-name" || /first.?name|given.?name|forename/i.test(c)) {
    if (data.firstName) { fillElement(el, data.firstName); return true; }
  }
  if (ac === "family-name" || /last.?name|family.?name|surname/i.test(c)) {
    if (data.lastName) { fillElement(el, data.lastName); return true; }
  }
  if (ac === "name" || /full.?name/i.test(c)) {
    if (data.fullName) { fillElement(el, data.fullName); return true; }
  }
  if (ac === "email" || /\bemail\b/i.test(c)) {
    if (data.email) { fillElement(el, data.email); return true; }
  }
  if (/cover.?letter/i.test(c) && el.tagName === "TEXTAREA") {
    if (data.coverLetterContent) { fillElement(el, data.coverLetterContent); return true; }
  }
  if (/(resume|cv)\b/i.test(c) && el.tagName === "TEXTAREA") {
    if (data.resumeContent) { fillElement(el, data.resumeContent); return true; }
  }
  return false;
}

function findSubmitButton(): HTMLElement | null {
  const explicit = document.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]');
  if (explicit) return explicit;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']"))) {
    if (/submit\s*application|apply\s*now|send\s*application/i.test(el.textContent ?? "")) return el;
  }
  return null;
}

function fillOnce(data: FillData): number {
  const filled = new Set<Element>();
  const sel = 'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], textarea';

  for (const el of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(sel))) {
    if (filled.has(el)) continue;
    const context = getFieldContext(el);
    if (tryFill(el, context, data)) {
      console.log(`[fill] filled "${el.getAttribute("name") || el.id || el.tagName}" via context: "${context.slice(0, 80)}"`);
      filled.add(el);
    }
  }

  console.log(`[fill] filled ${filled.size} field(s) — inputs on page: ${document.querySelectorAll(sel).length}`);
  return filled.size;
}

async function fillForm(payload: {
  company: string;
  roleTitle: string;
  resumeContent: string;
  coverLetterContent: string;
  userName: string;
  userEmail: string;
  autoSubmit: boolean;
}): Promise<void> {
  const nameParts = (payload.userName ?? "").trim().split(/\s+/);
  const data: FillData = {
    firstName: nameParts[0] ?? "",
    lastName: nameParts.slice(1).join(" "),
    fullName: payload.userName ?? "",
    email: payload.userEmail ?? "",
    coverLetterContent: payload.coverLetterContent,
    resumeContent: payload.resumeContent,
  };

  // Retry up to 6× (3 s) in case the SPA hasn't rendered the form yet
  let filled = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
    filled = fillOnce(data);
    if (filled > 0) break;
  }

  // Only auto-submit if we actually filled something — avoids resetting forms on failure
  if (payload.autoSubmit && filled > 0) {
    await new Promise((r) => setTimeout(r, 800));
    const btn = findSubmitButton();
    if (btn) {
      console.log("[fill] clicking submit:", btn.textContent?.trim());
      btn.click();
    } else {
      console.warn("[fill] no submit button found");
    }
  } else if (payload.autoSubmit && filled === 0) {
    console.warn("[fill] skipped auto-submit — no fields were filled");
  }
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (rawMessage: unknown, _sender, sendResponse) => {
    const message = rawMessage as SwToContentMessage;

    if (!message || (message as { version?: string }).version !== MESSAGE_VERSION) {
      sendResponse({ ok: false, error: "Version mismatch" } satisfies Response<never>);
      return false;
    }

    switch (message.type) {
      case "EXTRACT_JD": {
        const jobDescription = extractJobDescription();
        const company = extractCompany();
        const roleTitle = extractJobTitle();
        const detectedFields = detectFormFields();

        sendResponse({
          ok: true,
          data: { jobDescription, company, roleTitle, detectedFields },
        } satisfies Response<{ jobDescription: string; company: string; roleTitle: string; detectedFields: DetectedField[] }>);
        return false;
      }

      case "FILL_FORM": {
        fillForm(message.payload).then(() => {
          sendResponse({ ok: true, data: null } satisfies Response<null>);
        });
        return true; // async response
      }

      default:
        return false;
    }
  }
);
