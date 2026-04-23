"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shared submit pattern for the merge modals: POST a JSON payload, manage
 * busy/error state, trigger router.refresh() + the supplied onSuccess on 2xx.
 */
export function useMergeSubmit(url: string, onSuccess: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize on onSuccess so a parent re-render that produces a fresh callback
  // reference (e.g. a table rerendering its closeMergeAndClear between submit
  // and response) doesn't leave us calling a stale handler.
  const submit = useCallback(
    async (body: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${res.status}`);
        }
        router.refresh();
        setBusy(false);
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [url, onSuccess, router],
  );

  return { busy, error, submit };
}
