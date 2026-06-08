# Job Apply Agent

> An AI-powered job application assistant — tailors your resume and cover letter to every posting, pre-fills the form, and waits for your one-click confirm before anything is submitted.

---

## What it does

1. **Reads the job posting** on whatever page you're viewing
2. **Tailors your resume + cover letter** to that specific job description using Claude AI
3. **Pre-fills the application form** fields detected on the page
4. **Waits for your explicit confirm** — the agent never submits anything on its own
5. *(Planned)* **Classifies outcomes** from your inbox — rejections, ghosting, interview invites — and correlates them against which resume variant you sent to surface patterns

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                            │
│                                                         │
│  ┌─────────────┐   messages   ┌──────────────────────┐  │
│  │   Popup UI  │◄────────────►│   Service Worker     │  │
│  └─────────────┘              │  (holds auth token)  │  │
│                               └──────────┬───────────┘  │
│  ┌─────────────┐   messages            │ │              │
│  │Content Script│◄──────────────────────┘ │              │
│  │ (reads DOM, │                          │ REST         │
│  │  fills form)│                          ▼              │
└──────────────────────────────────────────────────────────┘
                                   ┌──────────────┐
                                   │   Backend    │
                                   │  Express v5  │
                                   │  Drizzle ORM │
                                   │  Postgres    │
                                   │  Claude API  │
                                   └──────────────┘
```

Three components with a strict responsibility split:

| Component | Responsibility |
|---|---|
| **Extension popup** | UI for review, confirm, and profile management |
| **Service worker** | Coordinates between popup ↔ content script ↔ backend; holds the auth token |
| **Content script** | Reads job page DOM; fills form after human confirm — never touches credentials |
| **Backend** | Owns everything durable: profiles, application log, variant store, LLM calls |

---

## Stack

| Layer | Tech |
|---|---|
| Backend | TypeScript · Express v5 · Drizzle ORM · PostgreSQL · Anthropic SDK |
| Extension | TypeScript · Chrome MV3 · esbuild |
| Auth | Google OAuth 2.0 (via `chrome.identity`) |
| AI | Claude Sonnet (resume + cover letter tailoring) |
| Tests | Node built-in `node:test` runner |

---

## Data model

```
profiles
  └── applications (one per job)
        ├── jd_snapshot        — job description text captured at apply time
        ├── company, role_title, job_attributes
        ├── state              — see state machine below
        └── submitted_variant_id (FK, immutable once set)
              └── variants
                    ├── resume_content
                    └── cover_letter_content   (no updated_at — variants never mutate)
```

### Application state machine

```
draft
  └─► ready_for_review    (tailoring complete)
        └─► submitted     ◄── human-confirm boundary (only path to submitted)
              ├─► responded
              ├─► rejected
              ├─► ghosted
              └─► interview
```

---

## Key design constraints

**Human-confirm boundary** — `POST /applications/:id/confirm` is the *only* path to `submitted` state. The agent never auto-submits. This keeps the system within the ToS of LinkedIn, Greenhouse, Workday, and every other major ATS.

**Variant immutability** — `variants` has no `updated_at`. Re-tailoring always inserts a new row. Once `submitted_variant_id` is set on an application it never changes. This is what makes the rejection-analytics correlation trustworthy.

**Credential isolation** — the content script (injected into untrusted job pages) never receives an auth token. All backend calls go through the service worker, which holds the token in `chrome.storage.session`.

---

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL (local or Docker)
- [Anthropic API key](https://console.anthropic.com/)
- Google Cloud project with OAuth 2.0 credentials (for the extension's `client_id`)

### Backend

```bash
cd backend
cp .env.example .env
# Fill in DATABASE_URL, ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID
npm install
npm run db:migrate
npm run dev          # starts on :3001
```

### Extension

```bash
cd extension
npm install
npm run build        # compiles to dist/
```

Load the extension in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder

---

## Dev mode (no Google OAuth)

Set in `backend/.env`:
```
DEV_USER_ID=dev-user-local
```

Set in `extension/src/config.ts`:
```ts
export const DEV_MODE = true;
```

Rebuild the extension after toggling `DEV_MODE`. Both flags must be active together — the backend skips token verification and the service worker returns a dummy token.

---

## Commands

```bash
# Backend
npm run dev          # hot reload on :3001
npm test             # run all *.test.ts
npm run db:generate  # generate migration from schema changes
npm run db:migrate   # apply migrations
npm run db:studio    # open Drizzle Studio (DB browser)
npm run build        # compile to dist/

# Extension
npm run build        # esbuild → dist/ (one-shot)
npm run dev          # esbuild watch mode
npm run typecheck    # tsc --noEmit
```

---

## Project structure

```
project/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.ts          — Drizzle table definitions
│   │   │   ├── state-machine.ts   — assertTransition + state logic
│   │   │   └── types.ts
│   │   ├── middleware/
│   │   │   └── auth.ts            — Google token verification
│   │   ├── routes/
│   │   │   ├── draft.ts           — POST /draft (JD → tailored variant)
│   │   │   ├── confirm.ts         — POST /applications/:id/confirm
│   │   │   └── profile.ts         — GET/PUT /profile
│   │   └── services/
│   │       └── tailor.ts          — Claude API call
│   └── drizzle/                   — generated migration SQL
└── extension/
    ├── src/
    │   ├── background/
    │   │   ├── service-worker.ts  — message router, auth token, backend calls
    │   │   ├── api.ts             — typed fetch wrappers
    │   │   └── auth.ts            — chrome.identity wrapper
    │   ├── content/
    │   │   └── content.ts         — DOM extraction + form filling
    │   ├── popup/
    │   │   └── popup.ts           — UI logic
    │   └── messages/
    │       └── types.ts           — versioned message contract (MESSAGE_VERSION = "v1")
    ├── manifest.json
    └── popup.html
```

---

## Roadmap

- [x] Backend: profiles, applications, variants, state machine
- [x] Extension: service worker, content script, popup, versioned message contract
- [x] End-to-end: JD extraction → tailoring → human-confirm → form fill
- [ ] Per-ATS form adapters (Workday, Greenhouse, Lever)
- [ ] Email ingestion via Gmail API
- [ ] Outcome classification (rejection / interview / ghosted)
- [ ] Rejection analytics dashboard — correlate variant features against outcomes

---

## License

MIT
