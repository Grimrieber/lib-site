/**
 * Central time is the guild's one and only timezone — a HARD RULE. Every
 * absolute timestamp shown anywhere on the site is formatted through here so it
 * reads the same for everyone, regardless of the server's timezone (Vercel runs
 * in UTC) or the viewer's local timezone.
 *
 * Uses the America/Chicago zone, which observes DST — so it correctly shows
 * CDT in summer and CST in winter (the guild's area adopts both). The label
 * (CDT/CST) comes from the zone automatically; never hardcode one.
 *
 * - formatCstDate      -> "Jun 25"            (or "Jun 25, 2026" with year)
 * - formatCstDateTime  -> "Jun 25, 4:33 AM CDT"   (CST in winter)
 * - cstDayIndex        -> Central calendar-day number, for relative "X days ago"
 *                         diffs anchored to Central instead of server/viewer time
 */

const ZONE = "America/Chicago";
const MON = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type DateInput = number | string | Date;

function toDate(input: DateInput): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Jun 25" — Central calendar date. Pass `{ withYear: true }` for "Jun 25, 2026". */
export function formatCstDate(
  input: DateInput,
  opts: { withYear?: boolean } = {},
): string {
  const d = toDate(input);
  if (!d) return "";
  return d.toLocaleString("en-US", {
    timeZone: ZONE,
    month: "short",
    day: "numeric",
    ...(opts.withYear ? { year: "numeric" } : {}),
  });
}

/** "Jun 25, 4:33 AM CDT" — Central date + time, with the live CST/CDT label. */
export function formatCstDateTime(input: DateInput): string {
  const d = toDate(input);
  if (!d) return "";
  return d.toLocaleString("en-US", {
    timeZone: ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Central calendar-day index (whole days since the epoch, in Central). Diff two
 *  of these for a DST-correct "X days ago" that rolls over at Central midnight. */
export function cstDayIndex(input: DateInput): number {
  const d = toDate(input);
  if (!d) return 0;
  // Read the Central calendar Y-M-D, then turn it into a stable day number.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.floor(Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000);
}
