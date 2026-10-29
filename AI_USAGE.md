# How AI was used

AI was used heavily throughout this assessment. This page says where it
helped, where it got things wrong, what I rejected, and how its output was
checked.

## Tools and what each did

| Tool | Used for |
|---|---|
| **Claude, in chat** | Planning before any code: reading the brief, researching Iran-specific requirements (Toman, VAT, card readers, card-to-card transfers, connectivity, sanctioned services), choosing the workflow and stack, and drafting SCOPE.md with me. Then step-by-step guidance during the build, including what to check at each phase and how to respond when I fell behind. |
| **Claude Code** (in VS Code) | Implementation, in phases defined in [CLAUDE.md](CLAUDE.md): one phase at a time. At the end of each phase it ran lint, typecheck and tests, summarised what it did, proposed a commit message, then stopped. It was told not to expand scope, add dependencies or change technologies without asking, never to commit or push, and to log decisions in [NOTES.md](NOTES.md). I reviewed each phase and made every commit myself. |

The AI feature inside the product (menu import from a photo) uses `gpt-4o`
through the GapGPT gateway. That is part of the product, not the build
process. See DECISIONS.md.

## Where AI saved real time

- **Boilerplate around a stack I already knew:**
  - the Next.js, Prisma 7, Docker and logging scaffold;
  - env validation;
  - the error format;
  - the request wrapper.
- **Raw SQL I would have written slowly:**
  - Row-Level Security policies for 13 tables;
  - the `app_user` role;
  - the database integrity checks;
  - the two SECURITY DEFINER lookup functions.

  All of it had to be idempotent.
- **Tests:** 137 tests (41 unit, 96 integration) against a real Postgres.
  They cover concurrent adds, status races, stale versions, idempotent
  retries, payment mismatches, settle racing an add or a void, tenant
  isolation at each layer, and every role rule. Writing the concurrency
  tests by hand would have taken longer than the features themselves.
- **Realistic seed data:**
  - a Shiraz café menu with plausible 1405 prices;
  - Persian staff names;
  - a week of order history with Thursday-evening and Friday peaks;
  - mixed payment methods and split bills;
  - discounts and voids with reasons and audit entries;
  - a second restaurant in Tehran for the isolation demo.
- **Persian UI text and error messages** throughout.
- **Diagnosis:** when the production migration failed on Neon, Claude Code
  reproduced the exact error on a throwaway database, fixed it, and
  rehearsed the recovery before I ran it on production.
- **Documentation drafts:** the README sections, NOTES.md, and these three
  documents.

Without it, this scope would not have fit anywhere near the time limit. Even
with it, the build took 7:20 against 6:00 (see [TIMELOG.md](TIMELOG.md)).

## Where it produced something bad

1. **`name` vs `nameSnapshot` (Phase 7).**
   - **What went wrong:** the kitchen board query selected a field called
     `name` on order lines. The field is `nameSnapshot`.
   - **Why the checks missed it:** TypeScript accepted it, because Prisma's
     types didn't catch an unknown field in that nested `select`. It would
     have failed only at runtime, on the kitchen screen.
   - **Outcome:** caught in review. The kitchen tests now exercise that
     query.
   - **Lesson:** "it type-checks" is not "it works".
2. **The missing PIN pepper (Phase 4).**
   - **What I asked for:** the PIN to be HMAC'd with a secret pepper from
     the environment before hashing.
   - **What was delivered:** plain scrypt. It was well built, but not what
     I asked for, and the summary didn't mention the gap.
   - **Outcome:** I caught it in my diff review and had it added, with
     tests and a note on why it exists.
   - **Lesson:** check delivered work against the request, not against
     its own summary.
3. **The auth-lookup migration that passed locally and failed on Neon
   (Phase 11).**
   - **What went wrong:** every local and test run migrated as a Postgres
     superuser, and superusers skip permission checks. On Neon the owner is
     not a superuser, and the migration failed with `permission denied for
     schema public`.
   - **Why it was a design flaw:** the test setup didn't match production.
     More tests of the same kind wouldn't have caught it.
   - **Outcome:** local Docker and the tests now migrate as a non-superuser
     owner, and a test enforces it.
   - **Lesson:** a green suite proves only what its environment can see.

## A recommendation I rejected

**Cutting scope to stay within 6 hours.**
- **Suggested twice:** in chat during planning, when I fell behind after
  Phase 4; then in Claude Code's options at Phase 6, which were to drop
  takeaway orders and thin the order-screen UI.
- **Why I kept the full scope:**
  - **Takeaway** was already in the seed data and the schema, so cutting it
    saved little.
  - **A thin UI** would have hurt the goal I care most about in SCOPE: a
    new staff member takes a complete order in under 10 minutes without
    training.
- **The cost** was the overrun: 7:20 against 6:00, explained in TIMELOG.md.

I never considered cutting tenant isolation, concurrency, checkout or
their tests.

## How generated code was verified

- **My diff review of every phase** before committing. This is where the
  missing pepper and other deviations from what I asked for were caught.
- **Running the tests myself**, not only reading Claude Code's report that
  they passed.
- **Manual UI checks** after Phases 6, 7 and 8, and
  a real menu photo through the AI import in Phase 10. Claude Code had no
  browser, so it never saw the UI.
- **Proving the tests can fail:**
  - **The settle race test:** with the void's `FOR SHARE` lock removed, it
    failed 4 of 4 runs (the settled total still included the voided item).
    So the test really detects that race.
  - **The isolation tests:** pointed at a superuser connection, all
    role-dependent isolation tests fail.
- **Live checks:**
  - the production deployment, opened from Iran without a VPN;
  - one real AI call with a deliberately injected instruction in the image,
    which the model ignored.

## Whose thinking is whose

- **Developed together with Claude, in chat:** the architecture. That covers
  three-layer isolation, polling, idempotency keys, conditional updates and
  version checks, and the shape of the AI import. Much of the technical
  design in CLAUDE.md came out of that discussion. I don't claim it as
  solely mine.
- **My decisions:**
  - **Product:** the one workflow (a table's check, from first item to
    settled bill); three roles; what is out of scope; the AI feature being
    menu import, not order-taking.
  - **Hosting:** Vercel and Neon in Frankfurt, after checking the live URL
    from Iran.
  - **Provider:** the GapGPT gateway.
  - **Keeping the full scope**, and accepting the overrun.
- **Pushback during review:** I required the PIN pepper. Several decisions
  started as options Claude Code raised, and I chose among them:
  - the generic idempotency table instead of a per-line key;
  - discount stored as type + value;
  - scrypt over argon2 or bcrypt;
  - an API-level workflow test instead of Playwright.
- **Claude Code** made smaller implementation choices within those
  boundaries and logged them in NOTES.md for me to review.

## Secrets

During manual testing, the AI API key and other secrets were exposed, and I
rotated them. No secret has been committed to the repository. `.env` is
git-ignored, and the only key-like value in the history is a test
placeholder. The app never logs PINs, session tokens, full phone numbers or
API keys. The AI key is used only on the server and is not in the browser
bundle.

## These documents

DECISIONS.md, AI_USAGE.md and HANDOVER.md were drafted by Claude Code from
NOTES.md, the commit history, TIMELOG.md and SCOPE.md. I reviewed and
edited them.
