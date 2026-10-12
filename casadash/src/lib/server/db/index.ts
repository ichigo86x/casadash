import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import fs from 'fs';
import path from 'path';
import { DATABASE_PATH } from '$lib/server/config';

const dbDir = path.dirname(DATABASE_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

export const client = new Database(DATABASE_PATH);
export const db = drizzle(client, { schema });

// Auto-inject indexes if they don't exist
try {
    client.exec('CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date);');
    client.exec('CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions(category);');
    client.exec('CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions(type);');
    client.exec('CREATE INDEX IF NOT EXISTS cc_settled_idx ON transactions(payment_method, settled);');
    console.log('[DB] Index verification and injection complete.');
} catch (err) {
    console.error('[DB] Error verifying indexes:', err);
}

// Safe runtime migration: add `settled` column if it doesn't exist
try {
    const cols = client.pragma('table_info(transactions)') as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'settled')) {
        client.exec('ALTER TABLE transactions ADD COLUMN settled INTEGER NOT NULL DEFAULT 0;');
        console.log('[DB] Column `settled` added to transactions.');
    }
} catch (err) {
    console.error('[DB] Error migrating settled column:', err);
}

// Safe runtime migration: server-side sessions and forced password change
// (also created by seed.js; repeated here so `npm run dev` works on an old database)
try {
    client.exec(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );`);
    client.exec('CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);');
    const cols = client.pragma('table_info(users)') as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'must_change_password')) {
        client.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;');
        console.log('[DB] Column `must_change_password` added to users.');
    }
} catch (err) {
    console.error('[DB] Error migrating sessions:', err);
}
