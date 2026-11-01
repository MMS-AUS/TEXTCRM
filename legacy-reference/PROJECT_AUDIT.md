# MMSCRM V2.0 — Architectural Audit

**Date:** 2 November 2026
**Scope:** Entire repository — `server/`, `src/`, `supabase/`, root `.json` data files, config, build tooling
**Method:** Static analysis of every source area, live runs of the dev server and production builds, API probing, inspection of all data files. Every claim below is backed by something observed in the code or at runtime; where something could not be verified it is marked as such.

---

## Executive summary

- **This is a solar-installer CRM/ERP prototype, not a working product.** It *looks* complete (16 screens, 24 settings modals, 15 integrations), but most of that surface is UI over fake data, browser-only storage, or integrations that have never been connected.
- **Real business data in the system: 5 customers, 1 project.** Everything else — staff users, company profile, "connected" integrations, integration credentials — is invented placeholder content.
- **The code has three competing places it stores data** (an unreachable Supabase database, JSON files on the server's disk, and each user's browser). The same record can exist in all three with different values.
- **The API's source code is effectively lost.** `server/app.ts` (189 KB) is *compiled, minified build output* that was saved over the original source, with type-checking disabled.
- **The UI cannot be redesigned without rewriting it.** 56,000 lines of components, 10,757 inline style declarations, zero shared UI components.
- **What is genuinely valuable:** the domain knowledge (how an Australian solar install job flows, captured in types and ~60 dropdown lists), a real equipment catalog of 2,288 panels/inverters/batteries, and roughly 6,500 lines of integration client code that talks to the real vendor APIs.
- **Verdict: Rebuild, harvesting the valuable 15–20%.** Fixing in place would mean rewriting ~80% of the code anyway, while being constrained by the old structure. Details and estimates in §6.

---

## 1. What is this project?

MMSCRM ("MySolarCRM") is a CRM and operations system for an **Australian residential solar and battery installer** (Make My Solar). It is designed to carry a customer from first enquiry to a finished, paid, compliant installation: **leads** arrive from Google Sheets, Meta (Facebook/Instagram) ads, the website and referral partners; sales staff call, SMS, WhatsApp and email them from inside the CRM; a lead is **converted into a project** that moves through install stages (design in OpenSolar, finance approval, grid-connection application with the electricity distributor, installer booking, meter connection); compliance paperwork for government **STC rebates** is pushed to BridgeSelect; invoices go to **Xero**; after installation, a **service/ticket** module handles warranty claims and faults. Around this core sit back-office modules — sales orders, install orders with subcontractor quoting, referral bonuses, maintenance schedules, a simple HR module, a P&L view — and two external **portals** for customers and installers to track jobs. The problem it solves is real and well-understood: replacing a patchwork of spreadsheets and separate tools with one system where sales, operations and service share the same customer record.

---

## 2. Feature inventory

**Legend:** ✅ Fully implemented (backend + frontend work) · ⚠️ Partial (UI exists, backend broken/fake/browser-only) · ❌ Missing/broken · 🗑️ Dead code / leftovers

> "Works" is judged against today's reality: the Supabase database is unreachable, so every ✅ feature currently runs on the local JSON-file fallback, which is not a production-grade store.

### 2.1 Core CRM

| Feature | Status | Evidence |
|---|---|---|
| Leads (list, edit, activities, statuses) | ✅ | `/api/leads` CRUD + `LeadsView`, `LeadEditModal`, `LeadDetailsLeftPanel`. Works on JSON fallback. Duplicate-record bug observed in real data. |
| Contacts | ✅ | `/api/contacts` + `ContactsView`. |
| Companies | ✅ | `/api/companies` + `CompaniesView`. 0 records. |
| Projects (pipeline, stages, details) | ✅ | `/api/projects` + `ProjectsView`, `ProjectDetailsLeftPanel` (2,600 lines). |
| Service tickets | ✅ | `/api/tickets` + `TicketsView`. 0 records. |
| Hardware catalog (panels/inverters/batteries) | ✅ | `/api/hardware-hierarchy`, Excel bulk import. Real catalog data (see §3). |
| Dropdown/option management, Excel mapping | ✅ | Stored in settings blob; ~60 option lists. |
| Dashboard | ✅ | Computed in the browser from loaded data (mixes server and browser-only data). |
| Lead → Project conversion | ⚠️ | Logic runs **in the browser** (`AppContext.convertLeadToProject`); a second, unused copy exists in `src/actions/`. |
| Login | ⚠️ | Firebase sign-in is real, **but** the login screen falls back to a local user list if Firebase fails (any user without a password gets in with any password), and ships a **"⚡ 1-Click Administrator Sign In (Dev Mode)"** button to everyone. Since Fix #1 the API rejects these fake sessions, so they see an empty app. |
| Users, invites, set-password | ⚠️ | Users are a JSON array inside a settings blob, not Firebase accounts. "Set password" is client-side. 4 fictional users. |
| Roles & permissions | ⚠️ | Enforced **only in the browser** (`hasPermission`). The server knows nothing about roles — any logged-in user can call any API. |
| Google Sheets lead sync | ⚠️ | Runs in the browser on a timer (the likely cause of the Supabase overage); only works if the sheet is shared publicly by link (downloads CSV without OAuth); created the duplicate lead seen in data. |
| System email / SMTP alerts | ⚠️ | Real `nodemailer` code; never configured — the only email log is a failed test to `smtp.example.com`. |
| Sales orders | ⚠️ | **Browser-only** (`localStorage`). No API, no DB table. Staff can't see each other's records. |
| Install orders & installer quotes | ⚠️ | Browser-only. |
| Subcontractors | ⚠️ | Browser-only. |
| Maintenance schedules | ⚠️ | Browser-only. |
| Referral bonuses | ⚠️ | Browser-only. |
| HRMS (employees, leave requests) | ⚠️ | Browser-only. |
| Customer reviews | ⚠️ | Browser-only. |
| Notifications | ⚠️ | Browser-only, per device. |
| P&L statement | ⚠️ | Client-side arithmetic over project fields; no accounting data source. |
| Company profile / branding | ⚠️ | Works (settings blob) but filled with a fictional company. |
| Customer portal | ❌ | No login, no API calls. Renders the *staff* app's in-memory data — cannot be used by a real customer on their own device. |
| Installer portal | ❌ | Same as customer portal. |
| Custom portal domains/subdomains | ❌ | UI only (a DNS lookup check); nothing provisions domains. |
| Settings → API Keys tab | ❌ | Its backend was the secret-leaking `/api/system/credentials` route, removed in Fix #1. |

### 2.2 Integrations

| Integration | Status | Evidence |
|---|---|---|
| Xero | ⚠️ | Real OAuth (verified: redirects to `login.xero.com`), invoices/contacts/quotes. Tokens are stored in Supabase → **cannot currently persist**. |
| Gmail | ⚠️ | Real OAuth, Gmail API, Pub/Sub push, refresh tokens. Not configured. Two competing connection flows (server OAuth vs. Firebase popup token). Credentials stored in unreachable Supabase. |
| WhatsApp (Meta Cloud API) | ⚠️ | Real Graph API calls. Settings contain fake IDs. `simulate-webhook` endpoint ships in production. |
| WhatsApp (Baileys / QR code) | ⚠️ | Real library + `simulate-pair` / `simulate-inbound` endpoints. Unofficial — risks a ban on the business number. |
| MessageMedia SMS | ⚠️ | Real API client. Not configured. |
| VoIPLine (click-to-call) | ⚠️ | API client exists (endpoint not verified against vendor docs). **Reports a call as "originating" even when the request fails** (`voipline.ts:184-199`). Placeholder API key. |
| OpenSolar | ⚠️ | Real API client + background queue polling every 30 s. Placeholder org ID `OS-ORG-84920`. |
| BridgeSelect (STC) | ⚠️ | Real API client + data mapper. Returns fake success only with test keys. Placeholder credentials `BS-TEST-KEY-88219`. |
| Mailchimp | ⚠️ | Real API, proxied via server. Not configured. |
| Meta Lead Ads | ⚠️ | Real webhook + Graph code; `test-webhook` endpoint fabricates leads (named "Sarah Jenkins") when no pages are connected. |
| Meta Conversions API | ⚠️ | Real hashing + Graph push. Not configured. |
| Microsoft Teams | ⚠️ | Real Graph API. **Swallows send errors and logs the message as delivered anyway** (`teams.ts:464-466`). |
| Google Calendar | ❌ | Shown as an integration; **no code exists**. |
| Google My Business | ❌ | Shown as an integration; **no code exists**. |
| Facebook Messenger | ❌ | Shown as "connected"; effectively no code. |
| Nearmap | ❌ | A key field only. |

> Every one of the 12 records in `.integrations_db.json` says `status: "connected"` with `lastSyncTime: "Real-time"` — and **every one has an empty `config: {}`**. The integrations screen is showing invented statuses.

### 2.3 Dead code and leftovers 🗑️

| Item | Why it's dead |
|---|---|
| `src/app/api/leads/[id]/convert/route.ts` | Empty Next.js API route in a Vite app. Never executed. |
| `src/types/next.d.ts`, all `NEXT_PUBLIC_*` env vars | Next.js leftovers. |
| `src/actions/convertLeadToProject.ts` (262 lines) | Imported nowhere. |
| Root `utils/` (3 files) | One-line re-exports, imported nowhere. |
| `@google/genai` dependency, `GEMINI_API_KEY` | No code uses it. Left over from Google AI Studio. |
| `metadata.json` | Google AI Studio applet manifest. |
| `vercel.json`, `DEPLOY_TO_CUSTOM_SUBDOMAIN.md` | Past deploy attempts for other platforms. |
| `bun.lock` alongside `package-lock.json` | Two package managers. |
| `tmp/find_inputs.py`, committed `dist/` | Scratch file and build output in the repo. |
| `/api/*/seed-if-empty`, `deleteDummyLeads`, `simulate-*` routes | Demo scaffolding shipped as production endpoints. |
| `src/data/initialData.ts` (1,234 lines) | Mock data used as the app's defaults. |
| SQL "copy this migration" endpoints and SQL inside UI components | Manual schema management through the UI. |
| `.app_config.json` | A second copy of secrets (Supabase service key, Xero secret) — not gitignored. |
| `.supabase_restriction.json` | Cached error state. |

---

## 3. Data model reality check

### 3.1 Where data lives — three competing stores

| Store | What's in it | State |
|---|---|---|
| **Supabase Postgres** (35 tables) | Intended primary DB | **Unreachable** (`fetch failed`); project restricted for exceeding its egress quota. |
| **JSON files on the server** (`.leads_db.json` etc.) | Leads, contacts, projects, settings, hardware | Actually serving the app today, as a silent fallback. Wiped on most redeploys. |
| **Browser `localStorage`** (39 keys) | Sales orders, install orders, HR, referrals, maintenance, reviews, notifications, users, roles… — plus copies of leads/projects | Per-device. Two staff members see different data. Clearing the browser deletes it. |

### 3.2 Is there real data?

| Data | Count | Real or fake? |
|---|---|---|
| Leads | 6 | **Real-looking customers** imported from Google Sheet rows 2–7. Only **5 unique people** — one person appears twice (the sync duplicated them). |
| Contacts | 5 | The same 5 people. |
| Projects | 1 | A 6.65 kW solar system at "Grid Meter Connected" stage. Plausibly real. |
| Companies, tickets | 0 | Empty. |
| Email logs | 1 | A failed SMTP test against `smtp.example.com`. |
| Staff users | 4 | **Fictional** (e.g. "Chloe Gallagher", "Mitchell Barnes") with made-up `+61` numbers. |
| Company profile | 1 | **Fictional company**: "My Solar CRM Australia Pty Ltd", Level 14, 100 Pacific Highway North Sydney, ABN `52 619 840 231`, CEC number `CEC-RET-94281`. |
| Integration statuses | 12 | **All fake** — "connected" with empty configs. |
| Integration settings | — | **Placeholders**: OpenSolar `OS-ORG-84920`, BridgeSelect `BS-TEST-KEY-88219` / salt `salt-s3cr3t-aust-solar-stc`, WhatsApp phone ID `109823749281726`, VoIPLine key `vpl_live_9f82…`. |
| **Hardware catalog** | 861 panels, 1,000 inverters, 427 batteries | **Real** manufacturer/model data (Clean Energy Council–style list). Inverters are capped at exactly 1,000 — likely truncated on import. **Worth keeping.** |
| **Dropdown vocabulary** | ~60 lists | **Real domain knowledge**: electricity distributors (DNSPs), energy retailers, STC portals and statuses, grid application statuses, finance companies, installation stages, warranty claim statuses, ticket triage options. **Worth keeping.** |

**Integrations storing real data?** No. Credential and message tables (Xero, Gmail, WhatsApp, SMS, calls) live in the unreachable Supabase project, and no integration has ever been configured with real credentials. There is no real integration data anywhere in the repository.

### 3.3 Schema quality

- `src/types/index.ts` defines **95 types** (1,755 lines). It is the best description of the business domain in the codebase — useful as a spec, too sprawling to keep as-is.
- The SQL `leads` table has **77 columns** plus a JSON `metadata` catch-all. Server mapping code reads fields like `d.customer_name || d.full_name || first_name + last_name` — a sign the schema drifted repeatedly and the code papers over it.
- **No tables exist** for users/roles, sales orders, install orders, referrals, maintenance, employees, leave, reviews or notifications — confirming those features were never connected to a backend.
- Row-level security is "enabled" on 34 tables, but **30 policies are `using (true)`** — i.e. they allow everything. It is security in name only.
- Schema changes were managed by **SQL strings embedded in code** (16 `CREATE TABLE` strings in `.ts/.tsx`, including 3 UI components) and "copy this SQL into Supabase" screens, rather than a migration tool.

---

## 4. The "AI-generated" debt

### 4.1 The ten worst architectural problems (most severe first)

1. **The API's source code is lost.** `server/app.ts` is esbuild output (189 KB, minified lines up to 84,000 characters, `// @ts-nocheck`, embedded source map pointing to `/app/applet/server.ts`). ~190 API routes live here. It can be patched, not maintained.
2. **Three competing data stores** (§3.1) with silent fallbacks between them. Data correctness cannot be guaranteed — the duplicate lead is a live example.
3. **Business logic lives in the browser.** `AppContext.tsx` is 5,506 lines exposing **242 values** to **57 components**: lead conversion, STC recalculation, P&L, permissions, Google Sheets sync, user management. Anything the browser decides, a user can bypass; every state change re-renders most of the app.
4. **Fake success paths.** VoIPLine, Teams and (with test keys) BridgeSelect report success when the real call failed; Meta and WhatsApp have endpoints that fabricate data; integration statuses are hard-coded "connected". Staff would believe actions happened that didn't — the most dangerous kind of bug in a CRM.
5. **Security theatre.** Fail-open auth (fixed in Fix #1); fake login fallback + 1-click admin button; permissions only in the browser; endpoints that returned secrets in plain text (fixed); secrets copied into three places (`.env`, `.app_config.json`, settings/DB); RLS that allows everything; the full staff list shipped to every browser; `/contracts` files served without login.
6. **Integrations not designed for production.** Google Sheets sync needs a publicly shared sheet; OAuth flows aren't tied to the user who started them; webhooks need signature verification audited; WhatsApp via an unofficial library.
7. **No quality safety net.** 0 tests. 626 explicit `any`. React types not installed, so ~76 UI files are never type-checked. 558 `console.*` calls as the only observability.
8. **UI monoliths.** 27 files over 1,000 lines; the largest component is 2,600 lines; one settings modal holds 55 separate state variables.
9. **Payload bloat.** `/api/settings` returns 415 KB and `/api/dropdowns` 390 KB on load; the frontend ships as a single 3.2 MB JavaScript file.
10. **Platform confusion.** Next.js leftovers in a Vite app, AI Studio/Cloud Run assumptions, Vercel config, two lockfiles, hard-coded `localhost` redirect URIs.

### 4.2 How much is salvageable?

Total: **~92,000 lines** across 136 source files.

| Area | Lines | Verdict |
|---|---:|---|
| UI components (`src/components`) | 56,372 | **Discard.** Not reskinnable (§5). Keep only as a visual reference of which fields/screens the business needs. |
| `AppContext` + `App.tsx` | 6,721 | **Discard.** Re-implement the business rules server-side; use it as a reference for *what* the rules are. |
| Mock data (`src/data`) | 1,234 | **Discard.** |
| Server data layer (`supabase.ts`, `*Db.ts`) | 6,699 | **Discard**, keep field-mapping knowledge as reference. |
| `server/app.ts` (compiled) | — | **Discard.** Use as a list of required endpoints. |
| Frontend services (`src/services`) | 6,084 | **Reference only** — mostly wrappers around the old API. |
| **Server integration clients** (Xero, Gmail, SMTP, MessageMedia, VoIPLine, OpenSolar, BridgeSelect, Meta, Teams, WhatsApp) | 6,585 | **Salvage with cleanup** — the vendor API calls, auth flows and payload formats are real work. Strip fake-success paths. |
| **Utilities** (`src/utils`: ABN validator, AU postcodes, Meta hashing, sheet de-duplication, BridgeSelect & OpenSolar mappers) | 4,890 | **Salvage most** — pure functions, easy to test. |
| **Types** (`src/types`) | 1,755 | **Salvage as domain spec**, slimmed down. |
| **Data**: hardware catalog, dropdown vocabulary, SQL schema | — | **Keep.** |
| `server/authMiddleware.ts` (new, Fix #1) | 92 | **Keep.** |

**Bottom line: ~15% of the code is reusable with cleanup (≈13,000 lines of integration clients, utilities and types), another ~15% is useful as reference, and ~70% should be discarded.** The *knowledge* in the codebase is worth far more than the code.

---

## 5. Frontend & UI/UX audit

### 5.1 Why it looks "AI-generated"

The impression is accurate, and measurable:

| Signal | Measurement | Effect |
|---|---|---|
| No design system | **0** shared UI primitives (no `Button`, `Card`, `Input`, `Modal`, `Table`, `Badge` components) | Every button, card and input is hand-assembled; no two are guaranteed to match. |
| Inline styling volume | **10,757** `className` attributes across components | Styling decisions are repeated thousands of times instead of made once. |
| Colour sprawl | **16 Tailwind colour families** in use (gray 2,515×, slate 1,991×, emerald 1,505×, amber 691×, rose 480×, blue, cyan, sky, red, purple, yellow, orange…) plus hundreds of hard-coded hex values (457 in one file) | No coherent palette; gray *and* slate used interchangeably as neutrals. |
| Typography | Arbitrary pixel sizes `text-[9px]` through `text-[12px]` | Tiny, dense text — the "dashboard generated by a model" look; also an accessibility problem. |
| Shape inconsistency | 12 different `rounded-*` variants | Corners vary randomly between components. |
| CSS overrides | 204 custom classes, **104 `!important`** in `index.css` | Styles fight each other; a theme switch (`corporate-slate`/`obsidian`) is bolted on via overrides. |
| Decorative noise | Pulsing "Operations Gateway Online" dots, "SSL TLS 1.3" badges, sparkle icons, emoji in buttons | Signals of generated UI; no information value. |

### 5.2 How tightly is styling tied to business logic?

**Very tightly.** In the large components, rendering, state, data transformation and side effects are interleaved in the same function bodies:

| Component | Lines | `className` | `useState` | Notes |
|---|---:|---:|---:|---|
| `ProjectDetailsLeftPanel.tsx` | 2,607 | 443 | 6 | 457 hard-coded hex colours |
| `XeroSettingsModal.tsx` | 2,543 | 470 | 55 | Contains SQL `CREATE TABLE` strings |
| `ReferralBonusView.tsx` | 1,833 | 367 | 37 | Browser-only data |
| `ContactsView.tsx` | 1,809 | 318 | 35 | |
| `LeadEditModal.tsx` | 1,479 | 88 | 17 | Calls APIs directly |

All 57 major components pull state and actions from the single `AppContext`. There is no separation between "what the screen shows" and "how the business works", so **a redesign cannot be done by swapping a theme or a component library — every component would have to be rewritten.**

### 5.3 How much backend can a new premium frontend reuse?

| Backend surface | Reusable by a new UI? |
|---|---|
| Leads, contacts, companies, projects, tickets CRUD | **Yes, temporarily.** Shapes are usable, but no role checks, no pagination, inconsistent field names, unreliable storage underneath. |
| Hardware catalog, dropdowns | **Yes**, but payloads are 380–415 KB per call and should be split. |
| Integration endpoints (Xero, Gmail, SMS, VoIP, OpenSolar, BridgeSelect, WhatsApp, Meta) | **Partially** — the server logic is real, but credentials depend on dead Supabase, and fake-success paths must go. |
| Settings (users, roles, features, rules, company profile) | **No** — one big JSON blob; users and roles need real tables and server-side enforcement. |
| Sales orders, install orders, HR, referrals, maintenance, reviews, notifications | **No — no API exists.** Must be built. |
| Business rules (lead conversion, STC calc, P&L, permissions, sheet sync) | **No — they live in the browser.** Must be moved server-side. |

**Answer: a new frontend could call roughly 40% of what it needs from today's API, and only about half of that is in a shape worth keeping.** Practically, a new UI would sit on top of a backend that also needs rebuilding — which is the core argument in §6.

---

## 6. The verdict: fix or rebuild?

### Assumptions behind the estimates

- One developer working full-time, paired with an AI assistant doing most of the typing under review. Part-time effort stretches calendar time proportionally.
- Scope = your stated priorities: **core CRM for Sales and Service** + integrations **Google Sheets, Gmail, SMTP, VoIPLine, MessageMedia, WhatsApp (official), OpenSolar, BridgeSelect, Xero**. Back-office modules (HR, referrals, P&L, portals) come after.
- Estimates are ranges, not promises. **Vendor approvals are calendar risks independent of code**: Meta business verification for WhatsApp, Xero app approval, Google OAuth verification for Gmail scopes, VoIPLine IP whitelisting — each can take days to weeks. Start them early in either path.

### Option A — Fix the existing codebase

| Step | What it involves | Estimate |
|---|---|---|
| A1. Security hardening | Remaining items: staff allowlist, server-side roles, remove fake login + 1-click admin, webhook signatures, OAuth state, `/contracts` | 1–2 weeks |
| A2. Recover the API source | Hand-rewrite ~190 routes out of the compiled `app.ts` into maintainable modules | 2–3 weeks |
| A3. One data store | Replace Supabase client + JSON files + localStorage with Postgres; create ~12 missing tables and their APIs | 3–4 weeks |
| A4. Move business logic server-side | Extract rules from the 5,500-line `AppContext`; split the context | 2–3 weeks |
| A5. Remove fakes | Fake-success paths, simulate endpoints, mock defaults, dead code | 1 week |
| A6. Type safety & tests | Install React types, fix the real error list (unknown until types are installed), add tests around critical flows | 2–3 weeks |
| A7. Premium UI | Build a design system, then rewrite/restyle 76 components (56k lines) | 5–8 weeks |
| A8. Integrations hardening + deploy | Configure and verify each priority integration; VPS deploy | 2–3 weeks |
| **Total** | | **≈ 18–27 weeks** |

**Risk profile: high and open-ended.** Every step is performed on code nobody understands, with no tests; each change can break something unseen. Steps A2, A3, A4 and A7 are rewrites in all but name — you pay rebuild cost while carrying the old structure's constraints.

### Option B — Clean rebuild, same stack, harvesting the good parts

Same stack: **Node + Express + TypeScript, React 19 + Tailwind, Postgres, Firebase Auth** — with a proper migration tool, a typed API layer, server-side business rules and permissions, and a component-based design system from day one.

| Step | What it involves | Estimate |
|---|---|---|
| B1. Foundations | Repo, Postgres schema + migrations (from the existing schema + types), auth with staff allowlist + roles, API skeleton, CI, VPS staging deploy | 1.5–2 weeks |
| B2. Design system | Tokens (one palette, type scale, spacing), ~15 core components (Button, Input, Select, Table, Card, Modal, Badge, Tabs, Toast, Empty state…), app shell & navigation | 1.5–2 weeks |
| B3. Core CRM | Leads, contacts, companies, projects pipeline, lead → project conversion, tickets, activity timeline, files, dashboard | 3–4 weeks |
| B4. Data in | One-off sheet import screen + scheduled leads sync (server-side, Sheets API, "sheet creates, CRM owns after" rule, `Lead ID` key); hardware catalog + dropdown vocabulary import | 1–1.5 weeks |
| B5. **Go-live for Sales & Service** | Production hardening, backups, monitoring, user onboarding | 0.5–1 week |
| — | **Sales & Service live at ≈ 8–10 weeks** | |
| B6. Priority integrations | Gmail, SMTP, VoIPLine, MessageMedia, WhatsApp Cloud, OpenSolar, BridgeSelect, Xero — adapting the salvaged client code, ~3–5 days each | 5–7 weeks |
| **Total for full priority scope** | | **≈ 13–17 weeks** |

**Risk profile: lower and front-loaded.** Every line is understood and reviewed; tests grow with the code; the UI is designed rather than accumulated. The main risk is scope creep — rebuilding all 16 screens and 15 integrations "because the old one had them". The defence is the priority list you already made.

### Comparison

| | Fix (A) | Rebuild (B) |
|---|---|---|
| Time to full priority scope | 18–27 weeks | 13–17 weeks |
| Time until Sales & Service can use it | ~12+ weeks (needs A1–A5 first) | **8–10 weeks** |
| Premium UI | Requires rewriting every component anyway | Built in from week 2 |
| Confidence in data correctness | Low until A3 completes | High from day one |
| Maintainability afterwards | Medium at best | High |
| Can you explain every part of it? | No | Yes — you'll have reviewed it as it was built |
| Predictability of estimate | Low (unknown unknowns in compiled/untyped code) | Medium-high |

### Final recommendation: **Rebuild** — a "salvage rebuild", not a blank-page rewrite

Given a premium UI, clean architecture and a strict deadline as the goals, **rebuilding is both faster and safer**. Fixing in place means rewriting ~80% of the code anyway (API, data layer, business logic, every UI component) while working around the remaining 20%. The existing project is best treated as a **detailed, clickable specification** — and a source of real assets:

**Carry forward:**
- The domain model (`src/types`) and dropdown vocabulary — your workflow knowledge
- The hardware catalog data (re-import the full inverter list; the current one looks truncated at 1,000)
- Integration client code for Xero, Gmail, SMTP, MessageMedia, VoIPLine, OpenSolar, BridgeSelect, WhatsApp Cloud and Meta — cleaned of fake-success paths
- Utilities: ABN validation, AU postcodes, sheet de-duplication, BridgeSelect/OpenSolar mappers, Meta hashing
- The SQL schema as a starting point for proper migrations
- `server/authMiddleware.ts`
- The current screens as a reference for which fields and steps users need

**Leave behind:** the compiled API, the 5,500-line context, all UI components, the three-store data layer, all mock/simulation code, Supabase, Baileys, and the Next.js/AI Studio/Vercel leftovers.

**Before starting, decide:**
1. **The deadline** — with a date, the scope for the first go-live can be cut to fit (the 8–10 week Sales & Service milestone is the natural target).
2. **Who reviews the design** — a premium UI needs one person who signs off on the look of the first 3–4 screens before the rest are built.
3. **Start vendor approvals now** (Meta/WhatsApp business verification, Xero app, Google OAuth consent screen, VoIPLine API access) — they run in parallel with the code and are the most common cause of late go-lives.

---

*Appendix — key evidence locations:* compiled API `server/app.ts:1-2,427` · fake call success `server/voipline.ts:184-199` · swallowed Teams errors `server/teams.ts:464-466` · BridgeSelect test-key success `server/bridgeselect.ts:164-176` · login fallback `src/components/auth/CRMLoginScreen.tsx:41-54` · 1-click admin `src/components/auth/CRMLoginScreen.tsx:183-195` · browser-side auth state `src/context/AppContext.tsx:449-476` · fake integration statuses `.integrations_db.json` · fictional company/users `.app_settings.json`.
