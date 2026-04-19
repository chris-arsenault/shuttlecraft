import { useEffect } from "react";
import { createPortal } from "react-dom";

import type { TimelineSubagent } from "../../api/types";
import { TurnDetail } from "./TurnDetail";
import "./SubagentModal.css";

interface Props {
  subagent: TimelineSubagent;
  showThinking: boolean;
  onClose: () => void;
}

export function SubagentModal({
  subagent,
  showThinking,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="sm__backdrop"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sm-title"
      data-testid="subagent-modal"
    >
      <div className="sm__content" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sm__header">
          <h3 id="sm-title" className="sm__title">
            {subagent.title}
          </h3>
          <span className="sm__meta">
            {subagent.event_count} events · {subagent.turns.length} turn
            {subagent.turns.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="sm__close"
            onClick={onClose}
            aria-label="Close subagent log"
          >
            ×
          </button>
        </div>
        <div className="sm__body">
          {subagent.turns.length === 0 && (
            <div className="sm__empty">
              No subagent events found for this Task. The subagent may not have
              emitted yet.
            </div>
          )}
          {subagent.turns.map((turn) => (
            <div key={turn.id} className="sm__turn">
              <TurnDetail turn={turn} showThinking={showThinking} />
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
