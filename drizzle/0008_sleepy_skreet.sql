CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`report_code` text NOT NULL,
	`report_url` text NOT NULL,
	`season_id` text NOT NULL,
	`raid_night_id` text NOT NULL,
	`replace_existing` integer DEFAULT false NOT NULL,
	`selected_fight_ids_json` text DEFAULT '[]' NOT NULL,
	`completed_fight_ids_json` text DEFAULT '[]' NOT NULL,
	`snapshot_json` text,
	`staging_report_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`total_pulls` integer DEFAULT 0 NOT NULL,
	`completed_pulls` integer DEFAULT 0 NOT NULL,
	`current_label` text,
	`player_rows` integer DEFAULT 0 NOT NULL,
	`event_rows` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`retry_after_seconds` integer,
	`resume_after` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`raid_night_id`) REFERENCES `raid_nights`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_import_jobs_status_updated` ON `import_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_import_jobs_report_code` ON `import_jobs` (`report_code`);