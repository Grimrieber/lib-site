import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { auth } from "@/auth";
import {
  getPollQuestion,
  POLL_QUESTIONS,
  type PollQuestion,
} from "@/lib/poll-questions";

// Guild Census poll.
//
// Storage model: one Redis hash per question, `poll:<questionId>`, mapping
// the voter's Discord user id -> their vote. Keying by Discord id means one
// account = one vote per question: re-voting OVERWRITES the field, so
// spam-clicking can't inflate the tally and changing your mind just updates
// your single entry.
//
// Until Upstash is connected (KV_REST_API_* / UPSTASH_REDIS_REST_* env), GET
// returns an empty `configured: false` payload and POST 503s — so the page
// renders fine pre-setup instead of crashing.

export const dynamic = "force-dynamic";

const REASON_MAX = 280;

type Vote = {
  answer: string;
  name: string;
  image: string | null;
  reason: string;
  ts: number;
};

type Voter = { name: string; image: string | null; reason: string; ts: number };

function getRedis(): Redis | null {
  // Accept either naming convention: the Vercel↔Upstash integration injects
  // KV_REST_API_URL / KV_REST_API_TOKEN, while a plain Upstash account uses
  // UPSTASH_REDIS_REST_URL / _TOKEN. Support both so the same code runs
  // locally and in production regardless of how the keys were provisioned.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const keyFor = (id: string) => `poll:${id}`;

function aggregate(votes: Record<string, Vote>, question: PollQuestion) {
  const lists: Record<string, Voter[]> = {};
  for (const o of question.options) lists[o.value] = [];
  for (const v of Object.values(votes)) {
    lists[v.answer]?.push({
      name: v.name,
      image: v.image,
      reason: v.reason ?? "",
      ts: v.ts,
    });
  }
  const counts: Record<string, number> = {};
  let total = 0;
  for (const o of question.options) {
    // Most recent first, so the freshest call-outs surface at the top.
    lists[o.value].sort((a, b) => b.ts - a.ts);
    counts[o.value] = lists[o.value].length;
    total += counts[o.value];
  }
  return { counts, total, lists };
}

function emptyPayload(question: PollQuestion) {
  const counts: Record<string, number> = {};
  const lists: Record<string, Voter[]> = {};
  for (const o of question.options) {
    counts[o.value] = 0;
    lists[o.value] = [];
  }
  return {
    configured: false,
    questionId: question.id,
    counts,
    total: 0,
    lists,
    you: null,
    yourReason: "",
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const question =
    getPollQuestion(searchParams.get("q") ?? "") ?? POLL_QUESTIONS[0];

  const redis = getRedis();
  if (!redis) return NextResponse.json(emptyPayload(question));

  const session = await auth();
  const votes =
    (await redis.hgetall<Record<string, Vote>>(keyFor(question.id))) ?? {};
  const mine = session?.user?.id ? votes[session.user.id] : undefined;
  return NextResponse.json({
    configured: true,
    questionId: question.id,
    ...aggregate(votes, question),
    you: mine?.answer ?? null,
    yourReason: mine?.reason ?? "",
  });
}

export async function POST(req: Request) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "Voting isn’t wired up yet — storage isn’t connected." },
      { status: 503 },
    );
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Log in with Discord to vote." },
      { status: 401 },
    );
  }

  let body: { questionId?: unknown; answer?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const question = getPollQuestion(
    typeof body.questionId === "string" ? body.questionId : "",
  );
  if (!question) {
    return NextResponse.json({ error: "Unknown question." }, { status: 400 });
  }
  const answer = typeof body.answer === "string" ? body.answer : "";
  if (!question.options.some((o) => o.value === answer)) {
    return NextResponse.json(
      { error: "Pick one of the answers." },
      { status: 400 },
    );
  }
  const reason =
    typeof body.reason === "string"
      ? body.reason.trim().slice(0, REASON_MAX)
      : "";

  const vote: Vote = {
    answer,
    name: session.user.name ?? "Unknown",
    image: session.user.image ?? null,
    reason,
    ts: Date.now(),
  };
  await redis.hset(keyFor(question.id), { [session.user.id]: vote });

  const votes =
    (await redis.hgetall<Record<string, Vote>>(keyFor(question.id))) ?? {};
  return NextResponse.json({
    configured: true,
    questionId: question.id,
    ...aggregate(votes, question),
    you: answer,
    yourReason: reason,
  });
}
