import type { DashboardData } from "./types";

export const privatePlaceholderData: DashboardData = {
  season: "Private workspace",
  raidNight: "Officer access required",
  reportCode: "",
  raid: "Private raid data",
  bosses: [{ id: "private-boss", name: "Raid boss" }],
  pulls: [{ id: "private-pull", bossId: "private-boss", label: "Private pull", killed: false, duration: "0:00", difficulty: "Private" }],
  players: [{
    id: "private-player", name: "Raider", realm: "", className: "Unknown", spec: "Unknown", role: "DPS",
    scores: { mechanics: null, performance: null, attendance: null, preparation: null }, parse: null, ilvlParse: null,
    attendanceLabel: "Private", prepLabel: "Private", trend: [], summary: "Private raid data loads only after officer access is verified.",
    wins: [], focus: [], deaths: 0, interrupts: 0, dispels: 0, avoidableDamage: 0,
  }],
  roster: [{ id: "private-player", name: "Raider", realm: "", className: "Unknown", spec: "Unknown", role: "DPS", pullsSeen: 0, raidNights: 0, lastSeen: null, included: true }],
  events: [], pullPlayers: { "private-pull": [] }, pullEvents: { "private-pull": [] }, rules: [],
  moduleSettings: { mechanics: true, performance: true, attendance: true, preparation: false },
  raidAverages: { mechanics: null, performance: null, attendance: null, preparation: null },
};
