# Deploying on free tiers

Nothing needs an always-on machine. The scheduler wakes the service, jobs run to completion.

## 1. Database: Supabase (or any PostgreSQL)
Create a project, copy the connection string into `DATABASE_URL`. Migrations run automatically on server start.

## 2. App: Render, Fly.io, Railway or similar
`render.yaml` is included. One Node service serves the API and the built frontend (`npm run build`, `npm run start`). Set the variables from `.env.example`, with `NODE_ENV=production`; the server refuses to start without `SESSION_SECRET` (or `JWT_SECRET`), `CRON_SECRET` and `DATABASE_URL`. Migrations and the problem pool load on start. No account is created unless `OWNER_EMAIL` and `OWNER_PASSWORD` are both set; there are no default credentials in production.

Serving everything from one origin keeps the session cookie same-site. If you host the frontend separately, add a rewrite from `/api/*` to the backend so requests stay same-origin.

## 3. Sign-in: Google and GitHub
Anyone can create a CAIRN account with either provider. The account's identity is its internal id; Google and GitHub identities are linked to it (one of each per account, never shared between accounts), and a second provider is linked from Preferences while signed in.

- **Google**: Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application). Authorised redirect URI `https://<host>/api/auth/google/callback`. Scopes requested: `openid email profile`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- **GitHub**: Settings → Developer settings → OAuth Apps → New. Callback URL `https://<host>/api/auth/github/callback`. Scope requested: `read:user` only. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

Both use the authorisation-code flow with a signed state cookie and PKCE (S256); secrets never reach the browser. Set `PUBLIC_URL` (or the `*_REDIRECT_URI` variables) so callbacks match exactly.

**Existing account.** Your current data stays in the account created from `OWNER_EMAIL`. To reach it with a provider: sign in with email and password, then Preferences → Sign-in → Link Google / Link GitHub. Alternatively, a Google sign-in whose verified address equals `OWNER_EMAIL`, or a GitHub sign-in whose login equals `OWNER_GITHUB`, attaches to that account the first time instead of creating a new one.

## 4. Scheduler
The server runs its own schedule (reminders every minute, synchronisation every 30 minutes, contests every two hours). On free hosts that sleep, keep the GitHub Actions workflow: add repository secrets `CRON_SECRET` and `VECTOR_API_URL`; `.github/workflows/jobs.yml` calls `POST /api/jobs/all` every 10 minutes, which also keeps the service awake. Every job is idempotent, and reminder delivery claims rows with `SKIP LOCKED`, so the two triggers never send a reminder twice.

Jobs: `contests` (global discovery from each platform's own listing), `sync` (every connected profile of every user), `rollover` (close past days, plan today), `notify` (schedule and deliver each user's reminders), `pool` (problem pool, at most daily).

## 5. Push notifications
`npx web-push generate-vapid-keys`, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Each person enables each device in Preferences → Contest reminders. On iOS the PWA must be installed to the home screen first.

## 6. What each platform supports

| Platform | Profile | Contests | Notes |
| --- | --- | --- | --- |
| Codeforces | Automatic (official API) | Automatic (official API) | Handle verified with `user.info` |
| LeetCode | Automatic (unofficial GraphQL, switchable) | Automatic (same source) | No documented API; isolated in one adapter; `SOURCE_LEETCODE=off` disables it |
| CodeChef | Figures entered by the person | Automatic (CodeChef's own listing) | Terms prohibit scraping profiles; `SOURCE_CODECHEF_PROFILE=on` enables the profile reader at your discretion |
| HackerRank | Figures entered | Unavailable (robots.txt disallows), unless clist is configured | |
| InterviewBit | Figures entered | None published | |
| Smart Interviews | Figures entered | No readable listing | Passwords are never requested |

When a source fails, the last verified data is kept and marked STALE or ERROR; nothing is estimated.

## Data ownership
Global: `problems`, `contests`, `source_health`, `kv`. User-owned (always resolved from the session, never from a request parameter): `users`, `auth_identities`, `platform_accounts`, `platform_stats`, `submissions`, `solved_problems`, `contest_participations`, `contest_commitments`, `rating_history`, `score_snapshots`, `daily_objectives`, `activity_events`, `notifications`, `push_subscriptions`, `awards`, `strategist_notes`.
