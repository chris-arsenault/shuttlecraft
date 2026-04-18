// Live xterm.js pane. Mounts xterm imperatively in a useEffect keyed on
// sessionId. React is NOT in the rendering path for PTY bytes — the
// WebSocket writes straight into xterm.write; xterm.onData writes back
// into the WS. This is load-bearing for latency (CLAUDE.md invariant #2).

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import { connectPty, type ConnectionState } from "../api/ws";
import "@xterm/xterm/css/xterm.css";
import "./TerminalPane.css";

export function TerminalPane({ sessionId }: { sessionId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [connState, setConnState] = useState<ConnectionState>("connecting");
  const [deadExit, setDeadExit] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;

    const term = new Terminal({
      // No client-side scrollback. History lives in the timeline pane
      // (CLAUDE.md invariant & design doc).
      scrollback: 0,
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      theme: {
        background: "#0b0d12",
        foreground: "#e5e7eb",
        cursor: "#93c5fd",
        black: "#1f232b",
        red: "#f87171",
        green: "#86efac",
        yellow: "#fde68a",
        blue: "#93c5fd",
        magenta: "#f0abfc",
        cyan: "#67e8f9",
        white: "#e5e7eb",
        brightBlack: "#4b5563",
        brightRed: "#fca5a5",
        brightGreen: "#bbf7d0",
        brightYellow: "#fef3c7",
        brightBlue: "#bfdbfe",
        brightMagenta: "#f5d0fe",
        brightCyan: "#a5f3fc",
        brightWhite: "#f9fafb",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // Fit once after mount; rAF ensures the host has real dimensions.
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        // Happy-dom lacks full layout — safe to ignore in tests.
      }
    });

    const conn = connectPty(sessionId, {
      onBytes: (chunk) => term.write(chunk),
      onServerMsg: (msg) => {
        if (msg.t === "dead") setDeadExit(msg.exit ?? null);
      },
      onConnectionChange: setConnState,
    });

    const onData = term.onData((data) => conn.sendInput(data));

    // Sync dimensions on every host resize so TUI apps stay correctly shaped.
    const resize = () => {
      try {
        fit.fit();
        conn.sendResize(term.cols, term.rows);
      } catch {
        // Host not laid out yet; the ResizeObserver will fire again.
      }
    };
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(resize);
      ro.observe(host);
    } else {
      window.addEventListener("resize", resize);
    }

    // Initial resize so the backend matches our column count from first byte.
    resize();

    return () => {
      ro?.disconnect();
      if (!ro) window.removeEventListener("resize", resize);
      onData.dispose();
      conn.close();
      term.dispose();
    };
    // sessionId in deps means a session switch tears down and remounts.
  }, [sessionId]);

  return (
    <div className="terminal-pane" data-testid="terminal-pane">
      <div ref={hostRef} className="terminal-pane__host" />
      {connState !== "open" && (
        <div className="terminal-pane__status">
          {connState === "connecting" && "connecting…"}
          {connState === "reconnecting" && "reconnecting…"}
          {connState === "closed" && "closed"}
        </div>
      )}
      {deadExit !== undefined && (
        <div className="terminal-pane__banner">
          shell exited {deadExit == null ? "" : `with code ${deadExit}`} — session
          no longer receiving input
        </div>
      )}
    </div>
  );
}
