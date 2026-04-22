/**
 * Return the item with the largest `key(item)`. Non-empty input required;
 * on ties the earlier item wins. Used by the merge modals to default-
 * select the candidate with the most data (safest canonical pick).
 */
export function pickMaxBy<T>(items: readonly T[], key: (t: T) => number): T {
  if (items.length === 0) throw new Error("pickMaxBy: empty input");
  let best = items[0];
  let bestKey = key(best);
  for (let i = 1; i < items.length; i++) {
    const k = key(items[i]);
    if (k > bestKey) {
      best = items[i];
      bestKey = k;
    }
  }
  return best;
}
