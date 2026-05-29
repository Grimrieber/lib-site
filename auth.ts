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

// Discord's ADMINISTRATOR permission bit (0x8), present in the `permissions`
// field of each entry returned by /users/@me/guilds.
const ADMINISTRATOR = BigInt(8);

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
      // `identify` = name + avatar; `guilds` = the user's server list (for
      // the membership + admin check); `guilds.members.read` = the user's
      // roles within LIB (for the role check).
      authorization: {
        params: { scope: "identify guilds guilds.members.read" },
      },
    }),
  ],
  callbacks: {
    // Gate sign-in to real LIB members. Auth.js hands us the freshly minted
    // access token here; we use it to confirm (a) they're in the LIB server,
    // and (b) they're either a server Administrator or hold one of the
    // allowed roles. Returning false rejects the login.
    async signIn({ account }) {
      if (!GUILD_ID) return true;
      const token = account?.access_token;
      if (!token) return false;
      const headers = { Authorization: `Bearer ${token}` };
      try {
        // Must be a member of the LIB server.
        const guildsRes = await fetch(
          "https://discord.com/api/users/@me/guilds",
          { headers },
        );
        if (!guildsRes.ok) return false;
        const guilds = (await guildsRes.json()) as {
          id: string;
          permissions?: string;
        }[];
        const lib = guilds.find((g) => g.id === GUILD_ID);
        if (!lib) return false;

        // Server admins always pass.
        if (lib.permissions) {
          try {
            if ((BigInt(lib.permissions) & ADMINISTRATOR) === ADMINISTRATOR) {
              return true;
            }
          } catch {
            /* malformed permissions string — fall through to role check */
          }
        }

        // No allowed roles configured → membership alone is enough.
        if (ALLOWED_ROLE_IDS.size === 0) return true;

        // Otherwise require one of the allowed roles.
        const memberRes = await fetch(
          `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
          { headers },
        );
        if (!memberRes.ok) return false;
        const member = (await memberRes.json()) as { roles?: string[] };
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
      if (session.user) session.user.id = t.discordId ?? t.sub ?? "";
      return session;
    },
  },
});
