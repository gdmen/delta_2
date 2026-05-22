/**
 * Pure selection helpers shared by every checkbox table (the data
 * catalogs via `useTableSelection`, the events list, the duplicates
 * view). Deliberately framework-free: each table owns its own
 * `useState<Set>` + anchor; these functions carry only the logic that
 * would otherwise be copy-pasted (and drift) across all three. See #37.
 */

/**
 * The keys to flip for a shift-click range select.
 *
 * Resolves the anchor (last non-shift-clicked key) and the just-clicked
 * key against the current visible order, and returns every key in the
 * inclusive span between them. Returns `[]` when either key isn't in
 * `orderedKeys` (e.g. the anchor was filtered/sorted out of view) — the
 * caller treats that as "no range" and falls back to a single toggle.
 *
 * Keys are primitives (row ids / group-key strings), so `indexOf`
 * identity is correct.
 */
export function computeRange<K>(
  orderedKeys: readonly K[],
  anchorKey: K,
  clickedKey: K,
): K[] {
  const a = orderedKeys.indexOf(anchorKey);
  const c = orderedKeys.indexOf(clickedKey);
  if (a === -1 || c === -1) return [];
  const [lo, hi] = a <= c ? [a, c] : [c, a];
  return orderedKeys.slice(lo, hi + 1);
}

/**
 * What a click on the tri-state header checkbox should do.
 *
 *   none selected      → "selectAll"
 *   some selected ("-") → "clear"   ← the bug fix: clicking the
 *   all selected        → "clear"      indeterminate dash clears,
 *                                       it does NOT select-all.
 *
 * Single definition so the same rule lands in every table's header.
 */
export function headerNextState(
  allSelected: boolean,
  someSelected: boolean,
): "clear" | "selectAll" {
  return allSelected || someSelected ? "clear" : "selectAll";
}
