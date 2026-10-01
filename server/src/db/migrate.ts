import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

export async function migrate(): Promise<string[]> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'sql');
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(readFileSync(join(dir, f), 'utf8'));
      await c.query('insert into schema_migrations(name) values ($1)', [f]);
      await c.query('commit');
      applied.push(f);
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
  await lockDownDataApi();
  return applied;
}

/**
 * CAIRN reads and writes the database only through its own server, which derives every user id from the session.
 * Hosted Postgres (Supabase in particular) can also expose the public schema through an automatic REST API to the
 * `anon` and `authenticated` roles. Row Level Security is therefore enabled on every table with no policy for those
 * roles, which denies them every row, and their table privileges are revoked as a second barrier. The server's own
 * role owns the tables and is unaffected. Runs on every start, so tables added later are covered too.
 */
export async function lockDownDataApi(): Promise<{ tables: number; apiRoles: string[] }> {
  const tables = (await pool.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename as string);
  const apiRoles = (await pool.query(`select rolname from pg_roles where rolname in ('anon', 'authenticated')`)).rows.map((r) => r.rolname as string);
  for (const t of tables) {
    try {
      await pool.query(`alter table public.${quoteIdent(t)} enable row level security`);
      for (const role of apiRoles) await pool.query(`revoke all on table public.${quoteIdent(t)} from ${quoteIdent(role)}`);
    } catch (e) {
      // Not the owner of this table (an unusual hosting set-up): reported, never fatal.
      console.warn(JSON.stringify({ level: 'warn', msg: 'could not lock down table', table: t, error: (e as Error).message }));
    }
  }
  return { tables: tables.length, apiRoles };
}

/** Identifiers come from pg_catalog, never from a request; quoting is still applied so no name can become syntax. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then((a) => { console.log(a.length ? `applied: ${a.join(', ')}` : 'up to date'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
