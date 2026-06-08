# Job Apply Agent — Development Conventions

## Stack

| Layer | Tech |
|---|---|
| Backend | TypeScript · Express v5 · Drizzle ORM · Postgres · Anthropic SDK |
| Extension | TypeScript · Chrome MV3 · esbuild |
| Tests | Node built-in test runner (`node:test`) via `tsx --test` |

## Commands

```sh
# Backend (project/backend/)
npm run dev          # tsx watch — hot reload on :3001
npm test             # run all *.test.ts files
npm run db:generate  # generate migration from schema changes
npm run db:migrate   # apply migrations to DATABASE_URL
npm run db:studio    # open Drizzle Studio (DB browser)
npm run build        # tsc → dist/

# Extension (project/extension/)
npm run build        # esbuild → dist/ (one-shot)
npm run dev          # esbuild watch mode
npm run typecheck    # tsc --noEmit
```

## Dev mode (no Google OAuth)

Set `DEV_USER_ID=dev-user-local` in `backend/.env` — the backend skips Google token
verification and assigns that string as the user ID.

Set `DEV_MODE = true` in `extension/src/config.ts` — the service worker returns a
dummy token instead of calling `chrome.identity.getAuthToken`.

Both must be active together. Rebuild the extension after toggling DEV_MODE.

## Critical invariants (do not break)

**§2.1 Human-confirm boundary** — the only path to `submitted` state is
`POST /applications/:id/confirm`, triggered by an explicit user action in the popup.
The backend enforces this via `assertTransition(state, "submitted")`.

**§2.2 Variant immutability** — `variants` has no `updated_at`. Re-tailoring inserts
a new row. `applications.submitted_variant_id` is set once at the confirm boundary
and never changed.

**§2.3 Credential isolation** — the content script never receives an auth token.
All backend calls go through the service worker.

## Schema changes

Always run `npm run db:generate` after editing `src/db/schema.ts`, then
`npm run db:migrate` to apply. Commit the generated SQL in `drizzle/`.

## Code style

- No comments unless the WHY is non-obvious (not the what)
- No `updated_at` on `variants` (intentional — variants are immutable)
- State machine transitions validated via `assertTransition` before any DB write
- Zod validates all external input at the route boundary; internal functions trust their callers
