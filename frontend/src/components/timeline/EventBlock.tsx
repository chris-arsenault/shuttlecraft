// Single event row in the timeline. Collapsed: one-line preview. Expanded:
// full text content + raw JSON. Tool-specific renderers land in #11.

import { useState } from "react";

import type { TimelineEvent } from "../../api/types";
import {
  flattenContent,
  isToolResultUser,
  payloadOf,
  textPreview,
  toolUsesIn,
} from "./types";
import { ToolCallRenderer } from "./tools/renderers";

export function EventBlock({ event }: { event: TimelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const p = payloadOf(event);
  const kind = effectiveKind(event);
  const tools = toolUsesIn(event);

  return (
    <div className={`tl-event tl-event--${kind}`}>
      <button
        type="button"
        className="tl-event__header"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="tl-event__chevron">{expanded ? "▾" : "▸"}</span>
        <span className={`tl-event__badge tl-event__badge--${kind}`}>
          {labelOf(kind)}
        </span>
        <span className="tl-event__preview">{textPreview(event, 180)}</span>
        {tools.length > 0 && (
          <span className="tl-event__tool-count" title={toolNames(tools)}>
            {tools.length} tool{tools.length === 1 ? "" : "s"}
          </span>
        )}
        <span className="tl-event__time">{formatTime(event.timestamp)}</span>
      </button>
      {expanded && (
        <div className="tl-event__body">
          <pre className="tl-event__text">
            {flattenContent(p.message?.content) || "— no inline text —"}
          </pre>
          {tools.length > 0 && (
            <div className="tl-event__tools">
              {tools.map((t, i) => (
                <details key={t.id ?? i} className="tl-event__tool" open>
                  <summary>
                    {t.name ?? "tool"}{" "}
                    <code className="tl-event__tool-id">
                      {t.id?.slice(0, 8)}
                    </code>
                  </summary>
                  <ToolCallRenderer tool={t} />
                </details>
              ))}
            </div>
          )}
          <details className="tl-event__raw">
            <summary>raw</summary>
            <pre>{JSON.stringify(event.payload, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

function effectiveKind(event: TimelineEvent): string {
  if (isToolResultUser(event)) return "tool_result";
  return event.kind;
}

function labelOf(kind: string): string {
  switch (kind) {
    case "user":
      return "user";
    case "assistant":
      return "claude";
    case "tool_result":
      return "result";
    case "summary":
      return "summary";
    default:
      return kind;
  }
}

function toolNames(tools: Array<{ name?: string }>): string {
  return tools.map((t) => t.name ?? "?").join(", ");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
