// Worker: reads an NDJSON HTTP response, parses one hit per line, and
// batches emitted hits to the main thread at ~30Hz. Main-thread-side
// the flush is an append — React only re-renders once per frame,
// keeping the terminal WebSocket frames flowing.
//
// Protocol:
//   main → worker:  { kind: "start", url: string, headers?: Record<string,string> }
//                   { kind: "abort" }
//   worker → main:  { kind: "hits", hits: Hit[] }
//                   { kind: "done" }
//                   { kind: "error", message: string }

interface StartMsg {
  kind: "start";
  url: string;
}

interface AbortMsg {
  kind: "abort";
}

type InMsg = StartMsg | AbortMsg;

let abortCtl: AbortController | null = null;

self.addEventListener("message", async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.kind === "abort") {
    abortCtl?.abort();
    abortCtl = null;
    return;
  }
  if (msg.kind !== "start") return;

  abortCtl?.abort();
  abortCtl = new AbortController();
  const my = abortCtl;

  try {
    const resp = await fetch(msg.url, { signal: my.signal });
    if (!resp.ok || !resp.body) {
      (self as unknown as Worker).postMessage({
        kind: "error",
        message: `HTTP ${resp.status}`,
      });
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let batch: unknown[] = [];
    let lastFlush = performance.now();
    const FLUSH_MS = 33; // ~30Hz

    const flush = () => {
      if (batch.length === 0) return;
      (self as unknown as Worker).postMessage({ kind: "hits", hits: batch });
      batch = [];
      lastFlush = performance.now();
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          batch.push(JSON.parse(line));
        } catch {
          // Skip malformed records.
        }
      }
      if (performance.now() - lastFlush > FLUSH_MS) {
        flush();
      }
    }
    flush();
    (self as unknown as Worker).postMessage({ kind: "done" });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") return;
    (self as unknown as Worker).postMessage({
      kind: "error",
      message: (err as Error).message,
    });
  }
});
