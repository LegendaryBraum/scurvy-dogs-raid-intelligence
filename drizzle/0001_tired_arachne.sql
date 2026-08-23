CREATE TABLE `player_roster_settings` (
	`player_id` text PRIMARY KEY NOT NULL,
	`included` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_player_roster_settings_included` ON `player_roster_settings` (`included`);