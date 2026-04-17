import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// Strict set of fields we ask Claude to extract from a BodySpec DEXA PDF.
// The client displays these for user review before saving.
const EXTRACTION_PROMPT = `You are extracting data from a BodySpec DEXA scan report PDF.

Return ONLY a JSON object with these fields. Use null for any field not clearly present in the report. Do NOT guess or infer values.

{
  "scan_date": "YYYY-MM-DD",
  "body_weight_lb": number | null,
  "body_fat_pct": number | null,
  "lean_mass_lb": number | null,
  "fat_mass_lb": number | null,
  "bone_mineral_density": number | null,
  "visceral_fat_lb": number | null,
  "notes": string | null
}

Notes on units:
- body_weight_lb, lean_mass_lb, fat_mass_lb, visceral_fat_lb: pounds (convert kg to lb if needed: multiply by 2.20462)
- body_fat_pct: percentage as a number (e.g. 18.5 for 18.5%)
- bone_mineral_density: g/cm² (typical range 1.0-1.4 for healthy adults)

If the report is not a BodySpec DEXA scan, return: {"error": "not_bodyspec_dexa"}

Return ONLY the JSON object. No markdown code fences, no preamble, no trailing text.`;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || apiKey === "your-claude-api-key-here") {
    return NextResponse.json({ error: "CLAUDE_API_KEY not configured" }, { status: 503 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: `Expected PDF, got ${file.type || "unknown"}` }, { status: 400 });
  }

  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "PDF exceeds 10 MB limit" }, { status: 413 });
  }

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json({ error: "Delta returned no text" }, { status: 500 });
    }

    const text = textBlock.text.trim();

    // Strip markdown fences if Claude ignores instructions and wraps JSON.
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "No JSON found in response", raw: text }, { status: 500 });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: "Malformed JSON from Delta", raw: text }, { status: 500 });
    }

    if (parsed.error === "not_bodyspec_dexa") {
      return NextResponse.json(
        { error: "This PDF doesn't look like a BodySpec DEXA scan." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      fileName: file.name,
      extracted: parsed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
