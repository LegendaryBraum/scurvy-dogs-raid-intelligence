import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const seasons = sqliteTable("seasons", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const raidNights = sqliteTable("raid_nights", {
  id: text("id").primaryKey(),
  seasonId: text("season_id").notNull().references(() => seasons.id),
  name: text("name").notNull(),
  happenedAt: text("happened_at").notNull(),
  included: integer("included", { mode: "boolean" }).notNull().default(true),
}, (table) => [index("idx_raid_nights_season_date").on(table.seasonId, table.happenedAt)]);

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(), raidNightId: text("raid_night_id").notNull().references(() => raidNights.id),
  code: text("code").notNull(), url: text("url").notNull(), title: text("title").notNull(), zoneName: text("zone_name"),
  startTime: integer("start_time"), endTime: integer("end_time"), sourceMode: text("source_mode").notNull().default("live"),
  included: integer("included", { mode: "boolean" }).notNull().default(true),
  importedAt: text("imported_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_reports_code_unique").on(table.code), index("idx_reports_raid_night").on(table.raidNightId)]);

export const importJobs = sqliteTable("import_jobs", {
  id: text("id").primaryKey(),
  reportCode: text("report_code").notNull(),
  reportUrl: text("report_url").notNull(),
  seasonId: text("season_id").notNull().references(() => seasons.id),
  raidNightId: text("raid_night_id").notNull().references(() => raidNights.id),
  replaceExisting: integer("replace_existing", { mode: "boolean" }).notNull().default(false),
  selectedFightIdsJson: text("selected_fight_ids_json").notNull().default("[]"),
  completedFightIdsJson: text("completed_fight_ids_json").notNull().default("[]"),
  snapshotJson: text("snapshot_json"),
  stagingReportId: text("staging_report_id"),
  status: text("status").notNull().default("queued"),
  totalPulls: integer("total_pulls").notNull().default(0),
  completedPulls: integer("completed_pulls").notNull().default(0),
  currentLabel: text("current_label"),
  playerRows: integer("player_rows").notNull().default(0),
  eventRows: integer("event_rows").notNull().default(0),
  errorMessage: text("error_message"),
  retryAfterSeconds: integer("retry_after_seconds"),
  resumeAfter: text("resume_after"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
}, (table) => [index("idx_import_jobs_status_updated").on(table.status, table.updatedAt), index("idx_import_jobs_report_code").on(table.reportCode)]);

export const bosses = sqliteTable("bosses", {
  id: text("id").primaryKey(), seasonId: text("season_id").notNull().references(() => seasons.id),
  encounterId: integer("encounter_id").notNull(), raidName: text("raid_name").notNull(), name: text("name").notNull(),
}, (table) => [uniqueIndex("idx_bosses_season_encounter").on(table.seasonId, table.encounterId)]);

export const pulls = sqliteTable("pulls", {
  id: text("id").primaryKey(), reportId: text("report_id").notNull().references(() => reports.id),
  bossId: text("boss_id").notNull().references(() => bosses.id), fightId: integer("fight_id").notNull(),
  pullNumber: integer("pull_number").notNull(), difficulty: integer("difficulty"), killed: integer("killed", { mode: "boolean" }).notNull().default(false),
  startTime: integer("start_time").notNull(), endTime: integer("end_time").notNull(), bossPercentage: real("boss_percentage"),
  included: integer("included", { mode: "boolean" }).notNull().default(true),
}, (table) => [uniqueIndex("idx_pulls_report_fight").on(table.reportId, table.fightId), index("idx_pulls_report_included").on(table.reportId, table.included), index("idx_pulls_boss").on(table.bossId)]);

export const players = sqliteTable("players", {
  id: text("id").primaryKey(), name: text("name").notNull(), realm: text("realm").notNull().default(""),
  className: text("class_name").notNull(), role: text("role").notNull().default("DPS"),
}, (table) => [uniqueIndex("idx_players_identity").on(table.name, table.realm)]);

export const playerRosterSettings = sqliteTable("player_roster_settings", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  included: integer("included", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_player_roster_settings_included").on(table.included)]);

export const playerIdentities = sqliteTable("player_identities", {
  playerId: text("player_id").primaryKey().references(() => players.id),
  identityId: text("identity_id").notNull().references(() => players.id),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_player_identities_identity").on(table.identityId)]);

export const scoreModuleSettings = sqliteTable("score_module_settings", {
  moduleKey: text("module_key").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const accessSettings = sqliteTable("access_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const officers = sqliteTable("officers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: text("revoked_at"),
}, (table) => [index("idx_officers_name").on(table.name)]);

export const officerInvites = sqliteTable("officer_invites", {
  id: text("id").primaryKey(),
  officerId: text("officer_id").notNull().references(() => officers.id),
  deviceLabel: text("device_label").notNull(),
  tokenHash: text("token_hash").notNull(),
  token: text("token"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  revokedAt: text("revoked_at"),
}, (table) => [uniqueIndex("idx_officer_invites_token").on(table.tokenHash), index("idx_officer_invites_officer").on(table.officerId)]);

export const officerSessions = sqliteTable("officer_sessions", {
  id: text("id").primaryKey(),
  officerId: text("officer_id").notNull().references(() => officers.id),
  deviceLabel: text("device_label").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text("last_used_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: text("revoked_at"),
}, (table) => [uniqueIndex("idx_officer_sessions_token").on(table.tokenHash), index("idx_officer_sessions_officer").on(table.officerId)]);

export const playerAccessLinks = sqliteTable("player_access_links", {
  token: text("token").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
}, (table) => [index("idx_player_access_links_player").on(table.playerId, table.revokedAt)]);

export const officerNotes = sqliteTable("officer_notes", {
  id: text("id").primaryKey(),
  playerId: text("player_id").notNull().references(() => players.id),
  authorOfficerId: text("author_officer_id").notNull().references(() => officers.id),
  raidNightId: text("raid_night_id").references(() => raidNights.id),
  bossId: text("boss_id").references(() => bosses.id),
  pullId: text("pull_id").references(() => pulls.id),
  visibility: text("visibility").notNull().default("player"),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_officer_notes_player_visibility").on(table.playerId, table.visibility, table.createdAt),
  index("idx_officer_notes_pull").on(table.pullId),
]);

export const pullPlayers = sqliteTable("pull_players", {
  id: text("id").primaryKey(), pullId: text("pull_id").notNull().references(() => pulls.id),
  playerId: text("player_id").notNull().references(() => players.id), spec: text("spec").notNull().default("Unknown"),
  dps: real("dps").notNull().default(0), hps: real("hps").notNull().default(0), parse: real("parse").notNull().default(0),
  ilvlParse: real("ilvl_parse").notNull().default(0), deaths: integer("deaths").notNull().default(0),
  mechanicsScore: real("mechanics_score").notNull().default(100), performanceScore: real("performance_score").notNull().default(0),
  attendanceScore: real("attendance_score").notNull().default(100), preparationScore: real("preparation_score").notNull().default(100),
}, (table) => [uniqueIndex("idx_pull_players_pull_player").on(table.pullId, table.playerId), index("idx_pull_players_player").on(table.playerId)]);

export const mechanicRules = sqliteTable("mechanic_rules", {
  id: text("id").primaryKey(), bossId: text("boss_id").notNull().references(() => bosses.id), spellId: integer("spell_id").notNull(),
  name: text("name").notNull(), icon: text("icon"), category: text("category").notNull(), severity: text("severity").notNull(), weight: real("weight").notNull(),
  eventType: text("event_type").notNull(), difficultiesJson: text("difficulties_json").notNull().default("[]"),
  rolesJson: text("roles_json").notNull().default("[]"), conditionJson: text("condition_json").notNull().default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_mechanic_rules_boss_enabled").on(table.bossId, table.enabled), index("idx_mechanic_rules_spell").on(table.spellId)]);

export const events = sqliteTable("events", {
  id: text("id").primaryKey(), pullId: text("pull_id").notNull().references(() => pulls.id), playerId: text("player_id").references(() => players.id),
  ruleId: text("rule_id").references(() => mechanicRules.id), spellId: integer("spell_id").notNull(), eventType: text("event_type").notNull(),
  timestamp: integer("timestamp").notNull(), amount: real("amount"), outcome: text("outcome").notNull().default("observed"),
  detailsJson: text("details_json").notNull().default("{}"),
}, (table) => [index("idx_events_pull_player").on(table.pullId, table.playerId), index("idx_events_spell").on(table.spellId)]);

export const shares = sqliteTable("shares", {
  token: text("token").primaryKey(), playerId: text("player_id").notNull().references(() => players.id),
  bossId: text("boss_id").references(() => bosses.id), pullId: text("pull_id").references(() => pulls.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), expiresAt: text("expires_at"),
}, (table) => [index("idx_shares_player").on(table.playerId)]);
