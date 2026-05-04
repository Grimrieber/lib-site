/**
 * Editable copy + open recruitment spots.
 */

export const OPEN_SPOTS = [
  { role: "Tank", spec: "Any Tank" },
  { role: "Healer", spec: "Resto Shaman" },
  { role: "DPS", spec: "Boomkin" },
  { role: "DPS", spec: "Aug Evoker" },
] as const;

/**
 * The three players who co-lead the guild. Each entry's `mainName` should
 * exactly match a character on the roster (used to look up class color,
 * avatar, etc.). Listed in display order on the About page.
 */
export const LEADERSHIP: { mainName: string; title: string; blurb?: string }[] = [
  { mainName: "Giaus", title: "Co-Leader" },
  { mainName: "Anorxxorcist", title: "Co-Leader" },
  { mainName: "Kujatas", title: "Co-Leader" },
];

export const ABOUT = {
  intro: [
    "Lessons in Brutality is a long-running raiding guild on Skullcrusher (US-Alliance), pushing Heroic and Mythic progression while staying active in Mythic+ between tiers.",
    "We've been around since Vanilla raids through Sepulcher, Aberrus, Nerub-ar Palace, Manaforge Omega, and the current Midnight tier. Our roster shows up, has laughs, and raids as a team.",
  ],
  schedule: [
    { day: "Tuesday", time: "8:00–10:00 PM Server", note: "Raid night" },
    { day: "Thursday", time: "8:00–10:00 PM Server", note: "Raid night" },
    {
      day: "Flex",
      time: "Alt Heroic Raid",
      note: "Organized with guildies for fun in the sun",
    },
  ],
  scheduleNote: undefined,
  lootRules: [
    {
      title: "Personal Loot",
      body: "Personal loot is the default — drops go to whoever the game assigns them to.",
    },
    {
      title: "Trinkets & Unique Drops",
      body: "Trinkets and super unique boss drops go to dedicated raiders first — frequency on raid nights matters more than one-off appearances.",
    },
  ],
  lootRulesNote: undefined,
} as const;

/** Used on the About page's "The Guild" stats grid. */
export const FACTION_DESCRIPTION = "Alliance with some Horde sprinkled in";
