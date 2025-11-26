// lib/syncState.js
import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();
const { Client } = pkg;

const db = new Client({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

export async function getLastSyncTimestamp(syncType) {
  await db.connect();
  const res = await db.query(
    `SELECT last_timestamp FROM sync_state WHERE sync_type = $1`,
    [syncType]
  );
  await db.end();
  return res.rows[0]?.last_timestamp ?? 0;
}

export async function updateLastSyncTimestamp(syncType, newTimestamp) {
  await db.connect();
  await db.query(
    `INSERT INTO sync_state (sync_type, last_timestamp)
     VALUES ($1, $2)
     ON CONFLICT (sync_type) DO UPDATE SET last_timestamp = EXCLUDED.last_timestamp`,
    [syncType, newTimestamp]
  );
  await db.end();
}
