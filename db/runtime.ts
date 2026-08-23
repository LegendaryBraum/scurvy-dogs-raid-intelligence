import { env } from "cloudflare:workers";

type ScurvyEnv = typeof env & { DB?: D1Database; WCL_CLIENT_ID?: string; WCL_CLIENT_SECRET?: string };
let schemaReady = false;

export function getRuntimeEnv() { return env as ScurvyEnv; }
export function getD1() {
  const database = getRuntimeEnv().DB;
  if (!database) throw new Error("The raid database is not connected.");
  return database;
}

export async function ensureSchema() {
  if (schemaReady) return getD1();
  const db = getD1();
  const statements = [
    `CREATE TABLE IF NOT EXISTS seasons (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS raid_nights (id TEXT PRIMARY KEY, season_id TEXT NOT NULL REFERENCES seasons(id), name TEXT NOT NULL, happened_at TEXT NOT NULL, included INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, raid_night_id TEXT NOT NULL REFERENCES raid_nights(id), code TEXT NOT NULL UNIQUE, url TEXT NOT NULL, title TEXT NOT NULL, zone_name TEXT, start_time INTEGER, end_time INTEGER, source_mode TEXT NOT NULL DEFAULT 'live', included INTEGER NOT NULL DEFAULT 1, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS bosses (id TEXT PRIMARY KEY, season_id TEXT NOT NULL REFERENCES seasons(id), encounter_id INTEGER NOT NULL, raid_name TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(season_id, encounter_id))`,
    `CREATE TABLE IF NOT EXISTS pulls (id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), boss_id TEXT NOT NULL REFERENCES bosses(id), fight_id INTEGER NOT NULL, pull_number INTEGER NOT NULL, difficulty INTEGER, killed INTEGER NOT NULL DEFAULT 0, start_time INTEGER NOT NULL, end_time INTEGER NOT NULL, boss_percentage REAL, UNIQUE(report_id, fight_id))`,
    `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, realm TEXT NOT NULL DEFAULT '', class_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'DPS', UNIQUE(name, realm))`,
    `CREATE TABLE IF NOT EXISTS player_roster_settings (player_id TEXT PRIMARY KEY REFERENCES players(id), included INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS player_identities (player_id TEXT PRIMARY KEY REFERENCES players(id), identity_id TEXT NOT NULL REFERENCES players(id), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS score_module_settings (module_key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS pull_players (id TEXT PRIMARY KEY, pull_id TEXT NOT NULL REFERENCES pulls(id), player_id TEXT NOT NULL REFERENCES players(id), spec TEXT NOT NULL DEFAULT 'Unknown', dps REAL NOT NULL DEFAULT 0, hps REAL NOT NULL DEFAULT 0, parse REAL NOT NULL DEFAULT 0, ilvl_parse REAL NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, mechanics_score REAL NOT NULL DEFAULT 100, performance_score REAL NOT NULL DEFAULT 0, attendance_score REAL NOT NULL DEFAULT 100, preparation_score REAL NOT NULL DEFAULT 100, UNIQUE(pull_id, player_id))`,
    `CREATE TABLE IF NOT EXISTS mechanic_rules (id TEXT PRIMARY KEY, boss_id TEXT NOT NULL REFERENCES bosses(id), spell_id INTEGER NOT NULL, name TEXT NOT NULL, icon TEXT, category TEXT NOT NULL, severity TEXT NOT NULL, weight REAL NOT NULL, event_type TEXT NOT NULL, difficulties_json TEXT NOT NULL DEFAULT '[]', roles_json TEXT NOT NULL DEFAULT '[]', condition_json TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, pull_id TEXT NOT NULL REFERENCES pulls(id), player_id TEXT REFERENCES players(id), rule_id TEXT REFERENCES mechanic_rules(id), spell_id INTEGER NOT NULL, event_type TEXT NOT NULL, timestamp INTEGER NOT NULL, amount REAL, outcome TEXT NOT NULL DEFAULT 'observed', details_json TEXT NOT NULL DEFAULT '{}')`,
    `CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), boss_id TEXT REFERENCES bosses(id), pull_id TEXT REFERENCES pulls(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_raid_nights_season_date ON raid_nights(season_id, happened_at)`,
    `CREATE INDEX IF NOT EXISTS idx_reports_raid_night ON reports(raid_night_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pulls_boss ON pulls(boss_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pull_players_player ON pull_players(player_id)`,
    `CREATE INDEX IF NOT EXISTS idx_player_roster_settings_included ON player_roster_settings(included)`,
    `CREATE INDEX IF NOT EXISTS idx_player_identities_identity ON player_identities(identity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mechanic_rules_boss_enabled ON mechanic_rules(boss_id, enabled)`,
    `CREATE INDEX IF NOT EXISTS idx_mechanic_rules_spell ON mechanic_rules(spell_id)`,
    `CREATE INDEX IF NOT EXISTS idx_events_pull_player ON events(pull_id, player_id)`,
    `CREATE INDEX IF NOT EXISTS idx_events_spell ON events(spell_id)`,
    `CREATE INDEX IF NOT EXISTS idx_shares_player ON shares(player_id)`,
    `INSERT OR IGNORE INTO score_module_settings (module_key, enabled) VALUES ('mechanics', 1)`,
    `INSERT OR IGNORE INTO score_module_settings (module_key, enabled) VALUES ('performance', 1)`,
    `INSERT OR IGNORE INTO score_module_settings (module_key, enabled) VALUES ('attendance', 1)`,
    `INSERT OR IGNORE INTO score_module_settings (module_key, enabled) VALUES ('preparation', 0)`,
    `INSERT OR IGNORE INTO player_identities (player_id, identity_id) SELECT id, id FROM players`,
    `PRAGMA optimize`,
  ];
  await db.batch(statements.map((statement) => db.prepare(statement)));
  schemaReady = true;
  return db;
}

export function makeId(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`; }
