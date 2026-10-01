export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/vector?host=/tmp',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  cronSecret: process.env.CRON_SECRET ?? 'dev-cron-secret',
  ownerEmail: process.env.OWNER_EMAIL ?? 'owner@vector.local',
  ownerPassword: process.env.OWNER_PASSWORD ?? 'vector-dev',
  isProd: process.env.NODE_ENV === 'production',
  vapidPublic: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivate: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:owner@vector.local',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  clistUser: process.env.CLIST_USERNAME ?? '',
  clistKey: process.env.CLIST_API_KEY ?? '',
  // Sign-in with GitHub or Google is permitted for the owner only. Without these, the buttons do not appear.
  githubClientId: process.env.GITHUB_CLIENT_ID ?? '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
  ownerGithub: process.env.OWNER_GITHUB ?? '',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  ownerGoogleEmail: process.env.OWNER_GOOGLE_EMAIL ?? '',
  // Optional: handles supplied by configuration, so that no one has to type them into the interface.
  handles: {
    leetcode: process.env.LEETCODE_HANDLE ?? '',
    codechef: process.env.CODECHEF_HANDLE ?? '',
    codeforces: process.env.CODEFORCES_HANDLE ?? '',
  } as Record<string, string>,
};

if (config.isProd) {
  for (const k of ['JWT_SECRET', 'CRON_SECRET', 'OWNER_PASSWORD', 'DATABASE_URL'] as const) {
    if (!process.env[k]) throw new Error(`${k} must be set in production`);
  }
}
