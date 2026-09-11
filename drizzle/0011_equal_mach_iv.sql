CREATE TABLE `category_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern` text NOT NULL,
	`category_primary` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
