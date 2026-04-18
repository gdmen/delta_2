import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ImportMapping } from "@/lib/import-mapping";

/**
 * POST /api/import-assistant/chat
 *
 * A small Claude-powered helper that reads the user's CSV (headers +
 * sample rows) and chats them through building an ImportMapping. The
 * model can either reply with text (clarifying question, explanation)
 * or call the `propose_mapping` tool to emit a full mapping JSON that
 * the wizard can apply with one click.
 *
 * Not a full coach loop - single-round per request, stateless on the
 * server, the client carries conversation history.
 */

interface ChatRequest {
  csv: {
    headers: string[];
    sampleRows: string[][];
    totalRows: number;
  };
  kind: "metrics" | "events" | "workout_sets";
  currentMapping: ImportMapping | null;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Canonical metric_types.name values in the DB (for context). */
  metricTypes: string[];
  /** Sports.name values in the DB. */
  sports: string[];
}

const SYSTEM_PROMPT = `You are Delta's CSV import assistant. Your job is to help the user map a third-party fitness CSV onto Delta's data model.

Delta has three kinds of measured data:
- "metrics": timestamped numeric observations (bodyweight, HRV, steps). Mapping fields: recordedAt, metrics[] (each entry has name + value + optional unit), optional sourceId, optional rowFilter.
- "events": sessions (runs, rides, classes). Mapping fields: startedAt, sport, type, optional durationMinutes/notes/sourceId, optional metrics[] (attached per-event dimensions like distance_mi or avg_hr), optional rowFilter.
- "workout_sets": per-set lifting rows. Mapping fields: startedAt, sport, eventType, exerciseName, reps, weight, optional eventSourceId/setNumber/rpe/notes, optional rowFilter.

ValueSlot shape (every non-date field uses this):
- { "source": "column", "ref": { "column": "Header Name" } }  OR  { "column": "..." , "index": 1-based }
- { "source": "column", "ref": { "column": "..." }, "aliases": { "Raw": "Canonical" } } to rewrite column values
- { "source": "literal", "value": "..." }
- { "source": "none" }

Date shape: { "ref": { "column": "..." }, "format": "auto" | "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY" | "MM-DD-YYYY" | "D-MMM-YY" }

RowFilter: { "column": "...", "op": "equals"|"notEquals"|"nonEmpty", "value": "..." } OR { op: "in"|"notIn", "values": [...] }

Style:
- Terse, direct. No preamble. No emojis.
- Inspect the headers and sample rows. Match obvious columns; ask about ambiguous ones.
- Prefer canonical Delta metric names + sport names when they fit (user will be shown the canonical list).
- When you're ready, call propose_mapping with the full JSON + a one-sentence explanation.
- Do NOT wrap the tool call in chat text - call the tool directly.
- If the user's CSV has mixed kinds (some rows belong to a different kind), suggest a rowFilter.`;

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose_mapping",
  description:
    "Propose a complete ImportMapping JSON the user can one-click apply. Only call when you have enough context.",
  input_schema: {
    type: "object",
    properties: {
      mapping: {
        type: "object",
        description:
          "The full ImportMapping object. Must have `kind` + the required fields for that kind.",
      },
      explanation: {
        type: "string",
        description: "One short sentence describing what you mapped and why.",
      },
    },
    required: ["mapping", "explanation"],
  },
};

export async function POST(request: NextRequest) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || apiKey === "your-claude-api-key-here") {
    return NextResponse.json(
      { error: "Delta assistant is not configured (missing CLAUDE_API_KEY)" },
      { status: 503 }
    );
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { csv, kind, currentMapping, messages, metricTypes, sports } = body;

  const contextBlock = [
    `Current kind: ${kind}`,
    `Canonical metric names in use: ${metricTypes.slice(0, 40).join(", ") || "(none)"}`,
    `Sports: ${sports.join(", ") || "(none)"}`,
    `CSV total rows: ${csv.totalRows}`,
    `CSV headers (${csv.headers.length}): ${JSON.stringify(csv.headers)}`,
    `First ${csv.sampleRows.length} rows:`,
    ...csv.sampleRows.map((r, i) => `  row ${i + 1}: ${JSON.stringify(r)}`),
    currentMapping
      ? `Current mapping (may be partial / incorrect):\n${JSON.stringify(currentMapping, null, 2)}`
      : `No mapping yet.`,
  ].join("\n");

  // Prepend the context as a synthetic first user message so Claude sees it
  // regardless of conversation position.
  const apiMessages: Anthropic.MessageParam[] = [
    { role: "user", content: `CSV context:\n${contextBlock}` },
    { role: "assistant", content: "Got it. What do you want to map?" },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      tools: [PROPOSE_TOOL],
      messages: apiMessages,
    });

    // Pull out tool-use + text blocks.
    let proposedMapping: ImportMapping | undefined;
    let explanation: string | undefined;
    let replyText = "";
    for (const block of response.content) {
      if (block.type === "text") {
        replyText += block.text;
      } else if (block.type === "tool_use" && block.name === "propose_mapping") {
        const input = block.input as { mapping?: ImportMapping; explanation?: string };
        if (input.mapping) proposedMapping = input.mapping;
        if (input.explanation) explanation = input.explanation;
      }
    }

    // If the tool fired without any text, surface the explanation so the
    // user sees something alongside the Apply button.
    if (!replyText && explanation) replyText = explanation;

    return NextResponse.json({
      reply: replyText.trim() || "(no reply)",
      proposedMapping,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
