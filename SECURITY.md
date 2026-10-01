# CAIRN security

This document describes how CAIRN protects the people who use it, what each control is, and how it is tested.
It contains no secrets. Every claim below is exercised by `server/test/security.test.ts` unless stated otherwise.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through the repository's **Security → Report a vulnerability**
(GitHub private advisory). Do not open a public issue. Include the steps to reproduce and the impact you expect.
You will receive an acknowledgement within three days. Please do not access other people's data while testing.

## Security model

CAIRN is one Node service that serves both the API and the built frontend from one origin, backed by PostgreSQL.

- **Identity** is CAIRN's own user id (`users.id`, a UUID). Google and GitHub are only ways of proving who is signing in.
- **Ownership** of every private record comes from the server-side session, never from a request parameter, path or body.
- **Writes** to the database happen only through the server. The database's own HTTP API (if the host offers one) is locked.
- **Scores** are computed deterministically by the server. Nothing a person, a platform or the strategist sends can set a score.

## Authentication

| Provider | Flow | Scope requested | What CAIRN keeps |
| --- | --- | --- | --- |
| Google | Authorisation code + PKCE (S256), server-side exchange | `openid email profile` | Google `sub`, the address if Google verified it, name |
| GitHub | Authorisation code + PKCE (S256), server-side exchange | none (public profile only) | GitHub numeric `id`, login, name |
| Email and password | bcrypt (cost 10), constant-time comparison | — | Only for the pre-existing owner account |

The flow:

1. `/api/auth/:provider/start` creates a random `state` (144 bits) and PKCE verifier (256 bits) and stores them in a
   signed, HttpOnly, SameSite=Lax cookie scoped to `/api/auth`, valid for 10 minutes. Only the state and the S256
   challenge go to the provider.
2. `/api/auth/:provider/callback` requires the cookie, an exactly matching `state`, and a well-formed `code`.
   Anything else — missing, malformed, expired, tampered, minted for another provider, or from another browser — is
   refused and creates no session.
3. The code is exchanged server to server with the client secret and the verifier. GitHub reports failures with
   HTTP 200 and an `error` field; both shapes are treated as failures.
4. The provider's **stable id** identifies the person (Google `sub`, GitHub numeric `id`). Email addresses, logins and
   display names are never used to find or merge accounts.
5. A new CAIRN session is created (see below), and the person is sent to a fixed path (`/`, `/?welcome=1`, or
   `/settings?auth=…`). There is no redirect parameter, so there is no open redirect.

**Redirect URIs** come only from configuration: `GOOGLE_REDIRECT_URI` / `GITHUB_REDIRECT_URI`, or `PUBLIC_URL` plus the
fixed path `/api/auth/<provider>/callback`. In production the request's `Host` header is never used, the URI must be
HTTPS, and a provider without a valid URI is disabled. Register exactly one callback per provider; do not use wildcards.

**Provider tokens.** The access token is used once to read the profile and then discarded. It is never stored, logged,
returned to the browser or placed in a URL. GitHub OAuth tokens do not expire on their own, so CAIRN revokes the one it
used immediately (`DELETE /applications/{client_id}/token`). If a future feature ever needs a stored token, it must be
encrypted at rest with a key held outside the database and must never reach the browser.

## Account linking

- A second provider is linked only from Preferences while signed in. The account that starts the link is recorded in
  the signed state; if a different account is signed in when the callback lands, the link is refused.
- An identity already attached to another account is refused (`conflict`); it is never moved.
- A person holds at most one identity per provider, and cannot remove their last way to sign in.
- **Bootstrap only:** the one pre-existing owner account (`OWNER_EMAIL`) can be reached by a Google sign-in whose
  address Google has verified and which equals `OWNER_EMAIL` exactly, or by the GitHub user whose numeric id equals
  `OWNER_GITHUB`. No other account is ever matched by email.
- Coding-platform handles are public identifiers and prove nothing about who someone is. Connecting a handle another
  member also uses gives no access to that member's account (each person's figures are separate rows).

## Sessions

- The cookie `cairn_session` holds 256 random bits (base64url). It contains no personal information and cannot be decoded.
- Only its SHA-256 hash is stored (`sessions.token_hash`), so a copy of the table cannot be replayed.
- Lifetime: 30 days. Expired sessions are refused and removed.
- Every sign-in creates a new session and discards any session the browser held (no fixation).
- Sign-out deletes the session on the server; *Sign out on every device* deletes all of them.
- Cookie attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production. Lax rather than Strict because the
  OAuth callback is a top-level navigation from the provider and linking needs the session on it.
- Nothing sensitive is kept in `localStorage`, `sessionStorage` or URLs (enforced by a test over the frontend source).

## CSRF

Two independent layers:

1. `SameSite=Lax` withholds the session cookie from cross-site POST, PUT and DELETE requests.
2. Every state-changing `/api` request must carry `X-CAIRN-Request: 1` (a simple form cannot set it, and cross-origin
   script can set it only after a CORS preflight that untrusted origins fail), must not be marked
   `Sec-Fetch-Site: cross-site`, and must come from this origin or `WEB_ORIGIN` when it states an `Origin`.

The cron endpoint uses a bearer secret instead. OAuth callbacks are protected by their signed, browser-bound state.

## CORS

Only `PUBLIC_URL` and `WEB_ORIGIN` are allowed, with credentials. There is no wildcard. In the standard single-service
deployment the frontend is same-origin and CORS is not used at all.

## Authorisation and user isolation

- Every private route sits behind `requireAuth`; the user id comes from the session only.
- Every query on a user-owned table filters by that id. Request bodies are validated with strict schemas, so fields such
  as `userId`, `score` or `isAdmin` are rejected rather than ignored or applied.
- Tests create two people with different profiles, figures, execution, contests, reminders and preferences, then check
  every endpoint in both directions, and check that the other person's ids in paths and bodies change nothing.

## Database

| Class | Tables |
| --- | --- |
| GLOBAL | `problems`, `contests`, `source_health` |
| SYSTEM | `schema_migrations`, `kv` (job leases, detection markers) |
| USER-OWNED | `users`, `auth_identities`, `sessions`, `platform_accounts`, `platform_stats`, `submissions`, `solved_problems`, `contest_participations`, `contest_commitments`, `rating_history`, `score_snapshots`, `daily_objectives` (+ `daily_objective_items`), `activity_events`, `notifications`, `push_subscriptions`, `awards`, `strategist_notes` |
| SENSITIVE | `users.password_hash`, `sessions.token_hash`, `push_subscriptions.p256dh` / `auth` |

**Row Level Security model.** Hosted PostgreSQL (Supabase in particular) can expose the `public` schema through an
automatic REST API to the `anon` and `authenticated` roles. CAIRN never uses that API. On every start the server
enables RLS on **every** table with **no policies** for those roles, which denies them every row, and revokes their
table privileges as a second barrier. The server's own role owns the tables and is unaffected. The test suite creates
`anon`, re-grants it full table privileges (as Supabase does by default) and confirms it still reads zero rows and
cannot insert.

**Queries** are parameterised throughout. No SQL is built from request values; the only dynamic identifiers are table
names read from `pg_catalog`, and they are quoted. Tests send classic and encoded injection payloads through every kind
of input and confirm they are refused or stored literally, and that the database is intact.

The Supabase service-role key, the database URL and every other secret exist only in the server's environment. A scan of
the built frontend bundle for secret patterns is part of the release checklist below.

## Input validation

Every endpoint validates its input on the server (zod): types, lengths, ranges, enumerations (platforms), UUIDs, real
calendar dates, IANA timezones, handles (`[A-Za-z0-9_.-]{1,40}`), push endpoints and keys. Unknown fields are rejected on
every write that has a fixed shape. Bodies over 1 MB are refused. Errors name the field, never echo the value.

## XSS

- React renders all text as text. There is no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or HTML rendering anywhere
  in the frontend (a test enforces this).
- Every link built from data goes through `safeHref` (http and https only). Contest links from external listings are kept
  only if they are HTTPS on that platform's own domain; anything else (`javascript:`, `data:`, other hosts) is dropped.
- External titles are stripped of control and bidirectional-override characters and bounded in length.
- The Content Security Policy allows only this origin's own scripts, styles, fonts and images, with
  `object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'none'`. Verified in a real browser across every page with
  no violations.

## The strategist (AI)

- It receives one read-only context object for the signed-in person and returns text. It has no tools, no database
  access, no network access and no write path: it cannot change a score, a rating, a solve, an attendance, a user id, a
  permission or a sign-in method.
- Prompt injection: figures are sent under `verified`; every title that came from outside CAIRN (contest names, plan item
  names) is moved to a separate `untrusted` block, bounded, cleaned, and referenced by id. The system prompt states that
  `untrusted` text is data and must never be followed.
- The reply is parsed against a strict schema with length limits, stored only as advisory text, and rendered as text.
- It is cached per person and day (at most one call per 30 minutes) and rate-limited per person.

## SSRF

The server makes outbound requests only to fixed hosts (Codeforces, LeetCode, CodeChef, clist, GitHub, Google,
Anthropic), with user-supplied handles URL-encoded into fixed paths; a test enforces the list. No endpoint fetches a URL
supplied in a request. **Push subscriptions** are the one place a client supplies a URL the server later contacts, so
endpoints are accepted only over HTTPS on the browsers' push services (FCM, Mozilla, Windows, Apple), on the default
port, without credentials; anything stored before this rule existed is removed instead of contacted.

## Rate limiting and platform abuse

| What | Limit |
| --- | --- |
| Whole API | 240 requests per minute per address |
| Password sign-in | 10 per 15 minutes per address |
| OAuth start / callback | 30 each per 15 minutes per address |
| Synchronise now | 30 per 15 minutes per person, one run at a time per person and platform, none within 60 s of the last |
| Profile connect / discover / detect | 20 per 15 minutes per person |
| Strategist | 30 per hour per person (plus the 30-minute cache) |
| Push device registration | 10 per hour per person |
| Export / delete account | 5 per hour per person |
| Other writes | 60 per minute per person |
| Cron endpoint | 20 per minute per address, plus the bearer secret |

Codeforces is additionally called at most once every two seconds by the whole server, as its terms ask.

## Background jobs

- `/api/jobs/:name` requires `Authorization: Bearer <CRON_SECRET>`, compared in constant time over fixed-length digests.
- Every job is idempotent. A lease row in the database lets only one run of a given job proceed at a time across the
  in-process scheduler, the external cron and any other instance; a crashed run's lease expires after 15 minutes.
- Reminder delivery claims rows with `FOR UPDATE SKIP LOCKED`, so two workers never send the same reminder.
- Job failures are reported to the caller as a code only; details go to the server log.

## Contest reminders

- Reminders are created only for the person who committed to a contest (1 h, 10 min, close) or who has a rated profile on
  that platform (24 h), and follow that person's preferences and timezone.
- One row per (person, type, contest) makes duplicates impossible; delivered reminders are never resent.
- A push failure is retried up to three times while still useful. A 24 h notice expires 12 hours before the start, a 1 h
  notice 20 minutes before, so a late run never sends stale wording.
- A contest moved later is followed; a contest that disappears from a complete listing before starting is treated as
  cancelled (its reminders are withdrawn and it leaves the fixtures) and is restored if listed again. An empty or failed
  listing cancels nothing.

## Transport and headers

Production runs on HTTPS only. A request the edge reports as plain HTTP is redirected (GET) or refused (writes). Headers on
every response: `Content-Security-Policy`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (camera, microphone, geolocation, payment, USB off), `Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Resource-Policy: same-origin`; `Cache-Control: no-store` on the API; no `X-Powered-By`.

## Errors and logging

- Clients receive a code and a request id (`{"error":"INTERNAL","requestId":"…"}`), never a stack trace, SQL, path,
  hostname or environment value.
- Logs are one JSON object per line: timestamp, level, request id, method, route (without query string), status,
  duration and user id. Query strings are never logged, because OAuth callbacks carry the code and state there. Cookies,
  authorisation headers and bodies are never logged; known secret fields are redacted. Tests capture the logs of a full
  sign-in and a failed one and confirm no code, token, cookie, password or secret appears.

## Data minimisation and retention

| Data | Why | Kept |
| --- | --- | --- |
| Provider id, provider email/login | To recognise the person at sign-in | Until the sign-in method is unlinked or the account deleted |
| Display name, timezone, target, reminder preferences | The product itself | Until changed or the account deleted |
| Coding handles (public), figures, history | The score and plan | Until disconnected (history kept) or the account deleted |
| Push endpoint and keys | To deliver reminders to that device | Until the push service reports the device gone, or deletion |
| Session hashes | To recognise a signed-in browser | 30 days at most |

CAIRN never asks for or stores a coding-platform password or credential.

## Account deletion and export

- **Preferences → Your data → Download my data** returns everything CAIRN holds about the person as JSON: profile,
  sign-in methods, connected profiles, figures, solved problems, ratings, score history, contest participation and
  commitments, execution record, awards, notifications, activity and strategist notes. It contains no password hash,
  session hash, push key, token or another person's data.
- **Delete account** (typing DELETE to confirm) removes, in one transaction: the user, every sign-in identity, every
  session, every profile connection and figure, the execution history, notifications, devices, awards and strategist
  notes. Global data (problem catalogue, public contests) is untouched. If `OWNER_EMAIL` and `OWNER_PASSWORD` are still
  configured, the owner account is recreated empty on the next start; remove them first if that account is deleted.

## Secret management

- Secrets live only in the host's environment variables (Render → Environment), never in the repository, the frontend
  bundle, logs or URLs. `.env` is git-ignored; `.env.example` holds placeholders only.
- Values are trimmed on load, which prevents the "invisible trailing newline" class of misconfiguration.
- Production refuses to start without `SESSION_SECRET` (or `JWT_SECRET`), `CRON_SECRET` and `DATABASE_URL`, and warns
  about short secrets.
- The GitHub Actions workflow reads its two secrets from repository secrets through environment variables and has no
  repository permissions.

## Incident response

1. **Contain.** Rotate the affected secret first (see below). For a suspected session compromise, rotate nothing else
   yet: delete the person's sessions (`delete from sessions where user_id = …`) or all sessions (`truncate sessions`).
2. **Assess.** Use request ids and user ids in the JSON logs to establish what was accessed. Logs never hold secrets, so
   they can be shared with whoever investigates.
3. **Rotate.** Any secret that appeared in a commit, a log, a screenshot or a chat is treated as compromised:
   - `SESSION_SECRET` / `JWT_SECRET`: replace in Render; only in-flight OAuth sign-ins are affected.
   - `GOOGLE_CLIENT_SECRET`: Google Cloud → Clients → add a new secret, update Render, then delete the old one.
   - `GITHUB_CLIENT_SECRET`: GitHub → Developer settings → OAuth App → generate a new secret, update Render, delete the old.
   - `CRON_SECRET`: replace in Render and in the repository's Actions secrets.
   - `DATABASE_URL`: reset the database password with the provider, update Render.
   - `VAPID_PRIVATE_KEY`: generate a new pair; devices must re-enable reminders.
   - `OWNER_PASSWORD`: change it, or remove it once Google/GitHub is linked to the owner account.
   Deleting a value from the latest commit is not enough; rotate it.
4. **Notify** affected people if their data was exposed, with what happened and what was done.
5. **Fix and test.** Add a test that reproduces the issue before closing it.

## Release checklist

```bash
npm ci && npm audit                    # no known vulnerabilities in any dependency
npm test                               # includes server/test/security.test.ts
npm run build                          # type checks and builds
grep -rEl "service_role|SECRET|PRIVATE_KEY|postgres://|GOCSPX|gh[op]_|sk-ant-" web/dist   # must print nothing
```

## Threat model

| Threat | Attack | Impact | Mitigation | Test |
| --- | --- | --- | --- | --- |
| Account takeover | Sign in with an identity that matches someone's email or login | Read and change their data | Match only by stable provider id; email used only for the one owner, only if Google verified it | `account takeover resistance` |
| OAuth CSRF / login CSRF | Make a victim's browser complete the attacker's OAuth callback | Victim signed into attacker's account | State bound to the starting browser by a signed cookie; exact match required | `every malformed callback is refused` |
| Authorisation-code replay | Reuse an intercepted code | Session for the code's owner | Codes are single use at the provider; PKCE verifier held only by the server | `reused code` case |
| Redirect manipulation | Change `redirect_uri` or `Host` to receive the code | Code theft | Redirect URI from configuration only; fixed path; HTTPS; no wildcard | `redirect URI comes only from configuration` |
| Session theft | Steal a cookie via script or the database | Impersonation | HttpOnly, Secure, opaque token, only hash stored, server-side revocation, 30-day expiry | `sessions` |
| Session fixation | Plant a session id before sign-in | Impersonation | New random session on every sign-in; unknown tokens rejected | `prevents fixation` |
| IDOR | Use another person's ids in paths or bodies | Read or change their data | User id only from the session; strict schemas; per-user filters | `authorisation: user isolation` |
| SQL injection | Payloads in any input | Data theft or loss | Parameterised queries only; validated inputs | `SQL injection payloads` |
| XSS | Hostile names, titles, links, AI output | Session riding, data theft | Text-only rendering, `safeHref`, URL allow-list per platform, strict CSP | `stores hostile names as text`, `frontend renders no raw HTML` |
| CSRF | Cross-site form or script triggers a write | Unwanted changes | SameSite=Lax + required header + Origin / Sec-Fetch-Site checks | `CSRF, CORS and security headers` |
| SSRF | Make the server request internal addresses | Metadata or internal service access | Fixed outbound hosts; push endpoint allow-list | `SSRF` |
| Open redirect | Bounce a person to a hostile site via CAIRN | Phishing | Fixed redirect targets; notification links same-site only | `redirect URI` test; service worker check |
| Credential leakage | Tokens or secrets in logs, URLs, responses | Account or service compromise | Tokens never stored or logged; redaction; generic errors | `never logs …`, `generic error` |
| Secret leakage | Secrets in the repository or bundle | Full compromise | Environment only; scans of history and bundle | Release checklist; `detect-secrets` |
| API abuse | Flood endpoints | Denial of service, cost | Per-address and per-person rate limits | `limits sign-in attempts and OAuth starts` |
| Platform API abuse | Repeated synchronise clicks | CAIRN banned by a platform | In-flight de-duplication, 60 s cooldown, per-person limit, global Codeforces pacing | `ten simultaneous clicks make one request` |
| Prompt injection | Instructions inside contest or problem titles | Misleading advice | Untrusted block, system rule, strict output schema, no tools or writes | `strategist` tests |
| Cross-user leakage | Any endpoint returns another person's data | Privacy breach | Session-derived ids everywhere; two-person tests on every endpoint | `A reads only A's data` |
| Notification leakage | Reminders sent to the wrong person or twice | Privacy breach, noise | Per-person scheduling, unique keys, SKIP LOCKED | `reminders go only to the person who wants them` |
| Background-job abuse | Call job endpoints publicly or concurrently | Load, duplicated work | Bearer secret, constant-time check, rate limit, job leases | `background jobs need the secret` |
| Database compromise via its API | Use the host's auto-generated REST API | Full data access | RLS on every table with no API-role policies; privileges revoked | `database: the data API is locked down` |

## Known limitations

- **Handle ownership is not proven.** Coding platforms offer no sign-in grant to third parties, so a handle is verified
  to exist, not to belong to the person. The consequence is limited to that person's own figures; nobody else's account
  is affected.
- **In-flight synchronisation de-duplication is per process.** The free deployment runs one process; across several
  instances the 60-second database cooldown and per-person rate limit still apply.
- **Rate limits are kept in memory** and reset when the service restarts; they are a brake, not an accounting system.
- **Content Security Policy uses no nonces**, because the built frontend has no inline scripts or styles to allow.
