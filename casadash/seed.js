import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

// Load .env when present (bare-metal installs); variables already set take precedence
try { process.loadEnvFile(); } catch {}

// Same resolution as src/lib/server/config.ts
const dataDir = path.resolve(process.env.DATA_DIR || (process.env.DATABASE_URL ? path.dirname(process.env.DATABASE_URL) : 'data'));
const dbPath = path.resolve(process.env.DATABASE_URL || path.join(dataDir, 'cdash.db'));
const dbDir = path.dirname(dbPath);

// Ensure dir exists if running locally or first time
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

if (!fs.existsSync(dbPath)) {
    console.log("Database file doesn't exist, it will be created by better-sqlite3.");
}

const db = new Database(dbPath);

console.log("Checking and migrating database schema...");

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        totp_secret TEXT,
        display_name TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_by INTEGER REFERENCES users(id),
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        category TEXT NOT NULL,
        receipt_path TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recurring_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'bancomat',
        tags TEXT NOT NULL DEFAULT '[]',
        frequency TEXT NOT NULL,
        next_date TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id),
        is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_type TEXT NOT NULL,
        year INTEGER NOT NULL,
        month INTEGER,
        category TEXT DEFAULT 'Totale',
        amount REAL NOT NULL,
        created_by INTEGER REFERENCES users(id),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        target REAL NOT NULL,
        deadline TEXT,
        color TEXT NOT NULL DEFAULT '#4361ee',
        icon TEXT NOT NULL DEFAULT 'fa-piggy-bank',
        archived INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goal_contributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        created_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS goal_contributions_goal_idx ON goal_contributions(goal_id);

    CREATE TABLE IF NOT EXISTS rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'any',
        category TEXT,
        add_tags TEXT NOT NULL DEFAULT '[]',
        mark_transfer INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id)
    );
`);

try {
	const tableInfo = db.prepare("PRAGMA table_info('transactions');").all();
	const hasPaymentMethod = tableInfo.some(col => col.name === 'payment_method');
	if (!hasPaymentMethod) {
		console.log("Applying structural update: ADD COLUMN payment_method TO transactions");
		db.prepare("ALTER TABLE transactions ADD COLUMN payment_method TEXT DEFAULT 'bancomat' NOT NULL;").run();
	}
	
	const hasTags = tableInfo.some(col => col.name === 'tags');
	if (!hasTags) {
		console.log("Applying structural update: ADD COLUMN tags TO transactions");
		db.prepare("ALTER TABLE transactions ADD COLUMN tags TEXT DEFAULT '[]' NOT NULL;").run();
	}
	
	if (!tableInfo.some(col => col.name === 'settled')) {
		console.log("Applying structural update: ADD COLUMN settled TO transactions");
		db.prepare("ALTER TABLE transactions ADD COLUMN settled INTEGER NOT NULL DEFAULT 0;").run();
	}

	const userTableInfo = db.prepare("PRAGMA table_info('users');").all();
	if (!userTableInfo.some(col => col.name === 'ha_user_id')) {
		console.log("Applying structural update: ADD COLUMN ha_user_id TO users");
		db.prepare("ALTER TABLE users ADD COLUMN ha_user_id TEXT;").run();
	}
	if (!userTableInfo.some(col => col.name === 'role')) {
		// Before roles everybody could do everything: the first account becomes the administrator
		console.log("Applying structural update: ADD COLUMN role TO users");
		db.prepare("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';").run();
		db.prepare("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)").run();
	}
	if (!userTableInfo.some(col => col.name === 'must_change_password')) {
		console.log("Applying structural update: ADD COLUMN must_change_password TO users");
		db.prepare("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;").run();
	}

	if (!tableInfo.some(col => col.name === 'import_batch')) {
		console.log("Applying structural update: ADD COLUMN import_batch TO transactions");
		db.prepare("ALTER TABLE transactions ADD COLUMN import_batch TEXT;").run();
	}
	db.prepare("CREATE INDEX IF NOT EXISTS transactions_import_batch_idx ON transactions(import_batch);").run();
	const hasReceipt = tableInfo.some(col => col.name === 'receipt_path');
	if (!hasReceipt) {
		console.log("Applying structural update: ADD COLUMN receipt_path TO transactions");
		db.prepare("ALTER TABLE transactions ADD COLUMN receipt_path TEXT;").run();
	}

	const rtTableInfo = db.prepare("PRAGMA table_info('recurring_transactions');").all();
	if (!rtTableInfo.some(col => col.name === 'anchor_day')) {
		console.log("Applying structural update: ADD COLUMN anchor_day TO recurring_transactions");
		db.prepare("ALTER TABLE recurring_transactions ADD COLUMN anchor_day INTEGER;").run();
		db.prepare("UPDATE recurring_transactions SET anchor_day = CAST(substr(next_date, 9, 2) AS INTEGER)").run();
	}
	const hasIsActive = rtTableInfo.some(col => col.name === 'is_active');
	if (!hasIsActive) {
		console.log("Applying structural update: ADD COLUMN is_active TO recurring_transactions");
		db.prepare("ALTER TABLE recurring_transactions ADD COLUMN is_active INTEGER DEFAULT 1 NOT NULL;").run();
	}

	const budgetTableInfo = db.prepare("PRAGMA table_info('budgets');").all();
	const hasCategory = budgetTableInfo.some(col => col.name === 'category');
	if (!hasCategory) {
		console.log("Applying structural update: ADD COLUMN category TO budgets");
		db.prepare("ALTER TABLE budgets ADD COLUMN category TEXT DEFAULT 'Totale';").run();
	}
} catch (e) {
	console.error("Migration check failed:", e);
}

console.log("Checking for default admin user...");
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

if (userCount === 0) {
    console.log("No users found. Creating default admin account (admin / admin)");
    const hash = bcrypt.hashSync('admin', 10);
    db.prepare("INSERT INTO users (username, password_hash, display_name, must_change_password, role) VALUES (?, ?, ?, 1, 'admin')").run('admin', hash, 'Amministratore');
} else {
    console.log(`Found ${userCount} users. Skipping default creation.`);
    // Existing installs still on admin/admin must pick a new password at next login
    const admin = db.prepare("SELECT id, password_hash FROM users WHERE username = 'admin'").get();
    if (admin && bcrypt.compareSync('admin', admin.password_hash.replace(/^\$2y\$/, '$2a$'))) {
        console.log("Default admin password still in use: forcing a password change.");
        db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(admin.id);
    }
}

console.log("Checking default categories...");
const expenseCategories = {
    'Cibo': { icon: 'fa-utensils', color: '#FF6384' },
    'Trasporti': { icon: 'fa-car', color: '#36A2EB' },
    'Intrattenimento': { icon: 'fa-film', color: '#FFCE56' },
    'Utenze': { icon: 'fa-bolt', color: '#4BC0C0' },
    'Shopping': { icon: 'fa-shopping-bag', color: '#9966FF' },
    'Salute': { icon: 'fa-heartbeat', color: '#FF9F40' },
    'Casa': { icon: 'fa-home', color: '#E7E9ED' },
    'Istruzione': { icon: 'fa-graduation-cap', color: '#FF6B6B' },
    'Altro': { icon: 'fa-ellipsis-h', color: '#8AC24A' }
};

const incomeCategories = {
    'Stipendio': { icon: 'fa-briefcase', color: '#2ecc71' },
    'Freelance': { icon: 'fa-laptop-code', color: '#00b894' },
    'Investimenti': { icon: 'fa-chart-line', color: '#0984e3' },
    'Vendite': { icon: 'fa-store', color: '#6c5ce7' },
    'Bonus': { icon: 'fa-gift', color: '#fdcb6e' },
    'Rimborsi': { icon: 'fa-undo', color: '#e17055' },
    'Altro': { icon: 'fa-ellipsis-h', color: '#55a3a4' }
};

const insertStmt = db.prepare('INSERT INTO categories (name, type, color, icon, created_by) VALUES (?, ?, ?, ?, ?)');
const checkStmt = db.prepare('SELECT id FROM categories WHERE name = ? LIMIT 1');

let catAdded = 0;
for (const [name, cat] of Object.entries(expenseCategories)) {
    if (!checkStmt.get(name)) { insertStmt.run(name, 'expense', cat.color, cat.icon, 1); catAdded++; }
}
for (const [name, cat] of Object.entries(incomeCategories)) {
    if (!checkStmt.get(name)) { insertStmt.run(name, 'income', cat.color, cat.icon, 1); catAdded++; }
}
console.log(`Added ${catAdded} default categories.`);

console.log("Database initialization complete!");
db.close();
