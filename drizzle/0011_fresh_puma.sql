CREATE TABLE `rule_analysis_state` (
	`pull_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`rule_updated_at` text NOT NULL,
	`analyzed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pull_id`) REFERENCES `pulls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `mechanic_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_rule_analysis_state_pull_rule` ON `rule_analysis_state` (`pull_id`,`rule_id`);--> statement-breakpoint
CREATE INDEX `idx_rule_analysis_state_rule` ON `rule_analysis_state` (`rule_id`,`rule_updated_at`);--> statement-breakpoint
ALTER TABLE `reanalysis_jobs` ADD `mode` text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE `reanalysis_jobs` ADD `rule_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `reanalysis_jobs` ADD `cancel_requested` integer DEFAULT false NOT NULL;