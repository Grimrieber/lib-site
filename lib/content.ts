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
    "Lessons in Brutality is a long-standing raiding guild on World of Warcraft (Skullcrusher — US Alliance), focused on Heroic and Mythic progression while staying active in Mythic+ throughout the tier.",
    "Founded in 2006, we've built a stable core that has been consistently raiding together since Shadowlands and continues through current content. Our team shows up prepared, takes feedback seriously, and treats raid time with purpose.",
    "We consider ourselves a casual-leaning but progression-minded guild. That means we value a relaxed, respectful environment, but we also hold a clear standard when it comes to performance, attendance, and preparation. Raiders are expected to come ready, communicate absences, and actively work to improve. When those standards aren't met, we will make roster adjustments to keep the team moving forward.",
    "At our core, we're a group that enjoys playing together, improving together, and clearing content without unnecessary drama.",
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
