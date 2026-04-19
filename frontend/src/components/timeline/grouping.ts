// Timeline grouping/pairing moved to the backend projection layer.
// Keep these type aliases so the component surface stays stable while
// the app migrates off the old frontend-owned transcript heuristics.

import type {
  TimelineToolPair,
  TimelineTurn,
} from "../../api/types";

export type ToolPair = TimelineToolPair;
export type Turn = TimelineTurn;
