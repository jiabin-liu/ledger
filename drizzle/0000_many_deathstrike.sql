CREATE TABLE `accounts` (
	`account_id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`official_name` text,
	`mask` text,
	`type` text NOT NULL,
	`subtype` text,
	`current_balance_milliunits` integer,
	`available_balance_milliunits` integer,
	`iso_currency_code` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plaid_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` text NOT NULL,
	`institution_id` text,
	`institution_name` text NOT NULL,
	`access_token_ciphertext` text NOT NULL,
	`sync_cursor` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plaid_items_item_id_unique` ON `plaid_items` (`item_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`merchant_name` text,
	`original_description` text,
	`amount_milliunits` integer NOT NULL,
	`iso_currency_code` text,
	`date` text NOT NULL,
	`authorized_date` text,
	`pending` integer DEFAULT false NOT NULL,
	`category_primary` text,
	`category_detailed` text,
	`payment_channel` text,
	`logo_url` text,
	`website` text,
	`updated_at` text NOT NULL
);
