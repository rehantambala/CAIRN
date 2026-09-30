# Deploying on free tiers

Nothing needs an always-on machine. The scheduler wakes the service, jobs run to completion.

## 1. Database: Supabase (or any PostgreSQL)
Create a project, copy the connection string into `DATABASE_URL`. Migrations run automatically on server start.

## 2. App: Render, Fly.io, Railway or similar
`render.yaml` is included. One Node service serves the API and the built frontend (`npm run build`, `npm run start`). Set the variables from `.env.example`, with `NODE_ENV=production` (the server refuses to start without `JWT_SECRET`, `CRON_SECRET`, `OWNER_PASSWORD`, `DATABASE_URL`). The first boot seeds the owner (from `OWNER_EMAIL`/`OWNER_PASSWORD`), the baseline and the problem pool automatically.

Serving everything from one origin keeps the session cookie same-site. If you host the frontend separately on Vercel, add a rewrite from `/api/*` to the backend so requests stay same-origin.

## 3. Scheduler: GitHub Actions (included)
Add repository secrets `CRON_SECRET` and `VECTOR_API_URL`. `.github/workflows/jobs.yml` calls `POST /api/jobs/all` every 10 minutes. GitHub cron is best-effort and can run late; every job processes everything due up to "now", so delay only delays notifications. Alternatives: Supabase `pg_cron` + `pg_net`, cron-job.org, Vercel cron (hobby is daily only).

Jobs: `contests` (discovery), `sync` (Codeforces), `rollover` (close past days, create today), `notify` (schedule and deliver). Each is idempotent.

## 4. Push notifications
`npx web-push generate-vapid-keys`, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Open CAIRN, Settings, Enable on this device. On iOS the PWA must be installed to the home screen first. Tapping a notification opens the relevant page.

## 5. Connect sources
Settings: add your Codeforces handle and Sync. LeetCode, CodeChef, Smart Interviews, InterviewBit and HackerRank take imported or manual values; no passwords are stored and no logins are automated.
