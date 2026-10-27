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

## Phase 3 — Schema & isolation

- **Generic idempotency table** (`idempotency_records`, unique on
  `(restaurant_id, key)`) instead of `order_line.idempotency_key` — agreed.
  A per-row key cannot replay the result of a conditional update (discount,
  settle, status change): a retry after a lost response would hit a version
  or status mismatch and show a false 409. Key inserted in the same
  transaction as the mutation; a concurrent duplicate blocks on the unique
  index, then reads the stored response. Not yet built: cleanup of old keys
  (a TTL job); harmless at v1 volume.
- **Plural snake_case table names** (`orders`, `order_lines`, …): `order` is
  a reserved word and would need quoting in every raw SQL statement.
- **Integrity rules in the database** (raw SQL migration), not only in code:
  positive prices/quantities/payments, rates 0–100%, discount type+value+reason
  together and percent ≤ 100%, settled ⇒ totals snapshot + settled_by present,
  voided line ⇒ voided_by present. **One OPEN order per table** is a partial
  unique index: two waiters opening the same table → exactly one wins.
- **Percent discounts stored in basis points** (1000 = 10%), consistent with
  VAT and service-charge rates; allows 12.5%.
- **`updated_at` maintained by triggers**, because status changes are raw
  conditional UPDATEs and the polling endpoint depends on the column.
  Known limit for Phase 6: commit order ≠ timestamp order, so the
  "changes since" query needs an overlap window.
- **`login_attempts` is platform-level, not tenant-owned, no RLS.** Attempts
  are counted before a restaurant is known (unknown slug) and per-IP limits
  span restaurants. Stores the phone only as a hash. Failed logins for an
  unknown slug can only be logged, not audit-logged (audit is per tenant).
- **app_user privileges are minimal**: DML on tables, nothing on
  `_prisma_migrations`, and **no UPDATE/DELETE on `audit_events`**
  (append-only for the application).
- **Role migration is idempotent** (role is cluster-wide: dev, test and the
  Prisma shadow DB share it). A test runs it twice. The REVOKE on
  `_prisma_migrations` is conditional because the shadow DB lacks that table.
- **Password out of band**: `scripts/set-app-db-password.mts` (run by
  `npm run db:setup`) applies `APP_DB_PASSWORD`. Production: Neon console or
  the same script once.
- **Fail closed**: unset context → `NULL` → no rows; malformed context →
  uuid cast error; `withTenant` rejects a non-uuid id before touching the DB.
- **ESLint `no-restricted-imports`** blocks `@/lib/db` outside `lib/db.ts`,
  `lib/tenant.ts`, the health route and tests, so new code can't bypass
  `withTenant` by accident.
- **Tests verify themselves**: running the isolation suite with the runtime
  URL pointed at the superuser makes all 12 role-dependent tests fail.
- **`"type": "module"`** in package.json; Vite warned that the config
  loaded ESM as CommonJS. Next build/dev verified afterwards.
- **Prisma 7's `migrate dev` no longer runs `generate`.** `postinstall` covers
  installs; after a schema change run `npx prisma generate`.

### Open items carried forward

- **Phase 4 (seed on Neon):** the Neon owner is not a superuser, so FORCE RLS
  applies to it too. The seed must set `app.restaurant_id` per restaurant
  (it will insert inside a tenant context, which also exercises the policies).
- **Phase 5 (auth bootstrap):** login must find a restaurant by slug, and
  session lookup must find a session by token hash, both *before* any tenant
  context exists. Plan: two narrow `SECURITY DEFINER` functions (slug → id,
  token hash → session/staff/role) granted to app_user. Those are the only
  two ways across the tenant boundary, and each needs a secret or a known
  slug.
- **API-level isolation tests** (user of A calling routes with B's ids) come
  with the routes in Phases 5–8.

## Phase 4 — Seed

- **PIN hashing: Node's built-in scrypt** (agreed; CLAUDE.md said argon2 or
  bcrypt). Memory-hard, no dependency, no native build on Vercel. N=2^15,
  r=8, p=1 (32 MiB, roughly 50–100 ms). Parameters are stored in the hash, so
  they can be raised later. Honest limit: a 4–6 digit PIN space falls to an
  offline brute force whatever the hash, so the real protection is the login
  rate limit and lockout (Phase 5). Offline case: see PIN_PEPPER below.
- **Bill calculation built now, not in Phase 8**: the seed needs it to write
  correct totals snapshots. `lib/bill.ts` is pure, with integer half-up
  rounding at each step. VAT is charged on the service charge (subtotal →
  discount → service → VAT). An AMOUNT discount larger than the subtotal is
  capped (the total is never negative); the API should still reject it.
- **Seed runs on plain Node** (type stripping), no `tsx` dependency. That
  required `importFileExtension = "ts"` on the Prisma generator. Next build
  and typecheck are verified with it.
- **Fixed restaurant ids** for the two demo tenants. The seed can't look a
  restaurant up by slug without a tenant context (RLS), but it can set the
  context to a known id and check whether it exists.
- **Every seed write happens inside the tenant context**, one transaction per
  restaurant. Works whether or not the owner bypasses RLS (local superuser:
  yes; Neon owner: no). A failure leaves no half-written tenant.
- **Idempotent = skip if present**; `--reset` recreates only the two demo
  tenants. Re-running never wipes what a reviewer did in the app. Live
  orders are relative to seed time; reseed before a demo to make them fresh.
- **Deterministic shape** (fixed PRNG seed per restaurant), timestamps
  relative to now. Verified by SQL: payments equal totals on every settled
  order, stored subtotals match the lines, Thursday 17:00+ and Friday peaks
  show up, card reader dominates, about 11% of bills are split.
- **Service charge 0% at the café, 10% at the Tehran restaurant**:
  realistic for each, and both bill shapes appear in the demo. Flip one
  constant in seed-data.mts if you want the café to show a service charge.
- **Phone numbers are obviously fake** (0917000000x / 0912000000x) so no
  real person's number is in the repo.
- **Not under automated test**: the seed itself (verified by SQL checks
  above). Candidate for the "what we didn't test" list.

### PIN pepper (added after Phase 4)

- **PINs are HMAC-SHA256'd with `PIN_PEPPER`, then hashed with scrypt.**
  Why: a 4–6 digit PIN has at most 1,000,000 values. With scrypt alone,
  anyone holding the `pin_hash` column (a leaked backup, a DB dump, SQL
  injection) can try every PIN offline in minutes, and slowing the hash
  can't fix a search space that small. The pepper is a secret that lives only
  in the app's environment (Vercel env vars), never in the database. A leaked
  database alone is no longer enough to recover PINs; the attacker needs the
  app's env too. Online guessing stays the rate limiter's job.
- **Fail closed**: `hashPin`/`verifyPin` throw on an empty pepper rather than
  silently degrading to plain scrypt. Env validation requires ≥ 32 chars.
- **The pepper is passed in, not read inside `lib/pin.ts`**, so the module
  stays importable by the plain-Node seed and trivially testable. The app
  passes `getEnv().PIN_PEPPER`.
- **New hash tag `scrypt-hmac$…`**: a hash from before the pepper (`scrypt$…`)
  verifies as false instead of being misread. Only demo data existed, so
  nothing needed migrating; the local dev DB was reseeded.
- **Operational cost**: the seed and the app must share one value (else demo
  logins fail), and changing it invalidates every stored PIN. Rotation would
  need a pepper id in the hash; not built for v1.
- **Local values** in `.env.example` / compose are dev-only placeholders,
  like the local DB passwords. Production gets a fresh random value
  (`openssl rand -base64 32`), set in Vercel and in the shell that seeds Neon.

## Phase 5 — Auth & roles

- **Pre-tenant lookups via two SECURITY DEFINER functions** owned by a
  NOLOGIN role `app_auth`: `auth_find_staff(slug, phone)` and
  `auth_find_session(token_hash)`. These are the only ways across the tenant
  boundary. `app_auth` reads three tables through RLS policies scoped
  `TO app_auth`. It doesn't rely on the owner bypassing RLS (the local
  superuser does, Neon's owner doesn't), and `app_user` can execute the
  functions but cannot `SET ROLE app_auth` (verified). Migration is
  idempotent and covered by the run-twice test.
- **Sessions**: 32 random bytes (base64url) in an `HttpOnly; SameSite=Lax`
  cookie; only the SHA-256 is stored. Fixed 12-hour lifetime, not sliding: a
  lost phone stops working by the next day. **Secure is set when the
  request is HTTPS** (always on Vercel), not on plain-HTTP localhost, where
  Safari would drop a Secure cookie. Deactivating staff ends their sessions
  immediately (the lookup joins `is_active`).
- **Rate limiting in Postgres** (`login_attempts`): 5 failures per
  restaurant+phone since that account's last success, and 20 failures per
  IP, within 15 minutes → 429. Phones are stored as an HMAC (keyed with
  PIN_PEPPER), never raw. Known gaps: a concurrent burst can slightly exceed
  the limit (count, then insert); no cleanup job for old attempts or expired
  sessions yet.
- **No account enumeration**: wrong PIN, unknown phone, unknown restaurant and
  inactive staff all return the same 401 body, and an unknown account still
  runs one scrypt against a dummy hash so timing doesn't tell them apart.
- **Failed logins**: every failure logged at warn (phone masked). Failures
  for a known staff member are also audit-logged in their restaurant.
  Unknown-restaurant failures can only be logged (no tenant to audit into).
- **Persian and Arabic-Indic digits accepted** in phone and PIN, plus
  spaces, dashes and a +98/0098 prefix. Iranian phone keyboards often type
  Persian digits.
- **`requireRole({ req, log }, ...roles)`** is the single check in route
  handlers: 401 without a session, 403 for the wrong role (both logged at warn
  by the wrapper). It binds restaurant_id/staff_id/role to the request log.
  The restaurant comes only from the session (tested with a spoofed header
  and query param).
- **Pages**: `requirePageSession()` redirects to /login. Plain UI: login
  form (restaurant code remembered in localStorage), placeholder home with
  logout.
- **Login and logout carry no idempotency key**: a retried login only
  creates a second session; logout is naturally idempotent.
- **CSRF**: SameSite=Lax means cross-site POSTs carry no session cookie. The
  APIs take JSON bodies. No CSRF token in v1.
- **The seed and password scripts print the target host/database.** Missing
  variables fall back to `.env`, so a run meant for Neon that forgot
  `DIRECT_URL` would otherwise write to localhost without saying so.
- **Role tests for discount, settle and kitchen price visibility** come with
  those endpoints (Phases 7–8). Phase 5 tests the mechanism.

## Phase 6 — Ordering

- **Idempotency helper** (`lib/idempotency.ts`): key from the
  `Idempotency-Key` header, inserted with `ON CONFLICT DO NOTHING` in the
  mutation's own transaction. A concurrent duplicate waits on the unique index
  and then replays the stored response. Errors roll the key back, so only
  successes are replayed. The route string includes the target id, so a key
  reused for another order gets 422. Responses are JSON-normalised so the
  original and the replay are identical. Tested: 5 identical requests at once
  → applied once, one non-replayed response, all bodies equal.
- **Adding items** is INSERT-only. The order row is locked `FOR SHARE`: adds
  don't block each other, but settle (Phase 8, `FOR UPDATE`) can't interleave
  with an add, so an item can't slip onto a bill that's being closed. Menu
  name and price are snapshotted at insert; unavailable or other-tenant items
  → 409 `MENU_ITEM_UNAVAILABLE`. Tested: 10 concurrent adds from two
  sessions all persist.
- **Opening a table**: pre-check for a friendlier 409 (with the existing
  order id, so the UI jumps to it), and the partial unique index as the real
  guarantee. Tested: two simultaneous opens → exactly one 201, one 409.
- **Polling** (`/api/changes`): DB clock (`clock_timestamp()`, same as the
  triggers) as the cursor, a 10 s overlap window for commit-order skew, and
  `resync: true` when the cursor is missing, older than 5 min, or a result hits
  the 300-row cap. **Clients treat changes as "reload my snapshot", never as
  a diff to merge.** It costs one extra request per change, and in exchange
  no screen can drift from the server. Cost and limits documented in the route.
- **Polling pauses when the tab is hidden** and polls immediately on
  return. A failed poll shows an "offline, data may be stale" banner. No
  offline queue (out of scope).
- **Kitchen gets no prices from any endpoint**: `lineView()` drops the price
  for KITCHEN; kitchen can't call the order, menu or floor endpoints (403).
  Tested by asserting the kitchen's changes payload contains no price/total
  fields.
- **API-level isolation tests** (signed-in user of B against A's ids): read
  order → 404, add to A's order → 404, reference A's menu item → 409, open on
  A's table → 404, and A's ids appear nowhere in B's floor/menu/changes.
  Malformed ids → 404 (validated before reaching SQL).
- **Weak connections**: every mutation in the UI has a visible
  pending / failed state; the key is made once per user action and reused on
  "retry", so a request that reached the server before the connection dropped
  is not applied twice. Editing the cart after a failure makes a new request
  (new key), because the body changed.
- **UI is plain and mobile-first**: tables grid (free / occupied / ready
  shown in green), takeaway list, order screen with category tabs, big tap
  targets, cart with quick-note chips + free text, bill summary. Built and
  server-rendered, but **not clicked through in a real browser** (no browser
  tool available in this session).
- **Branch**: every query is scoped to the session's branch as well as the
  restaurant, even though v1 has one branch per restaurant.
