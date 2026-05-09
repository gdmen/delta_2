/**
 * Auth.js v5 mounts its handlers at /api/auth/* via the catch-all
 * route. The full provider config (credentials, Google, JWT,
 * adapter, callbacks) lives in src/lib/auth/config.ts; this file
 * just re-exports the handlers Auth.js generated.
 *
 * Endpoints exposed by this route (Auth.js standard shapes):
 *   - GET  /api/auth/csrf
 *   - GET  /api/auth/providers
 *   - GET  /api/auth/session
 *   - GET  /api/auth/signin
 *   - POST /api/auth/signin/credentials
 *   - GET  /api/auth/signin/google
 *   - GET  /api/auth/callback/google
 *   - POST /api/auth/signout
 *
 * Custom signup (invite-code-gated) is at /api/auth/signup — see
 * src/app/api/auth/signup/route.ts.
 *
 * Custom signout (denylists the JWT jti before delegating to
 * Auth.js's signOut) is at /api/auth/signout — see
 * src/app/api/auth/signout/route.ts. NOTE: the custom signout
 * shadows the default Auth.js signout for this app — the Auth.js
 * handler is still mounted but our custom one runs first.
 */
import { handlers } from "@/lib/auth/config";

export const { GET, POST } = handlers;
