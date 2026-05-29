"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { dispatchUndoToast } from "@/components/undo-toast";

/**
 * Shared submit pattern for the merge modals: POST a JSON payload, manage
 * busy/error state, trigger router.refresh() + the supplied onSuccess on 2xx.
 *
 * On 2xx the response body is parsed for `mergeLogId` + `canonical` +
 * `merged` and dispatched as a `delta:undo-toast` event so the global
 * <UndoToastHost> can show the inline Undo affordance.
 */
export function useMergeSubmit(
  url: string,
  onSuccess: () => void,
  toastKind: "metric_type" | "activity",
) {
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
        const json = (await res.json().catch(() => null)) as {
          mergeLogId?: number;
          canonical?: { id: number; name: string };
          merged?: unknown[];
        } | null;
        if (json?.mergeLogId && json.canonical && Array.isArray(json.merged)) {
          dispatchUndoToast({
            mergeLogId: json.mergeLogId,
            canonicalName: json.canonical.name,
            mergedCount: json.merged.length,
            kind: toastKind,
          });
        }
        router.refresh();
        setBusy(false);
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [url, onSuccess, router, toastKind],
  );

  return { busy, error, submit };
}
