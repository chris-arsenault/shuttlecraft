// Minimal unified-diff renderer. Consumes the raw patch text codex's
// apply_patch produces (or any other tool that ships a unified diff)
// and paints each line by its leading marker:
//
//   `+` → added            (green)
//   `-` → removed          (red)
//   `@@` → hunk header     (muted)
//   (anything else)        (context, muted)
//
// No reconstruction, no AST, no per-line merge — what was written is
// what's shown.

interface UnifiedDiffProps {
  diff: string;
  compact?: boolean;
}

type DiffLineKind = "added" | "removed" | "context" | "hunk";

function classifyLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}

export function UnifiedDiff({ diff, compact }: UnifiedDiffProps) {
  if (!diff.trim()) return null;
  const lines = diff.split("\n");
  return (
    <pre
      className={compact ? "tr-udiff tr-udiff--compact" : "tr-udiff"}
      aria-label="unified diff"
    >
      {lines.map((line, i) => {
        const kind = classifyLine(line);
        return (
          <span key={i} className={`tr-udiff__line tr-udiff__line--${kind}`}>
            {line || " "}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}
