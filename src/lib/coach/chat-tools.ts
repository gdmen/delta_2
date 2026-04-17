import { db } from "@/db";
import { sports, metricTypes, focuses, goals } from "@/db/schema";
import { eq, ne } from "drizzle-orm";
import type { Anthropic } from "@anthropic-ai/sdk";
import { computeGoalProgress } from "@/lib/goal-calc";

// Tool definitions exposed to Claude. Keep descriptions terse - they burn context on every turn.
export const CHAT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "list_sports",
    description: "List all sports in the system with their IDs. Use this to find sport_id when creating focuses or goals.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_metric_types",
    description: "List all metric types with their IDs and units. Use this to find metric_type_id when creating goals (e.g. bench_1rm, bodyweight, deadlift_1rm).",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_active_focuses",
    description: "List the user's currently active focuses. Check this before creating a new focus to avoid duplicates or know what the user is already working on.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_goals",
    description: "List the user's existing goals.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_focus",
    description: "Create a new training focus. Focuses are multi-week themes the user is working on (e.g. 'Break 315 Bench', 'Cross-Face Defense'). Always confirm with the user before calling this. Strongly prefer linking the focus to an existing goal it advances - use list_goals first to find candidate goals.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short focus name, e.g. 'Break 315 Bench'" },
        sport_id: { type: "number", description: "Sport ID from list_sports" },
        goal_id: { type: "number", description: "Optional. ID of the goal this focus advances (from list_goals). Link whenever the focus is clearly in service of a numeric goal." },
        technical_notes: { type: "string", description: "Markdown notes about the technical plan: programming, techniques, targets. Can be multiple paragraphs." },
      },
      required: ["name", "sport_id"],
    },
  },
  {
    name: "create_goal",
    description: "Create a goal with a target value and deadline. Always confirm with the user before calling this. The deadline should be an ISO date (YYYY-MM-DD).",
    input_schema: {
      type: "object",
      properties: {
        metric_type_id: { type: "number", description: "Metric type ID from list_metric_types" },
        sport_id: { type: "number", description: "Sport ID from list_sports" },
        target_value: { type: "number", description: "Target value in the metric's native unit" },
        deadline: { type: "string", description: "ISO date YYYY-MM-DD" },
      },
      required: ["metric_type_id", "sport_id", "target_value", "deadline"],
    },
  },
];

type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "list_sports": {
        const rows = await db.select().from(sports);
        return { ok: true, data: rows };
      }
      case "list_metric_types": {
        const rows = await db.select().from(metricTypes);
        return { ok: true, data: rows };
      }
      case "list_active_focuses": {
        const rows = await db
          .select({
            id: focuses.id, name: focuses.name, sport_id: focuses.sportId,
            goal_id: focuses.goalId,
            start_date: focuses.startDate, technical_notes: focuses.technicalNotes,
          })
          .from(focuses)
          .where(eq(focuses.status, "active"));
        return { ok: true, data: rows };
      }
      case "list_goals": {
        const rows = await db
          .select({
            id: goals.id,
            metricTypeId: goals.metricTypeId,
            targetValue: goals.targetValue,
            deadline: goals.deadline,
            createdAt: goals.createdAt,
            metricName: metricTypes.name,
            metricUnit: metricTypes.unit,
            sportName: sports.name,
            sportColor: sports.color,
          })
          .from(goals)
          .innerJoin(metricTypes, eq(goals.metricTypeId, metricTypes.id))
          .innerJoin(sports, eq(goals.sportId, sports.id))
          .where(ne(goals.status, "abandoned"));

        const enriched = await Promise.all(
          rows.map(async (g) => {
            const p = await computeGoalProgress(g);
            return {
              id: g.id,
              sport: g.sportName,
              metric: g.metricName,
              unit: g.metricUnit,
              target: g.targetValue,
              deadline: g.deadline,
              current_value: p.currentValue,
              progress_pct: p.progress,
              required_rate_per_week: p.requiredRatePerWeek,
              actual_rate_per_week: p.actualRatePerWeek,
              days_remaining: p.daysRemaining,
              status: p.status,
            };
          })
        );
        return { ok: true, data: enriched };
      }
      case "create_focus": {
        const { name: focusName, sport_id, goal_id, technical_notes } = input as {
          name: string; sport_id: number; goal_id?: number; technical_notes?: string;
        };
        if (!focusName || !sport_id) return { ok: false, error: "name and sport_id are required" };
        const today = new Date().toISOString().slice(0, 10);
        const result = await db.insert(focuses).values({
          name: focusName,
          sportId: sport_id,
          goalId: goal_id ?? null,
          startDate: today,
          status: "active",
          technicalNotes: technical_notes,
        }).returning({ id: focuses.id });
        return { ok: true, data: { id: result[0].id, name: focusName, sport_id, goal_id: goal_id ?? null, start_date: today } };
      }
      case "create_goal": {
        const { metric_type_id, sport_id, target_value, deadline } = input as {
          metric_type_id: number; sport_id: number; target_value: number; deadline: string;
        };
        if (!metric_type_id || !sport_id || target_value === undefined || !deadline) {
          return { ok: false, error: "metric_type_id, sport_id, target_value, and deadline are required" };
        }
        const result = await db.insert(goals).values({
          metricTypeId: metric_type_id,
          sportId: sport_id,
          targetValue: target_value,
          deadline,
        }).returning({ id: goals.id });
        return { ok: true, data: { id: result[0].id, metric_type_id, sport_id, target_value, deadline } };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const CHAT_SYSTEM_PROMPT = `You are Delta's training coach. You help the user think through their training goals and focuses, then create them in the database using tools.

Core framing:
- GOALS are fundamental - numeric targets with deadlines (e.g. deadlift 500lb by April 2027). They define what success means.
- FOCUSES are tools that advance goals - multi-week narrative training themes (e.g. "Break 315 Bench", "Cross-Face Defense") with technical notes.
- When someone says "I want to work on X", your default move is to clarify the underlying GOAL first, then help define a FOCUS that advances it.

Style:
- Direct, terse. No filler, no pep talk.
- Ask ONE question at a time when exploring their goals.
- Don't be preachy. Respect that they're an experienced athlete.

Responsibilities:
- Start by understanding the goal. What's the numeric target? When's the deadline?
- Once the goal is clear, ask what focuses (training themes, techniques, protocols) will advance it.
- Summarize what you heard, then confirm before calling tools.
- Use read tools (list_*) to check existing state before creating new things.

Tool use rules:
- Call list_sports, list_metric_types, list_active_focuses, or list_goals FIRST to understand the current state before creating anything.
- When creating: prefer create_goal before create_focus when both are being set up. If only a focus is being discussed, check list_goals first to see what it's advancing.
- Before calling create_focus or create_goal, explicitly confirm the details with the user ("I'll create a focus called 'Break 315 Bench' for powerlifting with these notes: [summary]. Sound right?").
- After a user confirms, call the create tool and report back briefly.
- One create action per user confirmation. Don't batch.

Keep responses short. Most turns should be 1-3 sentences.`;
