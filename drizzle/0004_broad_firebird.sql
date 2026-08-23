CREATE TABLE `benefit_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`product_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_benefit_assignments_account_id` ON `benefit_assignments` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_benefit_assignments_product_id` ON `benefit_assignments` (`product_id`);--> statement-breakpoint
CREATE TABLE `benefit_defs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`name` text NOT NULL,
	`amount_milliunits` integer NOT NULL,
	`cadence` text NOT NULL,
	`effective_from_year` integer,
	`effective_to_year` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_benefit_defs_product_id` ON `benefit_defs` (`product_id`);--> statement-breakpoint
CREATE TABLE `benefit_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`benefit_def_id` integer NOT NULL,
	`year` integer NOT NULL,
	`period_key` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`note` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_benefit_periods_unique` ON `benefit_periods` (`account_id`,`benefit_def_id`,`year`,`period_key`);--> statement-breakpoint
CREATE INDEX `idx_benefit_periods_account_year` ON `benefit_periods` (`account_id`,`year`);--> statement-breakpoint
CREATE INDEX `idx_benefit_periods_benefit_def_id` ON `benefit_periods` (`benefit_def_id`);--> statement-breakpoint
CREATE TABLE `card_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
