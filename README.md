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

Then open <http://localhost:3000>. This starts Postgres, applies migrations
and runs the app in production mode. Health check: <http://localhost:3000/api/health>.

The compose Postgres is published on host port **5433** (not 5432) so it does
not collide with a Postgres you may already run. Override with
`POSTGRES_PORT=5434 docker compose up --build`.

### Demo logins

_To be added (Phase 4)._

## Development

Requires Node 24+.

```bash
cp .env.example .env
docker compose up -d db     # Postgres only
npm install                 # also generates the Prisma client
npm run db:setup            # apply migrations, set the app_user password
npm run dev                 # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | Generates Next route types, then `tsc --noEmit` |
| `npm test` | All tests. Integration tests need `docker compose up -d db` and use a separate `restaurant_test` database |
| `npm run test:unit` / `test:integration` | One project only |
| `npm run db:migrate` | Create a new migration (`prisma migrate dev`) |
| `npm run db:setup` | Apply migrations and set the `app_user` password (idempotent) |

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

_To be written (Phase 9), including what we deliberately did not test and why._

## Deployment

_To be written (Phase 11): Vercel (fra1) + Neon (Frankfurt)._
