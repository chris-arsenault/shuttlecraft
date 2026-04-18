// Clipboard helpers split out of TerminalPane so sanitize logic is
// independently testable. The terminal component wires these up to
// xterm.js key/paste/context-menu hooks.
//
// Context-sensitivity note: navigator.clipboard (readText/writeText)
// requires a "secure context" — HTTPS or localhost. On a LAN-HTTP
// origin (our TrueNAS deploy at 192.168.66.3:30080) writeText is
// typically blocked, so we fall back to document.execCommand('copy')
// via a transient textarea. readText has no such fallback — paste on
// HTTP happens via the native `paste` event on keystroke gesture,
// not a JS-initiated read.

/** Zero-width and "invisible" chars that ride along in clipboard data
 * from rich sources (web pages, Slack, editors). Removing them
 * prevents the classic "paste looks right but the shell sees junk"
 * bug. */
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u2060\u180E]/g;

export function sanitizePaste(text: string): string {
  return text
    .replace(INVISIBLE_CHARS, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand.
  }
  return execCommandCopy(text);
}

export async function readClipboard(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch {
    // Secure-context only; the caller should handle null by telling
    // the user to paste via Ctrl+V instead.
  }
  return null;
}

function execCommandCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    // `document.execCommand` is formally deprecated but still works on
    // HTTP contexts where navigator.clipboard doesn't — and it does
    // so synchronously inside a user-gesture handler.
    return document.execCommand("copy");
  } finally {
    ta.remove();
  }
}
