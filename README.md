# VECTOR

A personal competitive-programming performance instrument. One objective: **12,604 → 25,000+**.

```
CURRENT STATE → TRAJECTORY → TODAY'S EXECUTION → NEXT → verified completion → score update → calendar → NEXT
```

## Run locally

Requires Node 22+ and PostgreSQL 14+.

```bash
cp .env.example .env          # set DATABASE_URL, OWNER_EMAIL, OWNER_PASSWORD
npm install
npm run migrate
npm run seed                  # owner account, baseline 12,604, curated problem pool
npm run dev                   # api :4000, web :5173
```

Optional development data (never use against your real database):

```bash
SEED_DEV_CONTESTS=1 npm run seed   # four contests relative to now, labelled [DEV SEED]
npm run demo-history -w server     # DROPS the schema and writes 21 synthetic days tagged demo
```

Run every scheduled job once: `npm run jobs` (or `npm run jobs -- notify`).
Tests: `npm test` (needs a `vector_test` database; set `TEST_DATABASE_URL` to override).

## How it is built

| Layer | Location |
|---|---|
| Pure domain engines: score, trajectory, daily objective, calendar, awards, consistency, notifications, time | `server/src/domain` |
| Accepted-problem pipeline, derived state, contests, notifications, sync, jobs | `server/src/services` |
| Platform adapters (Codeforces official API, clist.by, honest fallbacks) | `server/src/adapters` |
| HTTP API | `server/src/routes` |
| Schema | `server/src/db/sql` |
| Editorial frontend, PWA | `web/` |

The score is computed by `server/src/domain/score.ts`, never by a model. See `DECISIONS.md` for the assumptions to confirm, and `DEPLOY.md` for free hosting.
