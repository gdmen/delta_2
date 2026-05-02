import { NextResponse } from "next/server";

/**
 * Cap on incoming JSON body size for the dashboard mutation routes. Larger
 * payloads are rejected up front so we don't waste memory loading a 100MB
 * blob just to have Zod reject it. The dashboard + widget mutation
 * payloads are tiny (config is itself capped at 4KB by serializeConfig);
 * 64KB is generous headroom.
 */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Read JSON from a request with a body-size guard. Returns either:
 *   - { ok: true, value }: parsed JSON (could be any type)
 *   - { ok: false, response }: a NextResponse with an error status the
 *     caller should return directly
 *
 * Usage:
 *   const r = await readJson(req);
 *   if (!r.ok) return r.response;
 *   const body = r.value;
 */
export async function readJson(
  req: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const len = Number(contentLengthHeader);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `Request body too large (max ${MAX_BODY_BYTES} bytes).` },
          { status: 413 },
        ),
      };
    }
  }
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
    };
  }
  return { ok: true, value };
}
