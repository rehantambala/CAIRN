// Values are trimmed: a secret pasted into a host's dashboard often carries an invisible trailing newline,
// which makes the provider reject it ("invalid client secret") while it looks identical on screen.
const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const on = (k: string, d: boolean) => (process.env[k] === undefined ? d : /^(1|on|true|yes)$/i.test(process.env[k]!.trim()));
const isProd = process.env.NODE_ENV === 'production';

const stripSlash = (u: string) => u.replace(/\/+$/, '');

export const config = {
  port: Number(env('PORT', '4000')),
  databaseUrl: env('DATABASE_URL', 'postgres://postgres@localhost:5432/cairn?host=/tmp'),
  /** Signs the short-lived OAuth state cookie only. Sessions are opaque random tokens stored hashed in the database. */
  jwtSecret: env('SESSION_SECRET') || env('JWT_SECRET') || 'dev-only-secret-change-me',
  cronSecret: env('CRON_SECRET', 'dev-cron-secret'),
  isProd,
  webOrigin: stripSlash(env('WEB_ORIGIN', isProd ? '' : 'http://localhost:5173')),
  /** Public origin of this deployment. Builds the OAuth callbacks and is the only origin trusted for writes. */
  publicUrl: stripSlash(env('PUBLIC_URL')),

  // Email and password remain for an existing account. In production nothing is created unless both are set.
  ownerEmail: env('OWNER_EMAIL', isProd ? '' : 'owner@cairn.local').toLowerCase(),
  ownerPassword: env('OWNER_PASSWORD', isProd ? '' : 'cairn-dev'),
  // Bootstrap only: the numeric GitHub user id whose first sign-in attaches to the existing owner account.
  // A login name is mutable and can be re-registered by someone else, so it is never used to match accounts.
  ownerGithub: env('OWNER_GITHUB'),

  githubClientId: env('GITHUB_CLIENT_ID'),
  githubClientSecret: env('GITHUB_CLIENT_SECRET'),
  githubRedirectUri: env('GITHUB_REDIRECT_URI'),
  googleClientId: env('GOOGLE_CLIENT_ID'),
  googleClientSecret: env('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: env('GOOGLE_REDIRECT_URI'),

  vapidPublic: env('VAPID_PUBLIC_KEY'),
  vapidPrivate: env('VAPID_PRIVATE_KEY'),
  vapidSubject: env('VAPID_SUBJECT', 'mailto:admin@cairn.local'),

  clistUser: env('CLIST_USERNAME'),
  clistKey: env('CLIST_API_KEY'),

  /** Source switches. Each reader can be turned off without touching anything else. */
  sources: {
    // LeetCode publishes no documented API; its own site's GraphQL is used, isolated in one adapter.
    leetcode: on('SOURCE_LEETCODE', true),
    // CodeChef's terms prohibit scraping, so reading profile pages is off unless the operator enables it.
    codechefProfile: on('SOURCE_CODECHEF_PROFILE', false),
    codechefContests: on('SOURCE_CODECHEF_CONTESTS', true),
  },

  strategist: { apiKey: env('ANTHROPIC_API_KEY'), model: env('STRATEGIST_MODEL', 'claude-sonnet-5-5') },

  // Handles supplied by configuration apply to the bootstrap owner (OWNER_EMAIL) only, never to anyone else.
  handles: {
    leetcode: env('LEETCODE_HANDLE'),
    codechef: env('CODECHEF_HANDLE'),
    codeforces: env('CODEFORCES_HANDLE'),
  } as Record<string, string>,
};

/** Origins allowed to make credentialed, state-changing requests: this deployment and, if set, a separate frontend. */
export function trustedOrigins(): string[] {
  const out = new Set<string>();
  if (config.publicUrl) out.add(new URL(config.publicUrl).origin);
  if (config.webOrigin) out.add(new URL(config.webOrigin).origin);
  return [...out];
}

if (isProd) {
  if (!process.env.SESSION_SECRET && !process.env.JWT_SECRET) throw new Error('SESSION_SECRET must be set in production');
  for (const k of ['CRON_SECRET', 'DATABASE_URL'] as const) {
    if (!process.env[k]) throw new Error(`${k} must be set in production`);
  }
  // Short secrets are reported rather than refused, so a running deployment is never taken down by an upgrade.
  if (config.jwtSecret.length < 32) console.warn(JSON.stringify({ level: 'warn', msg: 'SESSION_SECRET is shorter than 32 characters; rotate it' }));
  if (config.cronSecret.length < 24) console.warn(JSON.stringify({ level: 'warn', msg: 'CRON_SECRET is shorter than 24 characters; rotate it' }));
  if (!config.publicUrl) console.warn(JSON.stringify({ level: 'warn', msg: 'PUBLIC_URL is not set; Google and GitHub sign-in stay disabled' }));
  if (config.publicUrl && !config.publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL must use https in production');
}
