CREATE TABLE `reward_balances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`remaining_amount` real,
	`expiration_date` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reward_balances_sort_order` ON `reward_balances` (`sort_order`);