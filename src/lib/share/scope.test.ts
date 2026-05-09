import { describe, expect, it } from "vitest";
import {
  effectiveUserId,
  getShareContext,
  runInShareScope,
} from "./scope";

/**
 * The AsyncLocalStorage scope is the eng-review HIGH defense against
 * accidental session-leak inside the /share/[token] render. Pin the
 * core invariants:
 *
 *   - getShareContext returns undefined outside a runInShareScope.
 *   - getShareContext returns the right ctx INSIDE the scope.
 *   - The scope nests through async boundaries (Promise.all, await).
 *   - Two simultaneous render scopes don't cross-contaminate.
 *   - effectiveUserId routes to ownerId inside scope, fallback outside.
 */
describe("share scope (AsyncLocalStorage)", () => {
  it("getShareContext is undefined outside the scope", () => {
    expect(getShareContext()).toBeUndefined();
  });

  it("getShareContext returns the ctx INSIDE the scope", async () => {
    const ctx = { ownerId: 42, token: "tok", ownerName: "Alice" };
    const seen = await runInShareScope(ctx, async () => getShareContext());
    expect(seen).toEqual(ctx);
  });

  it("scope is preserved across awaited boundaries", async () => {
    const ctx = { ownerId: 7, token: "t", ownerName: "Bob" };
    const result = await runInShareScope(ctx, async () => {
      // Cross several awaits + a Promise.all to exercise async-hook
      // propagation.
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 5));
      const [a, b] = await Promise.all([
        Promise.resolve().then(() => getShareContext()?.ownerId),
        Promise.resolve().then(() => getShareContext()?.ownerId),
      ]);
      return [a, b];
    });
    expect(result).toEqual([7, 7]);
  });

  it("two concurrent scopes don't cross-contaminate", async () => {
    const [a, b] = await Promise.all([
      runInShareScope(
        { ownerId: 100, token: "ta", ownerName: "A" },
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          return getShareContext()?.ownerId;
        },
      ),
      runInShareScope(
        { ownerId: 200, token: "tb", ownerName: "B" },
        async () => {
          await new Promise((r) => setTimeout(r, 1));
          return getShareContext()?.ownerId;
        },
      ),
    ]);
    expect(a).toBe(100);
    expect(b).toBe(200);
  });

  it("effectiveUserId returns owner inside scope, fallback outside", async () => {
    expect(effectiveUserId(99)).toBe(99); // outside

    const inside = await runInShareScope(
      { ownerId: 5, token: "t", ownerName: "X" },
      async () => effectiveUserId(99),
    );
    expect(inside).toBe(5);
  });
});
