import { NextResponse } from "next/server";

/**
 * Shared payload validation for the three merge endpoints
 * (metric-types, sports, exercises). Returns either a typed struct to
 * destructure, or a ready-to-return NextResponse carrying the 400.
 */

type Result<T> = { ok: true; value: T } | { ok: false; response: NextResponse };

export function parseMergeByIdBody(
  body: unknown,
): Result<{ canonicalId: number; mergeIds: number[] }> {
  const b = (body ?? {}) as { canonicalId?: unknown; mergeIds?: unknown };
  const canonicalId = Number(b.canonicalId);
  const mergeIds = Array.isArray(b.mergeIds)
    ? [...new Set(b.mergeIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))]
    : [];

  if (!Number.isFinite(canonicalId) || canonicalId <= 0) {
    return err("canonicalId is required");
  }
  if (mergeIds.length === 0) {
    return err("mergeIds must be non-empty");
  }
  if (mergeIds.includes(canonicalId)) {
    return err("canonicalId cannot be in mergeIds");
  }
  return { ok: true, value: { canonicalId, mergeIds } };
}

export function parseMergeByNameBody(
  body: unknown,
): Result<{ canonical: string; mergeNames: string[] }> {
  const b = (body ?? {}) as { canonical?: unknown; mergeNames?: unknown };
  const canonical = typeof b.canonical === "string" ? b.canonical.trim() : "";
  const mergeNames = Array.isArray(b.mergeNames)
    ? [...new Set(b.mergeNames.map((s) => String(s).trim()).filter(Boolean))]
    : [];

  if (!canonical) return err("canonical is required");
  if (mergeNames.length === 0) return err("mergeNames must be non-empty");
  if (mergeNames.includes(canonical)) return err("canonical cannot be in mergeNames");
  return { ok: true, value: { canonical, mergeNames } };
}

function err(message: string): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status: 400 }),
  };
}
