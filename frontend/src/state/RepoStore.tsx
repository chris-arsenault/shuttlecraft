import { useEffect } from "react";
import { create } from "zustand";

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
  /** Monotonic invalidation token for in-flight tree requests. */
  treeEpoch: number;
  /** User-expanded directories (repo-relative paths). Root is "". */
  expanded: Set<string>;
  /** User-collapsed directories. Wins over auto-expand-on-dirty. */
  collapsed: Set<string>;
  /** Show ignored/untracked-by-gitignore files in listings. */
  showAll: boolean;
}

export interface RepoStore {
  repos: Record<string, RepoState>;
  expandedRepos: Set<string>;
  setExpanded: (repo: string, expanded: boolean) => void;
  toggleDir: (repo: string, path: string, currentlyExpanded: boolean) => void;
  expandPath: (repo: string, path: string) => void;
  refresh: (repo: string) => void;
  hardRefresh: (repo: string) => void;
  setShowAll: (repo: string, value: boolean) => void;
  loadDir: (repo: string, path: string, opts?: { force?: boolean }) => void;
  pollOne: (repo: string) => Promise<void>;
  refreshVisibleDirs: (repo: string, opts?: { clear?: boolean }) => void;
}

function createRepoState(): RepoState {
  return {
    git: null,
    gitLastFetched: 0,
    gitError: null,
    tree: {},
    treeEpoch: 0,
    expanded: new Set(),
    collapsed: new Set(),
    showAll: false,
  };
}

function initialState(): Pick<RepoStore, "repos" | "expandedRepos"> {
  return {
    repos: {},
    expandedRepos: new Set(),
  };
}

const knownRepoNames = new Set<string>();

export const useRepoStore = create<RepoStore>()((set, get) => ({
  ...initialState(),

  async pollOne(name) {
    knownRepoNames.add(name);
    const previous = get().repos[name]?.git ?? null;
    try {
      const git = await getRepoGit(name);
      set((state) => ({
        repos: {
          ...state.repos,
          [name]: {
            ...(state.repos[name] ?? createRepoState()),
            git,
            gitLastFetched: Date.now(),
            gitError: null,
          },
        },
      }));
      if (treeRelevantGitChanged(previous, git)) {
        get().refreshVisibleDirs(name);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      set((state) => ({
        repos: {
          ...state.repos,
          [name]: {
            ...(state.repos[name] ?? createRepoState()),
            gitError: msg,
          },
        },
      }));
    }
  },

  setExpanded(repo, expanded) {
    knownRepoNames.add(repo);
    set((state) => ({
      repos: {
        ...state.repos,
        [repo]: state.repos[repo] ?? createRepoState(),
      },
      expandedRepos: mutateSet(state.expandedRepos, (next) => {
        if (expanded) next.add(repo);
        else next.delete(repo);
      }),
    }));
    if (expanded) void get().pollOne(repo);
  },

  toggleDir(repo, path, currentlyExpanded) {
    set((state) => {
      const current = state.repos[repo];
      if (!current) return state;
      const expanded = new Set(current.expanded);
      const collapsed = new Set(current.collapsed);
      if (currentlyExpanded) {
        expanded.delete(path);
        collapsed.add(path);
      } else {
        collapsed.delete(path);
        expanded.add(path);
      }
      return {
        repos: {
          ...state.repos,
          [repo]: { ...current, expanded, collapsed },
        },
      };
    });
  },

  expandPath(repo, path) {
    const dirs = ancestorDirs(path);
    set((state) => {
      const current = state.repos[repo] ?? createRepoState();
      const expanded = new Set(current.expanded);
      const collapsed = new Set(current.collapsed);
      for (const dir of dirs) {
        expanded.add(dir);
        collapsed.delete(dir);
      }
      return {
        repos: {
          ...state.repos,
          [repo]: { ...current, expanded, collapsed },
        },
      };
    });
    for (const dir of ["", ...dirs]) {
      get().loadDir(repo, dir);
    }
  },

  refresh(repo) {
    get().refreshVisibleDirs(repo);
    void get().pollOne(repo);
  },

  hardRefresh(repo) {
    get().refreshVisibleDirs(repo, { clear: true });
    void get().pollOne(repo);
  },

  setShowAll(repo, value) {
    set((state) => {
      const current = state.repos[repo];
      if (!current) return state;
      return {
        repos: {
          ...state.repos,
          [repo]: {
            ...current,
            showAll: value,
            tree: {},
            treeEpoch: current.treeEpoch + 1,
          },
        },
      };
    });
    get().refreshVisibleDirs(repo);
  },

  loadDir(repo, path, opts) {
    knownRepoNames.add(repo);
    set((state) => ({
      repos: {
        ...state.repos,
        [repo]: state.repos[repo] ?? createRepoState(),
      },
    }));

    const current = get().repos[repo];
    if (!opts?.force && current && current.tree[path] !== undefined) return;
    const epoch = current?.treeEpoch ?? 0;

    set((state) => ({
      repos: {
        ...state.repos,
        [repo]: {
          ...(state.repos[repo] ?? createRepoState()),
          tree: {
            ...(state.repos[repo]?.tree ?? {}),
            [path]: null,
          },
        },
      },
    }));

    void (async () => {
      try {
        const showAll = get().repos[repo]?.showAll ?? false;
        const listing = await getRepoFiles(repo, path, showAll);
        set((state) => {
          if ((state.repos[repo]?.treeEpoch ?? 0) !== epoch) {
            return state;
          }
          return {
            repos: {
              ...state.repos,
              [repo]: {
                ...(state.repos[repo] ?? createRepoState()),
                tree: {
                  ...(state.repos[repo]?.tree ?? {}),
                  [path]: listing,
                },
              },
            },
          };
        });
      } catch {
        // Silent — tree rows render an error badge from missing entries.
      }
    })();
  },

  refreshVisibleDirs(repo, opts) {
    knownRepoNames.add(repo);
    const current = get().repos[repo] ?? createRepoState();
    const paths = visibleDirPaths(current);
    if (opts?.clear) {
      set((state) => ({
        repos: {
          ...state.repos,
          [repo]: {
            ...(state.repos[repo] ?? createRepoState()),
            tree: {},
            treeEpoch: (state.repos[repo]?.treeEpoch ?? 0) + 1,
          },
        },
      }));
    }
    for (const path of paths) {
      get().loadDir(repo, path, { force: true });
    }
  },
}));

let consumerCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startRepoStore() {
  if (typeof window === "undefined") return;
  consumerCount += 1;
  if (consumerCount > 1) return;

  pollTimer = window.setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    const { repos, expandedRepos, pollOne } = useRepoStore.getState();
    const now = Date.now();
    for (const name of knownRepoNames) {
      const repoState = repos[name];
      const age = now - (repoState?.gitLastFetched ?? 0);
      const cadence = expandedRepos.has(name) ? POLL_EXPANDED_MS : POLL_COLLAPSED_MS;
      if (age >= cadence) void pollOne(name);
    }
  }, 1_000);
}

function stopRepoStore() {
  consumerCount = Math.max(0, consumerCount - 1);
  if (consumerCount > 0) return;

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function useRepos<T>(selector: (state: RepoStore) => T): T {
  useEffect(() => {
    startRepoStore();
    return stopRepoStore;
  }, []);
  return useRepoStore(selector);
}

export function resetRepoStore() {
  consumerCount = 0;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  knownRepoNames.clear();
  useRepoStore.setState(initialState());
}

function mutateSet<T>(input: Set<T>, update: (next: Set<T>) => void): Set<T> {
  const next = new Set(input);
  update(next);
  return next;
}

function ancestorDirs(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    dirs.push(parts.slice(0, i).join("/"));
  }
  return dirs;
}

function visibleDirPaths(state: RepoState): string[] {
  const paths = new Set<string>([""]);
  for (const path of state.expanded) paths.add(path);
  for (const path of Object.keys(state.tree)) paths.add(path);
  return [...paths].sort((a, b) => a.localeCompare(b));
}

function treeRelevantGitChanged(
  previous: GitStatus | null,
  next: GitStatus,
): boolean {
  if (!previous) return true;
  if (previous.branch !== next.branch) return true;
  if (previous.uncommitted_count !== next.uncommitted_count) return true;
  if (previous.untracked_count !== next.untracked_count) return true;
  if (!shallowRecordEqual(previous.dirty_by_path, next.dirty_by_path)) return true;
  if (!shallowDiffStatsEqual(previous.diff_stats_by_path, next.diff_stats_by_path)) {
    return true;
  }
  return false;
}

function shallowRecordEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function shallowDiffStatsEqual(
  left: GitStatus["diff_stats_by_path"],
  right: GitStatus["diff_stats_by_path"],
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const l = left[key];
    const r = right[key];
    if (!r) return false;
    if (l.additions !== r.additions || l.deletions !== r.deletions) return false;
  }
  return true;
}

/** Walk `dirty_by_path` and return the set of ancestor directories
 * that contain any dirty descendant. Used to auto-expand the tree. */
export function dirtyAncestors(dirtyByPath: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const path of Object.keys(dirtyByPath)) {
    let cur = path;
    while (true) {
      const idx = cur.lastIndexOf("/");
      if (idx === -1) break;
      cur = cur.slice(0, idx);
      out.add(cur);
    }
  }
  return out;
}

/** Staleness classification for a repo's header badge. */
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
