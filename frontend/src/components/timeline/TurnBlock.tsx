// One turn in the timeline. Collapsed header: user prompt + tool badges +
// thinking badge + duration + error indicator. Expanded: sub-events with
// low-signal tool-use rolled up to a single line, error + pending tool
// uses fully rendered, thinking in its own sub-block (controlled by the
// showThinking filter).
//
// Turn-level click opens expansion inline for now. The inspector-pane
// alternative is ticket #28; this file stays compatible with either
// pattern — the TurnBlock just shells out to sub-renderers.

import { useState } from "react";

import type { TimelineEvent } from "../../api/types";
import { type ToolPair, type Turn } from "./grouping";
import {
  flattenContent,
  payloadOf,
  textBlocksIn,
  thinkingBlocksIn,
  toolResultsIn,
  userPromptText,
} from "./types";
import { ToolCallRenderer } from "./tools/renderers";
import "./TurnBlock.css";

interface Props {
  turn: Turn;
  showThinking: boolean;
  onOpenSubagent?: (toolPair: ToolPair) => void;
}

export function TurnBlock({ turn, showThinking, onOpenSubagent }: Props) {
  const [expanded, setExpanded] = useState(false);
  const preview = turnPreview(turn);
  const badges = toolBadges(turn.toolPairs);

  return (
    <div
      className={`tb ${turn.hasErrors ? "tb--errors" : ""}`}
      data-testid="turn-block"
    >
      <button
        type="button"
        className="tb__header"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="tb__chevron">{expanded ? "▾" : "▸"}</span>
        <span className="tb__prompt">{preview}</span>
        <span className="tb__badges">
          {badges.map((b) => (
            <span
              key={b.label}
              className={`tb__badge tb__badge--${b.variant}`}
              title={b.title}
            >
              {b.label}
            </span>
          ))}
          {turn.thinkingCount > 0 && showThinking && (
            <span
              className="tb__badge tb__badge--thinking"
              title={`${turn.thinkingCount} thinking step${turn.thinkingCount === 1 ? "" : "s"}`}
            >
              💭 {turn.thinkingCount}
            </span>
          )}
          {turn.hasErrors && (
            <span className="tb__badge tb__badge--error" title="Turn contains an error">
              ⚠ error
            </span>
          )}
        </span>
        <span className="tb__duration">
          {formatDuration(turn.durationMs)} · {formatTime(turn.startTimestamp)}
        </span>
      </button>
      {expanded && (
        <div className="tb__body">
          <TurnBody
            turn={turn}
            showThinking={showThinking}
            onOpenSubagent={onOpenSubagent}
          />
        </div>
      )}
    </div>
  );
}

function TurnBody({
  turn,
  showThinking,
  onOpenSubagent,
}: {
  turn: Turn;
  showThinking: boolean;
  onOpenSubagent?: (toolPair: ToolPair) => void;
}) {
  // Render in arrival order. For assistant events we walk their content
  // blocks and slot in: text, thinking (if shown), and pair-wise tool
  // calls. For tool_result-wrapper user events we skip rendering at the
  // top level — they're folded into the tool call row via turn.toolPairs.
  const pairById = new Map(turn.toolPairs.map((p) => [p.id, p] as const));

  return (
    <div className="tb__events">
      {turn.events.map((ev, idx) => {
        if (ev.kind === "user" && idx === 0 && ev === turn.userPrompt) {
          return (
            <div key={ev.byte_offset} className="tb__sub tb__sub--user-prompt">
              <pre className="tb__user-prompt-text">{userPromptText(ev)}</pre>
            </div>
          );
        }
        if (ev.kind === "user") {
          // tool_result wrapper — already surfaced via toolPairs; skip
          return null;
        }
        if (ev.kind === "assistant") {
          return (
            <AssistantSubRow
              key={ev.byte_offset}
              event={ev}
              pairById={pairById}
              showThinking={showThinking}
              onOpenSubagent={onOpenSubagent}
            />
          );
        }
        if (ev.kind === "summary") {
          return (
            <div key={ev.byte_offset} className="tb__sub tb__sub--summary">
              <span className="tb__sub-label">summary</span>
              <span>{flattenContent(payloadOf(ev).message?.content) || summaryTextOf(ev)}</span>
            </div>
          );
        }
        if (ev.kind === "system") {
          return (
            <div key={ev.byte_offset} className="tb__sub tb__sub--system">
              <span className="tb__sub-label">system</span>
              <span>
                {payloadOf(ev).subtype ?? "system"}{" "}
                {flattenContent(payloadOf(ev).message?.content)}
              </span>
            </div>
          );
        }
        return (
          <div key={ev.byte_offset} className="tb__sub tb__sub--generic">
            <span className="tb__sub-label">{ev.kind}</span>
            <details>
              <summary>raw</summary>
              <pre>{JSON.stringify(ev.payload, null, 2)}</pre>
            </details>
          </div>
        );
      })}
    </div>
  );
}

function AssistantSubRow({
  event,
  pairById,
  showThinking,
  onOpenSubagent,
}: {
  event: TimelineEvent;
  pairById: Map<string, ToolPair>;
  showThinking: boolean;
  onOpenSubagent?: (pair: ToolPair) => void;
}) {
  const texts = textBlocksIn(event);
  const thoughts = thinkingBlocksIn(event);
  const toolUseIds =
    (payloadOf(event).message?.content as { type: string; id?: string }[] | undefined)
      ?.filter((b) => b.type === "tool_use")
      .map((b) => b.id ?? "") ?? [];

  return (
    <div className="tb__sub tb__sub--assistant">
      {texts.map((t, i) => (
        <p key={`t-${i}`} className="tb__text">
          {t}
        </p>
      ))}
      {showThinking &&
        thoughts.map((th, i) => (
          <div key={`k-${i}`} className="tb__thinking">
            <span className="tb__thinking-glyph">💭</span>
            <div className="tb__thinking-body">
              <div className="tb__thinking-label">thinking</div>
              <pre>{th.thinking ?? ""}</pre>
            </div>
          </div>
        ))}
      {toolUseIds.map((id) => {
        const pair = pairById.get(id);
        if (!pair) return null;
        return (
          <ToolPairRow
            key={pair.id || id}
            pair={pair}
            onOpenSubagent={onOpenSubagent}
          />
        );
      })}
    </div>
  );
}

function ToolPairRow({
  pair,
  onOpenSubagent,
}: {
  pair: ToolPair;
  onOpenSubagent?: (pair: ToolPair) => void;
}) {
  // Low-signal rendering: a tool_use with a successful tool_result (no
  // is_error) collapses to a single line by default. Errors always get
  // their full-detail rendering. Pending pairs (no result yet) also
  // expand since the user probably wants to know something's in flight.
  const lowSignal = !pair.isError && !pair.isPending;
  const [expanded, setExpanded] = useState(!lowSignal);

  return (
    <div
      className={`tb__tool ${pair.isError ? "tb__tool--error" : ""} ${
        pair.isPending ? "tb__tool--pending" : ""
      }`}
    >
      <div className="tb__tool-header">
        <button
          type="button"
          className="tb__tool-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse tool details" : "Expand tool details"}
        >
          <span className="tb__tool-chevron">{expanded ? "▾" : "▸"}</span>
          <span className={`tb__tool-name tb__tool-name--${pair.name.toLowerCase()}`}>
            {pair.name}
          </span>
          <span className="tb__tool-summary">{toolSummary(pair)}</span>
          {pair.isPending && <span className="tb__tool-status">pending</span>}
          {pair.isError && <span className="tb__tool-status tb__tool-status--error">error</span>}
          {!expanded && !pair.isError && !pair.isPending && (
            <span className="tb__tool-status tb__tool-status--ok">ok</span>
          )}
        </button>
        {pair.name === "Task" && onOpenSubagent && (
          <button
            type="button"
            className="tb__tool-subagent"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSubagent(pair);
            }}
          >
            View agent log →
          </button>
        )}
      </div>
      {expanded && (
        <div className="tb__tool-body">
          <ToolCallRenderer
            tool={{ id: pair.id, name: pair.name, input: pair.input }}
          />
          {pair.result && <ToolResultRender pair={pair} />}
        </div>
      )}
    </div>
  );
}

function ToolResultRender({ pair }: { pair: ToolPair }) {
  const r = pair.result!;
  const body =
    typeof r.content === "string"
      ? r.content
      : flattenContent(r.content);
  const truncated = body.length > 2000 ? `${body.slice(0, 2000)}\n… (${body.length} chars)` : body;
  return (
    <div className={`tb__tool-result ${r.is_error ? "tb__tool-result--error" : ""}`}>
      <div className="tb__tool-result-label">result{r.is_error ? " (error)" : ""}</div>
      <pre>{truncated || "(empty result)"}</pre>
    </div>
  );
}

// ─── rendering helpers ────────────────────────────────────────────────

function turnPreview(turn: Turn): string {
  if (turn.userPrompt) {
    const txt = userPromptText(turn.userPrompt);
    if (txt) return txt.replace(/\s+/g, " ").slice(0, 200);
  }
  // Fallback for orphan turns (e.g. resume-session bootstrap)
  const firstAssistant = turn.events.find((e) => e.kind === "assistant");
  if (firstAssistant) {
    const txt = textBlocksIn(firstAssistant).join(" ");
    if (txt) return `(assistant) ${txt.slice(0, 180)}`;
  }
  return turn.userPrompt == null ? "(no user prompt)" : "";
}

interface Badge {
  label: string;
  variant: string;
  title: string;
}

function toolBadges(pairs: ToolPair[]): Badge[] {
  if (pairs.length === 0) return [];
  const counts = new Map<string, number>();
  for (const p of pairs) {
    counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({
      label: n === 1 ? name : `${name} ×${n}`,
      variant: name.toLowerCase(),
      title: `${n} ${name} call${n === 1 ? "" : "s"}`,
    }));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  return `${m}m${rs > 0 ? ` ${rs}s` : ""}`;
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

function toolSummary(pair: ToolPair): string {
  const input = (pair.input ?? {}) as Record<string, unknown>;
  const pick = (k: string) =>
    typeof input[k] === "string" ? (input[k] as string) : undefined;
  switch (pair.name) {
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "Read":
      return pick("file_path") ?? "";
    case "Bash":
      return (pick("command") ?? "").slice(0, 120);
    case "Grep":
      return pick("pattern") ?? "";
    case "Glob":
      return pick("pattern") ?? "";
    case "Task":
      return pick("description") ?? pick("subagent_type") ?? "";
    case "TodoWrite":
      return "todos updated";
    case "WebFetch":
      return pick("url") ?? "";
    case "WebSearch":
      return pick("query") ?? "";
    default:
      return "";
  }
}

function summaryTextOf(ev: TimelineEvent): string {
  const p = payloadOf(ev);
  const s = (p as { summary?: unknown }).summary;
  return typeof s === "string" ? s : "";
}

// Expose for tests
export { toolBadges as _toolBadges, turnPreview as _turnPreview };

// Small adapter so AssistantSubRow can reuse this without re-walking.
// Kept here so tests don't need to import internals.
export function _toolResultsIn(event: TimelineEvent) {
  return toolResultsIn(event);
}
