import type { DashboardData } from "./types";

export const demoData: DashboardData = {
  season: "The War Within · Season 3",
  raidNight: "Tuesday Progression · Aug 12",
  reportCode: "DEMO7QK9",
  raid: "Demo raid tier",
  bosses: [
    { id: "gilded-tyrant", name: "The Gilded Tyrant" },
    { id: "deepwarden", name: "Deepwarden Kharos" },
  ],
  pulls: [
    { id: "pull-14", bossId: "gilded-tyrant", label: "Pull 14 · Kill", killed: true, duration: "6:42", difficulty: "Heroic" },
    { id: "pull-13", bossId: "gilded-tyrant", label: "Pull 13 · 4.2%", killed: false, duration: "6:08", difficulty: "Heroic" },
    { id: "pull-9", bossId: "deepwarden", label: "Pull 9 · Kill", killed: true, duration: "5:51", difficulty: "Heroic" },
  ],
  raidAverages: { mechanics: 84, performance: 78, attendance: 91, preparation: 86 },
  players: [
    {
      id: "syflora", name: "Syflora", realm: "Area 52", className: "Druid", spec: "Restoration", role: "Healer",
      scores: { mechanics: 92, performance: 84, attendance: 96, preparation: 88 },
      parse: 79, ilvlParse: 86, attendanceLabel: "12 of 13 nights", prepLabel: "Ready", trend: [76, 80, 82, 84, 87, 92],
      summary: "You handled the fight cleanly. One positioning mistake is the clearest opportunity.",
      wins: ["Zero critical mechanic failures", "All 3 assigned dispels completed", "Strong healing uptime through phase three"],
      focus: ["Move one step earlier for Gilded Wave", "Hold Barkskin for the second Overthrow"],
      deaths: 0, interrupts: 0, dispels: 3, avoidableDamage: 184000,
    },
    {
      id: "cutlas", name: "Cutlas", realm: "Area 52", className: "Warrior", spec: "Protection", role: "Tank",
      scores: { mechanics: 87, performance: 90, attendance: 100, preparation: 96 },
      parse: 88, ilvlParse: 91, attendanceLabel: "13 of 13 nights", prepLabel: "Fully prepared", trend: [82, 84, 86, 84, 88, 87],
      summary: "A controlled tank pull with excellent survival planning and one late boss reposition.",
      wins: ["No unplanned deaths", "Defensive coverage on every Overthrow", "Clean taunt handoffs"],
      focus: ["Reposition the boss before the third wave"], deaths: 0, interrupts: 4, dispels: 0, avoidableDamage: 92000,
    },
    {
      id: "bramble", name: "Bramble", realm: "Area 52", className: "Hunter", spec: "Marksmanship", role: "DPS",
      scores: { mechanics: 76, performance: 93, attendance: 89, preparation: 82 },
      parse: 94, ilvlParse: 92, attendanceLabel: "11 of 13 nights", prepLabel: "1 item to fix", trend: [70, 73, 78, 79, 74, 76],
      summary: "Excellent damage output, but repeated floor damage created avoidable healer pressure.",
      wins: ["94th percentile damage", "Perfect target swaps", "All interrupt assignments completed"],
      focus: ["Respect the second Gilded Wave tick", "Use Healthstone before the final Overthrow"], deaths: 1, interrupts: 3, dispels: 0, avoidableDamage: 682000,
    },
    {
      id: "vex", name: "Vex", realm: "Illidan", className: "Mage", spec: "Arcane", role: "DPS",
      scores: { mechanics: 89, performance: 81, attendance: 82, preparation: 91 },
      parse: 76, ilvlParse: 83, attendanceLabel: "10 of 13 nights", prepLabel: "Ready", trend: [81, 83, 84, 86, 87, 89],
      summary: "A reliable mechanics pull with improving damage through each progression night.",
      wins: ["No avoidable hits", "Strong movement uptime", "Personal defensive used on time"],
      focus: ["Align the second cooldown window with Bloodlust"], deaths: 0, interrupts: 2, dispels: 0, avoidableDamage: 0,
    },
  ],
  events: [
    { id: "e1", playerId: "syflora", spellId: 451002, ability: "Royal Brand dispelled", kind: "success", detail: "3 of 3 assignments · perfect", timestamp: "5:31" },
    { id: "e2", playerId: "syflora", spellId: 451117, ability: "Gilded Wave", kind: "warning", detail: "2 ticks · 184k avoidable damage", timestamp: "4:18", amount: 184000 },
    { id: "e3", playerId: "syflora", spellId: 22812, ability: "Barkskin", kind: "utility", detail: "Defensive used before Overthrow", timestamp: "2:44" },
    { id: "e4", playerId: "cutlas", spellId: 451204, ability: "Overthrow", kind: "success", detail: "Shield Wall covered the hit", timestamp: "5:46" },
    { id: "e5", playerId: "bramble", spellId: 451117, ability: "Gilded Wave", kind: "warning", detail: "4 ticks · repeated avoidable damage", timestamp: "3:52", amount: 682000 },
    { id: "e6", playerId: "bramble", spellId: 451204, ability: "Overthrow", kind: "death", detail: "Died without Healthstone", timestamp: "5:58" },
    { id: "e7", playerId: "vex", spellId: 451117, ability: "Gilded Wave", kind: "success", detail: "No damage taken", timestamp: "4:18" },
  ],
  rules: [
    { id: "rule-wave", bossId: "gilded-tyrant", spellId: 451117, name: "Gilded Wave", category: "Avoidable damage", severity: "Medium", weight: 4, eventType: "damage", difficulties: ["Heroic", "Mythic"], roles: ["Tank", "Healer", "DPS"], condition: { minAmount: 50000, countOncePerCast: true, note: "Ignore the first unavoidable tick." } },
    { id: "rule-brand", bossId: "gilded-tyrant", spellId: 451002, name: "Royal Brand", category: "Dispel", severity: "High", weight: 8, eventType: "dispel", difficulties: ["Heroic", "Mythic"], roles: ["Healer"], condition: { note: "Evaluate assigned healers only." } },
    { id: "rule-overthrow", bossId: "gilded-tyrant", spellId: 451204, name: "Overthrow", category: "Defensive", severity: "High", weight: 7, eventType: "death", difficulties: ["Heroic", "Mythic"], roles: ["Tank", "Healer", "DPS"], condition: { countOncePerCast: true } },
  ],
};
