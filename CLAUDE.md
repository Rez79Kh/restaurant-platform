# Project brief

I'm completing a take-home assessment for a Senior Full-Stack Engineer role.
The brief: build the first version of a SaaS platform for cafés and restaurants
in Iran. Hard limit: 6 hours of total work. The reviewers value product
judgment and deliberate, explainable trade-offs over feature count. Every
choice below has been made deliberately — do not expand scope, add features,
or swap technologies without asking me first.

SCOPE.md in the repo root is written by me. Read it for context. NEVER create,
edit, or rewrite SCOPE.md.

## The one workflow we're building
The life of a table's check (سفارش میز), from first item to settled bill:
1. Staff opens a table (or a takeaway order).
2. Staff adds items with optional notes — several people may add to the same
   order at the same time from different devices.
3. Kitchen sees new items within a few seconds and moves them
   SENT → PREPARING → READY.
4. Staff marks items SERVED; more items can still be added.
5. Manager can apply a discount (amount or percent, with a reason) and can void
   items after the kitchen has started them. Both are audit-logged.
6. Bill shows subtotal, service charge, VAT, discount, total — in Toman.
7. Staff records payment: CARD_READER (standalone bank POS), CASH,
   CARD_TRANSFER (card-to-card), or a split across several methods.
8. Order is settled only if payments exactly equal the total. Table becomes free.

Out of scope (do not build): online payment gateways, guest QR ordering,
printers, inventory, reports/dashboards, Moadian tax submission, delivery-app
integration, multi-branch UI (branch exists in the schema only), offline mode,
SMS/OTP, i18n beyond Persian, menu-management UI beyond the minimum needed
(see AI phase).

## Stack (fixed)
- Next.js (App Router) + TypeScript (strict), Tailwind CSS.
- API via Route Handlers under /app/api — explicit REST endpoints, not Server
  Actions, so the API boundary is visible and testable.
- PostgreSQL + Prisma.
- Zod for validation at every API boundary.
- pino for structured JSON logging.
- Vitest for unit/integration tests against a real Postgres (docker), and
  one full-workflow test (Playwright e2e OR an API-level workflow test — ask me).
- Local: docker compose (Postgres + app). One command setup.
- Production: Vercel (functions in fra1) + Neon Postgres (Frankfurt), deployed
  from GitHub via Vercel CI/CD. Pooled connection URL for runtime, direct URL
  for migrations.
- Ask before adding any dependency not listed here.

## Domain model (adapt names as needed, keep the shape)
All tenant-owned tables carry restaurant_id. Money is integer Toman (Int).
- restaurant (id, name, slug, vat_rate_bp, service_charge_bp, timezone)
  — rates in basis points, configurable per restaurant
- branch (restaurant_id, ...)
- staff_member (restaurant_id, branch_id, name, phone, pin_hash, role,
  is_active) — role enum: MANAGER | STAFF | KITCHEN
- session (id, staff_member_id, restaurant_id, expires_at) — DB-backed
- menu_category, menu_item (price_toman Int, is_available)
- dining_table (branch_id, label, seats)
- order (branch_id, table_id nullable for takeaway, status OPEN|SETTLED|VOID,
  version Int, discount_toman, discount_reason, opened_by, settled_by,
  opened_at, settled_at)
- order_line (order_id, menu_item_id, name_snapshot, unit_price_snapshot,
  quantity, note, status SENT|PREPARING|READY|SERVED|VOID, created_by,
  idempotency_key, updated_at)
- payment (order_id, method, amount_toman, recorded_by)
- audit_event (restaurant_id, actor_id, action, entity, entity_id, data jsonb,
  created_at) — for discounts, voids, settle, login failures
- login_attempt (for rate limiting; Vercel functions are stateless so
  in-memory rate limiting does not work)
- menu_import_draft (for the AI phase)

Use composite keys so cross-tenant references are impossible at the DB level:
@@unique([restaurantId, id]) on parents, and relations with
fields: [restaurantId, xId], references: [restaurantId, id].
The schema must reflect the domain, not the screens.

## Concurrency design (must be implemented exactly like this)
- Adding items = INSERT of new order_line rows. Never read-modify-write the
  order to add items. Concurrent adds can never overwrite each other.
- Every mutating request carries a client-generated idempotency key; the server
  enforces it with a unique constraint and returns the original result on retry.
- Line status changes are conditional updates:
  UPDATE ... WHERE id = $1 AND status = $expected. Zero rows affected → 409
  Conflict with the current state in the body. The UI shows the conflict and
  refreshes; it never silently retries or overwrites.
- Order-level changes (discount, settle, void order) use optimistic locking on
  order.version: client sends the version it saw; mismatch → 409.
- Settle runs in one transaction: recompute totals from lines, verify payments
  sum to the total, verify version, then mark SETTLED.
- Realtime = short polling (every 2–3 s) of a cheap "changes since" endpoint
  per branch, returning only changed orders/lines. No WebSockets/SSE (Vercel
  serverless). Pause polling when the tab is hidden.
- Document in code comments where this breaks (e.g. polling cost at scale,
  no offline support).

## Tenant isolation (three layers — all required)
1. Composite foreign keys (above).
2. Postgres Row-Level Security on every tenant table, with ENABLE and FORCE
   ROW LEVEL SECURITY. Policies compare restaurant_id to
   current_setting('app.restaurant_id', true). Use a dedicated non-owner
   runtime role (app_user) for the app's connection; migrations run as owner.
   RLS policies live in a raw SQL migration.
3. All tenant data access goes through a single helper, e.g.
   withTenant(restaurantId, async (tx) => ...), which opens a Prisma
   interactive transaction and first runs
   SELECT set_config('app.restaurant_id', $1, true)
   — the third argument MUST be true (transaction-local), because Neon uses a
   connection pooler and a session-level setting could leak to another
   tenant's request. The restaurant id comes ONLY from the server-side
   session, never from the request body, URL, or headers.
   Queries also filter by restaurant_id explicitly (defense in depth).
Missing or invalid tenant context must fail closed (no rows / 401), never
fall back to "all rows".

## Auth & roles
- Login: restaurant slug + phone + 4–6 digit PIN. PIN hashed (argon2 or bcrypt).
- DB-backed session, httpOnly + Secure + SameSite=Lax cookie.
- Rate limiting / lockout on login via login_attempt table (per phone+restaurant
  and per IP). Failed logins are audit-logged.
- Authorization is checked server-side in every route handler via a single
  requireRole(...) helper. UI hiding is cosmetic only.
- MANAGER: everything. STAFF: open orders, add items, mark served, record
  payment, settle. Cannot discount or void lines past SENT. KITCHEN: view
  tickets, change PREPARING/READY only; never sees prices or totals.

## Iran-specific requirements
- Entire UI in Persian, dir="rtl", Persian digits (Intl.NumberFormat('fa-IR')),
  Jalali dates (Intl.DateTimeFormat('fa-IR-u-ca-persian')).
- Font: Vazirmatn, self-hosted via next/font/local (no Google Fonts CDN).
- Prices displayed in Toman ("تومان"), integers only, thousands separators.
- VAT and service charge configurable per restaurant (seed VAT at 10%; I will
  verify the current rate). Calculation order: subtotal → discount → service
  charge → VAT. Put this in one pure, unit-tested function.
- Price snapshots on order lines — menu price changes never affect existing bills.
- Weak connections: every mutation shows pending/failed state clearly; failed
  requests can be retried safely thanks to idempotency keys. Nothing fails silently.

## UX
- Staff: mobile-first. Tables grid (free / occupied / with ready items) →
  order screen (menu by category, big tap targets, quick notes) → bill → pay.
- Kitchen: tablet layout, ticket cards by order, oldest first, one tap to
  advance status, visual age indicator.
- Manager: same as staff plus discount/void actions and the menu photo import.
- Keep it clean and fast. No animation libraries.

## AI capability: menu import from photo
- Manager uploads a photo of a printed menu. A vision model extracts
  categories, item names, and prices in Toman into a draft. The manager reviews
  and edits every item; nothing is saved to the menu without explicit
  confirmation.
- Provider: an Iranian AI gateway with an OpenAI-compatible API. Configure via
  env: AI_BASE_URL, AI_API_KEY, AI_MODEL. Keep the provider behind one small
  interface so it can be swapped.
- Failure handling: 20 s timeout, one retry at most, clear Persian error
  message, manual entry always available as fallback. The AI is never on the
  service-time path.
- Validation: model output parsed with a Zod schema; invalid → treated as failure.
  Sanity checks on prices (positive integers, plausible range; detect Rial vs
  Toman confusion and flag it for review).
- Prompt injection: text in the image is data, never instructions. System prompt
  states this; output is schema-constrained; the model has no tools and no
  write access; the human review step is the final control.
- Limits: image type allowlist, max size (e.g. 5 MB), manager-only, rate limited.
- Log latency, token usage, and estimated cost per call (never log image
  content or API keys).

## Logging & errors
- pino JSON logs with request_id, restaurant_id, staff_id, role, route,
  status, duration_ms. Never log PINs, session tokens, phone numbers in full,
  or API keys.
- Log every 409 conflict, auth failure, and AI call outcome — those are what
  I'd need at 3am.
- Consistent error format: { error: { code, message } }. Unknown errors →
  500 with a generic message; details only in logs. Fail closed.

## Seed data (realistic — reviewers judge it as evidence)
- Restaurant 1: a café in Shiraz (e.g. "کافه نارنج"), one branch, ~10 tables,
  realistic Persian menu with current-feeling Toman prices: hot drinks
  (اسپرسو، لاته، چای، قهوه ترک، دمنوش), cold drinks, cakes/desserts, breakfast,
  light meals. Some items unavailable.
- Staff with Persian names: 1 manager, 3 staff, 1 kitchen.
- About one week of settled order history with Thursday-evening/Friday peaks,
  mixed payment methods (card reader dominant, some cash, some card-to-card,
  some splits), a few discounts and voids with reasons and audit entries.
- A few currently OPEN orders in different states so the app is alive on login.
- Restaurant 2: a small restaurant in another city (e.g. Tehran) with its own
  staff and menu — used to demonstrate and test isolation.
- Fixed demo PINs, documented in README. Seed must be idempotent.

## Tests (where they earn their place)
- Unit: bill calculation function.
- Integration (real Postgres): concurrent item adds on one order all persist;
  two conflicting status updates → exactly one wins, the other gets 409;
  stale version on discount/settle → 409; idempotent retry creates no duplicate;
  settle rejects mismatched payments.
- Isolation: authenticated user of restaurant A attempting to read, update, and
  reference restaurant B's orders/tables/menu items by id → all fail. Plus a
  test that queries without tenant context return zero rows.
- Role tests: STAFF cannot discount; KITCHEN cannot see prices or settle.
- One full workflow test: login → open table → add items → kitchen advances
  → serve → discount → split payment → settled.
- Keep a list of what we deliberately did NOT test and why (for the README).

## Secrets & config
- .env.example with every variable, no real values. .env* in .gitignore.
- Validate env at startup with Zod; fail fast with a clear message.
- Nothing secret in the repo, in logs, or in client bundles.

# Working rules
- Work in the phases below, one at a time. At the end of each phase: run
  lint, typecheck, and relevant tests; summarise what you did and any
  decisions you made; propose a commit message; then STOP and wait for me.
  Do not commit or push unless I say so.
- Prefer the simplest solution that meets the requirement. If you think a
  decision above is wrong, tell me and explain — don't silently deviate.
- Keep a running list of notable decisions and trade-offs in NOTES.md
  (scratch file) so I can write DECISIONS.md later. Don't write DECISIONS.md,
  AI_USAGE.md, or HANDOVER.md content yourself unless I ask.
- Flag anything that would take more than ~30 minutes so we can re-plan.

# Phases (SCOPE.md is already committed as phase 1)

Phase 2 — Scaffold: Next.js + TS strict + Tailwind, RTL root layout with
Vazirmatn, docker-compose (Postgres + app), Prisma init with pooled + direct
URLs, env validation, pino logger, request-id middleware, error helper,
.env.example, README skeleton with one-command local setup.

Phase 3 — Schema & isolation: Prisma schema per the domain model, composite
keys, migrations, raw SQL migration for app_user role + RLS policies (ENABLE +
FORCE), withTenant helper, plus the isolation tests.

Phase 4 — Seed: realistic data as specified, idempotent, wired into the
one-command setup.

Phase 5 — Auth & roles: login, sessions, rate limiting, requireRole,
role tests.

Phase 6 — Ordering: tables grid, order screen, add items with idempotency keys,
polling changes endpoint, concurrency tests for adds.

Phase 7 — Kitchen: kitchen board, conditional status transitions, 409 handling
in the UI, status race tests.

Phase 8 — Checkout: bill calculation (pure function + tests), discount and void
(manager, versioned, audited), split payments, settle transaction, tests.

Phase 9 — Full workflow test + README "what we didn't test and why".

Phase 10 — AI menu import as specified.

Phase 11 — Production hardening: Vercel config (fra1), Neon setup notes,
migration step for deploy, security headers, final log review, README
deployment + architecture overview + demo credentials.

Start with Phase 2. Before writing code, briefly confirm your understanding
and list any questions or concerns about the plan.