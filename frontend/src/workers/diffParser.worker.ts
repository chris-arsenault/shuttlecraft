// Worker: parses a unified-diff string into per-file line arrays off
// the main thread. Large diffs (say, a staged vendor update) can be
// multi-MB; parsing them inline stalls React + the terminal WS.
//
// Protocol:
//   main → worker:  { raw: string }
//   worker → main:  { files: FileDiff[] }

export interface DiffLine {
  kind: "+" | "-" | " " | "@" | "f" | "i";
  text: string;
}

export interface FileDiff {
  path: string;
  lines: DiffLine[];
}

self.addEventListener("message", (ev: MessageEvent<{ raw: string }>) => {
  const { raw } = ev.data;
  const files = parseDiff(raw);
  (self as unknown as Worker).postMessage({ files });
});

function parseDiff(raw: string): FileDiff[] {
  if (!raw) return [];
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      const m = line.match(/ b\/(.+)$/);
      current = { path: m ? m[1]! : "?", lines: [] };
      current.lines.push({ kind: "f", text: line });
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@")) {
      current.lines.push({ kind: "@", text: line });
    } else if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("index ")
    ) {
      current.lines.push({ kind: "i", text: line });
    } else if (line.startsWith("+")) {
      current.lines.push({ kind: "+", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.lines.push({ kind: "-", text: line.slice(1) });
    } else {
      current.lines.push({ kind: " ", text: line.slice(1) });
    }
  }
  if (current) files.push(current);
  return files;
}
