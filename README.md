# سفارش میز — Restaurant Platform v1

Order-to-settled-bill workflow for cafés and restaurants in Iran: staff take
orders from their phones, the kitchen sees new items within seconds, and the
bill closes only when payments match the total. See [SCOPE.md](SCOPE.md) for
what v1 does and does not include.

**Live:** <https://restaurant-platform-bay.vercel.app/> (demo logins below).

## Run it locally (one command)

Requires Docker.

```bash
docker compose up --build
```

Then open <http://localhost:3000>. This starts Postgres, applies migrations,
seeds the demo data and runs the app in production mode. Health check: <http://localhost:3000/api/health>.

The compose Postgres is published on host port **5433** (not 5432) so it does
not collide with a Postgres you may already run. Override with
`POSTGRES_PORT=5434 docker compose up --build`.

Migrations run as `migrator`, a non-superuser database owner like Neon's,
created by [docker/postgres-init.sql](docker/postgres-init.sql) when the
volume is first created. If you have a volume from before that role existed,
recreate it once (demo data only): `docker compose down -v`.

### Demo logins

Log in at `/login` with the restaurant code (slug), phone and PIN. Persian
digits are accepted. Demo PINs only: never reuse in production. The demo
data's PINs verify only with the `PIN_PEPPER` the seed ran with (the local
placeholder in `.env.example`). After changing it, run `npm run db:reseed`.

**کافه نارنج** (Shiraz café), slug `cafe-narenj`: a week of history, 5 open orders

| Role | Name | Phone | PIN |
|---|---|---|---|
| Manager | مریم کاظمی | 09170000001 | 1234 |
| Staff | علی رضایی | 09170000002 | 1111 |
| Staff | سارا احمدی | 09170000003 | 2222 |
| Staff | حسین محمدی | 09170000004 | 3333 |
| Kitchen | نرگس حسینی | 09170000005 | 4444 |

**رستوران کوچه** (Tehran restaurant, used to demonstrate isolation), slug `kucheh`

| Role | Name | Phone | PIN |
|---|---|---|---|
| Manager | رضا موسوی | 09120000001 | 5555 |
| Staff | فاطمه کریمی | 09120000002 | 6666 |
| Kitchen | محمد جعفری | 09120000003 | 7777 |

### Demo data

The seed ([prisma/seed.mts](prisma/seed.mts)) is idempotent: it creates the two
demo restaurants only if they are missing. `npm run db:reseed` deletes and
recreates them (and nothing else), refreshing "live" orders to the current time.

- Café: 34 menu items in five categories (some marked unavailable), 10 tables,
  about 210 settled orders over the last week. Thursday evening and Friday are
  the busiest. Card reader is dominant, then card-to-card and cash, with split
  bills. A few discounts and voids, each with a reason and an audit entry.
- Five open orders in different states: items ready to serve, items in the
  kitchen, a second round of items, a discounted bill, and a takeaway.
- VAT 10% for both (to be confirmed for 1405). Service charge 0% at the café,
  10% at the Tehran restaurant.

## Development

Requires Node 24+.

```bash
cp .env.example .env
docker compose up -d db     # Postgres only
npm install                 # also generates the Prisma client
npm run db:setup            # migrations, app_user password, demo data
npm run dev                 # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | Generates Next route types, then `tsc --noEmit` |
| `npm test` | All tests. Integration tests need `docker compose up -d db` and use a separate `restaurant_test` database |
| `npm run test:unit` / `test:integration` | One project only |
| `npm run db:migrate` | Create a new migration (`prisma migrate dev`) |
| `npm run db:setup` | Apply migrations, set the `app_user` password, seed demo data (all idempotent) |
| `npm run db:reseed` | Delete and recreate the two demo restaurants |

## Configuration

Every variable is listed with an explanation in [.env.example](.env.example).
The environment is validated at server start; a missing or invalid variable
stops the server with a message naming the variable (never its value).

- `DATABASE_URL` — the app's runtime connection (production: Neon **pooled**, as `app_user`).
- `DIRECT_URL` — migrations only (production: Neon **direct**, as the owner;
  locally `migrator`, a non-superuser owner, so migrations hit the same
  permission checks as on Neon).
- `APP_DB_PASSWORD` — applied to `app_user` by `npm run db:setup`; never stored in a migration.
- `PIN_PEPPER` — secret HMAC key for PINs (≥ 32 chars). The seed and the app must use the same value.
- `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` — menu import from a photo. Optional: without them, menu items are entered by hand.

The app must connect as `app_user`. Superusers and roles with BYPASSRLS
ignore Row-Level Security even with FORCE, so the server **refuses to start**
if `DATABASE_URL` is such a role (it logs `fatal` and names it), and an
integration test checks that the runtime role is neither of those and owns
no tables.

## Architecture

```
Phones and a kitchen tablet: Persian RTL UI (Next.js App Router)
  │  JSON over HTTPS · every mutation carries an Idempotency-Key
  │  polls GET /api/changes every 2.5 s (paused while the tab is hidden)
  ▼
Route Handlers on Vercel (fra1, Node runtime)
  route()          request id, timing, one JSON log line, { error: { code, message } }
  requireRole()    session cookie → auth_find_session() → role check (401 / 403)
  withTenant()     BEGIN; set_config('app.restaurant_id', <from session>, true); …
  idempotent()     key stored in the same transaction; retries replay the response
  ▼
Neon Postgres (Frankfurt) through the pooler, as app_user
  RLS (ENABLE + FORCE) · composite FKs · CHECKs · one-open-order index · triggers

Menu import only: POST /api/menu-imports → OpenAI-compatible AI gateway (server-side)
```

**The one workflow** (SCOPE §4), in API calls:

| Step | Endpoint | How it stays correct under concurrency |
|---|---|---|
| Open a table | `POST /api/orders` | Partial unique index: one OPEN order per table; the loser gets 409 and the existing order |
| Add items | `POST /api/orders/:id/lines` | INSERT only, never rewrites the order; `FOR SHARE` on the order; menu name and price snapshotted |
| Kitchen and waiter move items | `POST /api/order-lines/:id/status` | `UPDATE … WHERE id = $1 AND status = $from`; 0 rows → 409 with the current state |
| Discount, cancel order | `POST /api/orders/:id/discount`, `…/void` | `FOR UPDATE` + client's `version`; stale → 409; audited |
| Void an item | `POST /api/order-lines/:id/void` | Conditional like any status change; staff before the kitchen starts, manager after; audited |
| Settle | `POST /api/orders/:id/settle` | One transaction: lock, check version, recompute the bill after the lock, payments = total to the Toman, snapshot totals; audited |
| Live screens | `GET /api/changes?since=` | DB-clock cursor with a 10 s overlap; clients reload their snapshot on any change |

**Money**: integer Toman everywhere. One pure function (`lib/bill.ts`):
subtotal → discount → service charge → VAT, rounding half-up to a whole Toman
at each step. A settled order stores its totals, so history never changes.

**Roles** are checked on the server in every handler. Staff open orders,
add, serve, void unstarted items and settle. Managers do everything,
including discounts, voids after the kitchen starts and the menu import.
Kitchen sees tickets and moves items to preparing and ready, and never
receives a price from any endpoint.

**Where things live**

| Path | What |
|---|---|
| `app/api/**/route.ts` | REST endpoints: validation (Zod), role check, then one transaction |
| `app/**/page.tsx`, `components/` | Plain UI: login, tables grid, order screen, kitchen board, menu import |
| `lib/tenant.ts`, `lib/auth/`, `lib/idempotency.ts`, `lib/orders/` | The rules: isolation, sessions and rate limits, idempotency, locking and views |
| `lib/bill.ts`, `lib/pin.ts`, `lib/ai/` | Pure money calculation, PIN hashing, menu extraction and price checks |
| `prisma/schema.prisma`, `prisma/migrations/` | Schema; raw SQL for integrity rules, the `app_user` role, RLS and the two pre-login lookups |
| `tests/integration/` | Real Postgres, real handlers: isolation, auth, ordering, kitchen, checkout, menu import, full workflow |

Decisions and trade-offs, with reasons, are logged in [NOTES.md](NOTES.md).

### Tenant isolation (three independent layers)

1. **Composite foreign keys** — every tenant table carries `restaurant_id`, and
   every reference is `(restaurant_id, x_id) → (restaurant_id, id)`, so a row
   cannot point at another restaurant's row.
2. **Row-Level Security** — `ENABLE` + `FORCE` on every tenant table; policies
   compare `restaurant_id` to `app.restaurant_id`. No context → zero rows.
3. **`withTenant()`** — the only path to tenant data (enforced by an ESLint
   rule). It sets `app.restaurant_id` transaction-locally, from the session only.

Tests in `tests/integration/isolation.test.ts` exercise each layer separately.

## Security

These are the four risks we designed against. Reasons and trade-offs are in
[DECISIONS.md](DECISIONS.md#security-and-tenancy).

**1. One restaurant sees or changes another's data**
- **Risk:** a forgotten filter, a spoofed id, or a pooled connection that
  carries one tenant's context into another tenant's request.
- **What we did:**
  - The three isolation layers above. The restaurant comes only from the
    session.
  - The tenant setting is transaction-local.
  - The server refuses to start if its database role can bypass RLS.
- **Evidence:** `isolation.test.ts`:
  - each layer is tested on its own;
  - with no tenant context, queries return zero rows;
  - the setting doesn't survive on a reused connection;
  - the startup guard rejects a superuser.

  In `ordering.test.ts` and `kitchen.test.ts`, a user of restaurant B
  using restaurant A's ids gets 404 or 409. In `auth.test.ts`, a spoofed
  restaurant header or query parameter is ignored.

**2. PIN brute force**
- **Risk:** a 4–6 digit PIN has at most a million values. It can be
  guessed online, or cracked offline from a leaked database.
- **What we did:**
  - **Online:**
    - Login limits are stored in Postgres: 5 failures per account and 20
      per IP within 15 minutes.
    - Every failure gets the same 401, and an unknown account still runs
      one scrypt, so responses don't reveal which accounts exist.
  - **Offline:** PINs are HMAC'd with a secret pepper from the environment
    before scrypt, so a database dump alone can't be cracked.
- **Evidence:**
  - `auth.test.ts`: lockout after 5 failures even with the right PIN, the
    per-IP limit, identical answers, and failures audit-logged.
  - `lib/pin.test.ts`: the right PIN under a different pepper fails.

**3. Staff fraud through discounts and voids**
- **Risk:** taking cash and then discounting or voiding the item so the
  bill still balances, or editing the record afterwards.
- **What we did:**
  - Discounts are manager-only.
  - Staff can void only items the kitchen hasn't started; anything later
    needs a manager.
  - Every discount, void, discount removal and settle needs a reason and
    writes an audit event: who, when, and the values before and after.
  - The app's database role cannot update or delete audit events.
  - A settled bill stores its totals and can't be edited.
- **Evidence:**
  - `checkout.test.ts`: STAFF and KITCHEN cannot discount, staff cannot
    void once the kitchen has started, discounts and voids are audited,
    and a settled bill never changes.
  - `isolation.test.ts`: the app cannot update or delete the audit log.

**4. AI prompt injection and malicious uploads**
- **Risk:**
  - Text in a menu photo tells the model to change prices.
  - A non-image or oversized file is uploaded.
  - The import is abused to run up AI costs.
- **What we did:**
  - **The model can only fill a draft:**
    - The system prompt treats image text as data.
    - The model has no tools and no write access.
    - Its output must match a strict schema; extra fields are dropped and
      anything else is rejected.
    - A manager reviews and confirms every row before anything reaches the
      menu.
  - **Upload limits:**
    - The file type is checked by its bytes (JPEG, PNG, WebP), not by
      what the client claims.
    - 4 MB maximum.
    - Manager-only.
    - 10 imports per restaurant per hour.
- **Evidence:**
  - `lib/ai/menu-checks.test.ts`: an injected field is dropped.
  - `menu-import.test.ts`: only real images within the size limit are
    accepted; import is manager-only and rate limited; nothing reaches
    the menu without confirm.
  - Live test: an instruction planted in the image was ignored (see
    NOTES.md, Phase 10).

## Testing

```bash
docker compose up -d db   # integration tests need the compose Postgres
npm test                  # 137 tests: 41 unit + 96 integration, about 10 s
```

Integration tests run against a real Postgres (a separate `restaurant_test`
database) and call the real route handlers with real `Request` objects. They
connect as `app_user`, so Row-Level Security is on, as in production. One test
fails if the runtime connection is ever a superuser or table owner, because
that would silently switch RLS off.

### SCOPE's "done" criteria, and the tests that hold us to them

| SCOPE §5 | Tests |
|---|---|
| Two staff adding items at the same moment, both on the bill | `ordering`: 10 simultaneous adds from two sessions all persist; `workflow` step 3 |
| Kitchen changes status while a waiter works: nothing lost; real conflicts shown, never overwritten | `kitchen`: status change and add in parallel both succeed; two devices on one line → one 200, one 409 with the current state; stale `from` never overwrites |
| A double-tap or resent request never duplicates | `ordering`: same request ×5 at once → applied once; retry after success → replayed; `checkout`: retried settle pays once; `kitchen`: retried status move replays, no false 409 |
| A bill can't close unless payments match the total | `checkout`: 1 Toman over or under → 422, nothing written; settle racing an add or void never yields a bill that disagrees with its lines |
| A menu price change never changes an open or past bill | `ordering`: name and price snapshots; `checkout`: settled bill unchanged by later price and VAT changes |
| One restaurant can never see or change another's data | `isolation`: each of the three layers tested on its own; `ordering` and `kitchen`: a signed-in user of B against A's order, table, menu item and line ids → 404/409; `auth`: restaurant comes only from the session |
| A new staff member takes an order in under 10 minutes | Not automated: needs a usability test with a real person (see below) |

Also covered: the bill calculation (`lib/bill.test.ts`, half-up rounding at
each step), PIN hashing with pepper, env validation, the request wrapper,
login (lockout, per-IP limit, no account enumeration, Persian digits),
sessions and expiry, every role rule in CLAUDE.md, and one full workflow
(`tests/integration/workflow.test.ts`). It logs in four people and runs a
table's check from opening to the settled, split-paid, discounted bill.

### What we deliberately did not test, and why

| Not tested | Why | What covers the risk instead |
|---|---|---|
| The browser UI (no Playwright or component tests) | Chosen trade-off for a 6-hour build: the risky logic (concurrency, money, isolation) lives on the server and is tested there. UI tests would add a browser dependency and setup time | Manual walk-through on a phone and a tablet. The UI only calls the tested API. Client-side key reuse on retry (`useAction`, `useLineActions`) is reviewed, not tested |
| Real network faults (throttling, a drop mid-request) | No fault injection in the test setup | Idempotency is tested directly: same key, concurrent and after success, replays the stored result |
| Polling cost and latency under load | No load-test tooling in scope | Cost is estimated in `app/api/changes/route.ts`. Cheap indexed queries; polling pauses in hidden tabs |
| Neon's connection pooler (PgBouncer) | Tests run on plain Postgres | The tenant setting is transaction-local (`set_config(..., true)`), and a test proves it doesn't survive on a reused connection. Production smoke-checked after deploy |
| Commit-order skew in `/api/changes` | Not reproducible deterministically | 10-second overlap window, and clients reload on change instead of merging |
| Login timing equality; rate-limit bursts | Timing tests are flaky; bursts are a known small gap | Unknown accounts still run one scrypt. Limits are counted in Postgres, so a burst overshoots by at most the concurrent requests |
| The seed script | Data, not behaviour | Verified with SQL checks: payments equal totals, subtotals match lines, weekly peaks present. Idempotent re-run checked by hand |
| Log redaction | Config, reviewed once | Call sites mask phones (`maskPhone`); pino `redact` is a safety net |
| Cookie behaviour across browsers | Needs real browsers | Standard attributes; `Secure` only over HTTPS so Safari keeps the cookie on `http://localhost` |
| Persian number and Jalali date formatting | Relies on the platform's ICU data (`Intl`), not our code | Checked visually |
| "Under 10 minutes without training" | A usability claim, not a code property | To be checked with someone who has never seen the app |
| How accurately the AI reads real menus | Model behaviour, not our code; tests use a fake gateway | One live smoke test (synthetic Persian menu, see NOTES.md): 5 of 5 items found, one price misread (۱۳۰ → ۱۲۰). This is why every row is reviewed before saving. Price sanity checks are unit-tested |
| Prompt injection against the real model | Can't be proven with tests | Layered: the system prompt says image text is data; no tools; output must match a strict schema (extra fields dropped, anything else rejected); a manager confirms every row. The live smoke test's injected line was ignored |
| Client-side photo shrinking | Browser canvas API | Falls back to the original file; the server enforces type (magic bytes) and size anyway |

## Deployment

Production runs on **Vercel** (functions in `fra1`, Frankfurt, set in
[vercel.json](vercel.json)) and **Neon Postgres** in Frankfurt, deployed from
GitHub by Vercel. Same region keeps every database round trip short.

### First-time setup

1. **Neon**: create a project in *AWS Europe Central 1 (Frankfurt)*. From
   the dashboard, copy two connection strings for the owner role:
   *direct*, and *pooled* (host contains `-pooler`).
2. **Vercel environment variables** (Production):

   | Variable | Value |
   |---|---|
   | `DIRECT_URL` | Neon **direct** string, **owner** role. Used only by migrations during the build |
   | `DATABASE_URL` | Neon **pooled** string with the user and password swapped for `app_user` (keep `sslmode=require`) |
   | `PIN_PEPPER` | `openssl rand -base64 32`. Keep a copy: the seed needs the same value |
   | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | The AI gateway (optional) |
   | `LOG_LEVEL` | `info` |

3. **Deploy.** The build command (`vercel.json`) runs `prisma migrate
   deploy` before `next build`. The migrations create the `app_user` role,
   RLS policies and auth functions.
4. **Set the `app_user` password once**, from your machine (it prints which
   database it's writing to, never the password):
   ```bash
   DIRECT_URL='<neon direct, owner>' APP_DB_PASSWORD='<password>' node scripts/set-app-db-password.mts
   ```
   Use the same password in `DATABASE_URL`, then redeploy.
5. **Demo data** (once): `DIRECT_URL='<neon direct>' PIN_PEPPER='<same as Vercel>' npm run db:seed`.
   If a migration ever fails on Neon (Prisma `P3018`), fix it, then mark it
   rolled back and re-run setup. The RLS and auth migrations are idempotent,
   so a re-run is safe:
   ```bash
   npx prisma migrate status        # prints the target host; check it is Neon
   npx prisma migrate resolve --rolled-back <migration_name>
   npm run db:setup                 # migrate deploy + app_user password + seed
   ```
6. **Smoke check**: `/api/health` returns `{"status":"ok"}`; log in as each
   demo role. If `DATABASE_URL` points at the owner by mistake, the server
   refuses to start and the Vercel logs show a `fatal` line naming the role.

### Every deploy

- **Migrations run in the build, before the new code serves traffic.**
  They must therefore work with the version still running: add first, remove
  in a later deploy (expand → contract).
- **Preview deployments must use a Neon branch**, never production
  credentials, or a preview build would migrate the production database.
- **Pooling**: Neon's pooler is PgBouncer in transaction mode. The tenant
  setting is transaction-local (`set_config(…, true)`), so it can't leak
  between requests that share a connection.
- **Function limits**: menu import declares `maxDuration = 60` (two AI
  attempts of 20 s). Uploads are capped at 4 MB, under Vercel's 4.5 MB
  request limit.

### Known operational gaps (v1)

- No cleanup jobs yet for `login_attempts`, `idempotency_records` and
  expired `sessions`. A daily Vercel Cron would do it.
- Backups: rely on Neon's point-in-time restore. No separate export.
- Hosted outside Iran (SCOPE §11): if international connectivity is cut, the
  app is unreachable. Moving hosting into Iran is the first fix if that
  becomes real.
