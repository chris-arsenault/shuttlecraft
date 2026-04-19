import { type MouseEvent, useMemo, useRef, useState } from "react";

import type { TimelineAssistantItem } from "../../api/types";
import { CopyButton } from "./CopyButton";
import type { ToolPair, Turn } from "./grouping";
import { Markdown } from "./Markdown";
import {
  formatAssistantItems,
  formatAssistantText,
  formatTurn,
} from "./markdown-export";
import { ThinkingFlyout } from "./ThinkingFlyout";
import { ToolHoverCard } from "./ToolHoverCard";
import { ToolCallRenderer } from "./tools/renderers";
import "./TurnDetail.css";

interface Props {
  turn: Turn;
  showThinking: boolean;
  onOpenSubagent?: (pair: ToolPair) => void;
}

interface ThinkingAnchor {
  el: HTMLElement;
  text: string;
}

interface HoverAnchor {
  el: HTMLElement;
  pair: ToolPair;
  pinned: boolean;
}

export function TurnDetail({ turn, showThinking, onOpenSubagent }: Props) {
  const pairById = useMemo(
    () => new Map(turn.tool_pairs.map((pair) => [pair.id, pair] as const)),
    [turn.tool_pairs],
  );
  const [thinking, setThinking] = useState<ThinkingAnchor | null>(null);
  const [hover, setHover] = useState<HoverAnchor | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openHover = (el: HTMLElement, pair: ToolPair) => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setHover((prev) => {
      if (prev?.pinned && prev.pair.id === pair.id) return prev;
      return { el, pair, pinned: prev?.pinned && prev.pair.id === pair.id ? true : false };
    });
  };
  const scheduleDismiss = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => {
      setHover((prev) => (prev?.pinned ? prev : null));
    }, 180);
  };

  return (
    <div className="td">
      <div className="td__header">
        <div className="td__header-prompt">
          <span className="td__header-label">Prompt</span>
          <div className="td__prompt-text">
            {turn.user_prompt_text ? (
              <Markdown source={turn.user_prompt_text} />
            ) : (
              <span className="td__muted">(orphan turn — no user prompt)</span>
            )}
          </div>
        </div>
        <div className="td__header-meta">
          <span>{turn.event_count} events</span>
          <span>{turn.operation_count} tool calls</span>
          {turn.thinking_count > 0 && showThinking && (
            <span>💭 {turn.thinking_count}</span>
          )}
          {turn.has_errors && <span className="td__errors">⚠ errors</span>}
          <CopyButton
            getText={() => formatTurn(turn)}
            label="turn"
            icon="⧉"
            title="Copy this entire turn as markdown"
            className="td__copy-turn"
          />
        </div>
      </div>

      <div className="td__body" data-testid="turn-detail">
        {turn.chunks.map((chunk, idx) => {
          if (chunk.kind === "assistant") {
            return (
              <AssistantBlock
                key={`a-${idx}`}
                items={chunk.items}
                thinking={chunk.thinking}
                pairById={pairById}
                showThinking={showThinking}
                onThinkingChip={(el, text) => {
                  setHover(null);
                  setThinking({ el, text });
                }}
              />
            );
          }

          if (chunk.kind === "tool") {
            const pair = pairById.get(chunk.pair_id);
            if (!pair) return null;
            return (
              <ToolPairRow
                key={`t-${pair.id || idx}`}
                pair={pair}
                onOpenSubagent={onOpenSubagent}
                onEnter={(el) => openHover(el, pair)}
                onLeave={scheduleDismiss}
              />
            );
          }

          if (chunk.kind === "summary") {
            return (
              <div key={`s-${idx}`} className="td__sub td__sub--summary">
                <span className="td__sub-label">summary</span>
                <span>{chunk.text}</span>
              </div>
            );
          }

          if (chunk.kind === "system") {
            return (
              <div key={`sy-${idx}`} className="td__sub td__sub--system">
                <span className="td__sub-label">system</span>
                <span>
                  {chunk.subtype ?? "system"} {chunk.text}
                </span>
              </div>
            );
          }

          return (
            <div key={`g-${idx}`} className="td__sub td__sub--generic">
              <span className="td__sub-label">{chunk.label}</span>
              <details>
                <summary>details</summary>
                <pre>{JSON.stringify(chunk.details, null, 2)}</pre>
              </details>
            </div>
          );
        })}
      </div>

      {thinking && showThinking && (
        <ThinkingFlyout
          anchor={thinking.el}
          thinkingText={thinking.text}
          onClose={() => setThinking(null)}
        />
      )}
      {hover && (
        <div
          onMouseEnter={() => {
            if (dismissTimer.current) clearTimeout(dismissTimer.current);
          }}
          onMouseLeave={scheduleDismiss}
        >
          <ToolHoverCard
            anchor={hover.el}
            pair={hover.pair}
            pinned={hover.pinned}
            onPin={() =>
              setHover((prev) => (prev ? { ...prev, pinned: true } : prev))
            }
            onClose={() => setHover(null)}
          />
        </div>
      )}
    </div>
  );
}

function AssistantBlock({
  items,
  thinking,
  pairById,
  showThinking,
  onThinkingChip,
}: {
  items: TimelineAssistantItem[];
  thinking: string[];
  pairById: Map<string, ToolPair>;
  showThinking: boolean;
  onThinkingChip: (el: HTMLElement, text: string) => void;
}) {
  const texts = items.flatMap((item) => (item.kind === "text" ? [item.text] : []));
  const hasCopyable = texts.length > 0;

  return (
    <div className="td__sub td__sub--assistant">
      {hasCopyable && (
        <div className="td__assistant-actions" aria-label="Copy actions">
          <CopyButton
            getText={() => formatAssistantText(items)}
            label="text"
            icon="⧉"
            title="Copy just the assistant text as markdown"
          />
          <CopyButton
            getText={() => formatAssistantItems(items, pairById)}
            label="event"
            icon="⧉"
            title="Copy text + inline tool calls as markdown"
          />
        </div>
      )}
      {texts.map((text, idx) => (
        <div key={`t-${idx}`} className="td__text">
          <Markdown source={text} />
        </div>
      ))}
      {showThinking && thinking.length > 0 && (
        <div className="td__thinking-chips">
          {thinking.map((text, idx) => (
            <button
              key={`k-${idx}`}
              type="button"
              className="td__thinking-chip"
              onClick={(e: MouseEvent<HTMLButtonElement>) =>
                onThinkingChip(e.currentTarget, text)
              }
              title="View thinking"
            >
              💭 thinking
              {thinking.length > 1 ? ` ${idx + 1}/${thinking.length}` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolPairRow({
  pair,
  onOpenSubagent,
  onEnter,
  onLeave,
}: {
  pair: ToolPair;
  onOpenSubagent?: (pair: ToolPair) => void;
  onEnter: (el: HTMLElement) => void;
  onLeave: () => void;
}) {
  const lowSignal = !pair.is_error && !pair.is_pending;
  const [expanded, setExpanded] = useState(!lowSignal);
  const rowRef = useRef<HTMLDivElement>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = () => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => {
      if (rowRef.current) onEnter(rowRef.current);
    }, 160);
  };
  const handleLeave = () => {
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    onLeave();
  };

  return (
    <div
      ref={rowRef}
      className={`td__tool ${pair.is_error ? "td__tool--error" : ""} ${
        pair.is_pending ? "td__tool--pending" : ""
      }`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      data-testid="tool-pair-row"
    >
      <div className="td__tool-header">
        <button
          type="button"
          className="td__tool-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "Collapse tool details" : "Expand tool details"}
        >
          <span className="td__tool-chevron">{expanded ? "▾" : "▸"}</span>
          <span className={`td__tool-name td__tool-name--${pair.name.toLowerCase()}`}>
            {pair.name}
          </span>
          <span className="td__tool-summary">{toolSummary(pair)}</span>
          {pair.is_pending && <span className="td__tool-status">pending</span>}
          {pair.is_error && (
            <span className="td__tool-status td__tool-status--error">error</span>
          )}
          {!expanded && !pair.is_error && !pair.is_pending && (
            <span className="td__tool-status td__tool-status--ok">ok</span>
          )}
        </button>
        {pair.name === "task" && pair.subagent && onOpenSubagent && (
          <button
            type="button"
            className="td__tool-subagent"
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
        <div className="td__tool-body">
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
  const result = pair.result!;
  const body = result.content ?? "";
  const truncated =
    body.length > 2000 ? `${body.slice(0, 2000)}\n… (${body.length} chars)` : body;
  return (
    <div className={`td__tool-result ${result.is_error ? "td__tool-result--error" : ""}`}>
      <div className="td__tool-result-label">
        result{result.is_error ? " (error)" : ""}
      </div>
      <pre>{truncated || "(empty result)"}</pre>
    </div>
  );
}

function toolSummary(pair: ToolPair): string {
  const input = (pair.input ?? {}) as Record<string, unknown>;
  const pick = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : undefined;
  switch (pair.name) {
    case "edit":
    case "write":
    case "multi_edit":
    case "read":
      return pick("path") ?? "";
    case "bash":
      return (pick("command") ?? "").slice(0, 120);
    case "grep":
    case "glob":
      return pick("pattern") ?? "";
    case "task":
      return pick("description") ?? pick("agent") ?? "";
    case "todo_write":
      return "todos updated";
    case "web_fetch":
      return pick("url") ?? "";
    case "web_search":
      return pick("query") ?? "";
    default:
      return "";
  }
}
