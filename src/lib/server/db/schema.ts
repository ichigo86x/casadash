import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	totpSecret: text('totp_secret'),
	displayName: text('display_name').notNull(),
	createdAt: text('created_at').notNull()
});

export const transactions = sqliteTable('transactions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	createdBy: integer('created_by').references(() => users.id),
	type: text('type').notNull(),
	description: text('description').notNull(),
	amount: real('amount').notNull(),
	date: text('date').notNull(),
	category: text('category').notNull(),
	paymentMethod: text('payment_method').default('bancomat').notNull(),
	tags: text('tags').default('[]').notNull(),
	receiptPath: text('receipt_path'),
	settled: integer('settled').default(0).notNull(),
	createdAt: text('created_at').default('CURRENT_TIMESTAMP')
}, (table) => ({
	dateIdx: index('date_idx').on(table.date),
	categoryIdx: index('category_idx').on(table.category),
	typeIdx: index('type_idx').on(table.type),
	ccSettledIdx: index('cc_settled_idx').on(table.paymentMethod, table.settled)
}));

export const recurringTransactions = sqliteTable('recurring_transactions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	type: text('type').$type<'income' | 'expense'>().notNull(),
	amount: real('amount').notNull(),
	description: text('description').notNull(),
	category: text('category').notNull(),
	paymentMethod: text('payment_method').default('bancomat').notNull(),
	tags: text('tags').default('[]').notNull(),
	frequency: text('frequency').$type<'monthly' | 'yearly'>().notNull(),
	nextDate: text('next_date').notNull(),
	createdBy: integer('created_by').references(() => users.id).notNull(),
	isActive: integer('is_active').default(1).notNull()
});

export const budgets = sqliteTable('budgets', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	periodType: text('period_type').notNull(),
	year: integer('year').notNull(),
	month: integer('month'),
	category: text('category').default('Totale'),
	amount: real('amount').notNull(),
	createdBy: integer('created_by').references(() => users.id),
	updatedAt: text('updated_at').notNull()
});

export const categories = sqliteTable('categories', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	type: text('type').notNull(),
	color: text('color').notNull(),
	icon: text('icon').notNull(),
	createdBy: integer('created_by').references(() => users.id)
});
