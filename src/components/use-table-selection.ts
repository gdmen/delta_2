"use client";

import { useMemo, useState } from "react";

/**
 * Shared selection + filter state for the data-tab tables (metrics, sports,
 * exercises). Each row is keyed by whatever `getKey` returns; pass a
 * `filterText` extractor to enable the search-input path.
 */
export function useTableSelection<T, K>(
  rows: readonly T[],
  getKey: (row: T) => K,
  filterText?: (row: T) => string,
) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<K>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!filterText) return rows as T[];
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows as T[];
    return rows.filter((r) => filterText(r).toLowerCase().includes(needle));
  }, [rows, filter, filterText]);

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
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // Bulk-delete progress state. `busy` blocks repeated clicks.
  // `errorMsg` surfaces a one-line summary for the user; per-row errors
  // are returned by the caller via the result object.
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  return {
    filter,
    setFilter,
    filtered,
    selected,
    isSelected,
    toggle,
    clearSelection,
    selectedRows,
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
  };
}
