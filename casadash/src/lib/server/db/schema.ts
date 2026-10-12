import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	totpSecret: text('totp_secret'),
	displayName: text('display_name').notNull(),
	mustChangePassword: integer('must_change_password').default(0).notNull(),
	role: text('role').$type<'admin' | 'member'>().default('member').notNull(),
	// Home Assistant user linked for automatic sign-in through Ingress
	haUserId: text('ha_user_id'),
	createdAt: text('created_at').notNull()
});

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(), // SHA-256 of the cookie token
	userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	kind: text('kind').$type<'session' | 'mfa'>().notNull(),
	createdAt: integer('created_at').notNull(),
	expiresAt: integer('expires_at').notNull()
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
	// Groups the rows of one bank import, so the import can be undone
	importBatch: text('import_batch'),
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
	// Day of month the schedule was created for, so 31st jobs return to the 31st after short months
	anchorDay: integer('anchor_day'),
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

// Key/value application settings (backup schedule, account tags, ...)
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export const goals = sqliteTable('goals', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	target: real('target').notNull(),
	deadline: text('deadline'),
	color: text('color').default('#4361ee').notNull(),
	icon: text('icon').default('fa-piggy-bank').notNull(),
	archived: integer('archived').default(0).notNull(),
	createdBy: integer('created_by').references(() => users.id),
	createdAt: text('created_at').notNull()
});

// Money put into (positive) or taken out of (negative) a savings goal
export const goalContributions = sqliteTable('goal_contributions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	goalId: integer('goal_id').references(() => goals.id, { onDelete: 'cascade' }).notNull(),
	amount: real('amount').notNull(),
	date: text('date').notNull(),
	note: text('note'),
	createdBy: integer('created_by').references(() => users.id)
});

// Automatic categorisation: "description contains <pattern>" -> category, extra tags, transfer flag
export const rules = sqliteTable('rules', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	pattern: text('pattern').notNull(),
	type: text('type').$type<'any' | 'expense' | 'income'>().default('any').notNull(),
	category: text('category'),
	addTags: text('add_tags').default('[]').notNull(),
	markTransfer: integer('mark_transfer').default(0).notNull(),
	priority: integer('priority').default(0).notNull(),
	isActive: integer('is_active').default(1).notNull(),
	createdBy: integer('created_by').references(() => users.id)
});
