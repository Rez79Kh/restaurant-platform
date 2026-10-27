# سفارش میز — Restaurant Platform v1

Order-to-settled-bill workflow for cafés and restaurants in Iran: staff take
orders from their phones, the kitchen sees new items within seconds, and the
bill closes only when payments match the total. See [SCOPE.md](SCOPE.md) for
what v1 does and does not include.

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
- `DIRECT_URL` — migrations only (production: Neon **direct**, as the owner).
- `APP_DB_PASSWORD` — applied to `app_user` by `npm run db:setup`; never stored in a migration.

The app must connect as `app_user` (not a superuser, not the table owner):
Postgres superusers and table owners bypass Row-Level Security. An
integration test fails if the runtime connection is misconfigured.

## Architecture

_To be written (Phase 11)._

### Tenant isolation (three independent layers)

1. **Composite foreign keys** — every tenant table carries `restaurant_id`, and
   every reference is `(restaurant_id, x_id) → (restaurant_id, id)`, so a row
   cannot point at another restaurant's row.
2. **Row-Level Security** — `ENABLE` + `FORCE` on every tenant table; policies
   compare `restaurant_id` to `app.restaurant_id`. No context → zero rows.
3. **`withTenant()`** — the only path to tenant data (enforced by an ESLint
   rule). It sets `app.restaurant_id` transaction-locally, from the session only.

Tests in `tests/integration/isolation.test.ts` exercise each layer separately.

## Testing

```bash
docker compose up -d db   # integration tests need the compose Postgres
npm test                  # 108 tests: 23 unit + 85 integration, about 10 s
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

## Deployment

_To be written (Phase 11): Vercel (fra1) + Neon (Frankfurt)._
