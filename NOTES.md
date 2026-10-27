# NOTES — running decisions and trade-offs

Scratch file. Source material for DECISIONS.md later; not a final document.

## Agreed before Phase 2

- **Prisma 7 with a driver adapter** (`@prisma/adapter-pg` + `pg`). Prisma 7
  moves connection URLs out of `schema.prisma` into `prisma.config.ts` and
  requires an adapter at runtime. Pinned to 7.x: npm's `latest` tag for
  `prisma` currently points at an 8.0 release candidate.
- **Two database URLs, two axes.**
  - `DATABASE_URL` — runtime. Production: Neon *pooled* URL as `app_user`.
  - `DIRECT_URL` — migrations. Production: Neon *direct* URL as the owner.
  - Locally both point at the compose Postgres. Until Phase 3, the local
    `DATABASE_URL` uses the owner; from Phase 3 it must be `app_user`.
- **Superusers bypass RLS, even with FORCE.** The default local Postgres user
  is a superuser. From Phase 3 the app and every isolation test connect as
  `app_user` (not superuser, not table owner). A test asserts this about the
  runtime connection, so a misconfigured `DATABASE_URL` fails loudly instead
  of silently disabling isolation. The role migration must be idempotent.
- **`app_user` password is never in the repo.** The migration creates the
  role; the password comes from env locally and is set in the Neon console in
  production.
- **Discounts stored as type + value** (AMOUNT | PERCENT), not as a Toman
  amount. A 10% discount must stay 10% if items are added after it is applied;
  the bill calculation derives the Toman amount.
- **Totals snapshot on settle.** When an order is settled, the computed
  subtotal, discount, service charge, VAT and total are written to the order,
  so history never changes if rates or the calculation change later.
- **Rounding: half-up to whole Toman at each step** (discount → service charge
  → VAT). Documented in the bill function.
- **Kitchen responses are shaped by role**: kitchen never receives prices or
  totals from any endpoint, including the polling endpoint.
- **Full-workflow test is API-level in Vitest**, not Playwright: no browser
  install, no extra dependency, and it exercises the concurrency and money
  logic that matters.
- **Cut order if behind schedule:** (1) UI polish, (2) takeaway orders,
  (3) AI import reduced to upload → draft table → confirm, (4) kitchen board
  visuals. Never cut: tenant isolation, concurrency, checkout, or their
  tests. The final 35 minutes of documentation time is protected.

## Phase 2 — Scaffold

- **Handler wrapper instead of middleware for request ids.** Logging status
  and `duration_ms` has to happen around each route handler anyway, so one
  wrapper does request id, timing, structured logging and error mapping.
  Next 16's `proxy.ts` would only add a second place to look.
- **`docker compose up` = production-mode app** (Postgres → migrate → seed →
  `next start`). That is what a reviewer runs. Development uses `npm run dev`
  on the host against the compose Postgres (bind-mounted `node_modules` is
  slow on macOS).
- **Vazirmatn self-hosted** as a committed variable `.woff2` with its OFL
  licence, loaded via `next/font/local`. No Google Fonts, no npm package.
- **JSON-only logs**, no `pino-pretty`. Error codes are English constants;
  user-facing messages are Persian.
- **Cache Components turned off** (create-next-app 16.4 enables it by
  default). Every screen is per-tenant, per-session data that changes every
  few seconds; there is nothing to cache server-side, and a mis-keyed server
  cache is a cross-tenant leak. Route handlers and pages run per request.
- **Error body has an optional `details`** next to `code` and `message`:
  `{ error: { code, message, details? } }`. Needed so a 409 can carry the
  current state of the line/order, as the concurrency design requires.
- **Env is validated lazily, then forced at boot** via `instrumentation.ts`.
  `next build` (Docker, Vercel) has no runtime secrets, so validation cannot
  run at import time; the server still refuses to start with a bad config.
  Errors name the variable, never the value. `AI_*` are optional: missing AI
  config disables the import, never the app. Empty strings count as unset.
- **Prisma client is created lazily** (`db()`), for the same build-time reason.
- **Compose Postgres on host port 5433**, not 5432: a reviewer with a local
  Postgres would otherwise see `docker compose up` fail on the port. The app
  container talks to the db over the compose network, so only host-side dev
  and tests see the port.
- **Separate `restaurant_test` database** created by the compose init script,
  so integration tests never touch dev/demo data.
- **Docker image keeps dev dependencies** because the Prisma CLI runs
  `migrate deploy` at container start. Image size doesn't matter for a local
  one-command setup; Vercel builds independently.
- **TypeScript pinned to 6.0.x**, not 7.x (the new native compiler, which
  npm now tags `latest`). Next's type-check integration targets the JS
  compiler API; not worth discovering incompatibilities on a 6-hour clock.
- **`prisma init` installs agent skill folders** (`.agents/`, `.claude/`,
  `.windsurf/`, `skills-lock.json`) and wants `dotenv`. Removed the folders;
  `prisma.config.ts` uses Node's built-in `process.loadEnvFile` instead of
  dotenv (it never overrides real env vars, so Docker/Vercel values win).
- **Limits to remember:** the health route checks DB reachability only.
  Logger redaction is a safety net, not the policy: unknown-error logs include
  the raw error, and Prisma errors can include query parameters, so call sites
  must keep PINs and phone numbers out of query errors where possible.
