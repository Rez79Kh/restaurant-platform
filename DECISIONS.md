# Decisions

The decisions that shaped v1, each as **decision / reason / alternative
considered / trade-off accepted**. "I" marks decisions I made myself; "we"
marks technical decisions developed together with Claude (see
[AI_USAGE.md](AI_USAGE.md)). Detail and evidence for each phase are in
[NOTES.md](NOTES.md). The scope itself is in [SCOPE.md](SCOPE.md).

Total build time: **7:20 against a 6:00 limit** ([TIMELOG.md](TIMELOG.md)).

---

## Wrong, or I would revisit

### Migrations were only ever tested as a superuser

- **Decision:** Locally and in tests, migrations ran as the default `postgres`
  superuser.
- **Reason:** It is the Docker image's default. Nothing failed, so nobody
  questioned it.
- **Alternative considered:** None at the time. That was the mistake.
- **Trade-off accepted:** None; it failed in production.
  - **What happened:** the auth-lookup migration hands two functions to a
    restricted role. Postgres requires that role to have CREATE on the
    schema, and superusers skip that check. Neon's database owner is not a
    superuser, so the first production `db:setup` failed with `permission
    denied for schema public`.
  - **The fix:** grant the permission just for the ownership change, then
    revoke it.
  - **Why I edited the migration instead of adding one:** a failed migration
    blocks every later one. It had never succeeded anywhere except
    disposable superuser databases.
  - **Recovery on Neon:** `prisma migrate resolve --rolled-back`, then
    re-running setup. It was rehearsed on a fresh database first.
  - **The real fix:** local Docker and the test suite now migrate as
    `migrator`, a non-superuser owner like Neon's, and a test fails if the
    migration role is ever a superuser.
  - **Remaining gap:** `migrator` approximates Neon's owner but isn't
    identical. Running migrations against a Neon branch in CI would close it.

### Hosting on Vercel and Neon in Frankfurt, outside Iran

- **Decision:** Production runs on Vercel functions in `fra1` and Neon
  Postgres in Frankfurt. I made this decision.
- **Reason:**
  - It was the fastest path to a live URL inside a 6-hour build, with CI/CD
    from GitHub.
  - Both services sit in the same region, so database round trips are
    short.
  - I checked that the live URL opens from Iran without a VPN before
    building on it.
- **Alternative considered:** An Iranian cloud provider (a VPS or managed
  Kubernetes with a Postgres inside Iran). That means more setup, no
  managed database branching, and deployment tooling built by hand.
- **Trade-off accepted:** **If Iran's international internet is cut, the app
  is down for every restaurant.** Iran has had such cuts, and they tend to
  come at moments of unrest, not on a schedule. Foreign hosting can also be
  throttled or filtered without a full cut. This risk is stated in SCOPE
  §11. If the product goes beyond a pilot, moving hosting into Iran comes
  first. The code is ordinary Next.js and Postgres with no Vercel-specific
  APIs, so that is a deployment project, not a rewrite.

### Polling instead of push for live screens

- **Decision:** Every screen asks `GET /api/changes?since=…` every 2.5 s,
  pausing while the tab is hidden. When something has changed, it reloads
  its own snapshot.
- **Reason:**
  - Vercel functions are short-lived and cannot hold WebSockets or
    long-lived SSE connections.
  - Polling is stateless, survives flaky mobile connections, and is
    trivially correct: a screen can't drift from the server, because it
    never merges diffs.
  - "Within a few seconds" was the requirement.
- **Alternative considered:**
  - SSE or WebSockets on a long-lived server.
  - A managed push service (Pusher, Ably). These are foreign services with
    their own reachability risk from Iran.
  - Postgres LISTEN/NOTIFY behind a small realtime server.
- **Trade-off accepted:**
  - Each device costs about 0.4 requests per second, most of which say
    "nothing changed", and each one costs a session lookup and a short
    transaction.
  - Latency is up to one poll interval.
  - The work isn't proportional to how much actually changes. This is fine
    for tens of restaurants and wasteful for thousands (see HANDOVER.md,
    "where it breaks").
  - I would revisit this together with the hosting move. A long-lived
    server in Iran makes push cheap.

### Payments recorded only at settle; no partial payment

- **Decision:** Payments are part of the settle request. The split is built
  on screen and submitted once, with the version and an idempotency key. The
  bill closes only if the payments equal the recomputed total exactly.
- **Reason:**
  - One transaction, one key: a retry on weak Wi-Fi can never record a
    payment twice.
  - The "payments equal total" rule is checked in exactly one place,
    under the order lock.
- **Alternative considered:** A payments ledger on the open order, so each
  payment is recorded as it happens and settle checks the ledger.
- **Trade-off accepted:**
  - A guest who pays part of a bill and keeps ordering (or one person in a
    group paying first) can't have that payment recorded until the whole
    bill is settled. Staff must remember it, on paper or in their head,
    which is exactly the kind of loss SCOPE set out to remove.
  - A settled bill is final: no edits, no refunds, no reopening.
  - I would build the ledger next. It also gives end-of-shift
    reconciliation a clean source of truth.

---

## Product decisions

### One workflow: the table's check, from first item to settled bill

- **Decision:** v1 is only the life of a table's order. Opening, adding
  items, the kitchen, serving, discount and void, the bill, and payment. I
  made this decision.
- **Reason:**
  - The biggest daily losses in a café are items served but never billed,
    untraceable discounts, and a kitchen that misses changes. They all live
    here.
  - Reports, inventory and tax submission all depend on the order data this
    workflow produces.
- **Alternative considered:**
  - A broader v1 (menu management, reports, QR ordering) at shallower depth.
  - Starting from reporting.
- **Trade-off accepted:** No reports, no inventory, minimal menu management,
  no staff or table setup screens. A restaurant needs us to onboard it. In
  exchange, the one workflow is built to survive concurrent use, weak
  connections and retries, with tests for each claim.

### Three roles: manager, staff, kitchen

- **Decision:** Only three roles. I made this decision.
- **Reason:** In most small Iranian cafés the waiter also takes payment, so
  a separate cashier role adds a login and a setup step that doesn't match
  how they work. Kitchen staff never see prices.
- **Alternative considered:** A separate cashier role, or configurable
  permissions.
- **Trade-off accepted:**
  - Any staff member can settle a bill, so the controls are on discounts
    and voids (manager-only once the kitchen has started, always with a
    reason and an audit entry), not on who takes money.
  - A cashier role can be added later without changing the data model.

### Keep the full scope and accept the time overrun

- **Decision:** I kept the full planned scope, including takeaway orders and
  a usable order screen, and accepted going over 6 hours. I made this
  decision.
- **Reason:**
  - **Takeaway** was already in the seed data and the schema (an order with
    no table), so cutting it saved little.
  - **A thinner UI** would have hurt the success criterion "a new staff
    member takes an order in under 10 minutes without training".
- **Alternative considered:** The agreed cut order:
  1. UI polish.
  2. Takeaway.
  3. A reduced AI import.
  4. Kitchen board visuals.

  It was suggested twice: once in planning after Phase 4 ran over, and
  again as an option at Phase 6.
- **Trade-off accepted:** **7:20 against 6:00**, a 1:20 overrun, reported
  rather than hidden. Where it went (from TIMELOG.md):
  - Phase 6 ran past its estimate.
  - Bill calculation and the PIN pepper were added during Phase 4.
  - A local Docker disk failure cost time during Phase 5.
  - In Phase 11, the superuser-only migration had to be fixed and exposed
    secrets rotated.

  Isolation, concurrency, checkout and their tests were never candidates
  for cutting.

### Discounts stored as type + value, not as a Toman amount

- **Decision:** A discount is `AMOUNT` or `PERCENT` (in basis points) with a
  value and a required reason. The bill calculation derives the Toman amount.
  I made this decision.
- **Reason:** A 10% discount must stay 10% if more items are added after it
  was given. A stored Toman amount would silently become 8%.
- **Alternative considered:** Store the computed Toman amount at the moment
  of discount.
- **Trade-off accepted:**
  - The discount's Toman value changes while the order is open. Staff see
    it on the bill.
  - At settle, the computed totals are snapshotted on the order, so history
    never changes afterwards.

### AI for one thing only: menu import from a photo

- **Decision:** A vision model reads a photo of the printed menu into a
  draft. The manager reviews and edits every row, and nothing is saved
  without confirmation.
- **Reason:**
  - The system is useless until the menu is in it, and typing 80 items is
    where onboarding stalls.
  - It runs once, during setup, never during service. If the AI is slow or
    unreachable, no shift is affected.
- **Alternative considered:** AI order-taking by voice or free text during
  service.
- **Trade-off accepted:**
  - The model misreads prices sometimes. One of five was wrong in the live
    test.
  - Review is mandatory, and price sanity checks flag the likely mistakes
    (thousand-Toman shorthand, Rial, out-of-range values, duplicates).

### AI provider: the GapGPT gateway

- **Decision:** An Iranian AI gateway (gapgpt.app) with an OpenAI-compatible
  API, using `gpt-4o`, configured by `AI_BASE_URL`, `AI_API_KEY` and
  `AI_MODEL`. I made this decision.
- **Reason:**
  - Direct OpenAI, Anthropic or Google accounts are not available to
    Iranian businesses.
  - A local gateway can be reached and paid for from Iran.
  - I confirmed with curl that it accepts images as base64 data URLs and
    reads Persian menus correctly.
- **Alternative considered:** A foreign provider directly (not usable by the
  customer), or self-hosted OCR plus parsing (much worse on handwritten or
  stylised Persian menus).
- **Trade-off accepted:**
  - A third party sees the menu photo and holds the key.
  - Availability and model choice depend on the gateway.
  - Costs are reported in USD.
  - The provider sits behind one small `MenuExtractor` interface with plain
    `fetch` and no SDK, so swapping it means changing three environment
    variables or one file.
  - The call goes from Frankfurt to the gateway, so it also fails during an
    internet cut. It is acceptable only because the import is never on the
    service path.

### The kitchen never receives prices

- **Decision:** Responses are shaped by role. No endpoint returns a price
  or total to a KITCHEN session, including the polling endpoint.
- **Reason:** The brief requires it, and hiding prices in the UI only would
  be cosmetic.
- **Alternative considered:** Hide them in the UI.
- **Trade-off accepted:** A role-aware view function (`lineView`) every
  endpoint must use. Tests assert the kitchen's payloads contain no price
  fields.

---

## Data and concurrency

### Adding items is INSERT-only

- **Decision:** Adding items inserts new `order_lines` rows and never
  rewrites the order. Adds hold the order row `FOR SHARE`.
- **Reason:**
  - Two waiters adding at the same moment can't overwrite each other,
    because there is nothing to overwrite.
  - `FOR SHARE` lets adds run in parallel but makes them wait for a settle
    in progress, so an item can't slip onto a bill being closed.
- **Alternative considered:** Read-modify-write the order with a version
  check. Every concurrent add would conflict, and staff would see
  conflicts for something that isn't one.
- **Trade-off accepted:**
  - Adds don't bump the order's version.
  - Settle recomputes the bill after taking its lock instead of trusting
    the client's view. A waiter paying against a stale total gets a clear
    422 with the new total.

### A generic idempotency table, not a key column per order line

- **Decision:** One `idempotency_records` table, unique on `(restaurant_id,
  key)`, storing the response. The key is inserted in the same transaction
  as the mutation, and a retry replays the stored response. I made this
  decision.
- **Reason:**
  - A per-row key works for inserts but not for conditional updates
    (status changes, discount, settle).
  - A retry after a lost response would hit the changed status or version
    and show a **false 409**, telling staff someone else changed it when it
    was their own request.
  - Replaying the stored response fixes that for every mutation in one
    helper.
- **Alternative considered:** `order_line.idempotency_key` with a unique
  constraint (the original design in the brief).
- **Trade-off accepted:**
  - An extra row and stored JSON per mutation.
  - No cleanup job yet. The table grows forever until a TTL job exists.
  - A concurrent duplicate waits on the unique index until the first
    commits, which is the behaviour we want.

### Line status changes are conditional updates; a 409 is never retried

- **Decision:** `UPDATE … WHERE id = $1 AND status = $from`. Zero rows means
  409 with the line's current state. The UI shows "changed by someone else"
  and refreshes, and never retries or overwrites.
- **Reason:** The kitchen and waiters work the same lines from different
  devices. A real conflict must be visible, not resolved by whoever writes
  last.
- **Alternative considered:** Last-write-wins, or a version per line.
- **Trade-off accepted:**
  - Staff occasionally see a conflict message and must look again.
  - Allowed moves are a small table: SENT→PREPARING→READY for the kitchen,
    READY→SERVED for staff. There is no undo move. Mistakes are corrected
    with a void, which has a reason and an audit entry.

### Order-level changes: optimistic version plus a row lock; settle recomputes

- **Decision:** Discount, settle and cancel order take `FOR UPDATE` on the
  order and compare the client's `version`. Stale means 409.
  - Settle, in one transaction: lock, check the version, recompute the
    bill from the lines, require payments equal the total to the Toman,
    then write the payments, the totals snapshot and SETTLED.
  - Line voids hold `FOR SHARE`.
- **Reason:**
  - The version catches a manager acting on a bill they saw before it
    changed.
  - The lock serialises the server-side work.
  - Recomputing after the lock means the snapshot always matches the lines.
- **Alternative considered:** Version check only, or SERIALIZABLE isolation
  with retries.
- **Trade-off accepted:**
  - Settle briefly blocks adds and voids on that one order.
  - **Verified by mutation:** removing the void's `FOR SHARE` made the race
    test fail 4 of 4 runs.

### Money as integer Toman; rates in basis points; one pure bill function

- **Decision:** All money is integer Toman, and rates are basis points. The
  calculation order is subtotal → discount → service charge → VAT
  (VAT is charged on the service charge), rounding half-up to a whole Toman
  at each step, in one unit-tested function (`lib/bill.ts`).
- **Reason:** No floating point in money. One function is used for display,
  settle and the seed, so the numbers can't disagree.
- **Alternative considered:** Decimal types, or rounding only at the end.
- **Trade-off accepted:** Per-step rounding can differ from end-only
  rounding by a Toman. It is documented and tested with the arithmetic
  written out.

### Snapshots: menu price on each line, totals on settle

- **Decision:** Each line stores the item's name and price at the time it
  was ordered. A settled order stores its computed totals.
- **Reason:** Prices change often with high inflation. A menu change must
  never change an open or past bill.
- **Alternative considered:** Join to the current menu and rates.
- **Trade-off accepted:** Duplicated data, which is the point.

---

## Security and tenancy

### Tenant isolation in three independent layers

- **Decision:**
  1. **Composite foreign keys:** every tenant table carries `restaurant_id`,
     and every reference is `(restaurant_id, x_id) → (restaurant_id, id)`.
  2. **Postgres Row-Level Security** with ENABLE and FORCE on every tenant
     table, read through a dedicated `app_user` role.
  3. **`withTenant()`** is the only path to tenant data. It sets
     `app.restaurant_id` transaction-locally, taken only from the session,
     and an ESLint rule blocks other access.
  - A startup guard refuses to serve if the runtime role is a superuser or
    has BYPASSRLS.
- **Reason:** Each layer catches a different mistake: a bad reference, a
  forgotten filter, a misconfigured connection. A cross-tenant leak ends a
  SaaS business.
- **Alternative considered:** Application-level filtering only, or a
  database or schema per tenant.
- **Trade-off accepted:**
  - Every tenant query runs inside a transaction with one extra
    `set_config` round trip.
  - The setting is transaction-local because Neon's pooler reuses
    connections. A session-level setting could leak to another tenant's
    request.

### Two SECURITY DEFINER functions for the lookups before login

- **Decision:** Login (slug + phone → staff) and session lookup (token hash
  → staff) happen before any tenant is known. They go through
  `auth_find_staff` and `auth_find_session`, owned by a NOLOGIN role
  `app_auth` that can read only three tables. `app_user` can execute them
  but cannot become `app_auth`.
- **Reason:** These are the only two ways across the tenant boundary, and
  each returns only what the caller needs. Each requires a secret (the
  token) or a known slug plus phone.
- **Alternative considered:**
  - A second, privileged database connection for auth.
  - Turning RLS off on the staff and session tables.
- **Trade-off accepted:** Raw SQL migrations that are harder to read than
  Prisma code, and the ownership change that broke on Neon (see above).

### PINs: scrypt plus an HMAC pepper

- **Decision:** PINs are HMAC-SHA256'd with `PIN_PEPPER` from the
  environment, then hashed with Node's built-in scrypt. The pepper was my
  requirement.
- **Reason:**
  - A 4–6 digit PIN has at most a million values. With scrypt alone,
    anyone with a database dump can try them all offline in minutes.
  - The pepper lives only in the app's environment, so a leaked database
    alone isn't enough.
  - scrypt over argon2 or bcrypt: no dependency and no native build on
    Vercel.
- **Alternative considered:** argon2 or bcrypt without a pepper (what the
  brief allowed).
- **Trade-off accepted:**
  - The seed and the app must share the pepper.
  - Changing it invalidates every PIN. Rotation would need a pepper id in
    the hash, which isn't built.
  - Online guessing is still the rate limiter's job.

### Sessions in the database; rate limits in Postgres

- **Decision:**
  - **Sessions:** a random token in an HttpOnly, SameSite=Lax cookie
    (Secure over HTTPS). Only its SHA-256 is stored. Fixed 12 hours, not
    sliding.
  - **Login limits:** 5 failures per account since its last success, or 20
    per IP, within 15 minutes. Every failure returns the same 401 and runs
    the same hash work, so accounts can't be enumerated.
- **Reason:**
  - Vercel functions are stateless, so in-memory limits don't work.
  - Deactivating staff must end their sessions immediately.
  - A lost phone stops working by the next day.
- **Alternative considered:** JWTs, or a Redis rate limiter.
- **Trade-off accepted:**
  - One session lookup per request.
  - A concurrent burst can slightly exceed a limit.
  - No cleanup job yet for old attempts and sessions.

### Content Security Policy without nonces

- **Decision:** `'self'` plus `'unsafe-inline'` for scripts, plus HSTS,
  nosniff, frame denial, a referrer policy and a permissions policy.
- **Reason:** Nonces force every page to render per request. We render no
  user-supplied HTML, and React escapes output.
- **Alternative considered:** A nonce-based strict CSP.
- **Trade-off accepted:** Inline-script XSS isn't blocked by CSP. We rely
  on React's escaping.

---

## Engineering and delivery

### Migrations run in the Vercel build

- **Decision:** The build command is `prisma migrate deploy && next build`.
- **Reason:** The schema and the code ship together, from one push.
- **Alternative considered:** Migrating by hand before each deploy, or a
  separate CI job.
- **Trade-off accepted:**
  - Migrations run before the new code serves, so they must work with the
    version still running (expand, then contract).
  - Preview deployments must use a Neon branch, or a preview build would
    migrate production.

### Tests against real Postgres; an API-level workflow test, not Playwright

- **Decision:**
  - Integration tests call the real route handlers against a real Postgres
    as `app_user`, with RLS on.
  - The full-workflow test logs in four people and runs a check from open
    to settled, at the API level. I chose API level over Playwright.
- **Reason:** The risky logic (concurrency, money, isolation) lives on the
  server. Browser tests would add a dependency and setup time inside a
  6-hour build.
- **Alternative considered:** Playwright end to end, or mocked database
  tests.
- **Trade-off accepted:**
  - The browser UI has no automated tests. It was checked by hand after
    each UI phase.
  - The full list of what isn't tested, and why, is in the README.

### Route wrapper instead of middleware; Next.js caching off

- **Decision:** One `route()` wrapper per handler handles the request id,
  timing, one JSON log line and the error format. Cache Components is off.
- **Reason:**
  - Logging status and duration has to wrap each handler anyway.
  - Every screen is per-tenant data that changes every few seconds. A
    server cache keyed wrongly is a cross-tenant leak.
- **Alternative considered:** Next.js `proxy.ts` (middleware) plus the
  default caching.
- **Trade-off accepted:** Every route must use the wrapper. This is easy to
  check in review.
