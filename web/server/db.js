import { readFileSync, readdirSync } from 'node:fs';

import pg from 'pg';

const MIGRATIONS = new URL('./migrations/', import.meta.url);
const MIGRATION_LOCK = 4_202_026;

const pools = new Map();

export async function database(env) {
    const url = env.DATABASE_URL;
    if (!url) return null;
    let entry = pools.get(url);
    if (!entry) {
        const pool = new pg.Pool({ connectionString: url, max: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
        entry = { pool, ready: migrate(pool) };
        pools.set(url, entry);
        entry.ready.catch(() => pools.delete(url));
    }
    try {
        await entry.ready;
    } catch {
        return null;
    }
    return entry.pool;
}

async function migrate(pool) {
    const client = await pool.connect();
    try {
        await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
        await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
        const { rows } = await client.query('select name from schema_migrations');
        const applied = new Set(rows.map((row) => row.name));
        const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
        for (const name of files) {
            if (applied.has(name)) continue;
            await client.query('begin');
            try {
                await client.query(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
                await client.query('insert into schema_migrations (name) values ($1)', [name]);
                await client.query('commit');
            } catch (error) {
                await client.query('rollback');
                throw new Error(`Migration ${name} failed: ${error.message}`);
            }
        }
    } finally {
        await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
        client.release();
    }
}
