// Front-page "Guild Census" poll questions. Add a new entry here and it
// automatically appears in the cycle on the home page, gets its own storage
// bucket (`poll:<id>`), and validates its own answers — no other code change
// needed. Shared by the client component and the /api/poll route, so keep it
// free of server-only imports.

export type PollOption = {
  /** Stored vote value — keep stable once live, it's the persisted key. */
  value: string;
  /** Ballot button text. */
  label: string;
  /** Ballot button sub-text. */
  blurb: string;
  /** Short label for the results bar. */
  barLabel: string;
  /** Heading for this option's list of voters. */
  wallLabel: string;
  /** Wall heading colour: "good" = faction blue, "bad" = crimson. */
  tone: "good" | "bad";
};

export type PollQuestion = {
  /** URL-safe id; also the Redis bucket suffix. Stable once live. */
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  /** Placeholder for the optional reason box. */
  reasonPrompt: string;
  /** Optional credit — who supplied the question. Rendered as
   *  "Question provided by <credit>". */
  credit?: string;
  options: [PollOption, PollOption];
};

export const POLL_QUESTIONS: PollQuestion[] = [
  {
    id: "string-cheese",
    eyebrow: "Guild Census",
    title: "How do you eat your string cheese?",
    subtitle:
      "It is called STRING cheese. The name is instructions. Some of you bite into it anyway.",
    reasonPrompt: "Justify it to the raid…",
    credit: "Totemtartt",
    options: [
      {
        value: "peel",
        label: "I peel it",
        blurb: "One strand at a time. As intended.",
        barLabel: "Peel it",
        wallLabel: "Certified Peelers",
        tone: "good",
      },
      {
        value: "bite",
        label: "I bite into it",
        blurb: "Straight through the middle, like an animal.",
        barLabel: "Bite into it",
        wallLabel: "Animals",
        tone: "bad",
      },
    ],
  },
  {
    id: "feet",
    eyebrow: "Guild Census",
    title: "Do you actually wash your feet?",
    subtitle:
      "In the shower — do you scrub them, or just let the water run down and call it clean? The guild is watching.",
    reasonPrompt: "Defend your hygiene in court…",
    credit: "Step Bro Nimueh",
    options: [
      {
        value: "wash",
        label: "I scrub them",
        blurb: "Soap. Hands. Actual effort.",
        barLabel: "Scrub them",
        wallLabel: "Certified Clean",
        tone: "good",
      },
      {
        value: "drain",
        label: "I let the water run down",
        blurb: "Gravity does the work, apparently.",
        barLabel: "Let it run down",
        wallLabel: "Wall of Shame",
        tone: "bad",
      },
    ],
  },
];

export function getPollQuestion(id: string): PollQuestion | undefined {
  return POLL_QUESTIONS.find((q) => q.id === id);
}
