import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { goals, metricTypes, sports, focuses } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  getPlateauSignals,
  getRollingAverages,
  getRecoveryDebt,
  getVolumeTrends,
} from "./pre-aggregate";
import { SuggestFocusesResponse, type SuggestedFocus, type CoachErrorBody } from "./schemas";
import { trackCoachCall } from "./track-call";
import { userScope } from "@/lib/auth/scope";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You are a strength coach analyzing training data for an experienced athlete.

The athlete tracks GOALS (numeric, with a deadline) and FOCUSES (multi-week
training themes that advance the goals). You are being asked to propose 1-4
new focuses for a SPECIFIC goal, based on the athlete's recent training data.

You receive a CONTEXT BLOCK with pre-computed signals:
- plateau detection per Big-3 lift (with BOTH all-time PR and recent-best
  e1RM). The all-time PR may be years stale if the athlete has had layoffs,
  weight cuts, or sport rebalances. RECENT BEST is what reflects current
  capacity. Goals are typically benchmarked against current capacity, not
  the all-time peak.
- rolling 7d/28d averages on key metrics with deltas
- recovery debt (weighted z-score across sleep/HRV/protein, 90d baseline)
- volume trend per sport (28d vs 90d-equivalent baseline)

Rules for proposing focuses:
1. Each proposal must cite a SPECIFIC signal value from the context block as
   evidence. "I noticed your bench is plateauing" is OK only if you also
   reference the plateau signal value (e.g. "9 weeks since last PR at 200lb").
2. Do NOT propose focuses that duplicate existing manual focuses.
3. Do NOT propose focuses already in the dismissed list.
4. Be concrete and actionable. "Pause reps for bench, 3-week block" beats
   "improve bench."
5. Be honest about insufficient data. If the context block flags "insufficient
   data" on a signal, do NOT make claims based on it. Do not invent values.
6. Use RECENT BEST (not all-time PR) to reason about current capacity vs the
   goal. A goal that is below an all-time PR is valid — the athlete may be
   rebuilding from a layoff, weight cut, or shifted sport balance. Don't
   assume the athlete is "almost there" just because the lifetime PR is high.
7. CROSS-SPORT TRADEOFFS are valid focuses. If a non-goal sport has a
   dramatic volume change (e.g. BJJ +200%) and the goal sport is plateauing,
   propose a focus that names that recovery competition explicitly. The
   athlete has a fixed recovery budget; sports compete for it.
8. If no useful synthesis is possible from the data, return an empty focuses
   array. A silent miss beats noise. Do not pad to hit a target count.

Return ONLY valid JSON in this shape:
{
  "focuses": [
    {
      "name": "concrete focus title",
      "rationale": "1-2 sentences explaining the signal and the change",
      "evidence": {
        "signal_refs": ["plateau" | "recovery_debt" | "volume_trend" | "rolling_avg"],
        "metric_trends": ["sleep_hours: 6.1h vs 7.2h baseline", ...]
      }
    }
  ]
}

Hard cap: 5 focuses max. Empty array is acceptable.`;

export type SuggestFocusesResult =
  | { ok: true; suggestions: SuggestedFocus[]; tokensIn: number; tokensOut: number; durationMs: number }
  | { ok: false; error: CoachErrorBody; tokensIn: number; tokensOut: number; durationMs: number };

interface GoalShape {
  id: number;
  metricName: string;
  metricUnit: string;
  sportName: string;
  targetValue: number;
  deadline: string;
  existingManualFocuses: string[];
  dismissedLlmFocuses: string[];
}

async function loadGoalShape(goalId: number, userId: number): Promise<GoalShape | null> {
  const rows = await db
    .select({
      id: goals.id,
      targetValue: goals.targetValue,
      deadline: goals.deadline,
      metricName: metricTypes.name,
      metricUnit: metricTypes.unit,
      sportName: sports.name,
    })
    .from(goals)
    .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
    .innerJoin(sports, eq(goals.sportId, sports.id))
    .where(and(userScope(userId).goals, eq(goals.id, goalId)))
    .limit(1);
  if (rows.length === 0) return null;
  const g = rows[0];

  // focuses is INHERIT — scope through this user's goals.
  const ownedGoalIds = db
    .select({ id: goals.id })
    .from(goals)
    .where(userScope(userId).goals);
  const existing = await db
    .select({
      name: focuses.name,
      source: focuses.source,
      dismissedAt: focuses.dismissedAt,
    })
    .from(focuses)
    .where(and(eq(focuses.goalId, goalId), inArray(focuses.goalId, ownedGoalIds)));

  return {
    ...g,
    existingManualFocuses: existing
      .filter((f) => f.source === "manual" && !f.dismissedAt)
      .map((f) => f.name),
    dismissedLlmFocuses: existing
      .filter((f) => f.source === "llm" && f.dismissedAt)
      .map((f) => f.name),
  };
}

interface SignalsBlock {
  plateau: Awaited<ReturnType<typeof getPlateauSignals>>;
  rollingAverages: Awaited<ReturnType<typeof getRollingAverages>>;
  recoveryDebt: Awaited<ReturnType<typeof getRecoveryDebt>>;
  volumeTrends: Awaited<ReturnType<typeof getVolumeTrends>>;
}

export async function buildSignalsBlock(userId: number): Promise<SignalsBlock> {
  const [plateau, rolling, recovery, volume] = await Promise.all([
    getPlateauSignals(userId),
    getRollingAverages(userId),
    getRecoveryDebt(userId),
    getVolumeTrends(userId),
  ]);
  return {
    plateau,
    rollingAverages: rolling,
    recoveryDebt: recovery,
    volumeTrends: volume,
  };
}

/**
 * Renders the pre-aggregate signals into the markdown block the LLM consumes.
 * The shape is identical to the spike's render so prompt-cache hits work
 * across spike-and-prod (when run in the same 5min window).
 */
export function renderSignalsBlock(signals: SignalsBlock): string {
  return [
    "## CONTEXT (pre-aggregated from the athlete's data)",
    "",
    "### Plateau detection (Big-3 lifts) — recent best is current capacity",
    signals.plateau
      .map((p) => {
        if (!p.lastPrDate) return `- ${p.lift}: no historical PR data`;
        const recent =
          p.recentBestValue !== null
            ? `recent best ${p.recentBestValue} (${p.recentBestDate}, last ${p.recentBestWindowDays}d)`
            : `no sets in last ${p.recentBestWindowDays}d (likely off this lift)`;
        return `- ${p.lift}: all-time PR ${p.lastPrValue} (${p.lastPrDate}, ${p.weeksSinceLastPr}w ago) | ${recent}`;
      })
      .join("\n"),
    "",
    "### Rolling averages (7d vs 28d)",
    signals.rollingAverages.length === 0
      ? "- (no daily metrics with sufficient readings)"
      : signals.rollingAverages
          .map(
            (r) =>
              `- ${r.metric}: 7d=${r.avg7}${r.unit ? r.unit : ""} vs 28d=${r.avg28}${r.unit ? r.unit : ""} (delta ${r.delta >= 0 ? "+" : ""}${r.delta}, n=${r.readingsInLongWindow})`,
          )
          .join("\n"),
    "",
    "### Recovery debt (z-score, 90d baseline, sleep/HRV/protein)",
    signals.recoveryDebt.insufficientData
      ? "- insufficient data (need ≥14 readings on at least one of sleep/HRV/protein)"
      : `- score: ${signals.recoveryDebt.score} (alarm at ${signals.recoveryDebt.alarmThreshold}; positive = below baseline)\n` +
        Object.entries(signals.recoveryDebt.breakdown)
          .map(
            ([m, b]) =>
              `  - ${m}: z=${b.z} (recent ${b.recent} vs baseline ${b.baseline}, weight ${b.weight})`,
          )
          .join("\n"),
    "",
    "### Volume trend (28d vs 90d-equivalent)",
    signals.volumeTrends.length === 0
      ? "- (no sports with workout data)"
      : signals.volumeTrends
          .map((v) =>
            v.insufficientData
              ? `- ${v.sport}: insufficient data`
              : `- ${v.sport}: ${v.deltaPct >= 0 ? "+" : ""}${v.deltaPct}% (current ${v.currentTonnage}, baseline ${v.baselineTonnage})`,
          )
          .join("\n"),
  ].join("\n");
}

function renderGoalTail(goal: GoalShape): string {
  return [
    "",
    "## GOAL",
    `- ${goal.metricName} ${goal.targetValue}${goal.metricUnit} by ${goal.deadline} (sport: ${goal.sportName})`,
    "",
    "## EXISTING MANUAL FOCUSES (do not duplicate)",
    goal.existingManualFocuses.length === 0
      ? "- (none)"
      : goal.existingManualFocuses.map((f) => `- ${f}`).join("\n"),
    "",
    "## DISMISSED LLM FOCUSES (do not re-propose)",
    goal.dismissedLlmFocuses.length === 0
      ? "- (none)"
      : goal.dismissedLlmFocuses.map((f) => `- ${f}`).join("\n"),
    "",
    "Now produce the JSON response.",
  ].join("\n");
}

function parseLlmJson(raw: string): unknown {
  // Strip optional markdown code fences (the model often wraps).
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON object in response");
  return JSON.parse(match[0]);
}

/**
 * Generate suggested focuses for a goal. Returns either a structured
 * success result or a typed error body the API endpoint can serialize.
 *
 * Anthropic prompt-caching is enabled on the pre-aggregate signals block
 * (the largest, most-reused chunk). With a 5-min TTL, asking suggestions
 * for two goals back-to-back reuses the cached signals on the second call,
 * cutting input cost ~10x for that block.
 *
 * Side effect: writes one row to `coach_calls` per invocation (success or
 * fail), so the cost log accumulates regardless of outcome.
 */
export async function suggestFocuses(goalId: number, userId: number): Promise<SuggestFocusesResult> {
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

  const goal = await loadGoalShape(goalId, userId);
  if (!goal) {
    // Caller's responsibility to surface this — return as malformed_llm_output
    // would be misleading. Endpoint should 404 before reaching here.
    return {
      ok: false,
      error: { error: "internal", message: "goal not found" },
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
    };
  }

  const signals = await buildSignalsBlock(userId);
  const signalsBlock = renderSignalsBlock(signals);
  const goalTail = renderGoalTail(goal);

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
            // The signals block is the cacheable chunk: same across goals
            // queried in the same session window.
            {
              type: "text",
              text: signalsBlock,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: goalTail },
          ],
        },
      ],
    });
  } catch (err) {
    const durationMs = Date.now() - t0;
    await trackCoachCall({
      userId,
      endpoint: "suggest-focuses",
      goalId,
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
          error: { error: "rate_limit", message: err.message, retry_after: 60 },
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
      error: {
        error: "internal",
        message: err instanceof Error ? err.message : String(err),
      },
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
      userId,
      endpoint: "suggest-focuses",
      goalId,
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
    console.error("[suggest-focuses] JSON parse failed", { goalId, raw: textBlock.text, err });
    await trackCoachCall({
      userId,
      endpoint: "suggest-focuses",
      goalId,
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

  const validated = SuggestFocusesResponse.safeParse(parsedRaw);
  if (!validated.success) {
    console.error("[suggest-focuses] Zod validation failed", {
      goalId,
      raw: textBlock.text,
      issues: validated.error.issues,
    });
    await trackCoachCall({
      userId,
      endpoint: "suggest-focuses",
      goalId,
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
    userId,
    endpoint: "suggest-focuses",
    goalId,
    tokensIn,
    tokensOut,
    durationMs,
    model: MODEL,
    status: "success",
  });

  return {
    ok: true,
    suggestions: validated.data.focuses,
    tokensIn,
    tokensOut,
    durationMs,
  };
}
