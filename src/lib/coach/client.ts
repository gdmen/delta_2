import Anthropic from "@anthropic-ai/sdk";

const COACH_SYSTEM_PROMPT = `You are a fitness and training coach for an experienced athlete preparing for a powerlifting meet while also training jiujitsu, running, hiking, and biking.

Core framing of this athlete's system:
- GOALS are the fundamental targets (numeric, with a deadline). They define what success means.
- FOCUSES are multi-week training themes - tools that advance the goals.
- When you reason, lead with goals. Evaluate focuses and daily data as inputs that help or hurt goal progress.

Your job is diagnostic, not prescriptive. You produce HYPOTHESES about what's happening in the athlete's training based on the data. Every insight must:

1. Be evidence-based - reference specific data you saw (sleep hours, protein grams, workout frequency, HRV, required-vs-actual rate, etc.)
2. Be causal - explain WHY something is happening, not just what
3. Be humble - frame insights as "I think X because Y" not "X is caused by Y"
4. Be specific - no generic advice like "get more sleep" or "eat more protein"
5. Focus on cross-correlation - the signal is often in how metrics move together, or in how a focus is/isn't moving its linked goal

Use direct, terse language. No filler. No emojis. No pep-talk energy. Write like a trusted coach who respects the athlete's time.

Output structure:
- One paragraph of what happened recently (observations, yesterday's key activities, whether goals are on pace)
- One paragraph of your hypothesis (a causal claim with evidence, ideally tied to a goal gap)

Keep the total response under 150 words.`;

export const COACH_PROMPT_VERSION = "v1.1.0";

export interface CoachOutput {
  summary: string;
  insight: string;
  promptHash: string;
  contextSnapshot: string;
}

export interface CoachError {
  kind: "parse" | "refusal" | "stream" | "overflow" | "unavailable" | "unknown";
  message: string;
}

function getClient(): Anthropic | null {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || apiKey === "your-claude-api-key-here") return null;
  return new Anthropic({ apiKey });
}

/**
 * Generate a morning briefing. Returns a CoachOutput on success.
 * On failure, returns a CoachError - caller decides what to show the user.
 */
export async function generateBriefing(context: string): Promise<CoachOutput | CoachError> {
  const client = getClient();
  if (!client) {
    return { kind: "unavailable", message: "Delta coach is not configured (missing API key)" };
  }

  const userMessage = `${context}

Now write today's morning briefing. Start with what happened recently. Then give your hypothesis about what's working or what to change.

Respond in this JSON format:
{
  "summary": "one paragraph of recent observations",
  "insight": "one paragraph hypothesis with evidence"
}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      system: COACH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { kind: "refusal", message: "Coach couldn't generate a response. Try again." };
    }

    const text = textBlock.text.trim();

    // Parse JSON. Fall back to raw text if JSON is malformed.
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.summary !== "string" || typeof parsed.insight !== "string") {
        throw new Error("Missing fields");
      }
      return {
        summary: parsed.summary,
        insight: parsed.insight,
        promptHash: COACH_PROMPT_VERSION,
        contextSnapshot: context,
      };
    } catch {
      // Parse error fallback: return the raw text as summary, no insight.
      return {
        summary: text,
        insight: "",
        promptHash: COACH_PROMPT_VERSION,
        contextSnapshot: context,
      };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    if (errMsg.toLowerCase().includes("context") || errMsg.toLowerCase().includes("token")) {
      return { kind: "overflow", message: "Too much context. Try a shorter window." };
    }
    if (errMsg.toLowerCase().includes("timeout") || errMsg.toLowerCase().includes("aborted")) {
      return { kind: "stream", message: "Coach request timed out. Try again." };
    }
    return { kind: "unknown", message: errMsg };
  }
}

export function isCoachError(x: CoachOutput | CoachError): x is CoachError {
  return "kind" in x;
}
