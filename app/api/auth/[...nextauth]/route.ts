import { handlers } from "@/auth";

// Auth.js mounts its full OAuth flow (login, callback, session, signout)
// under /api/auth/* via these two handlers.
export const { GET, POST } = handlers;
