import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const ORIG_PASSWORD = process.env.SITE_PASSWORD;

function makeRequest(path = "/", headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers });
}

beforeEach(() => {
  delete process.env.SITE_PASSWORD;
});

afterEach(() => {
  if (ORIG_PASSWORD === undefined) {
    delete process.env.SITE_PASSWORD;
  } else {
    process.env.SITE_PASSWORD = ORIG_PASSWORD;
  }
});

/**
 * The auth gate has three states:
 *   - SITE_PASSWORD unset OR empty string → gate disabled (NextResponse.next)
 *   - SITE_PASSWORD set, no/invalid Authorization header → 401
 *   - SITE_PASSWORD set, matching Basic auth → next
 *
 * The empty-string case is the bug magnet (an attacker could rely on a
 * blank-default to bypass the gate; or a CI/dev env could leak past prod).
 * Locking down both sides of the empty-string behavior here.
 */
describe("proxy auth gate", () => {
  describe("when SITE_PASSWORD is unset", () => {
    it("lets every request through", () => {
      const res = proxy(makeRequest("/dashboards/today"));
      expect(res.status).toBe(200);
    });
  });

  describe("when SITE_PASSWORD is empty string", () => {
    it("treats empty string as disabled (gate off)", () => {
      process.env.SITE_PASSWORD = "";
      const res = proxy(makeRequest("/dashboards/today"));
      expect(res.status).toBe(200);
    });
  });

  describe("when SITE_PASSWORD is set", () => {
    beforeEach(() => {
      process.env.SITE_PASSWORD = "secret";
    });

    it("rejects requests with no Authorization header", () => {
      const res = proxy(makeRequest("/dashboards/today"));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Basic");
    });

    it("rejects wrong password", () => {
      const auth = Buffer.from("delta:wrong").toString("base64");
      const res = proxy(makeRequest("/dashboards/today", { authorization: `Basic ${auth}` }));
      expect(res.status).toBe(401);
    });

    it("accepts correct password regardless of username", () => {
      const auth = Buffer.from("delta:secret").toString("base64");
      const res = proxy(makeRequest("/dashboards/today", { authorization: `Basic ${auth}` }));
      expect(res.status).toBe(200);
    });

    it("lets /api/ingest/* through without Authorization (ingest paths self-auth)", () => {
      const res = proxy(makeRequest("/api/ingest/apple-health"));
      expect(res.status).toBe(200);
    });
  });
});
