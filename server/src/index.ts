import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { seedOwner, loadProblemPool } from './db/seed.js';

await migrate();
// Idempotent first-boot seed (free hosts have no shell): owner + baseline + problem pool.
await seedOwner(pool);
await loadProblemPool(pool);
const app = createApp();

// In production the API can also serve the built frontend, so one free service hosts both.
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(config.port, () => console.log(`VECTOR api on :${config.port}`));
