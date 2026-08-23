CREATE TABLE `score_module_settings` (
	`module_key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
