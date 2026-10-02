# Deploying on free tiers

[← Back to the README](../README.md) · [Architecture](ARCHITECTURE.md) · [Security](../SECURITY.md)

Nothing needs an always-on machine. The scheduler wakes the service, jobs run to completion.

## 1. Database: Supabase (or any PostgreSQL)
Create a project, copy the connection string into `DATABASE_URL`. Migrations run automatically on server start.

## 2. App: Render, Fly.io, Railway or similar
`render.yaml` is included. One Node service serves the API and the built frontend (`npm run build`, `npm run start`). Set the variables from `.env.example`, with `NODE_ENV=production`; the server refuses to start without `SESSION_SECRET` (or `JWT_SECRET`), `CRON_SECRET` and `DATABASE_URL`, and serves HTTPS only. Node 22.12 or later is required (`engines` in `package.json`). Migrations and the problem pool load on start. No account is created unless `OWNER_EMAIL` and `OWNER_PASSWORD` are both set; there are no default credentials in production.

Serving everything from one origin keeps the session cookie same-site. If you host the frontend separately, add a rewrite from `/api/*` to the backend so requests stay same-origin.

## 3. Sign-in: Google and GitHub
Anyone can create a CAIRN account with either provider. The account's identity is its internal id; Google and GitHub identities are linked to it (one of each per account, never shared between accounts), and a second provider is linked from Preferences while signed in.

- **Google**: Google Cloud Console → Google Auth Platform → Clients → Create client → *Web application*. Authorised redirect URI `https://<host>/api/auth/google/callback`. Leave "used by an AI-powered agent" unticked. Scopes requested: `openid email profile`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. While the consent screen is in *Testing*, only listed test users can sign in; publish it to open sign-in to everyone.
- **GitHub**: Settings → Developer settings → OAuth Apps → New. Callback URL `https://<host>/api/auth/github/callback` (exactly one, no wildcard). No scope is requested: CAIRN reads only the public profile, and revokes the token straight after. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
- Set **`PUBLIC_URL`** to the site's HTTPS origin. In production the callbacks are built from it (or from `GOOGLE_REDIRECT_URI` / `GITHUB_REDIRECT_URI`) and never from the request; a provider without a valid callback stays disabled.

Both use the authorisation-code flow with a signed, browser-bound state and PKCE (S256); secrets never reach the browser. When a sign-in fails, the server log has one line `{"msg":"oauth failed","provider":…,"reason":…}` saying why (for example `token 200 incorrect_client_credentials` for a wrong GitHub secret, `token 401 invalid_client` for a wrong Google secret, `state cookie missing` when the callback reached a different browser).

**Existing account.** Your current data stays in the account created from `OWNER_EMAIL`. To reach it with a provider: sign in with email and password, then Preferences → Sign-in → Link Google / Link GitHub. Alternatively, a Google sign-in whose address Google has verified and which equals `OWNER_EMAIL`, or a GitHub sign-in whose numeric user id equals `OWNER_GITHUB`, attaches to that account the first time. (`OWNER_GITHUB` is the number from `https://api.github.com/users/<login>`, never a login name, which can change hands.)

Sessions are opaque random tokens stored hashed in the database; see [SECURITY.md](../SECURITY.md).

## 4. Scheduler
The server runs its own schedule (reminders every minute, synchronisation every 30 minutes, contests every two hours). On free hosts that sleep, keep the GitHub Actions workflow: add repository secrets `CRON_SECRET` and `CAIRN_API_URL` (the site's HTTPS origin); `.github/workflows/jobs.yml` calls `POST /api/jobs/all` every 10 minutes, which also keeps the service awake. Every job is idempotent and runs under a database lease, and reminder delivery claims rows with `SKIP LOCKED`, so the two triggers never run a job twice at once or send a reminder twice.

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

## Renaming the service so that the address reads CAIRN

The address `<name>.onrender.com` comes from the Render service's name, and the code cannot change it. A service created under an earlier name keeps that
address until it is renamed. To change it:

1. In Render, open the service, then Settings, then Name, and enter `cairn`. Render uses `cairn.onrender.com` if it is free, and otherwise appends a short
   suffix; the new address is shown beside the service name. The old address stops working at once.
2. Set `PUBLIC_URL` to the new address (HTTPS, no trailing slash) and let the service redeploy.
3. In the Google Cloud console and the GitHub OAuth app, replace the callback with `https://<new address>/api/auth/<provider>/callback`. Sign-in fails until this is done.
4. In the GitHub repository, update the Actions secret `CAIRN_API_URL`. The scheduled job reads it to wake the service.
5. Update the live-app links in `README.md` and the Google consent screen (home page, privacy and terms addresses).
6. Anyone who created a calendar link before the rename must create a new one, because the address inside it changes.

A custom domain avoids this step in future and also removes Chrome's warning attached to the shared `onrender.com` domain.

## Calendar link and reminders

Reminders work through two channels. Web Push needs the VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); without them every reminder is recorded
as skipped with the reason, never as delivered. The calendar link needs nothing further: it is served by the same service and works on any device whose
calendar can subscribe to a link. Check both from Preferences after deployment: enable notifications on each device, create a calendar link, and commit to a contest.
