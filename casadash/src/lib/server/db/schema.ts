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
	// Last TOTP time step accepted, so a code cannot be replayed
	totpLastStep: integer('totp_last_step'),
	// JSON array of SHA-256 hashes of the unused MFA recovery codes
	recoveryCodes: text('recovery_codes'),
	createdAt: text('created_at').notNull()
});

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(), // SHA-256 of the cookie token
	userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
	kind: text('kind').$type<'session' | 'mfa'>().notNull(),
	createdAt: integer('created_at').notNull(),
	expiresAt: integer('expires_at').notNull(),
	userAgent: text('user_agent'),
	ip: text('ip'),
	lastSeen: integer('last_seen')
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
	// Foreign currency originally paid (amount is always stored in euro)
	origAmount: real('orig_amount'),
	origCurrency: text('orig_currency'),
	fxRate: real('fx_rate'),
	// Id given by the bank (Open Banking), to avoid importing a movement twice
	externalId: text('external_id'),
	// Booking day and value day, when they differ from the day of the operation (bank movements)
	bookingDate: text('booking_date'),
	valueDate: text('value_date'),
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

// --- Security ---

// Persistent brute-force counters (survive restarts)
export const loginFailures = sqliteTable('login_failures', {
	key: text('key').primaryKey(),
	count: integer('count').notNull(),
	until: integer('until').notNull()
});

export const auditLog = sqliteTable('audit_log', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	at: text('at').notNull(),
	userId: integer('user_id'),
	username: text('username'),
	action: text('action').notNull(),
	detail: text('detail'),
	ip: text('ip')
});

// --- Net worth ---

export const assets = sqliteTable('assets', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	kind: text('kind').$type<'asset' | 'liability'>().default('asset').notNull(),
	category: text('category').default('Altro').notNull(),
	value: real('value').default(0).notNull(),
	note: text('note'),
	updatedAt: text('updated_at').notNull(),
	createdBy: integer('created_by').references(() => users.id)
});

export const assetHistory = sqliteTable('asset_history', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	assetId: integer('asset_id').references(() => assets.id, { onDelete: 'cascade' }).notNull(),
	date: text('date').notNull(),
	value: real('value').notNull()
});

// --- Deadlines with reminders (stamp duty, insurance, taxes...) ---

export const deadlines = sqliteTable('deadlines', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull(),
	dueDate: text('due_date').notNull(),
	amount: real('amount').default(0).notNull(),
	kind: text('kind').default('Altro').notNull(),
	category: text('category'),
	repeat: text('repeat').$type<'none' | 'monthly' | 'yearly'>().default('none').notNull(),
	remindDays: integer('remind_days').default(14).notNull(),
	done: integer('done').default(0).notNull(),
	createdBy: integer('created_by').references(() => users.id)
});

// --- Open Banking ---

export const bankConnections = sqliteTable('bank_connections', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	provider: text('provider').notNull(),
	institutionId: text('institution_id').notNull(),
	institutionName: text('institution_name').notNull(),
	requisitionId: text('requisition_id').notNull(),
	accountId: text('account_id'),
	accountTag: text('account_tag'),
	status: text('status').default('pending').notNull(),
	lastSync: text('last_sync'),
	lastError: text('last_error'),
	// 1 = read this account automatically every few hours; 0 = only when asked from the Import page
	autoSync: integer('auto_sync').default(0).notNull(),
	createdBy: integer('created_by').references(() => users.id)
});
