import { z } from "zod";

/**
 * Zod schemas for the structured outputs of the three LLM coach endpoints.
 * These are the runtime validation layer — if the model returns a field
 * that doesn't match (extra prop, missing required, wrong type), parse fails
 * and the endpoint surfaces `malformed_llm_output` instead of letting bad
 * data downstream.
 *
 * Locked sizes match the cap rationale in the CEO plan:
 *   - 5 focuses max per suggest-focuses call (anti-spam)
 *   - 4000 char ceiling on summaries (~1k tokens, fits a goal-page panel)
 *   - 2000 char ceiling on verdicts (one journal entry, scannable)
 */

const SignalRef = z.enum(["plateau", "recovery_debt", "volume_trend", "rolling_avg"]);

export const SuggestedFocus = z.object({
  name: z.string().min(1).max(200),
  rationale: z.string().min(1).max(1000),
  evidence: z.object({
    signal_refs: z.array(SignalRef).max(4).optional(),
    workout_ids: z.array(z.number().int().positive()).max(20).optional(),
    metric_trends: z.array(z.string().max(200)).max(10).optional(),
  }),
});
export type SuggestedFocus = z.infer<typeof SuggestedFocus>;

export const SuggestFocusesResponse = z.object({
  focuses: z.array(SuggestedFocus).max(5),
});
export type SuggestFocusesResponse = z.infer<typeof SuggestFocusesResponse>;

export const SummarizePeriodResponse = z.object({
  summary_markdown: z.string().min(1).max(4000),
});
export type SummarizePeriodResponse = z.infer<typeof SummarizePeriodResponse>;

export const CloseFocusVerdictResponse = z.object({
  verdict_markdown: z.string().min(1).max(2000),
  references_prior_focuses: z.array(z.number().int().positive()).max(10).optional(),
});
export type CloseFocusVerdictResponse = z.infer<typeof CloseFocusVerdictResponse>;

/**
 * Common error surface returned by the coach endpoints. Pick one based on
 * the failure mode; the UI maps each to a toast + retry behavior.
 */
export type CoachErrorKind =
  | "rate_limit"
  | "llm_unavailable"
  | "malformed_llm_output"
  | "missing_api_key"
  | "internal";

export interface CoachErrorBody {
  error: CoachErrorKind;
  message?: string;
  retry_after?: number; // seconds, when error is rate_limit
  raw?: string; // for malformed_llm_output: the LLM's raw response, for debugging
}
