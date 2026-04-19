// Per-repo state: git status (polled), directory tree (lazy), user
// expansion state. Keyed by repo name.
//
// Polling cadence:
//   - git is polled every 5s for expanded repos, 60s for collapsed
//   - file tree refreshes on expand / drop / manual refresh; no polling
//
// The component below composes with SessionStore — this store is purely
// about repos' git + filesystem surfaces, not sessions.

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { getRepoFiles, getRepoGit } from "../api/client";
import type { DirListing, GitStatus } from "../api/types";

const POLL_EXPANDED_MS = 5_000;
const POLL_COLLAPSED_MS = 60_000;

export interface RepoState {
  git: GitStatus | null;
  gitLastFetched: number;
  gitError: string | null;
  /** path -> listing. Missing key = not loaded. Null value = loading. */
  tree: Record<string, DirListing | null>;
  /** User-expanded directories (repo-relative paths). Root is "". */
  expanded: Set<string>;
  /** Show ignored/untracked-by-gitignore files in listings. */
  showAll: boolean;
}

export interface RepoStore {
  repos: Record<string, RepoState>;
  /** Mark a repo's nav group expanded → fast-poll its git. */
  setExpanded: (repo: string, expanded: boolean) => void;
  /** Toggle user-expanded state on a directory path within a repo. */
  toggleDir: (repo: string, path: string) => void;
  /** Manually refresh one repo's git + root listing. */
  refresh: (repo: string) => void;
  /** Toggle the "show ignored files" mode on a repo. */
  setShowAll: (repo: string, v: boolean) => void;
  /** Load one directory listing. No-op if already loaded and not stale. */
  loadDir: (repo: string, path: string) => void;
}

const Ctx = createContext<RepoStore | null>(null);

export function RepoProvider({ children }: { children: ReactNode }) {
  const [repos, setRepos] = useState<Record<string, RepoState>>({});
  // Which repos currently expanded in the nav (drives poll cadence).
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());

  const ensureRepo = useCallback((name: string) => {
    setRepos((prev) => {
      if (prev[name]) return prev;
      return {
        ...prev,
        [name]: {
          git: null,
          gitLastFetched: 0,
          gitError: null,
          tree: {},
          expanded: new Set(),
          showAll: false,
        },
      };
    });
  }, []);

  const pollOne = useCallback(async (name: string) => {
    try {
      const git = await getRepoGit(name);
      setRepos((prev) => ({
        ...prev,
        [name]: {
          ...(prev[name] ?? {
            git: null,
            gitLastFetched: 0,
            gitError: null,
            tree: {},
            expanded: new Set(),
            showAll: false,
          }),
          git,
          gitLastFetched: Date.now(),
          gitError: null,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      setRepos((prev) => ({
        ...prev,
        [name]: {
          ...(prev[name] ?? {
            git: null,
            gitLastFetched: 0,
            gitError: null,
            tree: {},
            expanded: new Set(),
            showAll: false,
          }),
          gitError: msg,
        },
      }));
    }
  }, []);

  const knownRepoNames = useRef<Set<string>>(new Set());

  // Poll loop — one interval, per-repo dispatch. Cheaper than one
  // interval per repo on a page with many of them.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      const now = Date.now();
      for (const name of knownRepoNames.current) {
        const s = repos[name];
        const age = now - (s?.gitLastFetched ?? 0);
        const cadence = expandedRepos.has(name)
          ? POLL_EXPANDED_MS
          : POLL_COLLAPSED_MS;
        if (age >= cadence) {
          void pollOne(name);
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expandedRepos, pollOne, repos]);

  const setExpanded = useCallback(
    (repo: string, expanded: boolean) => {
      ensureRepo(repo);
      knownRepoNames.current.add(repo);
      setExpandedRepos((prev) => {
        const next = new Set(prev);
        if (expanded) next.add(repo);
        else next.delete(repo);
        return next;
      });
      // On expand, fetch git immediately if stale.
      if (expanded) {
        void pollOne(repo);
      }
    },
    [ensureRepo, pollOne],
  );

  const toggleDir = useCallback((repo: string, path: string) => {
    setRepos((prev) => {
      const s = prev[repo];
      if (!s) return prev;
      const next = new Set(s.expanded);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { ...prev, [repo]: { ...s, expanded: next } };
    });
  }, []);

  const loadDir = useCallback(
    async (repo: string, path: string) => {
      ensureRepo(repo);
      knownRepoNames.current.add(repo);
      const current = repos[repo];
      if (current && current.tree[path] !== undefined) return;
      // mark loading
      setRepos((prev) => ({
        ...prev,
        [repo]: {
          ...(prev[repo] ?? {
            git: null,
            gitLastFetched: 0,
            gitError: null,
            tree: {},
            expanded: new Set(),
            showAll: false,
          }),
          tree: {
            ...(prev[repo]?.tree ?? {}),
            [path]: null,
          },
        },
      }));
      try {
        const showAll = repos[repo]?.showAll ?? false;
        const listing = await getRepoFiles(repo, path, showAll);
        setRepos((prev) => ({
          ...prev,
          [repo]: {
            ...(prev[repo] ?? {
              git: null,
              gitLastFetched: 0,
              gitError: null,
              tree: {},
              expanded: new Set(),
              showAll: false,
            }),
            tree: { ...(prev[repo]?.tree ?? {}), [path]: listing },
          },
        }));
      } catch {
        // Silent — tree rows render an error badge from missing entries.
      }
    },
    [ensureRepo, repos],
  );

  const refresh = useCallback(
    (repo: string) => {
      ensureRepo(repo);
      void pollOne(repo);
      // Invalidate tree — next expand re-fetches.
      setRepos((prev) => {
        const s = prev[repo];
        if (!s) return prev;
        return { ...prev, [repo]: { ...s, tree: {} } };
      });
    },
    [ensureRepo, pollOne],
  );

  const setShowAll = useCallback((repo: string, v: boolean) => {
    setRepos((prev) => {
      const s = prev[repo];
      if (!s) return prev;
      return { ...prev, [repo]: { ...s, showAll: v, tree: {} } };
    });
  }, []);

  const value: RepoStore = {
    repos,
    setExpanded,
    toggleDir,
    refresh,
    setShowAll,
    loadDir,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRepos(): RepoStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRepos called outside RepoProvider");
  return ctx;
}

/** Walk `dirty_by_path` and return the set of ancestor directories
 * that contain any dirty descendant. Used to auto-expand the tree. */
export function dirtyAncestors(dirtyByPath: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const p of Object.keys(dirtyByPath)) {
    let cur = p;
    while (true) {
      const idx = cur.lastIndexOf("/");
      if (idx === -1) break;
      cur = cur.slice(0, idx);
      out.add(cur);
    }
  }
  return out;
}

/** Staleness classification for a repo's header badge.
 *    green  — no uncommitted work, or no session activity since last commit
 *    amber  — uncommitted + activity since last commit, within 15 min
 *    red    — uncommitted + activity > 15 min past last commit */
export function stalenessFor(
  git: GitStatus | null,
  latestEventAt: number | null,
): "green" | "amber" | "red" {
  if (!git || git.uncommitted_count === 0) return "green";
  const lastCommitMs = git.last_commit
    ? new Date(git.last_commit.committed_at).getTime()
    : 0;
  if (latestEventAt == null || latestEventAt <= lastCommitMs) return "green";
  const gap = latestEventAt - lastCommitMs;
  if (gap > 15 * 60 * 1000) return "red";
  return "amber";
}
