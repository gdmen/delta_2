import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import {
  focuses,
  goals,
  metricTypes,
  sports,
  goalJournalEntries,
} from "@/db/schema";
import { and, eq, gte, inArray, lte, ne, desc, isNotNull } from "drizzle-orm";
import { CloseFocusVerdictResponse, type CoachErrorBody } from "./schemas";
import { trackCoachCall } from "./track-call";
import { buildSignalsBlock, renderSignalsBlock } from "./suggest-focuses";
import { userScope } from "@/lib/auth/scope";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1200;

const SYSTEM_PROMPT = `You are a strength coach writing a CLOSE-OUT VERDICT
for a focus that an athlete has just completed (or abandoned). The verdict
will be appended to the athlete's per-goal journal as a marker entry — a
scannable "what just happened" summary they can find months later.

Inputs you receive:
1. The focus being closed: name, start_date, end_date, status, technical
   notes, and any LLM-evidence from when it was originally proposed.
2. Journal entries the athlete wrote during the focus's window.
3. Pre-aggregate signals (plateau / rolling avg / recovery debt / volume
   trend) computed against the goal's sport and the recent training data.
4. PRIOR CLOSED FOCUSES on the same goal (when ≥1 exists) — name, dates,
   final status, and a short window of journal entries inside that focus's
   range. Use these to draw cross-focus comparisons.

Verdict structure (markdown, ≤2000 chars):
- 1 sentence: what was attempted and why (paraphrased from the focus name +
  technical notes).
- 1-2 sentences: what actually happened, citing SPECIFIC signal values or
  journal observations. Use real numbers.
- 1 sentence (optional): comparison to a prior closed focus on the same
  goal, IF one exists and is comparable. Format: "Compared to [name]
  ([dates]): [delta]." Skip if no prior focus is comparable.
- 1 sentence: what to carry forward. Concrete, not "keep going."

Rules:
- Be honest. If the focus was abandoned or didn't move the needle, say so.
- Don't invent numbers. If a signal is missing, don't reference it.
- No throat-clearing, no "great work," no emojis.
- The output is a permanent journal entry. Write so it reads well 12 months
  later when the athlete scrolls back.

Return ONLY valid JSON:
{
  "verdict_markdown": "...",
  "references_prior_focuses": [<focus_id>, ...]   // optional, only when you cited one
}`;

export type CloseFocusVerdictResult =
  | {
      ok: true;
      verdictMarkdown: string;
      referencesPriorFocuses: number[];
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
    }
  | {
      ok: false;
      error: CoachErrorBody;
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
    };

interface FocusContext {
  id: number;
  name: string;
  startDate: string;
  endDate: string | null;
  status: "active" | "completed" | "abandoned";
  technicalNotes: string | null;
  evidence: string | null;
  source: "manual" | "llm";
}

interface GoalShape {
  id: number;
  metricName: string;
  metricUnit: string;
  sportName: string;
  targetValue: number;
  deadline: string;
}

async function loadFocus(focusId: number, goalId: number, userId: number): Promise<FocusContext | null> {
  // focuses is INHERIT — restrict to focuses on this user's goals.
  const ownedGoalIds = db
    .select({ id: goals.id })
    .from(goals)
    .where(userScope(userId).goals);
  const rows = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      startDate: focuses.startDate,
      endDate: focuses.endDate,
      status: focuses.status,
      technicalNotes: focuses.technicalNotes,
      evidence: focuses.evidence,
      source: focuses.source,
    })
    .from(focuses)
    .where(
      and(
        eq(focuses.id, focusId),
        eq(focuses.goalId, goalId),
        inArray(focuses.goalId, ownedGoalIds),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function loadGoal(goalId: number, userId: number): Promise<GoalShape | null> {
  const rows = await db
    .select({
      id: goals.id,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
      sportName: sports.name,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .where(and(userScope(userId).goals, eq(goals.id, goalId)))
    .limit(1);
  return rows[0] ?? null;
}

async function loadJournalInWindow(
  goalId: number,
  startDate: string,
  endDate: string,
  userId: number,
): Promise<Array<{ createdAt: string; content: string }>> {
  // goal_journal_entries is INHERIT — scope by this user's goals.
  const ownedGoalIds = db
    .select({ id: goals.id })
    .from(goals)
    .where(userScope(userId).goals);
  const rows = await db
    .select({
      createdAt: goalJournalEntries.createdAt,
      content: goalJournalEntries.content,
    })
    .from(goalJournalEntries)
    .where(
      and(
        eq(goalJournalEntries.goalId, goalId),
        inArray(goalJournalEntries.goalId, ownedGoalIds),
        gte(goalJournalEntries.createdAt, startDate),
        lte(goalJournalEntries.createdAt, `${endDate}T23:59:59Z`),
      ),
    )
    .orderBy(desc(goalJournalEntries.createdAt));
  return rows;
}

interface PriorFocus extends FocusContext {
  journalSnippets: Array<{ createdAt: string; content: string }>;
}

async function loadPriorClosedFocuses(
  goalId: number,
  excludeFocusId: number,
  userId: number,
): Promise<PriorFocus[]> {
  const ownedGoalIds = db
    .select({ id: goals.id })
    .from(goals)
    .where(userScope(userId).goals);
  const closed = await db
    .select({
      id: focuses.id,
      name: focuses.name,
      startDate: focuses.startDate,
      endDate: focuses.endDate,
      status: focuses.status,
      technicalNotes: focuses.technicalNotes,
      evidence: focuses.evidence,
      source: focuses.source,
    })
    .from(focuses)
    .where(
      and(
        eq(focuses.goalId, goalId),
        inArray(focuses.goalId, ownedGoalIds),
        ne(focuses.id, excludeFocusId),
        ne(focuses.status, "active"),
        isNotNull(focuses.endDate),
      ),
    )
    .orderBy(desc(focuses.endDate))
    .limit(3); // cap context size — most recent 3 prior closures

  const results: PriorFocus[] = [];
  for (const f of closed) {
    if (!f.endDate) continue;
    const snippets = await loadJournalInWindow(goalId, f.startDate, f.endDate, userId);
    results.push({ ...f, journalSnippets: snippets.slice(0, 5) });
  }
  return results;
}

function renderFocusBlock(label: string, f: FocusContext, journal: Array<{ createdAt: string; content: string }>): string {
  const lines = [
    `## ${label}`,
    `- name: ${f.name}`,
    `- window: ${f.startDate} → ${f.endDate ?? "(open)"}`,
    `- status: ${f.status}`,
    `- source: ${f.source}`,
  ];
  if (f.technicalNotes) lines.push(`- technical_notes: ${f.technicalNotes}`);
  if (f.evidence) lines.push(`- llm_evidence: ${f.evidence}`);
  if (journal.length === 0) {
    lines.push("- journal entries in window: (none)");
  } else {
    lines.push("- journal entries in window:");
    for (const j of journal) {
      const truncated = j.content.length > 400 ? `${j.content.slice(0, 400)}…` : j.content;
      lines.push(`  - [${j.createdAt}] ${truncated.replace(/\n+/g, " ")}`);
    }
  }
  return lines.join("\n");
}

function parseLlmJson(raw: string): unknown {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON object in response");
  return JSON.parse(match[0]);
}

/**
 * Generate a close-out verdict for a focus. Pulls journal entries from the
 * focus's window, prior closed focuses on the same goal (≤3 most recent),
 * and the current pre-aggregate signals — then asks the LLM to write a
 * short, scannable verdict that gets appended to the journal.
 *
 * The focus itself is NOT closed by this function. Caller (the close
 * endpoint) is responsible for status/end_date — verdict generation can
 * fail without leaving the focus in a half-closed state.
 */
export async function generateCloseFocusVerdict(args: {
  goalId: number;
  focusId: number;
  userId: number;
}): Promise<CloseFocusVerdictResult> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || apiKey === "your-claude-api-key-here") {
    return {
      ok: false,
      error: { error: "missing_api_key", message: "CLAUDE_API_KEY not set" },
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }

  const focus = await loadFocus(args.focusId, args.goalId, args.userId);
  if (!focus) {
    return {
      ok: false,
      error: { error: "internal", message: "focus not found on goal" },
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }
  const goal = await loadGoal(args.goalId, args.userId);
  if (!goal) {
    return {
      ok: false,
      error: { error: "internal", message: "goal not found" },
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }

  // Use today as the close date for the journal-window query if the focus
  // doesn't have an end_date yet (caller hasn't set it; we're pre-close).
  const closeDate = focus.endDate ?? new Date().toISOString().slice(0, 10);
  const focusJournal = await loadJournalInWindow(args.goalId, focus.startDate, closeDate, args.userId);
  const priorFocuses = await loadPriorClosedFocuses(args.goalId, args.focusId, args.userId);
  const signals = await buildSignalsBlock(args.userId);
  const signalsBlock = renderSignalsBlock(signals);

  const promptTail = [
    "## GOAL",
    `- ${goal.metricName} ${goal.targetValue}${goal.metricUnit} by ${goal.deadline} (sport: ${goal.sportName})`,
    "",
    renderFocusBlock("CLOSING FOCUS", focus, focusJournal),
    "",
    priorFocuses.length === 0
      ? "## PRIOR CLOSED FOCUSES (none on this goal)"
      : priorFocuses
          .map((pf, i) =>
            renderFocusBlock(`PRIOR CLOSED FOCUS ${i + 1} (id=${pf.id})`, pf, pf.journalSnippets),
          )
          .join("\n\n"),
    "",
    "Now write the verdict markdown.",
  ].join("\n");

  const client = new Anthropic({ apiKey });
  const t0 = Date.now();
  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            // Signals are the cacheable chunk shared with suggest-focuses.
            {
              type: "text",
              text: signalsBlock,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: promptTail },
          ],
        },
      ],
    });
  } catch (err) {
    const durationMs = Date.now() - t0;
    await trackCoachCall({
      userId: args.userId,
      endpoint: "close-focus-verdict",
      goalId: args.goalId,
      tokensIn: 0,
      tokensOut: 0,
      durationMs,
      model: MODEL,
      status: "failed",
    });
    if (err instanceof Anthropic.APIError) {
      if (err.status === 429) {
        return {
          ok: false,
          error: { error: "rate_limit", retry_after: 60, message: err.message },
          tokensIn: 0,
          tokensOut: 0,
          durationMs,
        };
      }
      if (err.status >= 500) {
        return {
          ok: false,
          error: { error: "llm_unavailable", message: err.message },
          tokensIn: 0,
          tokensOut: 0,
          durationMs,
        };
      }
      if (err.status === 401 || err.status === 403) {
        return {
          ok: false,
          error: { error: "missing_api_key", message: err.message },
          tokensIn: 0,
          tokensOut: 0,
          durationMs,
        };
      }
    }
    return {
      ok: false,
      error: { error: "internal", message: err instanceof Error ? err.message : String(err) },
      tokensIn: 0,
      tokensOut: 0,
      durationMs,
    };
  }

  const durationMs = Date.now() - t0;
  const tokensIn = response.usage.input_tokens;
  const tokensOut = response.usage.output_tokens;

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    await trackCoachCall({
      userId: args.userId,
      endpoint: "close-focus-verdict",
      goalId: args.goalId,
      tokensIn,
      tokensOut,
      durationMs,
      model: MODEL,
      status: "failed",
    });
    return {
      ok: false,
      error: { error: "malformed_llm_output", message: "no text block" },
      tokensIn,
      tokensOut,
      durationMs,
    };
  }

  let parsedRaw: unknown;
  try {
    parsedRaw = parseLlmJson(textBlock.text);
  } catch (err) {
    console.error("[close-focus-verdict] JSON parse failed", {
      goalId: args.goalId,
      focusId: args.focusId,
      raw: textBlock.text,
      err,
    });
    await trackCoachCall({
      userId: args.userId,
      endpoint: "close-focus-verdict",
      goalId: args.goalId,
      tokensIn,
      tokensOut,
      durationMs,
      model: MODEL,
      status: "failed",
    });
    return {
      ok: false,
      error: { error: "malformed_llm_output", raw: textBlock.text },
      tokensIn,
      tokensOut,
      durationMs,
    };
  }

  const validated = CloseFocusVerdictResponse.safeParse(parsedRaw);
  if (!validated.success) {
    console.error("[close-focus-verdict] Zod validation failed", {
      goalId: args.goalId,
      focusId: args.focusId,
      raw: textBlock.text,
      issues: validated.error.issues,
    });
    await trackCoachCall({
      userId: args.userId,
      endpoint: "close-focus-verdict",
      goalId: args.goalId,
      tokensIn,
      tokensOut,
      durationMs,
      model: MODEL,
      status: "failed",
    });
    return {
      ok: false,
      error: { error: "malformed_llm_output", raw: textBlock.text },
      tokensIn,
      tokensOut,
      durationMs,
    };
  }

  await trackCoachCall({
    userId: args.userId,
    endpoint: "close-focus-verdict",
    goalId: args.goalId,
    tokensIn,
    tokensOut,
    durationMs,
    model: MODEL,
    status: "success",
  });

  return {
    ok: true,
    verdictMarkdown: validated.data.verdict_markdown,
    referencesPriorFocuses: validated.data.references_prior_focuses ?? [],
    tokensIn,
    tokensOut,
    durationMs,
  };
}
