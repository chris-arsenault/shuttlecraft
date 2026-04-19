// Small reusable "copy" button with transient success feedback. Used by
// the timeline detail view to expose copy-as-markdown actions (ticket
// #20) without pulling in a toast system.

import { useEffect, useRef, useState } from "react";

import { copyToClipboard } from "../terminal/clipboard";
import "./CopyButton.css";

interface Props {
  /** The text to copy. Evaluated lazily on click via a function so we
   * don't re-format markdown on every render. */
  getText: () => string;
  label?: string;
  className?: string;
  title?: string;
}

export function CopyButton({ getText, label = "Copy", className = "", title }: Props) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const onClick = async () => {
    const text = getText();
    if (!text) return;
    const ok = await copyToClipboard(text);
    setState(ok ? "ok" : "err");
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 1600);
  };

  const display =
    state === "ok" ? "Copied" : state === "err" ? "Copy failed" : label;

  return (
    <button
      type="button"
      className={`cb cb--${state} ${className}`}
      onClick={onClick}
      title={title ?? "Copy as markdown"}
    >
      {display}
    </button>
  );
}
