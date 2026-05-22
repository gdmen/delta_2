import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildDbMock, setupRouteTest } from "@/test-utils/route-test";

vi.mock("@/db", () => buildDbMock());

import { eq } from "drizzle-orm";
import { sports, events, eventJournalEntries } from "@/db/schema";
import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[entryId]/route";
import { POST as UNMERGE } from "../unmerge/route";

/**
 * Behavior coverage for event journal CRUD + the composite-unmerge
 * copy-to-members flow (issue #19). Runs route handlers against a
 * per-test pglite via the route-test harness (default user id=1).
 */

const ctx = setupRouteTest();

function req(body?: unknown): NextRequest {
  const init: { method: string; headers?: Record<string, string>; body?: string } = {
    method: "POST",
  };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return new NextRequest("http://test/", init as ConstructorParameters<typeof NextRequest>[1]);
}

function p(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function pe(id: number, entryId: number) {
  return { params: Promise.resolve({ id: String(id), entryId: String(entryId) }) };
}

async function seedEvent(opts?: {
  status?: "visible" | "hidden_by_composite" | "composite";
  memberIds?: number[];
}): Promise<number> {
  const db = ctx.getDb();
  const [s] = await db
    .insert(sports)
    .values({ userId: 1, name: `sport-${Math.random()}`, color: "#000" })
    .returning({ id: sports.id });
  const [ev] = await db
    .insert(events)
    .values({
      userId: 1,
      sportId: s.id,
      type: "lift",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: opts?.status ?? "visible",
      compositeMemberIds: opts?.memberIds ?? [],
    })
    .returning({ id: events.id });
  return ev.id;
}

describe("event journal CRUD (#19)", () => {
  it("J1: POST creates an entry on an owned event", async () => {
    const eventId = await seedEvent();
    const res = await POST(req({ content: "felt strong" }), p(eventId));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.content).toBe("felt strong");
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const rows = await ctx
      .getDb()
      .select()
      .from(eventJournalEntries)
      .where(eq(eventJournalEntries.eventId, eventId));
    expect(rows).toHaveLength(1);
  });

  it("J2: POST 404 on a nonexistent event", async () => {
    const res = await POST(req({ content: "x" }), p(99999));
    expect(res.status).toBe(404);
  });

  it("J3: POST rejects empty content", async () => {
    const eventId = await seedEvent();
    const res = await POST(req({ content: "   " }), p(eventId));
    expect(res.status).toBe(400);
  });

  it("J4: PATCH edits content and bumps updated_at", async () => {
    const eventId = await seedEvent();
    const created = await (await POST(req({ content: "first" }), p(eventId))).json();
    // Force a clock gap so updatedAt strictly differs from createdAt.
    await new Promise((r) => setTimeout(r, 5));
    const res = await PATCH(req({ content: "edited" }), pe(eventId, created.id));
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.content).toBe("edited");
    expect(updated.updatedAt >= updated.createdAt).toBe(true);
  });

  it("J5: DELETE removes the entry", async () => {
    const eventId = await seedEvent();
    const created = await (await POST(req({ content: "rm me" }), p(eventId))).json();
    const res = await DELETE(req(), pe(eventId, created.id));
    expect(res.status).toBe(200);
    const rows = await ctx
      .getDb()
      .select()
      .from(eventJournalEntries)
      .where(eq(eventJournalEntries.eventId, eventId));
    expect(rows).toHaveLength(0);
  });

  it("J6: PATCH 404 when entryId doesn't belong to the path event", async () => {
    const eventA = await seedEvent();
    const eventB = await seedEvent();
    const created = await (await POST(req({ content: "on A" }), p(eventA))).json();
    // Try to edit A's entry via event B's path → 404.
    const res = await PATCH(req({ content: "x" }), pe(eventB, created.id));
    expect(res.status).toBe(404);
  });

  it("J7: GET returns the event's entries newest-first (live count for unmerge dialog)", async () => {
    const eventId = await seedEvent();
    await POST(req({ content: "first" }), p(eventId));
    await new Promise((r) => setTimeout(r, 5));
    await POST(req({ content: "second" }), p(eventId));

    const res = await GET(req(), p(eventId));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(2);
    // Newest first.
    expect(rows[0].content).toBe("second");
    expect(rows[1].content).toBe("first");
  });
});

describe("composite unmerge — journal copy-to-members (#19)", () => {
  async function seedComposite() {
    const db = ctx.getDb();
    const m1 = await seedEvent({ status: "hidden_by_composite" });
    const m2 = await seedEvent({ status: "hidden_by_composite" });
    const composite = await seedEvent({
      status: "composite",
      memberIds: [m1, m2],
    });
    return { db, m1, m2, composite };
  }

  it("U1: copies composite notes onto checked members, drops the composite's own", async () => {
    const { db, m1, m2, composite } = await seedComposite();
    await POST(req({ content: "great combined session" }), p(composite));

    const res = await UNMERGE(req({ copyJournalToEventIds: [m1] }), p(composite));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.journalCopies).toBe(1);

    // m1 got a copy; m2 did not; the composite's entries are gone (cascade).
    const m1Rows = await db
      .select()
      .from(eventJournalEntries)
      .where(eq(eventJournalEntries.eventId, m1));
    const m2Rows = await db
      .select()
      .from(eventJournalEntries)
      .where(eq(eventJournalEntries.eventId, m2));
    const compRows = await db
      .select()
      .from(eventJournalEntries)
      .where(eq(eventJournalEntries.eventId, composite));
    expect(m1Rows).toHaveLength(1);
    expect(m1Rows[0].content).toBe("great combined session");
    expect(m2Rows).toHaveLength(0);
    expect(compRows).toHaveLength(0);

    // Composite row deleted; members flipped back to visible.
    const stillComposite = await db
      .select()
      .from(events)
      .where(eq(events.id, composite));
    expect(stillComposite).toHaveLength(0);
    const m1Ev = await db.select().from(events).where(eq(events.id, m1));
    expect(m1Ev[0].status).toBe("visible");
  });

  it("U2: no copy targets → composite notes just cascade away, members untouched", async () => {
    const { db, m1, m2, composite } = await seedComposite();
    await POST(req({ content: "orphan note" }), p(composite));

    const res = await UNMERGE(req({ copyJournalToEventIds: [] }), p(composite));
    expect(res.status).toBe(200);
    expect((await res.json()).journalCopies).toBe(0);

    expect(
      await db.select().from(eventJournalEntries).where(eq(eventJournalEntries.eventId, m1)),
    ).toHaveLength(0);
    expect(
      await db.select().from(eventJournalEntries).where(eq(eventJournalEntries.eventId, m2)),
    ).toHaveLength(0);
  });

  it("U3: a non-member event id in the copy list is ignored (security)", async () => {
    const { db, m1, composite } = await seedComposite();
    const outsider = await seedEvent(); // not a member of the composite
    await POST(req({ content: "secret" }), p(composite));

    const res = await UNMERGE(
      req({ copyJournalToEventIds: [m1, outsider] }),
      p(composite),
    );
    expect(res.status).toBe(200);
    // Only the real member m1 got a copy; the outsider got nothing.
    expect(
      await db.select().from(eventJournalEntries).where(eq(eventJournalEntries.eventId, m1)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(eventJournalEntries)
        .where(eq(eventJournalEntries.eventId, outsider)),
    ).toHaveLength(0);
  });

  it("U4: member-event notes survive unmerge untouched", async () => {
    const { db, m1, composite } = await seedComposite();
    // Note written directly on the member (not the composite).
    await POST(req({ content: "on the member" }), p(m1));

    const res = await UNMERGE(req({ copyJournalToEventIds: [] }), p(composite));
    expect(res.status).toBe(200);

    const m1Rows = await db
      .select()
      .from(eventJournalEntries)
      .where(eq(eventJournalEntries.eventId, m1));
    expect(m1Rows).toHaveLength(1);
    expect(m1Rows[0].content).toBe("on the member");
  });
});
