import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { JOB_NAMES, runAll, runJob, type JobName } from './services/jobs.js';

// `npm run jobs` runs every job once and exits. Suitable for any cron that can run a command.
const arg = process.argv[2];
await migrate();
const out = arg && (JOB_NAMES as readonly string[]).includes(arg) ? await runJob(arg as JobName) : await runAll();
console.log(JSON.stringify(out, null, 2));
await pool.end();
