import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { env } from '$env/dynamic/private';
import fs from 'fs';
import path from 'path';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const dbDir = path.dirname(env.DATABASE_URL);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

export const client = new Database(env.DATABASE_URL);
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
