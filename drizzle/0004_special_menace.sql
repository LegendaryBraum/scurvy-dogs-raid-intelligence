CREATE TABLE `player_identities` (
	`player_id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`identity_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_player_identities_identity` ON `player_identities` (`identity_id`);--> statement-breakpoint
ALTER TABLE `raid_nights` ADD `included` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `reports` ADD `included` integer DEFAULT true NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `player_identities` (`player_id`, `identity_id`) SELECT `id`, `id` FROM `players`;--> statement-breakpoint
UPDATE `score_module_settings` SET `enabled` = 1, `updated_at` = CURRENT_TIMESTAMP WHERE `module_key` = 'attendance';
