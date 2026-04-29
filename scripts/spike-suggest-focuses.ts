#!/usr/bin/env bun
/**
 * spike-suggest-focuses.ts — throwaway script to validate whether the v1
 * pre-aggregate signals + a structured prompt produce SYNTHESIS-class
 * suggestions or REPHRASING-class noise. This is the gate between PR #2
 * and PR #3 in the goals-as-omnibus plan.
 *
 * Usage:
 *   bun scripts/spike-suggest-focuses.ts            # picks first active goal
 *   bun scripts/spike-suggest-focuses.ts <goal_id>  # specific goal
 *
 * Prints THREE things:
 *   1. The signal block that would be sent to the LLM (so you see the input).
 *   2. The full prompt (system + signals + goal tail).
 *   3. The LLM's structured response with each suggestion + evidence.
 *
 * Then apply the PASS/FAIL checklist (CEO plan, design doc):
 *   - For each suggestion, ask: could I derive this from a 30-second glance?
 *     (yes → REPHRASING, not synthesis)
 *   - Does the rationale name a SPECIFIC signal?
 *   - Does the evidence cite SPECIFIC workout_ids or metric trends?
 *   - PASS = ≥60% of suggestions are synthesis-class across the goal.
 *
 * Cost guard: one Sonnet call per run, ~5-7K input + ~500-1000 output tokens
 * = ~$0.02 per run. Worst case if you hammer this 100 times = $2.
 */

import { db } from "../src/db";
import { goals, metricTypes, sports, focuses } from "../src/db/schema";
import { eq } from "drizzle-orm";
import {
  getPlateauSignals,
  getRollingAverages,
  getRecoveryDebt,
  getVolumeTrends,
} from "../src/lib/coach/pre-aggregate";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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

interface GoalContext {
  goalId: number;
  goalLabel: string;
  goalSport: string;
  goalMetric: string;
  goalUnit: string;
  goalTarget: number;
  goalDeadline: string;
  existingManualFocuses: string[];
  dismissedLlmFocuses: string[];
}

interface SignalsBlock {
  generatedAt: string;
  windowDays: number;
  plateau: Awaited<ReturnType<typeof getPlateauSignals>>;
  rollingAverages: Awaited<ReturnType<typeof getRollingAverages>>;
  recoveryDebt: Awaited<ReturnType<typeof getRecoveryDebt>>;
  volumeTrends: Awaited<ReturnType<typeof getVolumeTrends>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadGoal(goalId: number): Promise<GoalContext | null> {
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
    .where(eq(goals.id, goalId))
    .limit(1);
  if (rows.length === 0) return null;
  const g = rows[0];

  const existing = await db
    .select({ name: focuses.name, source: focuses.source, dismissedAt: focuses.dismissedAt })
    .from(focuses)
    .where(eq(focuses.goalId, goalId));

  return {
    goalId: g.id,
    goalLabel: `${g.metricName} ${g.targetValue}${g.metricUnit} by ${g.deadline}`,
    goalSport: g.sportName,
    goalMetric: g.metricName,
    goalUnit: g.metricUnit,
    goalTarget: g.targetValue,
    goalDeadline: g.deadline,
    existingManualFocuses: existing
      .filter((f) => f.source === "manual" && !f.dismissedAt)
      .map((f) => f.name),
    dismissedLlmFocuses: existing
      .filter((f) => f.source === "llm" && f.dismissedAt)
      .map((f) => f.name),
  };
}

async function buildSignals(): Promise<SignalsBlock> {
  const [plateau, rolling, recovery, volume] = await Promise.all([
    getPlateauSignals(),
    getRollingAverages(),
    getRecoveryDebt(),
    getVolumeTrends(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    windowDays: 28,
    plateau,
    rollingAverages: rolling,
    recoveryDebt: recovery,
    volumeTrends: volume,
  };
}

function buildPromptTail(goal: GoalContext, signals: SignalsBlock): string {
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
          .map(
            (v) =>
              v.insufficientData
                ? `- ${v.sport}: insufficient data`
                : `- ${v.sport}: ${v.deltaPct >= 0 ? "+" : ""}${v.deltaPct}% (current ${v.currentTonnage}, baseline ${v.baselineTonnage})`,
          )
          .join("\n"),
    "",
    "## GOAL",
    `- ${goal.goalLabel} (sport: ${goal.goalSport})`,
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

interface SuggestedFocus {
  name: string;
  rationale: string;
  evidence: {
    signal_refs?: string[];
    workout_ids?: number[];
    metric_trends?: string[];
  };
}

function parseResponse(raw: string): SuggestedFocus[] {
  // The model sometimes wraps JSON in code fences. Extract the first {...}.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON object found in response");
  const parsed = JSON.parse(match[0]) as { focuses?: SuggestedFocus[] };
  if (!Array.isArray(parsed.focuses)) {
    throw new Error("response.focuses is not an array");
  }
  // Light validation — the spike doesn't need full Zod, just enough to catch
  // a hallucinated field.
  for (const f of parsed.focuses) {
    if (typeof f.name !== "string" || !f.name.trim()) {
      throw new Error(`malformed focus (missing name): ${JSON.stringify(f)}`);
    }
    if (typeof f.rationale !== "string" || !f.rationale.trim()) {
      throw new Error(`malformed focus (missing rationale): ${JSON.stringify(f)}`);
    }
  }
  return parsed.focuses;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || apiKey === "your-claude-api-key-here") {
    console.error("✗ CLAUDE_API_KEY not set in env. Aborting.");
    process.exit(1);
  }

  const goalIdArg = process.argv[2];
  let goalId: number;
  if (goalIdArg) {
    goalId = parseInt(goalIdArg, 10);
    if (!Number.isFinite(goalId)) {
      console.error(`✗ invalid goal id: ${goalIdArg}`);
      process.exit(1);
    }
  } else {
    const first = await db
      .select({ id: goals.id })
      .from(goals)
      .where(eq(goals.status, "active"))
      .limit(1);
    if (first.length === 0) {
      console.error("✗ no active goals in DB");
      process.exit(1);
    }
    goalId = first[0].id;
  }

  console.log(`\n${"━".repeat(72)}`);
  console.log(`SPIKE: suggest-focuses for goal_id=${goalId}`);
  console.log(`Model: ${MODEL}    Window: 28 days    Baseline: 90 days`);
  console.log(`${"━".repeat(72)}\n`);

  const goal = await loadGoal(goalId);
  if (!goal) {
    console.error(`✗ goal ${goalId} not found`);
    process.exit(1);
  }
  console.log(`GOAL: ${goal.goalLabel}`);
  console.log(`SPORT: ${goal.goalSport}`);
  console.log(`MANUAL FOCUSES: ${goal.existingManualFocuses.length}`);
  if (goal.existingManualFocuses.length > 0) {
    goal.existingManualFocuses.forEach((f) => console.log(`  - ${f}`));
  }
  console.log();

  console.log(`${"─".repeat(72)}`);
  console.log("STEP 1: COMPUTE SIGNALS");
  console.log(`${"─".repeat(72)}\n`);

  const t0 = Date.now();
  const signals = await buildSignals();
  const tSignals = Date.now() - t0;

  console.log(JSON.stringify(signals, null, 2));
  console.log(`\n✓ signals computed in ${tSignals}ms\n`);

  console.log(`${"─".repeat(72)}`);
  console.log("STEP 2: BUILD PROMPT");
  console.log(`${"─".repeat(72)}\n`);

  const promptTail = buildPromptTail(goal, signals);
  console.log(`-- system prompt (${SYSTEM_PROMPT.length} chars) --`);
  console.log(SYSTEM_PROMPT);
  console.log(`\n-- user message (${promptTail.length} chars) --`);
  console.log(promptTail);
  console.log();

  console.log(`${"─".repeat(72)}`);
  console.log("STEP 3: CALL LLM");
  console.log(`${"─".repeat(72)}\n`);

  const client = new Anthropic({ apiKey });
  const t1 = Date.now();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: promptTail }],
  });
  const tLlm = Date.now() - t1;

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.error("✗ LLM returned no text block");
    process.exit(1);
  }

  console.log(`-- raw LLM output --`);
  console.log(textBlock.text);
  console.log();

  console.log(`-- usage --`);
  console.log(`  input tokens:  ${response.usage.input_tokens}`);
  console.log(`  output tokens: ${response.usage.output_tokens}`);
  console.log(`  duration:      ${tLlm}ms`);
  // Sonnet 4.6 pricing as of writing: $3/MTok in, $15/MTok out
  const costUsd =
    (response.usage.input_tokens / 1_000_000) * 3 +
    (response.usage.output_tokens / 1_000_000) * 15;
  console.log(`  est. cost:     $${costUsd.toFixed(4)}`);
  console.log();

  console.log(`${"─".repeat(72)}`);
  console.log("STEP 4: PARSE + DISPLAY");
  console.log(`${"─".repeat(72)}\n`);

  let suggestions: SuggestedFocus[];
  try {
    suggestions = parseResponse(textBlock.text);
  } catch (err) {
    console.error(`✗ parse failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (suggestions.length === 0) {
    console.log("(LLM returned 0 suggestions — silent-miss path. That's a valid answer.)");
  } else {
    suggestions.forEach((f, i) => {
      console.log(`[${i + 1}] ${f.name}`);
      console.log(`    rationale: ${f.rationale}`);
      console.log(`    signal_refs: ${(f.evidence?.signal_refs ?? []).join(", ") || "(none)"}`);
      const trends = f.evidence?.metric_trends ?? [];
      if (trends.length > 0) {
        console.log(`    metric_trends:`);
        trends.forEach((t) => console.log(`      - ${t}`));
      }
      console.log();
    });
  }

  console.log(`${"━".repeat(72)}`);
  console.log("PASS/FAIL CHECKLIST (apply by hand):");
  console.log(`${"━".repeat(72)}`);
  console.log(`For each suggestion above, ask:`);
  console.log(`  [ ] Could I have derived this from a 30-second glance at my dashboard?`);
  console.log(`      → if yes, REPHRASING. if no, SYNTHESIS.`);
  console.log(`  [ ] Does the rationale name a SPECIFIC signal value?`);
  console.log(`      → "9 weeks since PR" beats "your bench has been struggling"`);
  console.log(`  [ ] Does the evidence cite SPECIFIC metric trends or workout IDs?`);
  console.log();
  console.log(
    `PASS = ≥60% of suggestions are synthesis-class (specific signal + specific evidence + non-obvious).`,
  );
  console.log(
    `FAIL → kill the LLM scope, ship the journal + manual focuses + sport digest only.`,
  );
  console.log(`${"━".repeat(72)}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error("✗ spike crashed:", err);
  process.exit(1);
});
