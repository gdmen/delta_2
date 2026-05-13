import { describe, expect, it } from "vitest";
import { makeSseStream, parseSseFrames } from "./sse-stream";

/**
 * Round-trip the encoder + parser without an HTTP layer in between.
 * Catches frame-format regressions (boundary parsing, JSON encoding,
 * event-type passthrough) that would otherwise only surface on a
 * real CSV import.
 */
describe("SSE stream round-trip", () => {
  async function collect(stream: ReadableStream<Uint8Array>): Promise<
    { event: string; data: unknown }[]
  > {
    const out: { event: string; data: unknown }[] = [];
    for await (const frame of parseSseFrames(stream)) {
      out.push(frame);
    }
    return out;
  }

  it("emits and parses a single frame", async () => {
    const stream = makeSseStream<"hello">(async (emit) => {
      emit("hello", { msg: "world" });
    });
    const frames = await collect(stream);
    expect(frames).toEqual([{ event: "hello", data: { msg: "world" } }]);
  });

  it("preserves event order across many frames", async () => {
    const stream = makeSseStream<"a" | "b">(async (emit) => {
      for (let i = 0; i < 50; i++) {
        emit(i % 2 === 0 ? "a" : "b", { i });
      }
    });
    const frames = await collect(stream);
    expect(frames).toHaveLength(50);
    expect(frames[0]).toEqual({ event: "a", data: { i: 0 } });
    expect(frames[1]).toEqual({ event: "b", data: { i: 1 } });
    expect(frames[49]).toEqual({ event: "b", data: { i: 49 } });
  });

  it("matches the import route's event shape", async () => {
    // Replicates exactly what /api/import-sources/[id]/import emits.
    const stream = makeSseStream<"start" | "progress" | "done">(async (emit) => {
      emit("start", { totalRows: 38123 });
      emit("progress", { rowsProcessed: 500 });
      emit("progress", { rowsProcessed: 1000 });
      emit("done", {
        kind: "metric",
        result: { accepted: 1000, skipped: 0, updated: 0, errors: [] },
        reconcile: null,
      });
    });
    const frames = await collect(stream);
    expect(frames.map((f) => f.event)).toEqual(["start", "progress", "progress", "done"]);
    expect((frames[0].data as { totalRows: number }).totalRows).toBe(38123);
    expect((frames[3].data as { result: { accepted: number } }).result.accepted).toBe(1000);
  });

  it("surfaces a thrown error as a typed error frame", async () => {
    const stream = makeSseStream<"done">(async () => {
      throw new Error("boom");
    });
    const frames = await collect(stream);
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("error");
    expect((frames[0].data as { message: string }).message).toBe("boom");
  });

  it("survives chunk boundaries inside a frame", async () => {
    // Manually craft a stream that splits a frame mid-data.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: split\ndata: {\"a\":"));
        controller.enqueue(encoder.encode("1,\"b\":2}\n\n"));
        controller.close();
      },
    });
    const frames = await collect(stream);
    expect(frames).toEqual([{ event: "split", data: { a: 1, b: 2 } }]);
  });

  it("handles two frames arriving in a single chunk", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: a\ndata: {"x":1}\n\nevent: b\ndata: {"x":2}\n\n',
          ),
        );
        controller.close();
      },
    });
    const frames = await collect(stream);
    expect(frames).toEqual([
      { event: "a", data: { x: 1 } },
      { event: "b", data: { x: 2 } },
    ]);
  });

  it("skips malformed frames without aborting the stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: good\ndata: {"x":1}\n\nevent: bad\ndata: not-json\n\nevent: good\ndata: {"x":2}\n\n',
          ),
        );
        controller.close();
      },
    });
    const frames = await collect(stream);
    expect(frames).toEqual([
      { event: "good", data: { x: 1 } },
      { event: "good", data: { x: 2 } },
    ]);
  });
});
