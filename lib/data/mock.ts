import type {
  Boss,
  Character,
  GuildSnapshot,
  SubRaid,
  TierState,
} from "../types";

const voidspireBosses: Boss[] = [
  { name: "Imperator Averzian", slug: "imperator-averzian" },
  { name: "Vorasius", slug: "vorasius" },
  { name: "Fallen-King Salhadaar", slug: "fallenking-salhadaar" },
  { name: "Vaelgor & Ezzorak", slug: "vaelgor-ezzorak" },
  { name: "Lightblinded Vanguard", slug: "lightblinded-vanguard" },
  { name: "Crown of the Cosmos", slug: "crown-of-the-cosmos" },
];
const dreamriftBosses: Boss[] = [
  { name: "Chimaerus the Undreamt God", slug: "chimaerus-the-undreamt-god" },
];
const quelDanasBosses: Boss[] = [
  { name: "Belo'ren, Child of Al'ar", slug: "beloren-child-of-alar" },
  { name: "Midnight Falls", slug: "midnight-falls" },
];
const mockBosses: Boss[] = [
  ...voidspireBosses,
  ...dreamriftBosses,
  ...quelDanasBosses,
];

function buildSubRaids(killed: number): SubRaid[] {
  let cursor = 0;
  const groups: { name: string; bosses: Boss[] }[] = [
    { name: "The Voidspire", bosses: voidspireBosses },
    { name: "The Dreamrift", bosses: dreamriftBosses },
    { name: "March on Quel'Danas", bosses: quelDanasBosses },
  ];
  return groups.map((g) => {
    const subKilled = Math.max(0, Math.min(killed - cursor, g.bosses.length));
    cursor += g.bosses.length;
    return { name: g.name, bosses: g.bosses, killed: subKilled };
  });
}

const mockRosterRaw: Omit<Character, "roleScores">[] = [
  { name: "Brutalis", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "warrior", spec: "Protection", role: "tank", faction: "alliance", ilvl: 642, mythicPlusScore: 3120, rank: "GM", rankNumber: 0 },
  { name: "Lessonia", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "paladin", spec: "Holy", role: "healer", faction: "alliance", ilvl: 638, mythicPlusScore: 2890, rank: "Officer", rankNumber: 1 },
  { name: "Shadowfang", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "rogue", spec: "Assassination", role: "dps", faction: "alliance", ilvl: 641, mythicPlusScore: 3340, rank: "Officer", rankNumber: 1 },
  { name: "Frostmane", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "mage", spec: "Frost", role: "dps", faction: "alliance", ilvl: 639, mythicPlusScore: 3010, rank: "Raider", rankNumber: 2 },
  { name: "Verdantheart", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "druid", spec: "Restoration", role: "healer", faction: "alliance", ilvl: 637, mythicPlusScore: 2780, rank: "Raider", rankNumber: 2 },
  { name: "Ironhide", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "druid", spec: "Guardian", role: "tank", faction: "alliance", ilvl: 640, mythicPlusScore: 2950, rank: "Raider", rankNumber: 2 },
  { name: "Stormcaller", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "shaman", spec: "Elemental", role: "dps", faction: "alliance", ilvl: 636, mythicPlusScore: 2840, rank: "Raider", rankNumber: 2 },
  { name: "Lightwarden", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "priest", spec: "Discipline", role: "healer", faction: "alliance", ilvl: 638, mythicPlusScore: 2910, rank: "Raider", rankNumber: 2 },
  { name: "Voidstalker", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "warlock", spec: "Destruction", role: "dps", faction: "alliance", ilvl: 641, mythicPlusScore: 3180, rank: "Raider", rankNumber: 2 },
  { name: "Trueshot", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "hunter", spec: "Marksmanship", role: "dps", faction: "alliance", ilvl: 639, mythicPlusScore: 3070, rank: "Raider", rankNumber: 2 },
  { name: "Ferakk", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "shaman", spec: "Restoration", role: "healer", faction: "horde", ilvl: 638, mythicPlusScore: 2930, rank: "Raider", rankNumber: 2 },
  { name: "Grommok", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "warrior", spec: "Arms", role: "dps", faction: "horde", ilvl: 637, mythicPlusScore: 2890, rank: "Raider", rankNumber: 2 },
  { name: "Gorthak", realm: "Skullcrusher", realmSlug: "skullcrusher", class: "deathknight", spec: "Blood", role: "tank", faction: "horde", ilvl: 640, mythicPlusScore: 3020, rank: "Raider", rankNumber: 2 },
];

const mockRoster: Character[] = mockRosterRaw.map((c) => ({
  ...c,
  roleScores: {
    tank: c.role === "tank" ? c.mythicPlusScore ?? 0 : 0,
    healer: c.role === "healer" ? c.mythicPlusScore ?? 0 : 0,
    dps: c.role === "dps" ? c.mythicPlusScore ?? 0 : 0,
  },
}));

const mockTiers: TierState[] = [
  {
    raidName: "Midnight Tier",
    difficulty: "Mythic",
    totalBosses: 9,
    killed: 0,
    bosses: mockBosses,
    subRaids: buildSubRaids(0),
  },
  {
    raidName: "Midnight Tier",
    difficulty: "Heroic",
    totalBosses: 9,
    killed: 8,
    bosses: mockBosses,
    subRaids: buildSubRaids(8),
  },
  {
    raidName: "Midnight Tier",
    difficulty: "Normal",
    totalBosses: 9,
    killed: 9,
    bosses: mockBosses,
    subRaids: buildSubRaids(9),
  },
];

export const mockSnapshot: GuildSnapshot = {
  source: "mock",
  fetchedAt: new Date().toISOString(),
  roster: mockRoster,
  tiers: mockTiers,
  rankings: [
    { difficulty: "Mythic", world: 0, region: 0, realm: 0 },
    { difficulty: "Heroic", world: 9154, region: 3672, realm: 25 },
    { difficulty: "Normal", world: 3468, region: 1698, realm: 13 },
  ],
  tierSlug: "tier-mn-1",
  tierExpansionName: "Midnight",
  recentRuns: [],
  weeklyTopRuns: [],
};
