// Small reusable "copy" button with transient success feedback. Used by
// the timeline detail view to expose copy-as-markdown actions (ticket
// #20) without pulling in a toast system.

import { type ReactNode, useEffect, useRef, useState } from "react";

import { copyToClipboard } from "../terminal/clipboard";
import "./CopyButton.css";

interface Props {
  /** The text to copy. Evaluated lazily on click via a function so we
   * don't re-format markdown on every render. */
  getText: () => string;
  /** Short textual label. When `icon` is provided, the label appears as
   * a compact subscript next to the icon; otherwise the full label
   * renders. */
  label?: string;
  /** When set, renders as an icon-first compact button. The icon is a
   * ReactNode so callers can pass a glyph, emoji, or SVG. */
  icon?: ReactNode;
  className?: string;
  title?: string;
}

export function CopyButton({
  getText,
  label = "Copy",
  icon,
  className = "",
  title,
}: Props) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const onClick = async (e: React.MouseEvent) => {
    // Stop propagation so the button can live inside a hover card /
    // expandable row without accidentally toggling the parent.
    e.stopPropagation();
    const text = getText();
    if (!text) return;
    const ok = await copyToClipboard(text);
    setState(ok ? "ok" : "err");
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 1600);
  };

  if (icon) {
    // Icon mode: tiny pill, icon + short label, status overlays the icon
    // on success/failure. The label stays so the action remains
    // self-describing without a tooltip.
    const statusIcon = state === "ok" ? "✓" : state === "err" ? "✗" : icon;
    return (
      <button
        type="button"
        className={`cb cb--icon cb--${state} ${className}`}
        onClick={onClick}
        title={title ?? `Copy ${label} as markdown`}
        aria-label={title ?? `Copy ${label}`}
      >
        <span className="cb__icon" aria-hidden>
          {statusIcon}
        </span>
        <span className="cb__label">{label}</span>
      </button>
    );
  }

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
