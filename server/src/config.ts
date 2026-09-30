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
};

if (config.isProd) {
  for (const k of ['JWT_SECRET', 'CRON_SECRET', 'OWNER_PASSWORD', 'DATABASE_URL'] as const) {
    if (!process.env[k]) throw new Error(`${k} must be set in production`);
  }
}
