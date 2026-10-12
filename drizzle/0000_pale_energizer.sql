-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT "transactions_check_1" CHECK(type IN ("income", "expense"),
	CONSTRAINT "budgets_check_2" CHECK(period_type IN ("monthly", "annual")
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_by` integer NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`amount` real NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`created_at` numeric DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transactions_check_1" CHECK(type IN ("income", "expense"),
	CONSTRAINT "budgets_check_2" CHECK(period_type IN ("monthly", "annual")
);
--> statement-breakpoint
CREATE INDEX `idx_transactions_category` ON `transactions` (`category`);--> statement-breakpoint
CREATE INDEX `idx_transactions_type` ON `transactions` (`type`);--> statement-breakpoint
CREATE INDEX `idx_transactions_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`period_type` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer,
	`amount` real NOT NULL,
	`created_by` integer,
	`updated_at` numeric DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT "transactions_check_1" CHECK(type IN ("income", "expense"),
	CONSTRAINT "budgets_check_2" CHECK(period_type IN ("monthly", "annual")
);

*/