ALTER TABLE `pulls` ADD `included` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_pulls_report_included` ON `pulls` (`report_id`,`included`);