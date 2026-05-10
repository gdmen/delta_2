import { NextRequest, NextResponse } from "next/server";
import { parseBodySpecPdf } from "@/lib/bodyspec/parse";
import { requireUserOr401 } from "@/lib/auth/require";

/**
 * POST /api/ingest/bodyspec-dexa/extract
 *
 * Extracts numeric fields from a BodySpec DEXA PDF using a programmatic
 * regex parser (src/lib/bodyspec/parse.ts). Returns a JSON envelope with
 * `extracted` populated; the client renders a per-field review form
 * before saving.
 *
 * Previously this route called Claude. The parser is deterministic, free,
 * and faster — and BodySpec's report layout has been stable across years
 * of scans. If they ever change the template, the parser fails loudly
 * (specific section returns null), preferable to silent hallucination.
 *
 * Auth: the proxy exempts /api/ingest/* (so the HAE bearer path works
 * unauth), but THIS route doesn't take a bearer token — it's only called
 * from the in-app /data-sources/bodyspec page after sign-in. Require a
 * session explicitly so an anonymous attacker can't burn CPU on the
 * regex parser via repeated 10 MB uploads.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { error } = await requireUserOr401();
  if (error) return error;

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

  const buf = Buffer.from(await file.arrayBuffer());

  try {
    const extracted = await parseBodySpecPdf(buf);
    if (!extracted.scan_date) {
      return NextResponse.json(
        { error: "Could not find a scan date in the PDF — does this look like a BodySpec DEXA report?" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      fileName: file.name,
      extracted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Parse failed: ${msg}` }, { status: 500 });
  }
}
