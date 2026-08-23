export type ScoreKey = "mechanics" | "performance" | "attendance" | "preparation";
export type ScoreValue = number | null;
export type ModuleSettings = Record<ScoreKey, boolean>;

export type PlayerSnapshot = {
  id: string;
  name: string;
  realm: string;
  className: string;
  spec: string;
  role: "Tank" | "Healer" | "DPS";
  scores: Record<ScoreKey, ScoreValue>;
  parse: number | null;
  ilvlParse: number | null;
  itemLevel?: number;
  attendanceLabel: string;
  prepLabel: string;
  trend: number[];
  summary: string;
  wins: string[];
  focus: string[];
  deaths: number;
  interrupts: number;
  dispels: number;
  avoidableDamage: number;
  raidAverages?: Record<ScoreKey, ScoreValue>;
  enabledModules?: ModuleSettings;
};

export type RosterMember = {
  id: string;
  name: string;
  realm: string;
  className: string;
  spec: string;
  role: "Tank" | "Healer" | "DPS";
  pullsSeen: number;
  raidNights: number;
  lastSeen: number | null;
  included: boolean;
};

export type RaidEvent = {
  id: string;
  playerId: string;
  spellId: number;
  ability: string;
  kind: "success" | "warning" | "death" | "utility";
  detail: string;
  timestamp: string;
  amount?: number;
  icon?: string;
};

export type MechanicRule = {
  id: string;
  bossId: string;
  spellId: number;
  name: string;
  icon?: string;
  category: "Avoidable damage" | "Mechanic failure" | "Interrupt" | "Dispel" | "Defensive" | "Soak" | "Utility";
  severity: "Low" | "Medium" | "High" | "Critical";
  weight: number;
  eventType: "damage" | "debuff" | "cast" | "interrupt" | "dispel" | "death";
  difficulties: string[];
  roles: string[];
  condition: {
    minAmount?: number;
    countOncePerCast?: boolean;
    ignoreTanks?: boolean;
    scoringMode?: "penalty" | "success" | "context";
    maxOccurrencesPerPull?: number;
    note?: string;
  };
  enabled?: boolean;
};

export type DashboardData = {
  season: string;
  raidNight: string;
  reportCode: string;
  raid: string;
  bosses: { id: string; name: string }[];
  pulls: { id: string; bossId: string; label: string; killed: boolean; duration: string; difficulty: string }[];
  players: PlayerSnapshot[];
  roster?: RosterMember[];
  events: RaidEvent[];
  pullPlayers?: Record<string, PlayerSnapshot[]>;
  pullEvents?: Record<string, RaidEvent[]>;
  rules: MechanicRule[];
  moduleSettings: ModuleSettings;
  raidAverages: Record<ScoreKey, ScoreValue>;
  dataSource?: {
    label: string;
    detail: string;
    reportUrl: string;
    wipefestUrl?: string;
  };
  preparationSummary?: string;
  preparationRaid?: { flasks: number | null; food: number | null; total: number | null };
};
