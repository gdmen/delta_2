"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Filter input for the merges table. Mirrors the URL `?q=` so the
 * server component re-renders with the filtered list. Debounced 200ms
 * so each keystroke doesn't fire a route fetch. Also clears `?alias=`
 * when the user starts typing — the alias deep-link is for landing,
 * the free-text input is for browsing.
 */
export function MergesFilterInput({ initial }: { initial: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("q", value.trim());
      } else {
        params.delete("q");
      }
      params.delete("alias");
      const qs = params.toString();
      router.replace(qs ? `/data/merges?${qs}` : "/data/merges");
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
