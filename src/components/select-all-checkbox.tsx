"use client";

import { useEffect, useRef } from "react";
import { headerNextState } from "@/lib/selection";

/**
 * The header "select all / clear" checkbox shared by every checkbox table.
 * Encapsulates the two things that were copy-pasted (and drifted — one
 * surface used a ref callback, two used useEffect) across the surfaces:
 *
 *  1. the tri-state `indeterminate` glyph, which is a DOM *property* and so
 *     can only be set via ref, never as an attribute; and
 *  2. the click decision: clicking the "-" dash CLEARS, it never
 *     selects-all (the bug `headerNextState` fixes).
 *
 * Renders only the <input>; callers own the surrounding <th>/<label> and
 * layout classes. See #37.
 */
export function SelectAllCheckbox({
  allSelected,
  someSelected,
  onSelectAll,
  onClear,
  disabled,
  selectAllLabel = "Select all",
  clearLabel = "Clear selection",
  className,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  disabled?: boolean;
  selectAllLabel?: string;
  clearLabel?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allSelected}
      onChange={() =>
        headerNextState(allSelected, someSelected) === "clear"
          ? onClear()
          : onSelectAll()
      }
      disabled={disabled}
      aria-label={allSelected ? clearLabel : selectAllLabel}
      className={className}
    />
  );
}
