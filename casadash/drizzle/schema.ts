import { sqliteTable, AnySQLiteColumn, check, integer, text, numeric, index, foreignKey, real } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const users = sqliteTable("users", {
	id: integer().primaryKey({ autoIncrement: true }),
	username: text().notNull(),
	displayName: text("display_name").notNull(),
	passwordHash: text("password_hash").notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`),
},
(table) => [
	check("transactions_check_1", sql`type IN ("income", "expense"`),
	check("budgets_check_2", sql`period_type IN ("monthly", "annual"`),
]);

export const transactions = sqliteTable("transactions", {
	id: integer().primaryKey({ autoIncrement: true }),
	createdBy: integer("created_by").notNull().references(() => users.id),
	type: text().notNull(),
	description: text().notNull(),
	amount: real().notNull(),
	date: text().notNull(),
	category: text().notNull(),
	createdAt: numeric("created_at").default(sql`(CURRENT_TIMESTAMP)`),
},
(table) => [
	index("idx_transactions_category").on(table.category),
	index("idx_transactions_type").on(table.type),
	index("idx_transactions_date").on(table.date),
	check("transactions_check_1", sql`type IN ("income", "expense"`),
	check("budgets_check_2", sql`period_type IN ("monthly", "annual"`),
]);

export const budgets = sqliteTable("budgets", {
	id: integer().primaryKey({ autoIncrement: true }),
	periodType: text("period_type").notNull(),
	year: integer().notNull(),
	month: integer(),
	amount: real().notNull(),
	createdBy: integer("created_by"),
	updatedAt: numeric("updated_at").default(sql`(CURRENT_TIMESTAMP)`),
},
(table) => [
	check("transactions_check_1", sql`type IN ("income", "expense"`),
	check("budgets_check_2", sql`period_type IN ("monthly", "annual"`),
]);

