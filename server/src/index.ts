import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { seedOwner, loadProblemPool } from './db/seed.js';
import { refreshPool } from './services/pool.js';
import { startScheduler } from './services/scheduler.js';
import { log } from './routes/security.js';

await migrate();
// Idempotent first-boot seed (free hosts have no shell): owner + baseline + problem pool.
// The pool must exist before the first objective is generated, or that day would store no problem links.
await loadProblemPool(pool);
// The existing owner's account is created only when its credentials are configured; nobody else is seeded.
if (config.ownerEmail && config.ownerPassword) await seedOwner(pool);
// In production the API also serves the built frontend, so one free service hosts both.
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
const app = createApp(existsSync(dist) ? dist : undefined);

app.listen(config.port, () => log('info', 'listening', { port: config.port }));
// Extend the pool from the platforms' own lists, in the background; failure is harmless.
void refreshPool(pool).catch(() => {});
// Reminders, synchronisation and contest discovery run on the server's own schedule.
if (process.env.SCHEDULER !== 'off') startScheduler();
