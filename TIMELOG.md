# Time log

The brief caps the work at 6 hours. This log records time as it was spent,
written during the work, not afterwards. Entries line up with the commit history.

| Date | Start | End | Duration | Work |
|---|---|---|---|---|
| 1405/08/05 | 16:10 | 17:00 | 0:50 | Read the brief; researched Iran-specific requirements; chose the workflow, stack and hosting (planning discussion with Claude) |
| 1405/08/05 | 17:00 | 17:30 | 0:30 | Wrote SCOPE.md |
| 1405/08/05 | 17:35 | 17:40 | 0:05 | Wrote CLAUDE.md |
| 1405/08/05 | 17:40 | 18:05 | 0:25 | Phase 2: scaffold Next.js, Docker, Prisma, logging, env validation |
| 1405/08/05 | 18:15 | 18:50 | 0:35 | Phase 3: domain schema, RLS tenant isolation, isolation tests |
| 1405/08/05 | 18:50 | 19:00 | 0:10 | Vercel + Neon connected; live URL checked from Iran without VPN |
| 1405/08/05 | 19:00 | 19:40 | 0:40 | Phase 4: seed data, bill calculation, PIN hashing with pepper (bill calc moved here from Phase 8; pepper added after review) |
| 1405/08/05 | 19:40 | 20:10 | 0:30 | Phase 5: login, sessions, rate limiting, requireRole, auth tests |
| 1405/08/05 | 20:10 | 20:55 | 0:45 | Phase 6: tables grid, order screen, idempotent adds, polling, concurrency tests; manual UI check |
| 1405/08/05 | 20:55 | 21:35 | 0:40 | Phase 7: kitchen board, conditional status transitions, conflict handling, tests; manual UI check |
| 1405/08/05 | 21:35 | 22:20 | 0:45 | Phase 8: discounts, voids, split payments, settle transaction, checkout tests; manual UI check |
| 1405/08/05 | 22:20 | 22:35 | 0:15 | Phase 9: full-workflow test, README testing section |
| 1405/08/05 | 22:35 | 23:10 | 0:35 | Phase 10: AI menu import (draft → review → confirm), validation, fallback, tests; manual check with a real menu photo |

**Total so far:** 6:45 / 6:00
**Overrun:** 0:45 - Phase 6 (ordering screens and concurrency tests) ran over its estimate; the bill calculation and PIN pepper were added during Phase 4; a local Docker disk failure cost time during Phase 5.