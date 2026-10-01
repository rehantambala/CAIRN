# CAIRN

A competitive-programming performance instrument. Each person signs in with Google or GitHub, connects their coding profiles, and works towards their own objective (25,000+ by default).

```
CURRENT STATE → TRAJECTORY → TODAY'S EXECUTION → NEXT → verified completion → score update → calendar → NEXT
```

## Run locally

Requires Node 22.12+ and PostgreSQL 14+.

```bash
cp .env.example .env          # set DATABASE_URL; OWNER_EMAIL/OWNER_PASSWORD for a local password account
npm install
npm run migrate
npm run seed                  # development owner with sample baseline figures, curated problem pool
npm run dev                   # api :4000, web :5173
```

Optional development data (never use against your real database):

```bash
SEED_DEV_CONTESTS=1 npm run seed   # four contests relative to now, labelled [DEV SEED]
npm run demo-history -w server     # DROPS the schema and writes 21 synthetic days tagged demo
```

Run every scheduled job once: `npm run jobs` (or `npm run jobs -- notify`).
Tests: `npm test` (needs a `cairn_test` database; set `TEST_DATABASE_URL` to override). `server/test/security.test.ts` covers sessions, OAuth negative cases, CSRF, isolation between people, injection, XSS, SSRF, rate limits, reminders and the database lock-down.

## How it is built

| Layer | Location |
|---|---|
| Pure domain engines: score, trajectory, daily objective, calendar, awards, consistency, notifications, time | `server/src/domain` |
| Accepted-problem pipeline, derived state, contests, notifications, sync, jobs | `server/src/services` |
| Platform adapters, one per platform, each implementing only what its source provides | `server/src/adapters` |
| Sign-in identities, sessions, profile connections, contest sources, reminders, strategist, account export and deletion | `server/src/services/{identity,sessions,accounts,sync,notify,scheduler,strategist,account}.ts` |
| Security middleware: headers, CSRF, CORS, rate limits, logging, errors | `server/src/routes/security.ts` |
| HTTP API | `server/src/routes` |
| Schema | `server/src/db/sql` |
| Editorial frontend, PWA | `web/` |

The score is computed by `server/src/domain/score.ts`, never by a model; the optional strategist only interprets verified figures and has no write path. See `DECISIONS.md` for the assumptions to confirm, `DEPLOY.md` for free hosting, and `SECURITY.md` for the security model, threat model and how to report a vulnerability.
