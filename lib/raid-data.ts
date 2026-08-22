import { scorePerformance } from "./scoring";
import type { DashboardData, MechanicRule, PlayerSnapshot, RaidEvent } from "./types";

const BOSS_ID = "nekzali-3470";
const RAID_MECHANICS_AVERAGE = 39;

type PlayerSeed = {
  id: string;
  name: string;
  className: string;
  spec: string;
  role: PlayerSnapshot["role"];
  itemLevel: number;
  mechanics: number;
  bonus: number;
  parse: number;
  ilvlParse: number;
};

type EventSeed = [time: string, spellId: number, ability: string, detail: string];
type WarningSeed = [time: string, spellId: number, ability: string, detail: string, amount: number];
type PullFact = {
  deaths: number;
  avoidableDamage: number;
  dispels: number;
  majorCasts: number;
  death: EventSeed;
  warning: WarningSeed;
  success?: EventSeed;
  utility?: EventSeed;
};

const playerSeeds: PlayerSeed[] = [
  { id: "syflora", name: "Syflora", className: "Druid", spec: "Restoration", role: "Healer", itemLevel: 297, mechanics: 29, bonus: 15, parse: 19, ilvlParse: 17 },
  { id: "alnima", name: "Alnima", className: "Shaman", spec: "Elemental", role: "DPS", itemLevel: 290, mechanics: 64, bonus: 25, parse: 9, ilvlParse: 16 },
  { id: "zatkyng", name: "Zatkyng", className: "Monk", spec: "Windwalker", role: "DPS", itemLevel: 292, mechanics: 64, bonus: 13, parse: 12, ilvlParse: 16 },
  { id: "bluesnakess", name: "Bluesnakess", className: "Warlock", spec: "Destruction", role: "DPS", itemLevel: 290, mechanics: 62, bonus: 15, parse: 8, ilvlParse: 9 },
  { id: "percypaladin", name: "Percypaladin", className: "Paladin", spec: "Retribution", role: "DPS", itemLevel: 293, mechanics: 61, bonus: 36, parse: 24, ilvlParse: 28 },
  { id: "vaelryth", name: "Vaelryth", className: "Evoker", spec: "Augmentation", role: "DPS", itemLevel: 295, mechanics: 47, bonus: 0, parse: 9, ilvlParse: 9 },
  { id: "illuminoida", name: "Illuminoida", className: "Mage", spec: "Arcane", role: "DPS", itemLevel: 294, mechanics: 46, bonus: 3, parse: 49, ilvlParse: 66 },
  { id: "linguine", name: "Línguine", className: "Death Knight", spec: "Unholy", role: "DPS", itemLevel: 293, mechanics: 42, bonus: 15, parse: 7, ilvlParse: 7 },
  { id: "darkboiz", name: "Darkboiz", className: "Shaman", spec: "Restoration", role: "Healer", itemLevel: 296, mechanics: 41, bonus: 53, parse: 97, ilvlParse: 99 },
  { id: "bloodydicc", name: "Bloodydicc", className: "Death Knight", spec: "Blood", role: "Tank", itemLevel: 295, mechanics: 37, bonus: 14, parse: 15, ilvlParse: 17 },
  { id: "kriptar", name: "Kriptar", className: "Warlock", spec: "Destruction", role: "DPS", itemLevel: 303, mechanics: 37, bonus: 52, parse: 13, ilvlParse: 9 },
  { id: "dipp", name: "Dipp", className: "Mage", spec: "Fire", role: "DPS", itemLevel: 306, mechanics: 35, bonus: 81, parse: 82, ilvlParse: 70 },
  { id: "kiggalaw", name: "Kiggalaw", className: "Rogue", spec: "Outlaw", role: "DPS", itemLevel: 297, mechanics: 31, bonus: 58, parse: 22, ilvlParse: 19 },
  { id: "harliquette", name: "Harliquette", className: "Priest", spec: "Shadow", role: "DPS", itemLevel: 289, mechanics: 30, bonus: 42, parse: 5, ilvlParse: 6 },
  { id: "varokk", name: "Varokk", className: "Warrior", spec: "Protection", role: "Tank", itemLevel: 300, mechanics: 30, bonus: 11, parse: 9, ilvlParse: 8 },
  { id: "wethealslut", name: "Wethealslut", className: "Shaman", spec: "Restoration", role: "Healer", itemLevel: 288, mechanics: 29, bonus: 11, parse: 67, ilvlParse: 89 },
  { id: "delver", name: "Delver", className: "Rogue", spec: "Subtlety", role: "DPS", itemLevel: 298, mechanics: 26, bonus: 1, parse: 5, ilvlParse: 5 },
  { id: "badussey", name: "Badussey", className: "Warlock", spec: "Affliction", role: "DPS", itemLevel: 290, mechanics: 26, bonus: 75, parse: 65, ilvlParse: 84 },
  { id: "megalea", name: "Megalea", className: "Paladin", spec: "Holy", role: "Healer", itemLevel: 302, mechanics: 23, bonus: 18, parse: 64, ilvlParse: 61 },
  { id: "akhmornjr", name: "Akhmornjr", className: "Demon Hunter", spec: "Devourer", role: "DPS", itemLevel: 305, mechanics: 21, bonus: 1, parse: 69, ilvlParse: 45 },
];

const pullFacts: Record<string, PullFact> = {
  syflora: { deaths: 1, avoidableDamage: 1046000, dispels: 9, majorCasts: 3, death: ["9:45", 1288554, "Latent Cultist", "Death during the Uncoiled Rage wipe cascade; shown for context, not double-penalized."], warning: ["9:45", 1288554, "Latent Cultist", "575k hit; 1.05m tracked avoidable damage in the pull.", 575000], success: ["0:25", 88423, "Nature's Cure", "First of 9 Essence Rend dispels recorded in the timeline."], utility: ["1:31", 740, "Tranquility", "Major healing cooldown used in Stage One."] },
  alnima: { deaths: 1, avoidableDamage: 2023000, dispels: 0, majorCasts: 0, death: ["9:45", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["4:48", 1289875, "Cremation", "535k hit; 2.02m tracked avoidable damage in the pull.", 535000] },
  zatkyng: { deaths: 1, avoidableDamage: 1570000, dispels: 0, majorCasts: 0, death: ["9:44", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["4:47", 1289875, "Cremation", "419k hit; 1.57m tracked avoidable damage in the pull.", 419000] },
  bluesnakess: { deaths: 1, avoidableDamage: 2002000, dispels: 0, majorCasts: 0, death: ["9:41", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["6:10", 1289875, "Cremation", "514k hit; 2.00m tracked avoidable damage in the pull.", 514000] },
  percypaladin: { deaths: 1, avoidableDamage: 1590000, dispels: 0, majorCasts: 0, death: ["9:37", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["4:47", 1289875, "Cremation", "486k hit; 1.59m tracked avoidable damage in the pull.", 486000] },
  vaelryth: { deaths: 1, avoidableDamage: 1654000, dispels: 0, majorCasts: 0, death: ["9:59", 1292034, "Possession Barrage", "Death after the pull had entered its wipe cascade."], warning: ["6:09", 1289875, "Cremation", "462k hit; 1.65m tracked avoidable damage in the pull.", 462000] },
  illuminoida: { deaths: 1, avoidableDamage: 1196000, dispels: 0, majorCasts: 0, death: ["9:42", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["4:07", 1289875, "Cremation", "357k hit; 1.20m tracked avoidable damage in the pull.", 357000] },
  linguine: { deaths: 1, avoidableDamage: 1502000, dispels: 0, majorCasts: 3, death: ["9:51", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["6:01", 1289875, "Cremation", "596k hit; 1.50m tracked avoidable damage in the pull.", 596000], utility: ["0:32", 51052, "Anti-Magic Zone", "First of 3 major cooldown events recorded."] },
  darkboiz: { deaths: 1, avoidableDamage: 2377000, dispels: 7, majorCasts: 6, death: ["9:51", 1290390, "Soulcoil Well", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["6:10", 1289875, "Cremation", "495k hit; 2.38m tracked avoidable damage in the pull.", 495000], success: ["0:22", 77130, "Purify Spirit", "First of 7 Essence Rend dispels recorded."], utility: ["0:29", 98008, "Spirit Link Totem", "First of 6 major cooldown events recorded."] },
  bloodydicc: { deaths: 1, avoidableDamage: 1511000, dispels: 0, majorCasts: 1, death: ["9:35", 123982, "Purgatory", "Death after Uncoiled Rage began the wipe cascade."], warning: ["4:47", 1289875, "Cremation", "489k hit; 1.51m tracked avoidable damage in the pull.", 489000], utility: ["2:31", 51052, "Anti-Magic Zone", "Raid defensive recorded in Stage One."] },
  kriptar: { deaths: 1, avoidableDamage: 1606000, dispels: 1, majorCasts: 0, death: ["9:39", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["4:48", 1289875, "Cremation", "433k hit; 1.61m tracked avoidable damage in the pull.", 433000], success: ["2:12", 89808, "Singe Magic", "Self-dispelled Essence Rend."] },
  dipp: { deaths: 1, avoidableDamage: 1380000, dispels: 0, majorCasts: 0, death: ["9:43", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["6:01", 1289875, "Cremation", "506k hit; 1.38m tracked avoidable damage in the pull.", 506000] },
  kiggalaw: { deaths: 1, avoidableDamage: 1932000, dispels: 0, majorCasts: 0, death: ["9:39", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["4:43", 1288554, "Latent Cultist", "542k hit; 1.93m tracked avoidable damage in the pull.", 542000] },
  harliquette: { deaths: 1, avoidableDamage: 1461000, dispels: 0, majorCasts: 4, death: ["7:48", 1307939, "Corpse Blight", "First death before the final wipe cascade."], warning: ["4:48", 1289875, "Cremation", "515k hit; 1.46m tracked avoidable damage in the pull.", 515000], utility: ["0:03", 15286, "Vampiric Embrace", "First of 4 major cooldown events recorded."] },
  varokk: { deaths: 3, avoidableDamage: 1172000, dispels: 0, majorCasts: 2, death: ["7:14", 1284109, "Hollowing Strikes", "First death of the pull, before the final wipe cascade."], warning: ["5:21", 1289875, "Cremation", "358k hit; 1.17m tracked avoidable damage in the pull.", 358000], utility: ["2:24", 97462, "Rallying Cry", "First of 2 raid defensive events recorded."] },
  wethealslut: { deaths: 2, avoidableDamage: 2807000, dispels: 8, majorCasts: 6, death: ["8:19", 1288772, "Soulcoil Rite", "Death before the final wipe cascade; Reincarnation followed at 8:26."], warning: ["8:16", 1288554, "Latent Cultist", "542k hit; 2.81m tracked avoidable damage in the pull.", 542000], success: ["0:23", 77130, "Purify Spirit", "First of 8 Essence Rend dispels recorded."], utility: ["1:10", 98008, "Spirit Link Totem", "One of 6 major cooldown events recorded."] },
  delver: { deaths: 1, avoidableDamage: 2449000, dispels: 0, majorCasts: 0, death: ["7:33", 1287434, "Essence Rend", "Death before the final wipe cascade."], warning: ["5:11", 1295085, "Soul Transfer", "605k hit; 2.45m tracked avoidable damage in the pull.", 605000] },
  badussey: { deaths: 1, avoidableDamage: 989000, dispels: 0, majorCasts: 0, death: ["9:47", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["4:46", 1288554, "Latent Cultist", "317k hit; 989k tracked avoidable damage in the pull.", 317000] },
  megalea: { deaths: 1, avoidableDamage: 1005000, dispels: 6, majorCasts: 8, death: ["9:50", 0, "Melee", "Death during the Uncoiled Rage wipe cascade; shown for context."], warning: ["6:01", 1289875, "Cremation", "643k hit; 1.01m tracked avoidable damage in the pull.", 643000], success: ["0:21", 4987, "Cleanse", "First of 6 Essence Rend dispels recorded."], utility: ["1:21", 31821, "Aura Mastery", "One of 8 major cooldown events recorded."] },
  akhmornjr: { deaths: 1, avoidableDamage: 2370000, dispels: 0, majorCasts: 2, death: ["9:33", 1288554, "Latent Cultist", "First death after Uncoiled Rage began the wipe cascade."], warning: ["9:33", 1288554, "Latent Cultist", "684k hit; 2.37m tracked avoidable damage in the pull.", 684000], utility: ["2:46", 196718, "Darkness", "First of 2 raid defensive events recorded."] },
};

function makeEvent(id: string, playerId: string, seed: EventSeed, kind: RaidEvent["kind"], amount?: number): RaidEvent {
  const [timestamp, spellId, ability, detail] = seed;
  return { id, playerId, spellId, ability, kind, detail, timestamp, amount };
}

function buildPlayer(seed: PlayerSeed): PlayerSnapshot {
  const fact = pullFacts[seed.id];
  const performance = scorePerformance(seed.parse, seed.ilvlParse);
  const metric = seed.role === "Healer" ? "healing" : "damage";
  const wins = [
    fact.dispels ? `${fact.dispels} Essence Rend dispels recorded` : null,
    fact.majorCasts ? `${fact.majorCasts} major cooldown events recorded` : null,
    seed.parse >= 50 ? `${seed.parse}th percentile ${metric} parse` : null,
    seed.mechanics >= RAID_MECHANICS_AVERAGE ? `At or above the raid's Wipefest mechanics average` : null,
    seed.bonus >= 40 ? `${seed.bonus} Wipefest bonus points` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    id: seed.id,
    name: seed.name,
    realm: "Dalaran",
    className: seed.className,
    spec: seed.spec,
    role: seed.role,
    itemLevel: seed.itemLevel,
    scores: { mechanics: seed.mechanics, performance, attendance: 100, preparation: null },
    parse: seed.parse,
    ilvlParse: seed.ilvlParse,
    attendanceLabel: "Present · first tracked night",
    prepLabel: "Raid-level only",
    trend: [seed.mechanics],
    summary: `Wipefest scored this pull at ${seed.mechanics} for mechanics. Warcraft Logs shows a ${seed.parse}th percentile ${metric} parse with ${seed.ilvlParse}th percentile item-level context.`,
    wins: wins.length ? wins.slice(0, 3) : ["Present for the deepest progression pull", "Reached Stage Two with the raid"],
    focus: [
      `Reduce ${fact.warning[2]} exposure; ${fact.warning[3]}`,
      seed.mechanics < RAID_MECHANICS_AVERAGE ? `Build from ${seed.mechanics} toward the raid mechanics average of ${RAID_MECHANICS_AVERAGE}` : `Keep mechanics above the raid average of ${RAID_MECHANICS_AVERAGE}`,
    ],
    deaths: fact.deaths,
    interrupts: 0,
    dispels: fact.dispels,
    avoidableDamage: fact.avoidableDamage,
  };
}

const players = playerSeeds.map(buildPlayer);
const events: RaidEvent[] = playerSeeds.flatMap((seed) => {
  const fact = pullFacts[seed.id];
  const [warningTime, warningSpellId, warningAbility, warningDetail, warningAmount] = fact.warning;
  const playerEvents = [
    makeEvent(`${seed.id}-death`, seed.id, fact.death, "death"),
    makeEvent(`${seed.id}-warning`, seed.id, [warningTime, warningSpellId, warningAbility, warningDetail], "warning", warningAmount),
  ];
  if (fact.success) playerEvents.push(makeEvent(`${seed.id}-success`, seed.id, fact.success, "success"));
  if (fact.utility) playerEvents.push(makeEvent(`${seed.id}-utility`, seed.id, fact.utility, "utility"));
  return playerEvents;
});

const allRoles = ["Tank", "Healer", "DPS"];
const heroic = ["Heroic"];
const rules: MechanicRule[] = [
  { id: "nekzali-uncoiled-rage", bossId: BOSS_ID, spellId: 1284034, name: "Uncoiled Rage", category: "Mechanic failure", severity: "Critical", weight: 12, eventType: "cast", difficulties: heroic, roles: allRoles, condition: { countOncePerCast: true, note: "Raid-wide failure when Nek'zali reaches full energy. Wipefest score: 29." } },
  { id: "nekzali-slithering-flame", bossId: BOSS_ID, spellId: 1294933, name: "Slithering Flame", category: "Mechanic failure", severity: "High", weight: 8, eventType: "debuff", difficulties: heroic, roles: allRoles, condition: { countOncePerCast: true, note: "Track spacing when the debuff expires; 18 unnecessary Cremation triggers on the calibration pull." } },
  { id: "nekzali-cremation", bossId: BOSS_ID, spellId: 1289875, name: "Cremation", category: "Avoidable damage", severity: "High", weight: 7, eventType: "damage", difficulties: heroic, roles: allRoles, condition: { minAmount: 1, note: "Damage caused by Slithering Flame proximity failures. Wipefest score: 25." } },
  { id: "nekzali-hungering-pyre", bossId: BOSS_ID, spellId: 1289855, name: "Hungering Pyre", category: "Soak", severity: "Critical", weight: 10, eventType: "damage", difficulties: heroic, roles: allRoles, condition: { countOncePerCast: true, note: "Only 8.8/20 players soaked on average. Wipefest score: 36." } },
  { id: "nekzali-soul-transfer", bossId: BOSS_ID, spellId: 1295085, name: "Soul Transfer", category: "Mechanic failure", severity: "High", weight: 8, eventType: "damage", difficulties: heroic, roles: allRoles, condition: { countOncePerCast: true, note: "One hit on the calibration pull. Wipefest score: 47." } },
  { id: "nekzali-latent-cultist", bossId: BOSS_ID, spellId: 1288554, name: "Latent Cultist", category: "Avoidable damage", severity: "Medium", weight: 5, eventType: "damage", difficulties: heroic, roles: allRoles, condition: { minAmount: 1, note: "7.4m raid-wide avoidable damage. Wipefest score: 62." } },
  { id: "nekzali-essence-rend", bossId: BOSS_ID, spellId: 1287434, name: "Essence Rend", category: "Dispel", severity: "High", weight: 7, eventType: "dispel", difficulties: heroic, roles: ["Healer"], condition: { note: "Average removal time was 4.3s. Wipefest score: 86." } },
  { id: "nekzali-anguished-echoes", bossId: BOSS_ID, spellId: 1294846, name: "Anguished Echoes", category: "Avoidable damage", severity: "High", weight: 7, eventType: "damage", difficulties: heroic, roles: allRoles, condition: { minAmount: 1, note: "Three hits on the calibration pull. Wipefest score: 83." } },
  { id: "nekzali-possession-barrage", bossId: BOSS_ID, spellId: 1292034, name: "Possession Barrage", category: "Avoidable damage", severity: "High", weight: 7, eventType: "damage", difficulties: heroic, roles: allRoles, condition: { countOncePerCast: true, note: "Damage falls as echoes travel farther. Wipefest score: 91." } },
  { id: "nekzali-hollowing-strikes", bossId: BOSS_ID, spellId: 1284109, name: "Hollowing Strikes", category: "Defensive", severity: "Critical", weight: 10, eventType: "death", difficulties: heroic, roles: ["Tank"], condition: { countOncePerCast: true, note: "Tank stack reset and survival check." } },
  { id: "nekzali-gravebound-advance", bossId: BOSS_ID, spellId: 1287533, name: "Gravebound Advance", category: "Mechanic failure", severity: "High", weight: 8, eventType: "debuff", difficulties: heroic, roles: ["DPS"], condition: { note: "Restless Amani took 14.4s on average to break. Wipefest score: 52." } },
];

const performanceAverage = Math.round(players.reduce((sum, player) => sum + (player.scores.performance ?? 0), 0) / players.length);

export const raidData: DashboardData = {
  season: "Midnight · Season 1",
  raidNight: "Friday Progression · Aug 21, 2026",
  reportCode: "YtD1kgCwLv4cJT7n",
  raid: "The Venomous Abyss",
  bosses: [{ id: BOSS_ID, name: "Nek'zali the Soulcoiler" }],
  pulls: [{ id: "fight-13", bossId: BOSS_ID, label: "Wipe 12 · 15% · calibration pull", killed: false, duration: "9:59", difficulty: "Heroic" }],
  players,
  events,
  rules,
  raidAverages: { mechanics: RAID_MECHANICS_AVERAGE, performance: performanceAverage, attendance: 100, preparation: null },
  dataSource: {
    label: "Real raid snapshot",
    detail: "1 of 19 pulls calibrated · Warcraft Logs performance + Wipefest mechanics",
    reportUrl: "https://www.warcraftlogs.com/reports/YtD1kgCwLv4cJT7n?fight=13",
    wipefestUrl: "https://www.wipefest.gg/report/YtD1kgCwLv4cJT7n/fight/13?gameVersion=warcraft-live",
  },
  preparationSummary: "Raid-level result: 16/20 flasks, 13/20 food, 5.2 enchants and 2.1 gems on average. Individual preparation was not exposed publicly.",
  preparationRaid: { flasks: 16, food: 13, total: 20 },
};
