# MMS CRM

CRM for Make My Solar. npm-workspaces monorepo:

| Path               | What                                                        |
| ------------------ | ----------------------------------------------------------- |
| `apps/api`         | Node 26 + Express 5 + Drizzle ORM (PostgreSQL)              |
| `apps/web`         | React 19 + Vite + Tailwind CSS v4                           |
| `packages/shared`  | zod schemas, types and constants shared by api and web      |
| `legacy-reference` | Data and code copied from the old app — read-only reference |

TypeScript runs natively on Node 26 (type stripping), so the API has no compile step:
relative imports use the `.ts` extension, and TS-only runtime syntax (`enum`, `namespace`) is
not allowed (`erasableSyntaxOnly`).

## Prerequisites

- Node.js 26 LTS (`.nvmrc`) — `node -v`
- Docker Desktop (WSL 2 backend on Windows), running — `docker -v`
- Git — `git --version`

## First-time setup

```powershell
npm install
Copy-Item .env.example .env      # skip if .env already exists
npm run db:up                    # start Postgres in Docker and wait until healthy
npm run db:migrate               # create the tables
npm run db:seed                  # load roles, option lists, hardware catalog
# Fill the Firebase values in .env (claude_code_CRM_SECRETS.md §2.2 Firebase), then add yourself:
npm run user:create -w @mms/api -- --email you@makemysolar.com.au --name "Your Name"
npm run dev                      # api on :3000, web on :5173
```

Open http://localhost:5173 and sign in with Google. The API refuses to start and lists any
missing `.env` values; the web shows a "Configuration missing" page for missing `VITE_*` values.

## Authentication

Firebase signs people in with Google; the API decides who gets in. Every tRPC call carries the
Firebase ID token, and the API requires a verified Google identity in `ALLOWED_EMAIL_DOMAIN`
**and** an active row in the `users` table (the allowlist). Permissions come from the user's role
(`role_permissions`); use `protectedProcedure` / `permissionProcedure(feature, action)` from
`apps/api/src/trpc/trpc.ts` for every new procedure.

## Design system

Tokens (colours, type, radius, shadows) live in `apps/web/src/index.css` for two theme styles —
Graphite and Make My Solar — each in light and dark (`<html data-theme="mms-dark">` etc., chosen
from the palette menu). Components are in `apps/web/src/ui/` — import them from `ui/index.ts`.
Screens use semantic colour utilities (`bg-surface`, `text-fg-muted`, `border-line`, …); Tailwind's
default palette is switched off. Open http://localhost:5173/design to see every component and state
(no sign-in needed).

Routes are defined in `apps/web/src/app/router.tsx` (TanStack Router); every page except `/design`
renders inside the protected layout and app shell (`apps/web/src/app/`).

## Scripts (run from the repo root)

| Script                                                                              | Does                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run dev`                                                                       | API, background worker and web together (auto-restart on change)                      |
| `npm run build`                                                                     | Typecheck the API, production build of the web app                                    |
| `npm test`                                                                          | Unit tests (no database needed)                                                       |
| `npm run test:integration`                                                          | Database tests against `crm_test` (needs `db:up`)                                     |
| `npm run lint`                                                                      | ESLint                                                                                |
| `npm run typecheck`                                                                 | `tsc --noEmit` in every workspace                                                     |
| `npm run format`                                                                    | Prettier                                                                              |
| `npm run db:up` / `db:down`                                                         | Start / stop the Postgres container (data is kept in a named volume)                  |
| `npm run db:generate`                                                               | Write a new SQL migration after changing `apps/api/src/db/schema/`                    |
| `npm run db:migrate`                                                                | Apply pending migrations to `DATABASE_URL`                                            |
| `npm run db:seed`                                                                   | Idempotent reference-data seed (safe to re-run)                                       |
| `npm run db:fake-leads [-- --count 10000]` / `-- --remove`                          | **Dev only:** add / remove made-up leads for performance testing                      |
| `npm run db:studio`                                                                 | Drizzle Studio — browse the database                                                  |
| `npm run db:reset`                                                                  | **Dev only:** wipe the local database and re-apply migrations                         |
| `npm run user:create -w @mms/api -- --email … --name "…" [--role admin]`            | Add or re-activate an allowlisted user                                                |
| `npm run legacy:migrate -- --as you@… [--commit] [--keep-both] [--include-suspect]` | One-off (Step 3.4): move the real records from the old CRM. Dry run unless `--commit` |

## File storage

Files (bills, photos, contracts) live in S3-compatible object storage: Cloudflare R2 in
production, and in development a local storage container (RustFS) that `npm run db:up` starts
next to Postgres — S3 API on `127.0.0.1:9000`, web console on `127.0.0.1:9001` (login
`crm-dev` / `crm-dev-secret`). The `S3_*` values in `.env.example` work as-is locally; the API
creates the bucket and its browser-upload (CORS) rule on start. Browsers upload and download
directly with short-lived presigned URLs that the API only issues after a permission check.

## Imports and Google Sheets

Settings → Import loads leads or contacts from a CSV/XLSX upload or a Google Sheet: map the
columns, preview what every row will do (create / update / skip / error), confirm, and the
worker runs it in the background. Nothing changes before you confirm, and re-importing the same
sheet never creates duplicates (rows are matched by `Lead ID`, then by the duplicate rules).

Google Sheets are read with a service account: set `GOOGLE_SERVICE_ACCOUNT_PATH` in `.env` to
its JSON key (kept outside the repo), then share each sheet with the service account's email as
**Viewer**. Without it, uploads still work and the wizard explains what is missing.

Settings → Live sheet sync keeps lead-intake sheets flowing in: every
`SHEETS_SYNC_INTERVAL_MINUTES` (default 5) the worker reads each enabled sheet. Each row needs a
unique `Lead ID`. The sheet creates leads; once anyone changes a lead in the CRM, the sheet never
changes it again. The CRM never writes to the sheet. Every run, with its row errors, is listed
in Settings.

## Database

- Local Postgres 18 in Docker, bound to `127.0.0.1:5432`, user/password/db `crm`/`crm`/`crm`.
  A second database, `crm_test`, is created on first start for integration tests.
- Schema: `apps/api/src/db/schema/`. Migrations: `apps/api/drizzle/` (generated — commit them,
  never edit applied ones).
- To start completely fresh (deletes all local data): `docker compose down -v`, then `npm run db:up`.

## Secrets

`.env` and `claude_code_CRM_SECRETS.md` are gitignored. Never commit real credentials;
`.env.example` lists names only.
