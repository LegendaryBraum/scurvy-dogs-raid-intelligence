CREATE TABLE `bosses` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`encounter_id` integer NOT NULL,
	`raid_name` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bosses_season_encounter` ON `bosses` (`season_id`,`encounter_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`pull_id` text NOT NULL,
	`player_id` text,
	`rule_id` text,
	`spell_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`timestamp` integer NOT NULL,
	`amount` real,
	`outcome` text DEFAULT 'observed' NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`pull_id`) REFERENCES `pulls`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `mechanic_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_pull_player` ON `events` (`pull_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_events_spell` ON `events` (`spell_id`);--> statement-breakpoint
CREATE TABLE `mechanic_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`boss_id` text NOT NULL,
	`spell_id` integer NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`weight` real NOT NULL,
	`event_type` text NOT NULL,
	`difficulties_json` text DEFAULT '[]' NOT NULL,
	`roles_json` text DEFAULT '[]' NOT NULL,
	`condition_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`boss_id`) REFERENCES `bosses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_mechanic_rules_boss_enabled` ON `mechanic_rules` (`boss_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_mechanic_rules_spell` ON `mechanic_rules` (`spell_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`realm` text DEFAULT '' NOT NULL,
	`class_name` text NOT NULL,
	`role` text DEFAULT 'DPS' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_players_identity` ON `players` (`name`,`realm`);--> statement-breakpoint
CREATE TABLE `pull_players` (
	`id` text PRIMARY KEY NOT NULL,
	`pull_id` text NOT NULL,
	`player_id` text NOT NULL,
	`spec` text DEFAULT 'Unknown' NOT NULL,
	`dps` real DEFAULT 0 NOT NULL,
	`hps` real DEFAULT 0 NOT NULL,
	`parse` real DEFAULT 0 NOT NULL,
	`ilvl_parse` real DEFAULT 0 NOT NULL,
	`deaths` integer DEFAULT 0 NOT NULL,
	`mechanics_score` real DEFAULT 100 NOT NULL,
	`performance_score` real DEFAULT 0 NOT NULL,
	`attendance_score` real DEFAULT 100 NOT NULL,
	`preparation_score` real DEFAULT 100 NOT NULL,
	FOREIGN KEY (`pull_id`) REFERENCES `pulls`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pull_players_pull_player` ON `pull_players` (`pull_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_pull_players_player` ON `pull_players` (`player_id`);--> statement-breakpoint
CREATE TABLE `pulls` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`boss_id` text NOT NULL,
	`fight_id` integer NOT NULL,
	`pull_number` integer NOT NULL,
	`difficulty` integer,
	`killed` integer DEFAULT false NOT NULL,
	`start_time` integer NOT NULL,
	`end_time` integer NOT NULL,
	`boss_percentage` real,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boss_id`) REFERENCES `bosses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pulls_report_fight` ON `pulls` (`report_id`,`fight_id`);--> statement-breakpoint
CREATE INDEX `idx_pulls_boss` ON `pulls` (`boss_id`);--> statement-breakpoint
CREATE TABLE `raid_nights` (
	`id` text PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`name` text NOT NULL,
	`happened_at` text NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_raid_nights_season_date` ON `raid_nights` (`season_id`,`happened_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`raid_night_id` text NOT NULL,
	`code` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`zone_name` text,
	`start_time` integer,
	`end_time` integer,
	`source_mode` text DEFAULT 'live' NOT NULL,
	`imported_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`raid_night_id`) REFERENCES `raid_nights`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reports_code_unique` ON `reports` (`code`);--> statement-breakpoint
CREATE INDEX `idx_reports_raid_night` ON `reports` (`raid_night_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`token` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`boss_id` text,
	`pull_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`boss_id`) REFERENCES `bosses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pull_id`) REFERENCES `pulls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_shares_player` ON `shares` (`player_id`);