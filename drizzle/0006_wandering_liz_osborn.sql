CREATE TABLE `access_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `officer_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`officer_id` text NOT NULL,
	`device_label` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`revoked_at` text,
	FOREIGN KEY (`officer_id`) REFERENCES `officers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_officer_invites_token` ON `officer_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_officer_invites_officer` ON `officer_invites` (`officer_id`);--> statement-breakpoint
CREATE TABLE `officer_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`officer_id` text NOT NULL,
	`device_label` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`officer_id`) REFERENCES `officers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_officer_sessions_token` ON `officer_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_officer_sessions_officer` ON `officer_sessions` (`officer_id`);--> statement-breakpoint
CREATE TABLE `officers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_officers_name` ON `officers` (`name`);--> statement-breakpoint
CREATE TABLE `player_access_links` (
	`token` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_player_access_links_player` ON `player_access_links` (`player_id`,`revoked_at`);