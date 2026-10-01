import { runJob, type JobName } from './jobs.js';

/**
 * The server's own clock for background work, so reminders and contest discovery never depend on a browser.
 * The external cron (GitHub Actions → /api/jobs/all) remains as a second trigger and keeps a sleeping host awake;
 * every job is idempotent and reminder delivery claims rows with SKIP LOCKED, so the two never double-send.
 */
const EVERY: [JobName, number][] = [
  ['notify', 60_000],          // reminders need minute accuracy for the 10-minute notice
  ['rollover', 15 * 60_000],
  ['sync', 30 * 60_000],
  ['contests', 2 * 3_600_000],
  ['pool', 6 * 3_600_000],     // the pool job itself refreshes at most every 20 hours
];

export function startScheduler(log: (msg: string) => void = console.log): () => void {
  const busy = new Set<JobName>();
  const timers = EVERY.map(([name, ms], i) => {
    const run = async () => {
      if (busy.has(name)) return;
      busy.add(name);
      try { await runJob(name); } catch (e) { log(`job ${name} failed: ${(e as Error).message}`); } finally { busy.delete(name); }
    };
    // Staggered first runs so a cold start does not do everything at once.
    setTimeout(() => void run(), 5_000 + i * 7_000).unref();
    return setInterval(() => void run(), ms).unref();
  });
  return () => timers.forEach(clearInterval);
}
