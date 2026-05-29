"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SessionProvider,
  signIn,
  signOut,
  useSession,
} from "next-auth/react";
import { POLL_QUESTIONS, type PollOption } from "@/lib/poll-questions";

type Voter = { name: string; image: string | null; reason: string; ts: number };
type Results = {
  configured: boolean;
  questionId: string;
  counts: Record<string, number>;
  total: number;
  lists: Record<string, Voter[]>;
  you: string | null;
  yourReason?: string;
};

const REASON_MAX = 280;

function DiscordMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 127.14 96.36"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M107.7 8.07A105.15 105.15 0 0081.47 0a72.06 72.06 0 00-3.36 6.83 97.68 97.68 0 00-29.11 0A72.37 72.37 0 0045.64 0a105.89 105.89 0 00-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0032.17 16.15 77.7 77.7 0 006.89-11.11 68.42 68.42 0 01-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0064.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 01-10.87 5.19 77 77 0 006.89 11.1 105.25 105.25 0 0032.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z" />
    </svg>
  );
}

function pct(n: number, total: number) {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

// A single clickable poll bar: the answer button and the result tally are
// the same element. A background fill shows the option's share; clicking it
// casts (or changes) the vote.
function OptionBar({
  option,
  count,
  total,
  chosen,
  disabled,
  onClick,
}: {
  option: PollOption;
  count: number;
  total: number;
  chosen: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const p = pct(count, total);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="relative w-full overflow-hidden rounded-lg border bg-surface/40 px-4 py-2.5 text-left transition disabled:cursor-not-allowed enabled:hover:border-faction"
      style={{ borderColor: chosen ? "var(--faction)" : "var(--border)" }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 transition-[width] duration-500"
        style={{
          width: `${p}%`,
          background: chosen
            ? "var(--faction-soft)"
            : "color-mix(in srgb, var(--faction-soft) 45%, transparent)",
        }}
      />
      <span className="relative flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-medium">{option.label}</span>
          <span className="block truncate text-xs text-muted">
            {option.blurb}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {chosen && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
              style={{ background: "var(--faction)" }}
            >
              You
            </span>
          )}
          <span className="tabular-nums text-sm font-semibold">
            {count} · {p}%
          </span>
        </span>
      </span>
    </button>
  );
}

function Wall({ option, voters }: { option: PollOption; voters: Voter[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3">
      <p
        className="font-display text-xs uppercase tracking-[0.3em]"
        style={{
          color: option.tone === "bad" ? "#e8a8a8" : "var(--faction-fg)",
        }}
      >
        {option.wallLabel}{" "}
        <span className="text-muted/50">({voters.length})</span>
      </p>
      {voters.length === 0 ? (
        <p className="mt-2 text-xs text-muted/70">No one yet.</p>
      ) : (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {voters.map((v, i) => (
            <li
              key={`${v.name}-${i}`}
              className="group relative flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 py-0.5 pl-0.5 pr-2.5"
            >
              {v.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={v.image}
                  alt=""
                  className="h-5 w-5 rounded-full"
                  width={20}
                  height={20}
                />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-border text-[9px] font-semibold">
                  {v.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="text-xs">{v.name}</span>
              {v.reason && (
                <>
                  <span aria-hidden className="text-[10px] text-muted/50">
                    💬
                  </span>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-56 max-w-[80vw] -translate-x-1/2 rounded-md border border-faction/60 bg-background p-2.5 text-xs leading-relaxed text-foreground shadow-xl group-hover:block"
                  >
                    “{v.reason}”
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Census() {
  const { data: session, status } = useSession();
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Results | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // Track which question the reason box was pre-filled for, so switching
  // questions re-prefills but a background re-fetch doesn't clobber typing.
  const reasonInitFor = useRef<string | null>(null);

  const question = POLL_QUESTIONS[index];
  const count = POLL_QUESTIONS.length;

  // Load tallies for the current question on mount and whenever the question
  // or auth state changes. setState lives inside the promise chain (not the
  // synchronous effect body); an `active` flag drops a stale request.
  useEffect(() => {
    if (status === "loading") return;
    let active = true;
    fetch(`/api/poll?q=${encodeURIComponent(question.id)}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        const r = data as Results;
        setResults(r);
        if (reasonInitFor.current !== question.id) {
          setReason(r.yourReason ?? "");
          reasonInitFor.current = question.id;
        }
      })
      .catch(() => {
        /* network hiccup — keep prior state, the page still renders */
      });
    return () => {
      active = false;
    };
  }, [status, question.id]);

  const go = useCallback((dir: number) => {
    setIndex((i) => (i + dir + POLL_QUESTIONS.length) % POLL_QUESTIONS.length);
    setResults(null);
    setReason("");
    setError(null);
    reasonInitFor.current = null;
  }, []);

  const vote = useCallback(
    async (answer: string) => {
      setPending(true);
      setError(null);
      try {
        const res = await fetch("/api/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: question.id, answer, reason }),
        });
        const data = await res.json();
        if (!res.ok) setError(data.error ?? "Something went wrong.");
        else setResults(data as Results);
      } catch {
        setError("Couldn’t reach the census. Try again.");
      } finally {
        setPending(false);
      }
    },
    [question.id, reason],
  );

  const total = results?.total ?? 0;
  const you = results?.you ?? null;
  const authed = status === "authenticated";
  const savedReason = results?.yourReason ?? "";
  // Unsaved edits in the reason box — drives the green "Save note" reminder.
  const reasonDirty = reason !== savedReason;

  return (
    <section className="border-b border-border bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p
                className="font-display text-xs uppercase tracking-[0.4em]"
                style={{ color: "var(--faction-fg)" }}
              >
                {question.eyebrow}
              </p>
              <span className="text-[11px] text-muted">
                Hover a voter to read their excuse 💬
              </span>
            </div>
            <h2 className="mt-2 font-display text-3xl font-semibold">
              {question.title}
            </h2>
            <p className="mt-2 text-sm text-muted">{question.subtitle}</p>
            {question.credit && (
              <p className="mt-1.5 text-xs italic text-muted/70">
                Question provided by {question.credit}
              </p>
            )}
          </div>

          {/* Question cycler — appears as soon as there's more than one. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous question"
              onClick={() => go(-1)}
              disabled={count <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border transition enabled:hover:border-faction disabled:opacity-30"
            >
              ‹
            </button>
            <span className="text-xs tabular-nums text-muted">
              {index + 1} / {count}
            </span>
            <button
              type="button"
              aria-label="Next question"
              onClick={() => go(1)}
              disabled={count <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border transition enabled:hover:border-faction disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-stretch">
          {/* Ballot. Both columns share a header row + a flex-1 input, so
              the options block and the textarea line up top AND bottom. */}
          <div className="flex flex-col">
            <p className="flex h-7 items-center text-xs uppercase tracking-wider text-muted">
              Your answer
            </p>
            <div className="mt-1.5 flex flex-1 flex-col gap-2.5">
              {question.options.map((o) => (
                <OptionBar
                  key={o.value}
                  option={o}
                  count={results?.counts[o.value] ?? 0}
                  total={total}
                  chosen={you === o.value}
                  disabled={!authed || pending}
                  onClick={() => vote(o.value)}
                />
              ))}
            </div>
          </div>

          {/* Reasoning — only meaningful once logged in. Save + count live in
              the label row (top-right). */}
          {authed ? (
            <div className="flex flex-col">
              <div className="flex h-7 items-center justify-between gap-3">
                <label
                  htmlFor="poll-reason"
                  className="text-xs uppercase tracking-wider text-muted"
                >
                  Care to explain yourself? (optional)
                </label>
                <div className="flex items-center gap-3">
                  {you && (
                    <button
                      type="button"
                      onClick={() => vote(you)}
                      disabled={pending || !reasonDirty}
                      className="rounded-md border px-2.5 py-1 text-xs font-medium transition enabled:hover:opacity-90 disabled:cursor-default"
                      style={
                        reasonDirty
                          ? {
                              background: "#22c55e",
                              borderColor: "#22c55e",
                              color: "#052e16",
                            }
                          : {
                              borderColor: "var(--border)",
                              color: "var(--fg-muted)",
                            }
                      }
                    >
                      {reasonDirty ? "Save note" : "Note saved"}
                    </button>
                  )}
                  <span className="shrink-0 text-[10px] text-muted/60">
                    {reason.length}/{REASON_MAX}
                  </span>
                </div>
              </div>
              <textarea
                id="poll-reason"
                value={reason}
                maxLength={REASON_MAX}
                disabled={pending}
                onChange={(e) => setReason(e.target.value)}
                placeholder={question.reasonPrompt}
                className="achievements-scroll mt-1.5 min-h-[6rem] w-full flex-1 resize-none rounded-lg border border-border bg-surface/40 px-3 py-2 text-sm outline-none focus:border-faction"
              />
              {!you && (
                <p className="mt-1.5 text-[10px] text-muted/60">
                  Pick an answer to cast your vote &amp; save your note.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="hidden h-7 lg:block" aria-hidden />
              <div className="mt-1.5 flex flex-1 items-center rounded-lg border border-dashed border-border/70 bg-surface/20 p-4 text-sm text-muted">
                Log in with Discord to cast your vote and leave an excuse for
                the guild to mock.
              </div>
            </div>
          )}
        </div>

        {/* Status line — full width below so the textarea matches just the
            two options above, not this row. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
          <span className="text-xs text-muted/70">
            {total === 0
              ? "No votes yet. Be the first to confess."
              : `${total} ${total === 1 ? "vote" : "votes"} cast.`}
          </span>
          {status === "loading" ? null : authed ? (
            <span className="text-xs text-muted">
              Voting as{" "}
              <span className="text-foreground">{session?.user?.name}</span>
              {" · "}
              <button
                type="button"
                onClick={() => signOut()}
                className="underline underline-offset-2 hover:text-foreground"
              >
                not you?
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => signIn("discord")}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
              style={{ background: "#5865F2" }}
            >
              <DiscordMark className="h-4 w-4" />
              Log in with Discord
            </button>
          )}
        </div>

        {results !== null && !results.configured && (
          <p className="mt-2 text-xs text-muted/70">
            The census opens the moment vote storage is connected.
          </p>
        )}
        {error && <p className="mt-2 text-sm text-[#e8a8a8]">{error}</p>}

        {/* Walls — full width below so names spread horizontally and the
            section stays short. */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {question.options.map((o) => (
            <Wall
              key={o.value}
              option={o}
              voters={results?.lists[o.value] ?? []}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export function FootPoll() {
  return (
    <SessionProvider>
      <Census />
    </SessionProvider>
  );
}
