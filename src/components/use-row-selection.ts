"use client";

import { useRef, useState } from "react";
import { computeRange } from "@/lib/selection";

/**
 * The one row-selection state machine for every checkbox table (the data
 * catalogs via `useTableSelection`, the events list, the duplicates view).
 * Owns the selected Set, the shift-click anchor, and every selection
 * mutation. Before this, each surface hand-rolled the same machine, so a
 * selection bug (e.g. shift-click reading the wrong event, or the
 * indeterminate-header dash selecting-all) had to be fixed in three places.
 *
 * Surface-specific concerns stay in the CALLER: you compute
 * `orderedSelectableKeys` (already filtered / status-gated / grouped, in
 * display order) and pass it in. The hook only ever reasons about those
 * keys — it knows nothing about row status, pagination, or grouping. That
 * separation is what lets one machine serve three different renderers
 * without the state coupling an all-knowing hook would create. See #37.
 *
 * Keys are primitives (row ids / group-key strings) so Set identity and
 * `computeRange`'s `indexOf` are correct.
 */
export function useRowSelection<K>(orderedSelectableKeys: readonly K[]) {
  const [selected, setSelected] = useState<Set<K>>(new Set());
  // The last key toggled WITHOUT shift — the origin of a shift range.
  // Stored by key (not index) so it survives re-sorts/filters/pagination;
  // resolved against the current order at click time.
  const anchorRef = useRef<K | null>(null);

  function isSelected(key: K) {
    return selected.has(key);
  }

  /** Add or remove a batch of keys in one update. The shared mutation that
   * used to be copy-pasted as `new Set(prev); for (…) add/delete`. */
  function apply(keys: Iterable<K>, present: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (present) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  /** Single toggle; (re)sets the anchor to this key. */
  function toggle(key: K) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    anchorRef.current = key;
  }

  /**
   * Checkbox handler with shift-click range select. Without shift — or with
   * no anchor yet, or an anchor that scrolled out of the visible set — it's
   * a single toggle that sets the anchor. With shift it fills the inclusive
   * range from the anchor to this key, setting every key in the span to
   * this key's RESULTING state (Behavior B: shift a checked box clears the
   * range, an unchecked box selects it). The range accretes — keys outside
   * the span are untouched — and the anchor is unchanged on a shift-click.
   */
  function toggleRange(key: K, withShift: boolean) {
    if (withShift && anchorRef.current !== null) {
      const range = computeRange(orderedSelectableKeys, anchorRef.current, key);
      if (range.length > 0) {
        apply(range, !selected.has(key));
        return;
      }
    }
    toggle(key);
  }

  /** Clear everything (including selections hidden by a filter) + reset the
   * anchor. */
  function clearSelection() {
    setSelected(new Set());
    anchorRef.current = null;
  }

  /** Select every currently-selectable key. Keeps already-selected keys
   * that are hidden by the current filter, so toggling a filter doesn't
   * lose the selection. */
  function selectAll() {
    apply(orderedSelectableKeys, true);
  }

  /** Deselect every currently-selectable key (mirror of `selectAll`,
   * preserves out-of-view selections) + reset the anchor. Used by the
   * header dash so the next shift-click starts a fresh range rather than
   * extending from the now-cleared, invisible anchor. */
  function clearVisible() {
    apply(orderedSelectableKeys, false);
    anchorRef.current = null;
  }

  // Tri-state for the header checkbox, computed over the selectable keys:
  // none / all / some-but-not-all (indeterminate). The empty-list guard
  // matters — `[].every(...)` is true, which would wrongly read as "all".
  const allSelected =
    orderedSelectableKeys.length > 0 &&
    orderedSelectableKeys.every((k) => selected.has(k));
  const someSelected =
    !allSelected && orderedSelectableKeys.some((k) => selected.has(k));

  return {
    selected,
    isSelected,
    toggle,
    toggleRange,
    clearSelection,
    selectAll,
    clearVisible,
    allSelected,
    someSelected,
  };
}
