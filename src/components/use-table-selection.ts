"use client";

import { useMemo, useRef, useState } from "react";
import { computeRange } from "@/lib/selection";

export type SortDir = "asc" | "desc";
export type SortState = { colIdx: number; dir: SortDir } | null;

/**
 * Shared selection + filter + sort state for the data-tab tables
 * (metrics, sports, exercises, aliases). Each row is keyed by whatever
 * `getKey` returns; pass a `filterText` extractor to enable the
 * search-input path; pass per-column `sortBy` extractors via
 * SelectableDataTable's columns array to enable click-to-sort.
 *
 * Default order is whatever the caller passed in (caller-controlled,
 * e.g. metrics sorted by row-count desc). User clicking a sortable
 * header overrides it; clicking the same header again flips direction;
 * clicking a third time clears (returns to caller's default order).
 */
export function useTableSelection<T, K>(
  rows: readonly T[],
  getKey: (row: T) => K,
  filterText?: (row: T) => string,
  sortBys?: (((row: T) => string | number | null) | undefined)[],
) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<K>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [sort, setSort] = useState<SortState>(null);

  const filteredAndSorted = useMemo(() => {
    let result: T[];
    if (!filterText) {
      result = [...rows];
    } else {
      const needle = filter.trim().toLowerCase();
      result = needle
        ? rows.filter((r) => filterText(r).toLowerCase().includes(needle))
        : [...rows];
    }
    if (sort && sortBys) {
      const extract = sortBys[sort.colIdx];
      if (extract) {
        const dir = sort.dir === "asc" ? 1 : -1;
        result.sort((a, b) => {
          const av = extract(a);
          const bv = extract(b);
          // Nulls always sink to the bottom regardless of direction.
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          if (av < bv) return -1 * dir;
          if (av > bv) return 1 * dir;
          return 0;
        });
      }
    }
    return result;
  }, [rows, filter, filterText, sort, sortBys]);
  const filtered = filteredAndSorted;

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(getKey(r))),
    [rows, selected, getKey],
  );

  function isSelected(row: T) {
    return selected.has(getKey(row));
  }

  function toggle(row: T) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = getKey(row);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    anchorRef.current = getKey(row);
  }

  // Anchor for shift-click range select: the last key toggled WITHOUT
  // shift. Stored by key (not index) so it survives re-sorts/filters —
  // resolved against the current `filtered` order at click time.
  const anchorRef = useRef<K | null>(null);

  /**
   * Checkbox handler that supports shift-click range select (#37).
   * Without shift (or with no anchor yet) it's a single toggle that
   * sets the anchor. With shift it fills the inclusive range from the
   * anchor to this row, setting every key in the span to this row's
   * RESULTING state (Behavior B: shift a checked box clears the range,
   * an unchecked box selects it). The range accretes — keys outside the
   * span are untouched. Anchor is unchanged on a shift-click.
   */
  function toggleRange(row: T, withShift: boolean) {
    const key = getKey(row);
    if (withShift && anchorRef.current !== null) {
      const range = computeRange(filtered.map(getKey), anchorRef.current, key);
      if (range.length > 0) {
        const target = !selected.has(key);
        setSelected((prev) => {
          const next = new Set(prev);
          for (const k of range) {
            if (target) next.add(k);
            else next.delete(k);
          }
          return next;
        });
        return;
      }
      // Anchor fell out of the visible set → treat as a fresh single
      // toggle (the `toggle` below re-sets the anchor).
    }
    toggle(row);
  }

  function clearSelection() {
    setSelected(new Set());
    anchorRef.current = null;
  }

  /**
   * Tri-state for the header-row checkbox: "none of the filtered rows
   * selected" / "all of them" / "some but not all" (indeterminate). The
   * comparison is against `filtered`, not `rows` — when the user has a
   * search filter active, "select all" should mean "all visible," not
   * "all rows in the table." That matches user intent for the common
   * case (filter to `bodyspec_dexa:`, then select all to bulk-edit) and
   * keeps the hidden rows from being silently swept into the action.
   */
  const filteredAllSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(getKey(r)));
  const filteredSomeSelected =
    !filteredAllSelected && filtered.some((r) => selected.has(getKey(r)));

  /** Add every currently-filtered row to the selection set. Keeps any
   * already-selected rows that happen to be hidden by the current
   * filter (so toggling the filter doesn't lose your selection). */
  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of filtered) next.add(getKey(r));
      return next;
    });
  }

  /** Remove every currently-filtered row from the selection set. Mirror
   * of `selectAllFiltered` — preserves selections outside the filter. */
  function clearFilteredSelection() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of filtered) next.delete(getKey(r));
      return next;
    });
  }

  // Bulk-delete progress state. `busy` blocks repeated clicks.
  // `errorMsg` surfaces a one-line summary for the user; per-row errors
  // are returned by the caller via the result object.
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /** Click-handler for a sortable column header. Cycles
   * none -> asc -> desc -> none for the same column; resets to asc
   * when switching columns. */
  function toggleSort(colIdx: number) {
    setSort((prev) => {
      if (!prev || prev.colIdx !== colIdx) return { colIdx, dir: "asc" };
      if (prev.dir === "asc") return { colIdx, dir: "desc" };
      return null;
    });
  }

  return {
    filter,
    setFilter,
    filtered,
    selected,
    isSelected,
    toggle,
    toggleRange,
    clearSelection,
    selectedRows,
    filteredAllSelected,
    filteredSomeSelected,
    selectAllFiltered,
    clearFilteredSelection,
    mergeOpen,
    openMerge: () => setMergeOpen(true),
    closeMergeAndClear: () => {
      setMergeOpen(false);
      clearSelection();
    },
    busy,
    setBusy,
    errorMsg,
    setErrorMsg,
    sort,
    toggleSort,
  };
}
