/**
 * Thin Server-Sent Events helpers. The route handler builds a
 * `ReadableStream<Uint8Array>` and writes frames via `emit()`. The client
 * reads the response body and parses frames via `parseSseFrames()`.
 *
 * Frame format (one event per frame, frames separated by `\n\n`):
 *
 *   event: <type>
 *   data: <JSON>
 *
 * Multi-line data values aren't supported here — we always JSON-encode
 * the payload, so the wire format stays single-line per frame.
 */

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

export function sseHeaders(): Record<string, string> {
  return SSE_HEADERS;
}

export function makeSseStream<T extends string>(
  run: (emit: (event: T, data: unknown) => void) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: T, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        await run(emit);
      } catch (err) {
        // Last-resort error surface: the run callback should already
        // emit a typed error event before throwing. If it threw before
        // emitting (or while emitting), we emit a generic one.
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });
}

/**
 * Streaming SSE parser. Feed it chunks from a `Response.body` reader and
 * yield `{ event, data }` for each complete frame. Buffers partial
 * frames across chunk boundaries.
 */
export async function* parseSseFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: unknown }, void, void> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = frame.split("\n");
      let event = "message";
      let dataRaw = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataRaw = line.slice(5).trim();
      }
      if (!dataRaw) continue;
      try {
        yield { event, data: JSON.parse(dataRaw) };
      } catch {
        // Malformed frame — skip rather than abort the whole stream.
      }
    }
  }
}
