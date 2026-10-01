const env = (k: string, d = '') => process.env[k] ?? d;
const on = (k: string, d: boolean) => (process.env[k] === undefined ? d : /^(1|on|true|yes)$/i.test(process.env[k]!));
const isProd = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(env('PORT', '4000')),
  databaseUrl: env('DATABASE_URL', 'postgres://postgres@localhost:5432/vector?host=/tmp'),
  jwtSecret: env('SESSION_SECRET') || env('JWT_SECRET') || 'dev-only-secret-change-me',
  cronSecret: env('CRON_SECRET', 'dev-cron-secret'),
  isProd,
  webOrigin: env('WEB_ORIGIN', 'http://localhost:5173'),
  /** Public origin used to build OAuth callbacks when the *_REDIRECT_URI variables are not set. */
  publicUrl: env('PUBLIC_URL'),

  // Email and password remain for an existing account. In production nothing is created unless both are set.
  ownerEmail: env('OWNER_EMAIL', isProd ? '' : 'owner@vector.local').toLowerCase(),
  ownerPassword: env('OWNER_PASSWORD', isProd ? '' : 'vector-dev'),
  // Bootstrap only: lets the existing owner's first GitHub sign-in attach to the existing account.
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

if (isProd) {
  if (!process.env.SESSION_SECRET && !process.env.JWT_SECRET) throw new Error('SESSION_SECRET must be set in production');
  for (const k of ['CRON_SECRET', 'DATABASE_URL'] as const) {
    if (!process.env[k]) throw new Error(`${k} must be set in production`);
  }
}
