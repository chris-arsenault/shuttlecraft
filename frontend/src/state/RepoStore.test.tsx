import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRepoStore } from "./RepoStore";

describe("RepoStore", () => {
  it("refreshes loaded directories without leaving the tree stale", async () => {
    let filesCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === "string" ? input : input.url;
        if (url === "/api/repos/alpha/git") {
          return new Response(
            JSON.stringify({
              branch: "main",
              uncommitted_count: 0,
              untracked_count: 0,
              last_commit: null,
              recent_commits: [],
              dirty_by_path: {},
              diff_stats_by_path: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/repos/alpha/files") {
          filesCalls += 1;
          const name = filesCalls === 1 ? "first.txt" : "second.txt";
          return new Response(
            JSON.stringify({
              path: "",
              entries: [
                {
                  name,
                  kind: "file",
                  size: 1,
                  mtime: null,
                  dirty: null,
                  diff: null,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("", { status: 404 });
      }),
    );

    useRepoStore.getState().loadDir("alpha", "");

    await waitFor(() => {
      const root = useRepoStore.getState().repos.alpha?.tree[""];
      expect(root && "entries" in root && root.entries[0]?.name).toBe("first.txt");
    });

    useRepoStore.getState().refresh("alpha");

    await waitFor(() => {
      const root = useRepoStore.getState().repos.alpha?.tree[""];
      expect(root && "entries" in root && root.entries[0]?.name).toBe("second.txt");
    });
  });

  it("hard refresh clears stale tree requests and reloads the root listing", async () => {
    let resolveFirst: ((value: Response) => void) | null = null;
    let filesCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = typeof input === "string" ? input : input.url;
        if (url === "/api/repos/alpha/git") {
          return new Response(
            JSON.stringify({
              branch: "main",
              uncommitted_count: 0,
              untracked_count: 0,
              last_commit: null,
              recent_commits: [],
              dirty_by_path: {},
              diff_stats_by_path: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/repos/alpha/files") {
          filesCalls += 1;
          if (filesCalls === 1) {
            return await new Promise<Response>((resolve) => {
              resolveFirst = resolve;
            });
          }
          return new Response(
            JSON.stringify({
              path: "",
              entries: [
                {
                  name: "fresh.txt",
                  kind: "file",
                  size: 1,
                  mtime: null,
                  dirty: null,
                  diff: null,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("", { status: 404 });
      }),
    );

    useRepoStore.getState().loadDir("alpha", "");

    await waitFor(() => {
      expect(useRepoStore.getState().repos.alpha?.tree[""]).toBeNull();
    });

    useRepoStore.getState().hardRefresh("alpha");

    await waitFor(() => {
      const root = useRepoStore.getState().repos.alpha?.tree[""];
      expect(root && "entries" in root && root.entries[0]?.name).toBe("fresh.txt");
    });

    (resolveFirst as ((value: Response) => void) | null)?.(
      new Response(
        JSON.stringify({
          path: "",
          entries: [
            {
              name: "stale.txt",
              kind: "file",
              size: 1,
              mtime: null,
              dirty: null,
              diff: null,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await waitFor(() => {
      const root = useRepoStore.getState().repos.alpha?.tree[""];
      expect(root && "entries" in root && root.entries[0]?.name).toBe("fresh.txt");
    });
  });
});
