Job Application Agent — Architecture

This document is the design narrative for the project. It is the source of
truth for why the system is shaped the way it is. Read this before writing
code. Keep standing conventions (stack, commands, code style) in CLAUDE.md
instead — this file is the design, that file is the rules.


1. What this system is
An agent that assists with a job search end to end:

Reads the job posting on the page the user is viewing.
Tailors a resume + cover-letter variant to that specific job description.
Pre-fills the application form and presents it for a one-click human
confirm before anything is submitted.
(Later phase) Ingests the user's email, classifies outcomes (rejection,
ghosting, recruiter reply, interview invite), and correlates outcomes
against which variant was sent and which job attributes the role had —
surfacing patterns that tell the user how to fix their resume and targeting.

The genuinely novel and valuable part is #4, the rejection-analytics feedback
loop. Everything else is plumbing in service of producing trustworthy data
for that loop. Design decisions resolve in favor of whatever keeps that data
clean.

2. Hard constraints (do not design around these)
These are not preferences. They are the boundaries that keep the system within
bounds and keep its output trustworthy. Violating any of them silently breaks
the project.
2.1 Human-in-the-loop submission
The agent does everything up to submission — find role, tailor documents,
pre-fill the form, assemble the application — then stops and presents it for an
explicit one-click human confirm. The agent never submits unattended.
Rationale: most major job platforms (LinkedIn especially, and many ATS systems)
prohibit automated submission and actively detect and ban for it. The asset at
risk is the user's real professional identity — the exact reputation the tool
exists to protect. The human-confirm step preserves ~95% of the time savings
while keeping the system within terms. It is also the safety net for when
form-field mapping gets something wrong.
Prefer official ATS APIs where they exist. Treat anything requiring headless
browser automation against a bot-hostile site as human-supervised by design.
2.2 Variant immutability
A variant is a specific resume + cover-letter version produced for a specific
job. Once a variant is attached to a submitted application, it is immutable.
Re-tailoring produces a new variant row — it never edits an existing one.
Rationale: the entire analytics value proposition depends on being able to
state, with certainty, "this exact framing went to this exact job and got this
exact outcome." A mutable or loosely-linked variant makes the correlation layer
worthless. This constraint is load-bearing.
2.3 Credential isolation
The content script (injected into job pages, least-trusted context) never
sees the backend auth token. It requests actions through the service worker,
which holds the credential. Token lives in chrome.storage.session (cleared on
browser close, not readable by content scripts), never localStorage.

3. Components and responsibility split
Three components. The split is deliberate; keep it strict.
3.1 Extension (thin client)
Does only what requires being in the browser:

Hosts the UI surface (popup / side panel) for review and confirm.
Coordinates between content script and backend via the service worker.
Holds no durable state and no business logic.

Manifest V3 reality: the background context is a service worker that is
killed aggressively when idle. Anything treated as "running" there will
silently not be. The extension is a renderer and a coordinator, nothing more.
3.2 Content script (page-injected, isolated world)
A distinct piece, not part of the extension's main logic:

The only thing that can read the job page DOM: JD, company, role title,
detectable form fields.
Fills the form from confirmed data after human confirm.
Talks only to the service worker via message passing. Never talks to the
backend directly. Never holds credentials.

3.3 Backend (owns everything that matters)

Master profile storage.
Application log and immutable variant store.
JD-tailoring LLM calls.
(Later) email ingestion + outcome classification + correlation engine.

Build the backend as if the extension is one of several possible clients. The
analytics surface wants to be a web dashboard later, not a popup — don't couple
backend logic to the extension.

4. Data model
Relational (Postgres). The eventual money question — "which variant features
predict callbacks" — is a join across applications, variants, and outcomes.
That access pattern is firmly relational; do not use document storage here.
Three core tables:
profiles
The user's master data (the source content from which variants are tailored).
One row per user for the single-user build; structured for multi-user later.
applications
One row per job applied to.

id
profile_id (FK)
jd_snapshot — the job description text captured at apply time. Snapshot,
not a live reference: postings disappear and the analytics must still work.
company, role_title, and structured job attributes extracted at capture
(seniority framing, stack, remote/onsite, etc.) — these are the features the
correlation engine joins outcomes against, so capture them at apply time.
state — see the state machine in §5.
submitted_variant_id (FK, nullable until submitted) — the variant frozen
onto this application. Set once, at submission. Never changed.
timestamps for each state transition.

variants
Immutable resume + cover-letter versions.

id
application_id (FK — the application this was produced for)
resume_content, cover_letter_content
created_at
No updated_at. Variants are never updated. Re-tailoring inserts a new row.

The join that the entire product is built to serve:
applications ⋈ variants (on submitted_variant_id) ⋈ outcome state →
"which variant features correlate with which outcomes."
Design the schema for this join from day one.

5. Application state machine
Define this explicitly now. The post-submitted states are populated later by
the email pipeline, but the schema must anticipate them today — retrofitting
outcome states onto a log not designed for them loses data.
draft
  → ready_for_review        (variant produced, awaiting human confirm)
    → submitted             (human confirmed; variant frozen onto application)
      → responded           (any human reply received)
      → rejected            (rejection detected)
      → ghosted             (no response past a threshold window)
      → interview           (interview invite detected)

draft → ready_for_review: tailoring complete.
ready_for_review → submitted: the human-confirm boundary (§2.1). This
transition is the only path to submitted. submitted_variant_id is set
here and is immutable thereafter.
submitted → {responded | rejected | ghosted | interview}: populated by the
email pipeline in the later phase. Terminal states.

The entire feedback engine is just: transitions into the terminal states,
correlated against the frozen variant and the captured job attributes.

6. Auth model

Single identity system via Google OAuth. Use it now even before email
integration — the Gmail phase needs Google OAuth anyway, so avoid building a
throwaway auth system first.
Extension obtains a token via the OAuth flow.
Token stored in chrome.storage.session.
Content script never receives the token (§2.3). It requests actions; the
service worker attaches the credential and calls the backend.
Do not roll session cookies — MV3 service workers + cross-origin make that
fragile.


7. Message-passing contract
Three contexts (content script ↔ service worker ↔ backend) passing loosely
typed messages is the part of an MV3 extension that rots fastest. Define an
explicit, versioned tagged-union of message types before writing handlers.
Initial message types (extend as needed, keep them versioned):

EXTRACT_JD — service worker → content script: read the page.
JD_EXTRACTED — content script → service worker: JD + fields payload.
REQUEST_DRAFT — service worker → backend: JD + profile, get tailored draft.
DRAFT_READY — backend → service worker → UI: assembled draft for review.
CONFIRM_SUBMIT — UI → service worker: human confirmed (the §2.1 boundary).
FILL_FORM — service worker → content script: fill from confirmed data.

Version the contract so a Chrome change to service-worker behavior (it happens)
doesn't silently break message handling.

8. Build order
Deliberately sequential. Each step de-risks the next. Do not build all four
capabilities in parallel.
Step 1 — Backend, no extension
Three tables, the state machine, and one endpoint: receive JD + profile,
return a tailored draft. Test with curl. Get variant immutability and the state
model correct while it is cheap to change. Start here.
Step 2 — Extension scaffold, mocked backend
Service worker + content script + popup + the versioned message contract,
talking to a mocked backend response. This isolates MV3 quirks (service
worker lifecycle, content-script injection timing, permissions) from business
logic so each hard thing is debugged alone.
Step 3 — Connect them + the human-confirm step
Wire real backend to the extension. Implement the ready_for_review → submitted boundary (§2.1) as a real, explicit user action.
Step 4 — Email integration (later phase, not now)
Gmail API via OAuth (not tab scraping). Outcome classification
(rejection / interview / recruiter / ghost) as a structured-extraction task.
Plugs into a backend that already has clean application + variant records
waiting for outcomes to attach to. The classifier is worthless without a
trustworthy log to correlate against — which is why the log must be solid
first.

9. Known hard parts (budget for these)

Form-field detection across sites is the messiest engineering in the whole
project. Workday, Greenhouse, Lever, and bespoke career pages structure
forms differently. Do not attempt one universal filler. Plan for per-ATS
adapters. The human-confirm step (§2.1) is also the safety net for when an
adapter mis-maps a field.
MV3 service worker lifecycle. It will be killed when idle. Never hold
state or assume continuity there. Step 2 exists specifically to surface this
early.
Outcome classification ambiguity (later phase). "We'll keep your resume
on file" is a rejection; auto-acknowledgements are not outcomes. Treat the
classifier's output as needing a confidence threshold and a human-review
queue for low-confidence cases, rather than blindly transitioning state.


10. First-session sanity check
Before generating code: restate this design and the build order back, in your
own words, and explicitly confirm how the schema enforces §2.2 (variant
immutability) and how the flow enforces §2.1 (human-confirm boundary). These
two constraints are the ones that quietly break the project if not respected.
Surface any misread now, while it is free to correct.