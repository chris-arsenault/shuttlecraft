import type { TimelineEvent } from "../../api/types";

// Narrow the opaque payload into the shapes we care about for rendering.
// All fields are optional — unknown kinds fall back to a generic block.
export interface EventPayload {
  type?: string;
  timestamp?: string;
  uuid?: string;
  sessionId?: string;
  parentUuid?: string | null;
  /** True when this event belongs to a Task-subagent conversation rather
   * than the main thread. The subagent modal (#5) uses this to pull
   * its log out of the main timeline. */
  isSidechain?: boolean;
  /** True for internal/bookkeeping system events. */
  isMeta?: boolean;
  /** Present on some rollup/compact events. */
  isCompactSummary?: boolean;
  message?: MessagePayload;
  subtype?: string;
  // Some events (summary, file-history-snapshot) carry ad-hoc fields.
  [key: string]: unknown;
}

export interface MessagePayload {
  role?: "user" | "assistant" | string;
  content?: string | ContentBlock[];
  stop_reason?: string;
  usage?: Record<string, unknown>;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking?: string; signature?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  | {
      type: "tool_result";
      tool_use_id?: string;
      content?: string | ContentBlock[];
      is_error?: boolean;
    }
  | { type: string; [key: string]: unknown };

export interface ToolUseBlock {
  type: "tool_use";
  id?: string;
  name?: string;
  input?: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking?: string;
  signature?: string;
}

// Top-level event kinds surfaced by Claude Code's JSONL that carry
// purely internal / filesystem / housekeeping state, not conversational
// content. Hidden from the default timeline view.
const BOOKKEEPING_KINDS = new Set<string>([
  "file-history-snapshot",
  "permission-mode",
  "last-prompt",
  "queue-operation",
  "attachment",
]);

export function payloadOf(event: TimelineEvent): EventPayload {
  if (event.payload && typeof event.payload === "object") {
    return event.payload as EventPayload;
  }
  return {};
}

export function isBookkeepingEvent(event: TimelineEvent): boolean {
  if (BOOKKEEPING_KINDS.has(event.kind)) return true;
  // system events marked isMeta are internal diagnostics
  if (event.kind === "system") {
    const p = payloadOf(event);
    if (p.isMeta === true) return true;
  }
  return false;
}

export function isSidechainEvent(event: TimelineEvent): boolean {
  return payloadOf(event).isSidechain === true;
}

/** A flattened chunk of text suitable for a preview line or block header.
 * Excludes `thinking` and `tool_use` input — those get their own renderers. */
export function textPreview(event: TimelineEvent, max = 140): string {
  const p = payloadOf(event);
  const text = flattenContent(p.message?.content);
  if (text) return trim(text, max);
  return trim(`[${event.kind}]`, max);
}

export function flattenContent(content: MessagePayload["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "tool_use" && block.name) {
      parts.push(`[tool_use: ${block.name}]`);
    } else if (block.type === "tool_result") {
      const tr = block as { content?: string | ContentBlock[] };
      const nested =
        typeof tr.content === "string" ? tr.content : flattenContent(tr.content);
      parts.push(`[tool_result]${nested ? ` ${nested}` : ""}`);
    }
    // thinking blocks intentionally excluded from text flattening
  }
  return parts.join(" ");
}

function trim(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

/** True when a user event is actually a tool_result container and should
 * fold into the preceding assistant turn rather than open a new turn. */
export function isToolResultUser(event: TimelineEvent): boolean {
  const p = payloadOf(event);
  if (p.type !== "user") return false;
  const c = p.message?.content;
  if (!Array.isArray(c)) return false;
  return c.some((b) => b.type === "tool_result");
}

/** True when a user event carries an actual typed prompt (string content
 * or a content array with at least one `text` block). These events open
 * new turns. */
export function isRealUserPrompt(event: TimelineEvent): boolean {
  if (event.kind !== "user") return false;
  if (isToolResultUser(event)) return false;
  return true;
}

export function toolUsesIn(event: TimelineEvent): ToolUseBlock[] {
  const c = payloadOf(event).message?.content;
  if (!Array.isArray(c)) return [];
  return c.filter((b): b is ToolUseBlock => b.type === "tool_use");
}

export function toolResultsIn(event: TimelineEvent): ToolResultBlock[] {
  const c = payloadOf(event).message?.content;
  if (!Array.isArray(c)) return [];
  return c.filter((b): b is ToolResultBlock => b.type === "tool_result");
}

export function thinkingBlocksIn(event: TimelineEvent): ThinkingBlock[] {
  const c = payloadOf(event).message?.content;
  if (!Array.isArray(c)) return [];
  return c.filter((b): b is ThinkingBlock => b.type === "thinking");
}

export function hasThinking(event: TimelineEvent): boolean {
  return thinkingBlocksIn(event).length > 0;
}

export function textBlocksIn(event: TimelineEvent): string[] {
  const c = payloadOf(event).message?.content;
  if (typeof c === "string") return [c];
  if (!Array.isArray(c)) return [];
  return c
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text);
}

/** Text of a user event's real prompt content, if any. */
export function userPromptText(event: TimelineEvent): string {
  if (!isRealUserPrompt(event)) return "";
  const c = payloadOf(event).message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((b) => b.type === "text" && typeof (b as { text?: string }).text === "string")
      .map((b) => (b as { text: string }).text)
      .join(" ");
  }
  return "";
}

/** True when any tool_result block in this event has is_error=true. */
export function hasToolError(event: TimelineEvent): boolean {
  return toolResultsIn(event).some((b) => b.is_error === true);
}
