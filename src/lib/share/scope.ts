import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-render scope for the /share/[token] view. The plan's eng-review
 * HIGH finding flagged that "every server query in this codepath
 * uses the dashboard owner's user_id" was a fragile convention —
 * one forgotten query in a widget renderer could leak the viewer's
 * own data into the public page (or worse, leak the owner's data
 * across users via a query that pulled session-derived ids).
 *
 * The fix: a per-render AsyncLocalStorage that wraps the share-page
 * render. Inside the scope, `getShareContext()` returns the owner's
 * user_id and any code path that reaches for `auth()` / session.user
 * is wrong — call sites should pull from this scope instead.
 *
 * Usage:
 *
 *   // share/[token]/page.tsx
 *   await runInShareScope({ ownerId, token, ownerName }, async () => {
 *     return renderDashboard(...);
 *   });
 *
 *   // anywhere inside (widget renderers, lib functions):
 *   const ctx = getShareContext();
 *   if (ctx) {
 *     // we're rendering a public share — use ctx.ownerId, NEVER session.user
 *   }
 */
export interface ShareContext {
  ownerId: number;
  token: string;
  ownerName: string;
}

const storage = new AsyncLocalStorage<ShareContext>();

export function runInShareScope<T>(
  ctx: ShareContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Returns the share context if the current async stack is inside a
 * share-page render, otherwise undefined. Call from anywhere on the
 * server — widget renderers, lib functions, etc.
 */
export function getShareContext(): ShareContext | undefined {
  return storage.getStore();
}

/**
 * Convenience: returns the OWNER's user_id when inside a share scope,
 * otherwise the supplied fallback (typically the signed-in user's id).
 *
 *   const userId = effectiveUserId(session.user.id);
 *
 * Lib functions that take userId as an arg can call this at their
 * boundary so the same code path serves both signed-in renders and
 * share-link renders without each caller having to remember the
 * branch.
 */
export function effectiveUserId(fallback: number): number {
  return getShareContext()?.ownerId ?? fallback;
}
