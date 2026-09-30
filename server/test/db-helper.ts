import { migrate } from '../src/db/migrate.js';
import { pool, tx } from '../src/db/pool.js';
import { loadProblemPool, seedOwner } from '../src/db/seed.js';

export const SEED_NOW = new Date('2026-09-30T04:30:00Z'); // 10:00 IST

export async function freshDb() {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate();
  await tx((c) => loadProblemPool(c));
  return tx((c) => seedOwner(c, SEED_NOW));
}

export { pool, tx };
