import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { coachMessages } from "@/db/schema";
import { assembleBriefingContext, formatContextForLLM } from "@/lib/coach/context";
import { generateBriefing, isCoachError } from "@/lib/coach/client";
import { desc, eq, gte, and } from "drizzle-orm";

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function GET() {
  // If there's already a briefing today, return the cached one.
  const existing = await db
    .select()
    .from(coachMessages)
    .where(and(eq(coachMessages.type, "briefing"), gte(coachMessages.createdAt, startOfToday())))
    .orderBy(desc(coachMessages.createdAt))
    .limit(1);

  if (existing.length > 0) {
    const msg = existing[0];
    try {
      const parsed = JSON.parse(msg.content);
      return NextResponse.json({ cached: true, ...parsed, createdAt: msg.createdAt });
    } catch {
      return NextResponse.json({ cached: true, summary: msg.content, insight: "", createdAt: msg.createdAt });
    }
  }

  return NextResponse.json({ cached: false, generated: false, message: "No briefing yet. POST to generate." });
}

export async function POST(_request: NextRequest) {
  const context = await assembleBriefingContext(7);

  // If the window has zero data, don't burn an API call. Return a helpful message.
  const hasData =
    context.dailySummaries.some((d) => Object.keys(d.metrics).length > 0 || d.events.length > 0) ||
    context.activeFocuses.length > 0;

  if (!hasData) {
    return NextResponse.json({
      generated: false,
      reason: "no_data",
      message: "Not enough data yet. Log a session or add a focus to get started.",
    });
  }

  const formatted = formatContextForLLM(context);
  const result = await generateBriefing(formatted);

  if (isCoachError(result)) {
    return NextResponse.json({
      generated: false,
      reason: result.kind,
      message: result.message,
    }, { status: result.kind === "unavailable" ? 503 : 500 });
  }

  // Store the generated briefing.
  const content = JSON.stringify({ summary: result.summary, insight: result.insight });
  const inserted = await db.insert(coachMessages).values({
    type: "briefing",
    content,
    promptTemplateHash: result.promptHash,
    contextSnapshot: result.contextSnapshot,
  }).returning({ id: coachMessages.id, createdAt: coachMessages.createdAt });

  return NextResponse.json({
    generated: true,
    id: inserted[0].id,
    createdAt: inserted[0].createdAt,
    summary: result.summary,
    insight: result.insight,
  });
}
