import type { TimelineEvent } from "../../api/types";

/** Narrow the opaque payload into the shapes we care about for rendering.
 * All fields are optional — unknown kinds fall back to a generic block. */
export interface EventPayload {
  type?: string;
  timestamp?: string;
  uuid?: string;
  sessionId?: string;
  parentUuid?: string | null;
  isCompactSummary?: boolean;
  message?: MessagePayload;
  // Some events (summary, file-history-snapshot) carry ad-hoc fields.
  [key: string]: unknown;
}

export interface MessagePayload {
  role?: "user" | "assistant" | string;
  content?: string | ContentBlock[];
  // Top-level assistant messages sometimes carry these:
  stop_reason?: string;
  usage?: Record<string, unknown>;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  | {
      type: "tool_result";
      tool_use_id?: string;
      content?: string | ContentBlock[];
      is_error?: boolean;
    }
  | { type: string; [key: string]: unknown };

export function payloadOf(event: TimelineEvent): EventPayload {
  if (event.payload && typeof event.payload === "object") {
    return event.payload as EventPayload;
  }
  return {};
}

/** A flattened chunk of text suitable for a preview line or a block header. */
export function textPreview(event: TimelineEvent, max = 140): string {
  const p = payloadOf(event);
  const text = flattenContent(p.message?.content);
  if (text) return trim(text, max);
  // Fallback: show the type
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
  }
  return parts.join(" ");
}

function trim(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

/** True when a user event is actually a tool_result container and should
 * visually group with the preceding assistant turn rather than start a
 * new exchange. */
export function isToolResultUser(event: TimelineEvent): boolean {
  const p = payloadOf(event);
  if (p.type !== "user") return false;
  const c = p.message?.content;
  if (!Array.isArray(c)) return false;
  return c.some((b) => b.type === "tool_result");
}

export function toolUsesIn(event: TimelineEvent): Array<{
  id?: string;
  name?: string;
  input?: unknown;
}> {
  const p = payloadOf(event);
  const c = p.message?.content;
  if (!Array.isArray(c)) return [];
  return c
    .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> =>
      b.type === "tool_use",
    )
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}
