import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRedis } from "@/lib/announce-store";
import { simulateMoos } from "@/lib/moo";

/**
 * LOCAL-ONLY: shows the next ~50 moos the channel would post, using the EXACT
 * same logic as buildMooPost + /api/moo (simulateMoos runs the real render-roll,
 * image rotation, caption picker + dedup — read-only, never touches the live
 * channel). Cow images are CSP-blocked in-browser, so they're fetched + inlined
 * as data URIs here; the render URL is CSP-allowed and used directly. Each load
 * re-rolls a fresh 50. noindex + dev-only.
 */
export const metadata: Metadata = {
  title: "Next 50 Moos (demo)",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

// Light Discord-markdown: render **bold** spans.
function renderText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export default async function MooNext50Page() {
  if (process.env.NODE_ENV === "production") notFound();

  const moos = await simulateMoos(getRedis(), 50);

  // Images load directly in the browser (cow URLs are now CSP-allowed) — no
  // server-side inlining, so the page stays light and reliable.
  const cows = moos.filter((m) => m.kind === "cow").length;
  const renders = moos.length - cows;
  const distinctImages = new Set(moos.map((m) => m.imageUrl)).size;
  const distinctCaptions = new Set(moos.map((m) => m.text)).size;
  // Computed straight from the data array (authoritative — not parsed from HTML).
  const renderPositions = moos
    .map((m, i) => (m.kind === "render" ? i + 1 : 0))
    .filter(Boolean);
  const renderGaps = renderPositions
    .slice(1)
    .map((p, i) => p - renderPositions[i]);

  return (
    <section className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <p
        className="font-display text-xs uppercase tracking-[0.4em]"
        style={{ color: "var(--faction-fg)" }}
      >
        Demo · local only
      </p>
      <h1 className="mt-2 font-display text-4xl font-bold">Next 50 Moos</h1>
      <p className="mt-3 text-sm text-muted">
        Simulated with the real picker (rotation + caption + dedup), read-only —
        does not touch the live channel. Reload to roll a fresh 50.
      </p>

      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border bg-background p-4 text-sm">
        <span>🐄 cows: <b>{cows}</b></span>
        <span>🧍 renders: <b>{renders}</b></span>
        <span>
          distinct images:{" "}
          <b style={{ color: distinctImages === moos.length ? "#6aa84f" : "#e23b3b" }}>
            {distinctImages}/{moos.length}
          </b>
        </span>
        <span>
          distinct captions:{" "}
          <b style={{ color: distinctCaptions === moos.length ? "#6aa84f" : "#e23b3b" }}>
            {distinctCaptions}/{moos.length}
          </b>
        </span>
      </div>

      <div
        className="mt-2 rounded-lg border border-border bg-background p-4 text-sm"
        data-render-positions={renderPositions.join(",")}
        data-render-gaps={renderGaps.join(",")}
      >
        🧍 render lands at post: <b>{renderPositions.join(", ") || "none"}</b>
        {renderGaps.length > 0 && (
          <>
            {" "}· gaps of <b>{renderGaps.join(", ")}</b> posts
          </>
        )}
        <span className="ml-1 text-muted">
          (weekly grace = ~14 posts apart at twice-daily)
        </span>
      </div>

      <ol className="mt-6 space-y-3">
        {moos.map((m, i) => {
          const src = m.imageUrl;
          return (
            <li
              key={i}
              className="overflow-hidden rounded-lg border border-border bg-background"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted">
                <span>#{i + 1}</span>
                <span style={{ color: m.kind === "render" ? "#e8c15a" : "var(--faction-fg)" }}>
                  {m.kind === "render" ? "🧍 render (portrait)" : "🐄 cow"}
                </span>
              </div>
              <div className="flex gap-3 p-3">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-surface text-[10px] text-muted">
                    img n/a
                  </div>
                )}
                <p className="text-sm leading-snug text-foreground/90">
                  {renderText(m.text)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
