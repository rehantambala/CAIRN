<div align="center">

<img src="web/public/icon-512.png" alt="CAIRN" width="112" height="112" />

# CAIRN

**A competitive-programming performance instrument.**<br/>
Sign in, connect your coding profiles, and work towards your own target with one clear next step every day.

[**Open the app →**](https://vector-wx2a.onrender.com)

[![CI](https://github.com/rehantambala/CAIRN/actions/workflows/ci.yml/badge.svg)](https://github.com/rehantambala/CAIRN/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522.12-3c873a?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-149eca?logo=react&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-black)

</div>

---

## Quick links

| | |
| --- | --- |
| 🌐 **Live app** | [vector-wx2a.onrender.com](https://vector-wx2a.onrender.com) *(free host: the first load after idle can take a minute)* |
| 🔐 **Privacy · Terms** | [/privacy](https://vector-wx2a.onrender.com/privacy) · [/terms](https://vector-wx2a.onrender.com/terms) |
| 🏗️ **Architecture** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 🚀 **Deploy it yourself** | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| 🛡️ **Security model · report a vulnerability** | [SECURITY.md](SECURITY.md) |
| 🎨 **Design notes** | [docs/DESIGN.md](docs/DESIGN.md) |
| 🧭 **Decisions and assumptions** | [docs/DECISIONS.md](docs/DECISIONS.md) |
| 🤝 **Contributing** | [CONTRIBUTING.md](CONTRIBUTING.md) |

## What it does

```
CURRENT STATE → TRAJECTORY → TODAY'S EXECUTION → NEXT → verified completion → score update → calendar → NEXT
```

- **One score, computed by code.** Per-platform totals from problems solved, rating above a baseline and contests entered. A model never sets a score.
- **Trajectory.** Pace and projection towards *your* target and date; with no date it says so rather than guessing.
- **Daily objective and one next action.** Per-platform quotas for the day, and the single problem to start now.
- **Honest verification.** Work is *verified* only when a platform's own data confirms it. Anything entered by hand is labelled *manual*.
- **Contests and reminders.** Upcoming contests from each platform's own listing, with Web Push reminders at 24 h, 1 h, 10 min and at close, in your timezone. Moved or cancelled contests are followed. A private calendar link, and a download for any single contest, place the same alerts in the calendar on your phone or computer.
- **After the target.** Once your score passes its target, the briefing offers a successor target drawn from your own figures, with the research behind it, and lets you keep the present one.
- **Leaderboard check.** Compare your Smart Interviews row with CAIRN platform by platform; the three manual platforms are entered in the leaderboard's own columns.
- **Log.** Calendar, earned awards and contest history.
- **Optional strategist.** An AI advisor that reads verified figures only. It has no tools and no write path.
- **Your data is yours.** Download everything, sign out of every device, or delete the account, all from Preferences.

### Platforms

| Platform | Profile | Contests |
| --- | --- | --- |
| Codeforces | Automatic (official API) | Automatic |
| LeetCode | Automatic (isolated adapter, switchable) | Automatic |
| CodeChef | Figures entered | Automatic |
| HackerRank · InterviewBit · Smart Interviews | Figures entered | Where a source exists |

## Built with

| Layer | Technology |
| --- | --- |
| Frontend | React 18, React Router 7, Vite 8, TypeScript, installable PWA with a service worker |
| Backend | Node 22, Express 4, TypeScript (tsx), zod validation |
| Database | PostgreSQL with row-level security on every table |
| Auth | Google and GitHub OAuth (code flow + PKCE), opaque hashed sessions, bcrypt password fallback |
| Notifications | Web Push (VAPID) |
| Testing | Vitest, 162 tests including a dedicated security suite |
| Hosting | Render (one service for API + web), Supabase or any PostgreSQL, GitHub Actions cron |

## Run it locally

Requires **Node 22.12+** and **PostgreSQL 14+**.

```bash
git clone https://github.com/rehantambala/CAIRN.git
cd CAIRN
cp .env.example .env     # set DATABASE_URL; OWNER_EMAIL / OWNER_PASSWORD for a local password account
npm install
npm run migrate
npm run seed             # development owner with sample figures and a curated problem pool
npm run dev              # API on :4000, web on :5173
```

<details>
<summary>More commands</summary>

```bash
npm test                          # needs a cairn_test database (TEST_DATABASE_URL to override)
npm run build                     # type-check + production build
npm run jobs                      # run every scheduled job once (or: npm run jobs -- notify)
SEED_DEV_CONTESTS=1 npm run seed  # four labelled dev contests relative to now
npm run demo-history -w server    # DROPS the schema and writes 21 synthetic days (never on a real database)
```

</details>

## Deploy

One Node service serves the API and the built frontend, so it fits free tiers. Step by step (database, Render, Google and GitHub sign-in, scheduler, push) is in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Every setting is listed in [`.env.example`](.env.example).

## Repository layout

```
CAIRN/
├── server/            Express API, domain engines, adapters, migrations, tests
│   ├── src/domain     pure engines: score, trajectory, objective, calendar, awards
│   ├── src/services   sync, contests, notifications, sessions, strategist, account
│   ├── src/adapters   one reader per platform
│   ├── src/routes     HTTP API, auth, OAuth, jobs, security middleware
│   └── test           domain, pipeline, multi-user and security tests
├── web/               React PWA (pages, components, styles, service worker)
├── docs/              architecture, deployment, design, decisions
├── .github/           CI, scheduler workflow, issue and PR templates
├── SECURITY.md        security model, threat model, incident response
└── render.yaml        one-click service definition for Render
```

## Security

Sessions are random tokens stored only as a hash. Every private record is resolved from the session, never from a request. CSRF, CORS, CSP/HSTS headers, rate limits, SSRF-safe push endpoints, and row-level security are all in place and covered by tests. Read the full model and how to report a problem in **[SECURITY.md](SECURITY.md)**.

## License

[MIT](LICENSE)
