CREATE TABLE `reanalysis_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`boss_id` text NOT NULL,
	`difficulty` integer NOT NULL,
	`pull_ids_json` text DEFAULT '[]' NOT NULL,
	`completed_pull_ids_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`total_pulls` integer DEFAULT 0 NOT NULL,
	`completed_pulls` integer DEFAULT 0 NOT NULL,
	`current_label` text,
	`event_rows` integer DEFAULT 0 NOT NULL,
	`players_penalized` integer DEFAULT 0 NOT NULL,
	`rules_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`retry_after_seconds` integer,
	`resume_after` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`boss_id`) REFERENCES `bosses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reanalysis_jobs_status_updated` ON `reanalysis_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_reanalysis_jobs_boss_difficulty` ON `reanalysis_jobs` (`boss_id`,`difficulty`,`updated_at`);