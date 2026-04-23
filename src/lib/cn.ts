/**
 * Tiny className joiner. Accepts strings, falsy values (skipped), and nothing else —
 * no tailwind-merge, no conflict resolution, just the common
 * `[...].filter(Boolean).join(" ")` pattern made a single function call.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    out = out ? `${out} ${p}` : p;
  }
  return out;
}
