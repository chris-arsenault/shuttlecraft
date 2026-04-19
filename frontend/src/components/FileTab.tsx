// File preview tab. Format dispatch is cheap: images by ext, markdown
// through our existing Markdown component, everything text-ish as a
// <pre>. Over 1 MiB the backend refuses to serve the content and the
// tab shows a truncation banner.

import { useEffect, useState } from "react";

import { getRepoFile } from "../api/client";
import type { FileResponse } from "../api/types";
import { useRepos } from "../state/RepoStore";
import { useTabs } from "../state/TabStore";
import { Markdown } from "./timeline/Markdown";
import "./FileTab.css";

export function FileTab({ repo, path }: { repo: string; path: string }) {
  const [data, setData] = useState<FileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repoState = useRepos().repos[repo];
  const dirty = repoState?.git?.dirty_by_path[path];
  const { openTab } = useTabs();

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getRepoFile(repo, path)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [repo, path]);

  if (error) {
    return (
      <div className="ft ft--err">
        <div className="ft__header">
          <span className="ft__path">{path}</span>
        </div>
        <div className="ft__body">error: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ft">
        <div className="ft__header">
          <span className="ft__path">{path}</span>
        </div>
        <div className="ft__body ft__body--muted">loading…</div>
      </div>
    );
  }

  return (
    <div className="ft">
      <div className="ft__header">
        <span className="ft__path">{path}</span>
        <span className="ft__meta">
          {formatSize(data.size)} · {data.mime}
          {data.binary ? " · binary" : ""}
          {data.truncated ? " · truncated" : ""}
        </span>
        {dirty && (
          <button
            type="button"
            className="ft__diff-btn"
            title={`Open diff (${dirty.trim()})`}
            onClick={() => openTab({ kind: "diff", repo, path })}
          >
            {dirty.trim() || "•"} view diff
          </button>
        )}
      </div>
      <div className="ft__body">
        <FileBody data={data} repo={repo} />
      </div>
    </div>
  );
}

function FileBody({ data, repo }: { data: FileResponse; repo: string }) {
  if (data.truncated) {
    return (
      <div className="ft__muted">
        File exceeds 1 MiB; preview disabled. Use the terminal to inspect it
        directly.
      </div>
    );
  }
  if (data.binary) {
    // Images render inline; other binaries show a size summary only.
    if (data.mime.startsWith("image/")) {
      const src = `/api/repos/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(
        data.path,
      )}&raw=1`;
      return (
        <img
          src={src}
          alt={data.path}
          className="ft__img"
        />
      );
    }
    return <div className="ft__muted">Binary file ({formatSize(data.size)}).</div>;
  }
  if (data.mime === "text/markdown" && data.content) {
    return (
      <div className="ft__md">
        <Markdown source={data.content} />
      </div>
    );
  }
  if (data.mime.startsWith("image/")) {
    // Text-sniffed SVG path — render inline.
    return (
      <div className="ft__svg" dangerouslySetInnerHTML={{ __html: data.content ?? "" }} />
    );
  }
  return <pre className="ft__code">{data.content ?? ""}</pre>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
