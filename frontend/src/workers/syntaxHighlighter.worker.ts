// Worker: runs Shiki syntax highlighting off the main thread. Keeps
// the terminal WebSocket frames flowing and the tab strip responsive
// when a large file tab loads.
//
// Protocol:
//   main → worker: { kind: "highlight", lang: string, code: string, theme?: string }
//   worker → main: { kind: "highlighted", html: string }
//                  { kind: "error", message: string }
//
// Shiki's bundle is big; keep it in the worker so the main thread
// doesn't pay the parse cost until a file tab actually opens.

import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";

// Languages Shiki knows we care about. The worker lazy-loads the
// actual grammar on first demand per lang. Keep this list aligned
// with the extension map in FileTab.
const LANGS: BundledLanguage[] = [
  "rust",
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "go",
  "java",
  "c",
  "cpp",
  "shell",
  "bash",
  "toml",
  "yaml",
  "sql",
  "css",
  "scss",
  "html",
  "json",
  "markdown",
  "diff",
];

const THEME = "dark-plus";

let highlighter: Highlighter | null = null;
let ready: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (highlighter) return Promise.resolve(highlighter);
  if (!ready) {
    ready = createHighlighter({
      themes: [THEME],
      langs: LANGS,
    }).then((h) => {
      highlighter = h;
      return h;
    });
  }
  return ready;
}

type InMsg =
  | { kind: "highlight"; lang: string; code: string; id: number }
  | { kind: "warmup" };

self.addEventListener("message", async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.kind === "warmup") {
    await getHighlighter();
    (self as unknown as Worker).postMessage({ kind: "ready" });
    return;
  }
  if (msg.kind !== "highlight") return;
  try {
    const h = await getHighlighter();
    const effectiveLang = (LANGS as readonly string[]).includes(msg.lang)
      ? (msg.lang as BundledLanguage)
      : ("text" as BundledLanguage);
    const html = h.codeToHtml(msg.code, {
      lang: effectiveLang,
      theme: THEME,
    });
    (self as unknown as Worker).postMessage({
      kind: "highlighted",
      id: msg.id,
      html,
    });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      kind: "error",
      id: msg.id,
      message: (err as Error).message,
    });
  }
});
