# Feature Backlog

Synthesized research on high-value additions for shuttlecraft, drawn from Zellij / Warp / Wave / Tabby community feedback, xterm.js patterns, and Claude Code user threads (r/ClaudeAI, anthropics/claude-code GitHub). Organized by fit for shuttlecraft's two-pane (live PTY + typed-event timeline) design and importance.

Filed issues link to the numbered items below.

## Must-haves we're missing (fit=strong, importance=high)

1. **Timeline full-text search** — Search/discovery · Complexity M. Postgres FTS over existing event payloads + filter bar on the timeline. Past ~500 events the timeline becomes unusable without it; Warp's command search is their #1 praised feature, and r/ClaudeAI's "can't find what Claude did 3 hours ago" is recurring.

2. **Cost & token meter per session** — Observability · Complexity S. JSONL already carries `usage` blocks per assistant turn; ingester sums them. Third-party tools (ccusage, claude-monitor) exist because the CLI hides this. Live pane can't show it; timeline pane can.

3. **Jump-to-event ↔ jump-to-live bidirectional linking** — Timeline UX · Complexity M. Without it the two panes feel like two apps. Click a timeline event → mark/scroll live pane to its buffer position; "follow tail" toggle on the timeline.

4. **Activity notifications (Claude-is-idle / awaiting-approval)** — Observability · Complexity S. Browser Notification API + favicon badge driven by JSONL event patterns. The walk-away-and-come-back pitch doesn't work without this. CLI can't detect "Claude is waiting for you"; we can from events.

5. **Resume/fork-from-event** — Claude workflow · Complexity M. Button on any timeline event spawns a new PTY with `claude --resume <uuid> --fork-session`. Session correlation already gives us the UUID. This is the single clearest thing a GUI can do that the CLI can't.

## High-value workflow wins

6. **Tabs / multi-session visible at once** — Multi-session · Complexity M. Zellij-style tabs + optional split. Power users already run parallel Claudes; sidebar is the foundation.

7. **Timeline filter chips (tool type, file path, errors)** — Timeline UX · Complexity S. Per-tool renderers already categorize events; exposing them as facets is tiny.

8. **Diff-review queue (batch approval view)** — Claude workflow · Complexity M. Aggregate unapproved edits from the current session into a single reviewable surface. Cursor Composer's version of this is heavily praised.

9. **Command palette (Ctrl+K)** — Input productivity · Complexity S. Session switch, jump-to-event, copy last response, toggle timeline. Standard in Warp/Zed/VS Code, absent in every terminal-first tool.

10. **Prompt templates / snippets per repo** — Input productivity · Complexity S. Intercept the input textarea before it hits the PTY; scope by repo (sidebar already knows).

11. **Copy-event-as-markdown / copy-full-response** — Sharing · Complexity S. Events are already structured; one render pass per event. Half of "review on any LAN device" is "and send it to someone".

## Worth considering

| Feature | Cat | Imp | Why here |
|---|---|---|---|
| Session rename / pin / color | Session mgmt | M | Sidebar growth management |
| Keybind cheatsheet overlay (`?`) | Input prod | M | Discoverability of the above |
| Per-session env/cwd badge | Observability | M | Disambiguate at a glance |
| Sticky "current turn" timeline header | Timeline | M | Orientation on long transcripts |
| Mobile timeline-only mode | Live-pane | M | LAN phone check-ins |
| Session-event permalinks (`#event=<id>`) | Sharing | M | Point-share a decision |
| Floating throwaway-`claude` pane | Multi-session | M | Quick one-off ask without losing main context |
| Bell/activity dot on sidebar rows | Observability | M | Cheap, high signal |
| Paste-large-as-file auto-upload | Live-pane | L | Avoid PTY choke on huge pastes |
| TodoWrite progress widget above live pane | Claude-specific | M | We already parse TodoWrite |
| Auto-scroll-lock when user selects | Live-pane | L | Small polish, prevents lost selections |

## Speculative / big bets

**A. Semantic timeline — collapse by inferred "task".** Group prompt → tool calls → summary into collapsible Warp-style blocks. The feature that would make shuttlecraft feel categorically different rather than "xterm + sidebar." Big design lift but our typed events make it tractable.

**B. Cross-session search.** "What did I ask Claude about file X last week, across any session?" Shared Postgres already has the data. Turns shuttlecraft into a knowledge base over your own Claude history — no single-session CLI can match this.

**C. Browser approval gates via PreToolUse hooks.** Claude Code hooks can pause on risky operations; route the pause to a browser modal any LAN device can approve. Leverages existing hook system + multi-device mirror. Real safety win for walk-away use.

**D. Plugin / custom renderer API.** Tool renderers are already modular; expose as a plugin point so users render MCP tools or custom hooks without forking. Higher risk (API surface, sandboxing) but fits the architecture.

## Explicitly NOT recommended

1. **Live-pane AI autocomplete (Warp-style).** The PTY is an AI agent. Stacking another AI on the input line fights the model and doubles cost.
2. **"Replace tmux" — panes inside one PTY.** Conflicts with PTY-per-session design. Users who want that run tmux inside the PTY.
3. **SSH host browser.** Out of scope; container-local PTY is the design.
4. **Offline PWA / local sync.** Product is LAN-tethered by definition. Sync invites divergence bugs with no user gain.
5. **Vim/emacs modal keybinds in the timeline.** Timeline isn't a terminal; imposing modes on a virtualized DOM list is friction. Command palette (#9) solves discoverability without the mode-confusion tax.
