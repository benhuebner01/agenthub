import 'dotenv/config';
import path from 'path';
import fs from 'fs';

export const mode: 'sqlite' | 'postgres' = process.env.DATABASE_URL?.startsWith('postgresql')
  ? 'postgres'
  : 'sqlite';

let _db: any;
let _sqliteInstance: any;

if (mode === 'postgres') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require('pg');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { drizzle } = require('drizzle-orm/node-postgres');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const schema = require('./schema');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  _db = drizzle(pool, { schema });
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const schema = require('./schema');
  const dataDir = process.env.DATA_DIR || './data';
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'agenthub.db');
  _sqliteInstance = new Database(dbPath);
  _sqliteInstance.pragma('journal_mode = WAL');
  _sqliteInstance.pragma('foreign_keys = ON');
  _db = drizzle(_sqliteInstance, { schema });
}

export const db: any = _db;
export const sqlite: any = _sqliteInstance;

// Legacy alias used by some modules
export const sqliteInstance: any = _sqliteInstance;
