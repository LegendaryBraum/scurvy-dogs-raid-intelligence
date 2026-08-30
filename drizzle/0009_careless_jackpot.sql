CREATE TABLE `officer_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`author_officer_id` text NOT NULL,
	`raid_night_id` text,
	`boss_id` text,
	`pull_id` text,
	`visibility` text DEFAULT 'player' NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_officer_id`) REFERENCES `officers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raid_night_id`) REFERENCES `raid_nights`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boss_id`) REFERENCES `bosses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_id`) REFERENCES `pulls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_officer_notes_player_visibility` ON `officer_notes` (`player_id`,`visibility`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_officer_notes_pull` ON `officer_notes` (`pull_id`);