import { NextRequest, NextResponse } from "next/server";
import { parseCsv } from "@/lib/csv";
import { applyMapping, autoMatchHeaders, type ImportMapping } from "@/lib/import-mapping";
import { loadUserTimezone } from "@/lib/app-settings";

/**
 * POST /api/import-sources/preview
 * multipart/form-data:
 *   file: CSV file
 *   mapping?: JSON string - if omitted, returns headers + auto-match guesses
 *   kind?: string - only used when mapping is omitted, to pick the right auto-match table
 *
 * Always returns { headers, sampleRows, autoMatch, parsed? }
 *   - headers: CSV header names (empty strings preserved)
 *   - sampleRows: first 5 raw rows
 *   - autoMatch: suggested column refs per target (only when mapping omitted)
 *   - parsed: when mapping is provided, the output of applying it to the
 *     first 5 passing rows
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Expected multipart field "file"' }, { status: 400 });
  }

  const text = await file.text();
  const { headers, rows } = parseCsv(text);

  const mappingStr = form.get("mapping");
  const kindStr = form.get("kind");

  let mapping: ImportMapping | null = null;
  if (typeof mappingStr === "string" && mappingStr.trim()) {
    try {
      mapping = JSON.parse(mappingStr) as ImportMapping;
    } catch {
      return NextResponse.json({ error: "Invalid mapping JSON" }, { status: 400 });
    }
  }

  const out: Record<string, unknown> = {
    headers,
    sampleRows: rows.slice(0, 5),
    totalRows: rows.length,
  };

  if (!mapping && typeof kindStr === "string" && ["metrics", "events", "workout_sets"].includes(kindStr)) {
    out.autoMatch = autoMatchHeaders(kindStr as ImportMapping["kind"], headers);
  }

  if (mapping) {
    const tz = await loadUserTimezone();
    const parsed: unknown[] = [];
    const errors: string[] = [];
    let taken = 0;
    for (let i = 0; i < rows.length && taken < 5; i++) {
      const { out: rowsOut, error } = applyMapping(mapping, headers, rows[i], i, tz);
      if (error) errors.push(`row ${i + 2}: ${error}`);
      if (rowsOut.length > 0) {
        parsed.push(...rowsOut);
        taken++;
      }
    }
    out.parsed = parsed;
    out.parseErrors = errors.slice(0, 5);
  }

  return NextResponse.json(out);
}
