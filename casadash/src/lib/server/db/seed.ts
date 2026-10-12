import Database from 'better-sqlite3';
import path from 'path';

const expenseCategories: Record<string, any> = {
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

const incomeCategories: Record<string, any> = {
    'Stipendio': { icon: 'fa-briefcase', color: '#2ecc71' },
    'Freelance': { icon: 'fa-laptop-code', color: '#00b894' },
    'Investimenti': { icon: 'fa-chart-line', color: '#0984e3' },
    'Vendite': { icon: 'fa-store', color: '#6c5ce7' },
    'Bonus': { icon: 'fa-gift', color: '#fdcb6e' },
    'Rimborsi': { icon: 'fa-undo', color: '#e17055' },
    'Altro': { icon: 'fa-ellipsis-h', color: '#55a3a4' }
};

const dbPath = path.resolve(__dirname, '../../../../data/cdash.db');
const db = new Database(dbPath);

console.log("Seeding categories into", dbPath);

const insertStmt = db.prepare('INSERT INTO categories (name, type, color, icon, created_by) VALUES (?, ?, ?, ?, ?)');
const checkStmt = db.prepare('SELECT id FROM categories WHERE name = ? LIMIT 1');

for (const [name, cat] of Object.entries(expenseCategories)) {
    if (!checkStmt.get(name)) {
        insertStmt.run(name, 'expense', cat.color, cat.icon, 1);
        console.log(`Inserted expense: ${name}`);
    }
}

for (const [name, cat] of Object.entries(incomeCategories)) {
    if (!checkStmt.get(name)) {
        insertStmt.run(name, 'income', cat.color, cat.icon, 1);
        console.log(`Inserted income: ${name}`);
    }
}

console.log("Seeding complete!");
db.close();
