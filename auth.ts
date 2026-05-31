import NextAuth, { type DefaultSession } from "next-auth";
import Discord from "next-auth/providers/discord";

// LIB Discord server id. Sign-in is gated on membership of this server, so
// only people actually in the guild can log in and vote. Set in .env.local
// (local) and Vercel env (prod). If unset, the gate is skipped — a dev
// convenience, never the case in production.
const GUILD_ID = process.env.LIB_DISCORD_GUILD_ID;

// Comma-separated Discord role ids allowed to vote (Raider / Member /
// Officer / Guild Master). Anyone with the Administrator permission on the
// server is allowed regardless of role. Kept in env so the role list can
// change without a code edit.
const ALLOWED_ROLE_IDS = new Set(
  (process.env.LIB_ALLOWED_ROLE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Expose the stable Discord user id on the session so API routes can key
// votes by it (one Discord account = one vote). Without a database adapter,
// Auth.js sets `token.sub` to a random UUID — NOT the Discord id — so we
// capture the real id from the OAuth account at sign-in and carry it on the
// JWT as `discordId`, surfacing it as `session.user.id`.
declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

// The JWT carries the captured Discord id between sign-in and later requests.
type TokenWithDiscord = { discordId?: string; sub?: string };

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Vercel sets the deployment host dynamically; trustHost lets Auth.js
  // accept it without a hardcoded AUTH_URL.
  trustHost: true,
  providers: [
    Discord({
      clientId: process.env.AUTH_DISCORD_ID,
      clientSecret: process.env.AUTH_DISCORD_SECRET,
      // `identify` = name + avatar; `guilds.members.read` = the user's member
      // record (roles) within the LIB server, which doubles as the membership
      // check. We intentionally DON'T request `guilds` (the full server list)
      // — the member endpoint alone tells us everything we need.
      authorization: {
        params: { scope: "identify guilds.members.read" },
      },
    }),
  ],
  callbacks: {
    // Gate sign-in to real LIB members. We fetch the user's member record
    // for the LIB server: if the request fails they're not in the server
    // (rejected); otherwise we check their roles against the allowlist.
    // Admins are covered because the Discord Admin role id is in the list.
    async signIn({ account }) {
      if (!GUILD_ID) return true;
      const token = account?.access_token;
      if (!token) return false;
      try {
        const res = await fetch(
          `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return false; // not a member of the LIB server
        // No allowed roles configured → membership alone is enough.
        if (ALLOWED_ROLE_IDS.size === 0) return true;
        const member = (await res.json()) as { roles?: string[] };
        return (member.roles ?? []).some((r) => ALLOWED_ROLE_IDS.has(r));
      } catch {
        return false;
      }
    },
    // `account` is only present on the initial sign-in; capture the Discord
    // user id (a stable snowflake) onto the token so it persists for the
    // life of the session.
    async jwt({ token, account }) {
      if (account?.providerAccountId) {
        (token as TokenWithDiscord).discordId = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      const t = token as TokenWithDiscord;
      // Key strictly on the stable Discord snowflake. We deliberately do NOT
      // fall back to `t.sub` — without a DB adapter that's a RANDOM UUID, so
      // the same account could end up keyed by a UUID on one session and by
      // the snowflake on another, producing a duplicate vote (one person,
      // two entries). If `discordId` is somehow absent (e.g. a stale cookie
      // from before this capture existed), leave the id empty so the poll
      // route rejects the vote and the user re-logs in to get a real id —
      // better than silently minting a phantom identity.
      if (session.user) session.user.id = t.discordId ?? "";
      return session;
    },
  },
});
