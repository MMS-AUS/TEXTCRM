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
npm run dev                      # api on :3000, web on :5173
```

Open http://localhost:5173 — the placeholder page should say **API: ok**.

## Scripts (run from the repo root)

| Script                      | Does                                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| `npm run dev`               | API (auto-restarts on change) and web together                       |
| `npm run build`             | Typecheck the API, production build of the web app                   |
| `npm test`                  | Unit tests (no database needed)                                      |
| `npm run test:integration`  | Database tests against `crm_test` (needs `db:up`)                    |
| `npm run lint`              | ESLint                                                               |
| `npm run typecheck`         | `tsc --noEmit` in every workspace                                    |
| `npm run format`            | Prettier                                                             |
| `npm run db:up` / `db:down` | Start / stop the Postgres container (data is kept in a named volume) |
| `npm run db:generate`       | Write a new SQL migration after changing `apps/api/src/db/schema/`   |
| `npm run db:migrate`        | Apply pending migrations to `DATABASE_URL`                           |
| `npm run db:seed`           | Idempotent reference-data seed (safe to re-run)                      |
| `npm run db:studio`         | Drizzle Studio — browse the database                                 |
| `npm run db:reset`          | **Dev only:** wipe the local database and re-apply migrations        |

## Database

- Local Postgres 18 in Docker, bound to `127.0.0.1:5432`, user/password/db `crm`/`crm`/`crm`.
  A second database, `crm_test`, is created on first start for integration tests.
- Schema: `apps/api/src/db/schema/`. Migrations: `apps/api/drizzle/` (generated — commit them,
  never edit applied ones).
- To start completely fresh (deletes all local data): `docker compose down -v`, then `npm run db:up`.

## Secrets

`.env` and `claude_code_CRM_SECRETS.md` are gitignored. Never commit real credentials;
`.env.example` lists names only.
