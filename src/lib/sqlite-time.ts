/**
 * SQLite's `datetime('now')` writes timestamps as `YYYY-MM-DD HH:MM:SS` —
 * UTC, but with a space separator and no `Z` suffix. JavaScript's
 * `new Date(string)` constructor parses that format as LOCAL time
 * (the ECMAScript spec only guarantees UTC parsing for ISO 8601 with
 * the `T` separator AND a `Z`/offset).
 *
 * Result: a row written at 12:31 UTC becomes 12:31 LOCAL when read back
 * by Node, which means `.toISOString()` on a Pacific laptop returns
 * 19:31 UTC — 7 hours in the future. The "-25100s ago" bug.
 *
 * `parseSqliteUtc` normalises by upgrading the SQLite format to ISO 8601
 * with explicit Z. ISO strings with `T` + `Z` (or an explicit offset)
 * pass through unchanged.
 */
export function parseSqliteUtc(ts: string): Date {
  if (!ts) return new Date(NaN);
  // Already ISO with Z or explicit offset — let JS handle it.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(ts)) return new Date(ts);
  // SQLite's space-separated UTC. Replace space with T, append Z.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(ts)) {
    return new Date(`${ts.replace(" ", "T")}Z`);
  }
  // Fallback: hand it to JS. NaN if it's truly malformed.
  return new Date(ts);
}
