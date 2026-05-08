"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Filter input for the merges table. Mirrors the URL `?q=` so the
 * server component re-renders with the filtered list. Debounced 200ms
 * so each keystroke doesn't fire a route fetch.
 */
export function MergesFilterInput({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = value.trim();
      const qs = trimmed ? `?q=${encodeURIComponent(trimmed)}` : "";
      router.replace(`/data/merges${qs}`);
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Filter merges..."
      className="w-full max-w-xs px-3 py-1.5 border border-border rounded text-[0.875rem] mb-3"
    />
  );
}
