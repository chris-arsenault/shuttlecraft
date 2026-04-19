import type { TimelineAssistantItem } from "../../api/types";
import type { ToolPair, Turn } from "./grouping";

export function formatTurn(turn: Turn): string {
  return turn.markdown;
}

export function formatAssistantText(items: TimelineAssistantItem[]): string {
  return items
    .flatMap((item) => (item.kind === "text" ? [item.text] : []))
    .join("\n\n")
    .trim();
}

export function formatAssistantItems(
  items: TimelineAssistantItem[],
  pairById: Map<string, ToolPair>,
): string {
  return items
    .flatMap((item) => {
      if (item.kind === "text") return [item.text.trim()].filter(Boolean);
      const pair = pairById.get(item.pair_id);
      return pair ? [formatToolPair(pair)] : [];
    })
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export function formatToolPair(pair: ToolPair): string {
  const header = `**Tool:** \`${pair.name}\`${toolOneLine(pair)}`;
  const inputBlock = formatToolInput(pair);
  const resultBlock = formatToolResult(pair);
  const status = pair.is_pending ? " _(pending)_" : pair.is_error ? " _(error)_" : "";
  return [`${header}${status}`, inputBlock, resultBlock].filter(Boolean).join("\n\n");
}

function toolOneLine(pair: ToolPair): string {
  const input = (pair.input ?? {}) as Record<string, unknown>;
  const pick = (key: string) =>
    typeof input[key] === "string" ? (input[key] as string) : undefined;
  let summary = "";
  switch (pair.name) {
    case "edit":
    case "write":
    case "multi_edit":
    case "read":
      summary = pick("path") ?? "";
      break;
    case "bash":
      summary = pick("command") ?? "";
      break;
    case "grep":
    case "glob":
      summary = pick("pattern") ?? "";
      break;
    case "task":
      summary = pick("description") ?? pick("agent") ?? "";
      break;
    case "web_fetch":
      summary = pick("url") ?? "";
      break;
    case "web_search":
      summary = pick("query") ?? "";
      break;
  }
  return summary ? ` \`${summary.slice(0, 160)}\`` : "";
}

function formatToolInput(pair: ToolPair): string {
  const input = pair.input;
  if (pair.name === "edit" || pair.name === "write") {
    return formatEditInput(pair);
  }
  if (pair.name === "multi_edit") {
    return formatMultiEditInput(pair);
  }
  if (pair.name === "bash") {
    const cmd =
      typeof (input as { command?: unknown })?.command === "string"
        ? ((input as { command: string }).command)
        : "";
    if (!cmd) return "";
    return fence("bash", cmd);
  }
  if (pair.name === "todo_write") {
    const todos = (input as { todos?: Array<{ status?: string; content?: string }> })
      ?.todos;
    if (!Array.isArray(todos) || todos.length === 0) return "";
    const lines = todos.map((todo) => {
      const box =
        todo.status === "completed" ? "[x]" : todo.status === "in_progress" ? "[~]" : "[ ]";
      return `- ${box} ${todo.content ?? ""}`;
    });
    return lines.join("\n");
  }
  return fence("json", JSON.stringify(input ?? {}, null, 2));
}

function formatEditInput(pair: ToolPair): string {
  const input = pair.input as Record<string, unknown>;
  const oldText = typeof input.old_text === "string" ? input.old_text : "";
  const newText =
    typeof input.new_text === "string"
      ? input.new_text
      : typeof input.content === "string"
        ? input.content
        : "";
  if (!oldText && !newText) return "";
  return fence("diff", unifiedDiff(oldText, newText));
}

function formatMultiEditInput(pair: ToolPair): string {
  const input = pair.input as Record<string, unknown>;
  const edits = Array.isArray(input.edits)
    ? (input.edits as Array<Record<string, unknown>>)
    : [];
  if (edits.length === 0) return "";
  const diffs = edits.map((edit) => {
    const oldText = typeof edit.old_text === "string" ? edit.old_text : "";
    const newText = typeof edit.new_text === "string" ? edit.new_text : "";
    return unifiedDiff(oldText, newText);
  });
  return fence("diff", diffs.join("\n\n---\n\n"));
}

function formatToolResult(pair: ToolPair): string {
  if (!pair.result) return "";
  const body = pair.result.content ?? "";
  if (!body) return "";
  const truncated =
    body.length > 1500 ? `${body.slice(0, 1500)}\n… (${body.length} chars total)` : body;
  const label = pair.is_error ? "Result (error)" : "Result";
  return `_${label}_\n\n${fence("", truncated)}`;
}

function unifiedDiff(oldStr: string, newStr: string): string {
  return [
    ...oldStr.split("\n").map((line) => `- ${line}`),
    ...newStr.split("\n").map((line) => `+ ${line}`),
  ].join("\n");
}

function fence(lang: string, body: string): string {
  const fenceChars = body.includes("```") ? "````" : "```";
  return `${fenceChars}${lang}\n${body}\n${fenceChars}`;
}
