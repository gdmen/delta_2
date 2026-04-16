import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { CHAT_TOOLS, CHAT_SYSTEM_PROMPT, executeTool } from "@/lib/coach/chat-tools";

// Wire-format message types we accept from the client.
interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

// Sanitization limits.
const MAX_TURNS = 20;
const MAX_TOOL_ROUNDS = 6;

export async function POST(request: NextRequest) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || apiKey === "your-claude-api-key-here") {
    return NextResponse.json(
      { error: "CLAUDE_API_KEY not configured" },
      { status: 503 }
    );
  }

  let body: { messages: ClientMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const history = body.messages ?? [];
  if (!Array.isArray(history) || history.length === 0) {
    return NextResponse.json({ error: "messages must be a non-empty array" }, { status: 400 });
  }

  // Cap history to avoid runaway context.
  const trimmed = history.slice(-MAX_TURNS);

  // Convert to Anthropic format. Start with just user/assistant text turns.
  let messages: Anthropic.Messages.MessageParam[] = trimmed.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const client = new Anthropic({ apiKey });
  const toolInvocations: Array<{ name: string; input: Record<string, unknown>; result: unknown }> = [];

  try {
    // Tool-use loop: keep calling Claude until it stops requesting tools.
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: CHAT_SYSTEM_PROMPT,
        tools: CHAT_TOOLS,
        messages,
      });

      if (response.stop_reason === "tool_use") {
        // Extract tool calls and execute each.
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
        );

        const toolResultContent: Anthropic.Messages.ToolResultBlockParam[] = [];

        for (const block of toolUseBlocks) {
          const result = await executeTool(block.name, block.input as Record<string, unknown>);
          toolInvocations.push({ name: block.name, input: block.input as Record<string, unknown>, result });

          toolResultContent.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
            is_error: !result.ok,
          });
        }

        // Append Claude's tool-use turn and our tool-result turn.
        messages = [
          ...messages,
          { role: "assistant", content: response.content },
          { role: "user", content: toolResultContent },
        ];
        continue;
      }

      // Terminal response: extract text and return.
      const textBlocks = response.content.filter(
        (b): b is Anthropic.Messages.TextBlock => b.type === "text"
      );
      const text = textBlocks.map((b) => b.text).join("\n").trim();

      return NextResponse.json({
        reply: text || "(coach returned no text)",
        toolInvocations,
        stopReason: response.stop_reason,
      });
    }

    return NextResponse.json({
      reply: "Reached tool-use round limit without a final response. Try again.",
      toolInvocations,
      stopReason: "max_rounds",
    }, { status: 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
