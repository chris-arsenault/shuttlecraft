import { useEffect, useRef, useState } from "react";

import { Sidebar } from "./Sidebar";
import { WorkArea } from "./WorkArea";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useTabs } from "../state/TabStore";
import "./Layout.css";

/** Root layout: sidebar + WorkArea. On mobile the sidebar becomes a
 * drawer. The split / tab system lives inside WorkArea. */
export function Layout() {
  const { openTab } = useTabs();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Stable ref to openTab so global-event listeners don't re-bind on
  // every tab state change — re-binding caused the "click file does
  // nothing" bug: every re-registration fired pending events against a
  // stale closure and the tab was immediately re-activated elsewhere.
  const openTabRef = useRef(openTab);
  openTabRef.current = openTab;

  // Global Cmd/Ctrl-K opens the search tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openTabRef.current({ kind: "search" }, "top");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // File-tree row clicks dispatch this event; translate to a tab open.
  useEffect(() => {
    const onFile = (e: Event) => {
      const ce = e as CustomEvent<{ repo: string; path: string; dirty: boolean }>;
      if (ce.detail.dirty) {
        openTabRef.current({ kind: "diff", repo: ce.detail.repo, path: ce.detail.path });
      } else {
        openTabRef.current({ kind: "file", repo: ce.detail.repo, path: ce.detail.path });
      }
    };
    const onCloseDrawer = () => setDrawerOpen(false);
    window.addEventListener("shuttlecraft:open-file", onFile as EventListener);
    window.addEventListener(
      "shuttlecraft:close-drawer",
      onCloseDrawer as EventListener,
    );
    return () => {
      window.removeEventListener(
        "shuttlecraft:open-file",
        onFile as EventListener,
      );
      window.removeEventListener(
        "shuttlecraft:close-drawer",
        onCloseDrawer as EventListener,
      );
    };
  }, []);

  if (isMobile) {
    return (
      <div className="layout layout--mobile">
        <MobileTopBar onOpenDrawer={() => setDrawerOpen(true)} />
        {drawerOpen && (
          <>
            <div
              className="layout__scrim"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <aside className="layout__drawer" aria-label="Sessions">
              <Sidebar />
            </aside>
          </>
        )}
        <main className="layout__main">
          <WorkArea />
        </main>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="layout__sidebar">
        <Sidebar />
      </aside>
      <main className="layout__main">
        <WorkArea />
      </main>
    </div>
  );
}

function MobileTopBar({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  return (
    <div className="mobile-topbar">
      <button
        type="button"
        className="mobile-topbar__hamburger"
        onClick={onOpenDrawer}
        aria-label="Open sessions drawer"
      >
        ☰
      </button>
      <span className="mobile-topbar__title">shuttlecraft</span>
    </div>
  );
}
