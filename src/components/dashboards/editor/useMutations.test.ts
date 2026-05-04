// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMutations } from "./useMutations";

/**
 * Tests for the per-widget mutation queue. Focus is on the race semantics
 * the outside review flagged: flush-while-in-flight must wait for the
 * full queue to drain, not return early.
 *
 * Uses mocked global fetch since the hook's only side effect is the
 * outbound HTTP. Widget rows themselves don't matter — the hook only
 * cares about widgetIds.
 */

const ORIG_FETCH = global.fetch;

function mockOk(data: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = ORIG_FETCH;
});

describe("useMutations.patchWidget", () => {
  it("debounces 500ms and coalesces rapid edits into one PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockOk({ widget: {} }));
    global.fetch = fetchMock as typeof fetch;
    const { result } = renderHook(() => useMutations(1));

    act(() => {
      result.current.patchWidget(42, { gridX: 1 });
      result.current.patchWidget(42, { gridX: 2 });
      result.current.patchWidget(42, { gridX: 3 });
    });

    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.gridX).toBe(3);
  });

  it("merges fields across calls so each one survives", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockOk());
    global.fetch = fetchMock as typeof fetch;
    const { result } = renderHook(() => useMutations(1));

    act(() => {
      result.current.patchWidget(42, { gridX: 5 });
      result.current.patchWidget(42, { gridY: 7 });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ gridX: 5, gridY: 7 });
  });
});

describe("useMutations.flushOne", () => {
  it("waits for the full queue to drain even when called during in-flight", async () => {
    let resolveFirst!: (r: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    ).mockImplementation(() => Promise.resolve(mockOk()));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result } = renderHook(() => useMutations(1));

    act(() => {
      result.current.patchWidget(42, { gridX: 1 });
    });

    // Trigger the first send (debounce expires).
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // First request is in flight; queue another patch on top of it.
    act(() => {
      result.current.patchWidget(42, { gridX: 2 });
    });

    // Caller starts awaiting flushOne. The promise should NOT resolve
    // until both requests have completed (the in-flight one + the
    // queued-up second patch). We track that via a flag flipped after
    // the await, then assert it's still false until the in-flight is
    // released.
    let resolved = false;
    let flushPromise!: Promise<void>;
    await act(async () => {
      flushPromise = result.current.flushOne(42).then(() => {
        resolved = true;
      });
      // Drain the debounce timer for the second patch (still in-flight on first).
      vi.advanceTimersByTime(500);
    });
    expect(resolved).toBe(false);

    // Release the first request and let the queue drain.
    await act(async () => {
      resolveFirst(mockOk());
      await vi.runAllTimersAsync();
      await flushPromise;
    });

    expect(resolved).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("useMutations.deleteWidget", () => {
  it("drops queued patches for the deleted widget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockOk());
    global.fetch = fetchMock as typeof fetch;
    const { result } = renderHook(() => useMutations(1));

    act(() => {
      result.current.patchWidget(42, { gridX: 1 });
    });

    await act(async () => {
      await result.current.deleteWidget(42);
    });

    // Advance the now-orphaned debounce timer; nothing should fire for #42.
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();
    });

    // Only the DELETE request, no PATCH for the abandoned queued patch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]!.method).toBe("DELETE");
  });
});

describe("useMutations 401 handling", () => {
  it("reloads the page when a mutation returns 401", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload },
      writable: true,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response) as typeof fetch;
    const { result } = renderHook(() => useMutations(1));

    await act(async () => {
      await result.current.deleteWidget(42);
    });

    expect(reload).toHaveBeenCalled();
  });
});
