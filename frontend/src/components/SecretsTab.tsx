import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deleteSecret,
  getSecret,
  listSecretGrants,
  listSecrets,
  revokeSecretGrant,
  unlockSecretGrant,
  upsertSecret,
} from "../api/client";
import type {
  SecretEnvelope,
  SecretGrantMetadata,
  SecretMetadata,
  SecretTool,
} from "../api/types";
import { Icon } from "../icons";
import { useSessions } from "../state/SessionStore";
import "./SecretsTab.css";

const TTL_PRESETS = [
  { label: "10m", seconds: 600 },
  { label: "30m", seconds: 1800 },
  { label: "1h", seconds: 3600 },
  { label: "4h", seconds: 14_400 },
] as const;

const EMPTY_SECRET: SecretEnvelope = {
  description: "",
  scope: "global",
  repo: null,
  env: { EXAMPLE_KEY: "" },
};

export function SecretsTab({ sessionId }: { sessionId: string | null }) {
  const session = useSessions((store) =>
    sessionId ? store.sessions.find((item) => item.id === sessionId) ?? null : null,
  );
  const [secrets, setSecrets] = useState<SecretMetadata[]>([]);
  const [grants, setGrants] = useState<SecretGrantMetadata[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState("");
  const [draft, setDraft] = useState<SecretEnvelope>(EMPTY_SECRET);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [grantTool, setGrantTool] = useState<SecretTool>("with-cred");
  const [ttlSeconds, setTtlSeconds] = useState<number>(TTL_PRESETS[1].seconds);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSecrets = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listSecrets();
      setSecrets(items);
      setSelectedId((prev) => prev ?? items[0]?.id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "secret load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGrants = useCallback(async () => {
    if (!sessionId) {
      setGrants([]);
      return;
    }
    try {
      setGrants(await listSecretGrants(sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "grant load failed");
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  useEffect(() => {
    if (!selectedId) {
      setDraftId("");
      setDraft(EMPTY_SECRET);
      return;
    }
    setLoadingDetail(true);
    void getSecret(selectedId)
      .then((secret) => {
        setDraftId(selectedId);
        setDraft(secret);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "secret load failed");
      })
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  const activeGrantByTool = useMemo(() => {
    const map = new Map<string, SecretGrantMetadata>();
    for (const grant of grants) {
      if (grant.secret_id !== draftId) continue;
      map.set(grant.tool, grant);
    }
    return map;
  }, [draftId, grants]);

  const selectedSecretMeta = useMemo(
    () => secrets.find((item) => item.id === draftId) ?? null,
    [draftId, secrets],
  );

  const withCredConflicts = useMemo(() => {
    if (!draftId || grantTool !== "with-cred") return [];
    const currentKeys = new Set(selectedSecretMeta?.env_keys ?? Object.keys(draft.env));
    return grants
      .filter((grant) => grant.tool === "with-cred" && grant.secret_id !== draftId)
      .map((grant) => {
        const meta = secrets.find((item) => item.id === grant.secret_id);
        if (!meta) return null;
        const overlap = meta.env_keys.filter((key) => currentKeys.has(key));
        if (overlap.length === 0) return null;
        return { secretId: grant.secret_id, keys: overlap };
      })
      .filter((item): item is { secretId: string; keys: string[] } => item != null);
  }, [draftId, draft.env, grantTool, grants, secrets, selectedSecretMeta?.env_keys]);

  const startNew = useCallback(() => {
    setSelectedId(null);
    setDraftId("");
    setDraft(EMPTY_SECRET);
    setNotice(null);
    setError(null);
  }, []);

  const saveSecret = useCallback(async () => {
    const id = draftId.trim();
    if (!id) {
      setError("secret id is required");
      return;
    }
    if (Object.keys(draft.env).length === 0) {
      setError("at least one env entry is required");
      return;
    }
    setSaving(true);
    try {
      await upsertSecret(id, {
        description: draft.description.trim(),
        scope: draft.scope.trim() || "global",
        repo: draft.repo?.trim() || null,
        env: trimEnvMap(draft.env),
      });
      await loadSecrets();
      setSelectedId(id);
      setNotice(`Saved ${id}`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "secret save failed");
    } finally {
      setSaving(false);
    }
  }, [draft, draftId, loadSecrets]);

  const removeSecret = useCallback(async () => {
    if (!draftId) return;
    try {
      await deleteSecret(draftId);
      setNotice(`Deleted ${draftId}`);
      setSelectedId(null);
      setDraftId("");
      setDraft(EMPTY_SECRET);
      await loadSecrets();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "secret delete failed");
    }
  }, [draftId, loadSecrets]);

  const enableGrant = useCallback(async () => {
    if (!sessionId || !draftId) return;
    if (grantTool === "with-cred" && withCredConflicts.length > 0) {
      setError("resolve with-cred env key conflicts before enabling this bundle");
      return;
    }
    try {
      await unlockSecretGrant({
        pty_session_id: sessionId,
        secret_id: draftId,
        tool: grantTool,
        ttl_seconds: ttlSeconds,
      });
      await loadGrants();
      setNotice(`Enabled ${draftId} for ${grantTool}`);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "grant enable failed");
    }
  }, [draftId, grantTool, loadGrants, sessionId, ttlSeconds, withCredConflicts.length]);

  const disableGrant = useCallback(
    async (tool: SecretTool, secretId: string) => {
      if (!sessionId || !secretId) return;
      try {
        await revokeSecretGrant({
          pty_session_id: sessionId,
          secret_id: secretId,
          tool,
        });
        await loadGrants();
        setNotice(`Revoked ${secretId} for ${tool}`);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "grant revoke failed");
      }
    },
    [loadGrants, sessionId],
  );

  return (
    <div className="secrets-tab">
      <aside className="secrets-tab__sidebar">
        <div className="secrets-tab__sidebar-head">
          <div>
            <div className="secrets-tab__eyebrow">Secrets</div>
            <h2>Bundles</h2>
          </div>
          <button type="button" className="secrets-tab__button" onClick={startNew}>
            <Icon name="plus" size={14} />
            <span>New</span>
          </button>
        </div>
        {loading ? (
          <div className="secrets-tab__empty">loading…</div>
        ) : secrets.length === 0 ? (
          <div className="secrets-tab__empty">No secrets yet.</div>
        ) : (
          <ul className="secrets-tab__list">
            {secrets.map((secret) => (
              <li key={secret.id}>
                <button
                  type="button"
                  className={
                    "secrets-tab__list-item" + (secret.id === draftId ? " is-active" : "")
                  }
                  onClick={() => setSelectedId(secret.id)}
                >
                  <span className="secrets-tab__list-title">{secret.id}</span>
                  <span className="secrets-tab__list-meta">{secret.description || secret.scope}</span>
                  <span className="secrets-tab__list-keys">
                    {secret.env_keys.join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="secrets-tab__main">
        <header className="secrets-tab__header">
          <div>
            <div className="secrets-tab__eyebrow">Secret editor</div>
            <h2>{draftId || "New bundle"}</h2>
          </div>
          <div className="secrets-tab__header-actions">
            {notice ? <span className="secrets-tab__notice">{notice}</span> : null}
            {error ? <span className="secrets-tab__error">{error}</span> : null}
          </div>
        </header>

        <div className="secrets-tab__grid">
          <div className="secrets-tab__panel">
            <label className="secrets-tab__field">
              <span>ID</span>
              <input
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
                placeholder="claude-api"
                disabled={selectedId != null}
              />
            </label>
            <label className="secrets-tab__field">
              <span>Description</span>
              <input
                value={draft.description}
                onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Anthropic API key"
              />
            </label>
            <div className="secrets-tab__field-row">
              <label className="secrets-tab__field">
                <span>Scope</span>
                <input
                  value={draft.scope}
                  onChange={(e) => setDraft((prev) => ({ ...prev, scope: e.target.value }))}
                  placeholder="global"
                />
              </label>
              <label className="secrets-tab__field">
                <span>Repo</span>
                <input
                  value={draft.repo ?? ""}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      repo: e.target.value.trim() ? e.target.value : null,
                    }))
                  }
                  placeholder="optional repo"
                />
              </label>
            </div>

            <div className="secrets-tab__env-head">
              <h3>Environment</h3>
              <button
                type="button"
                className="secrets-tab__button secrets-tab__button--ghost"
                onClick={() => {
                  const key = nextEnvKey(draft.env);
                  setDraft((prev) => ({
                    ...prev,
                    env: { ...prev.env, [key]: "" },
                  }));
                }}
              >
                <Icon name="plus" size={14} />
                <span>Add pair</span>
              </button>
            </div>
            <div className="secrets-tab__env-list">
              {Object.entries(draft.env).map(([key, value], index) => (
                <div key={`${key}-${index}`} className="secrets-tab__env-row">
                  <input
                    value={key}
                    onChange={(e) => {
                      const nextKey = e.target.value;
                      setDraft((prev) => ({
                        ...prev,
                        env: renameEnvKey(prev.env, key, nextKey),
                      }));
                    }}
                    placeholder="ANTHROPIC_API_KEY"
                  />
                  <input
                    value={value}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        env: { ...prev.env, [key]: e.target.value },
                      }))
                    }
                    placeholder="value"
                  />
                  <button
                    type="button"
                    className="secrets-tab__icon-button"
                    aria-label={`Remove ${key}`}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        env: removeEnvKey(prev.env, key),
                      }))
                    }
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="secrets-tab__actions">
              <button
                type="button"
                className="secrets-tab__button"
                onClick={() => void saveSecret()}
                disabled={saving || loadingDetail}
              >
                Save
              </button>
              {selectedId ? (
                <button
                  type="button"
                  className="secrets-tab__button secrets-tab__button--danger"
                  onClick={() => void removeSecret()}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </div>

          <div className="secrets-tab__panel">
            <div className="secrets-tab__grant-head">
              <div>
                <div className="secrets-tab__eyebrow">Terminal access</div>
                <h3>
                  {session
                    ? session.label?.trim() || session.id.slice(0, 8)
                    : "Pick a terminal/session"}
                </h3>
              </div>
              {session ? <span className="secrets-tab__grant-repo">{session.repo}</span> : null}
            </div>

            {!sessionId ? (
              <div className="secrets-tab__empty">
                Open this tab from a terminal or session context menu to manage grants for that PTY.
              </div>
            ) : (
              <>
                <div className="secrets-tab__field">
                  <span>Mode</span>
                  <div className="secrets-tab__tool-picker">
                    <button
                      type="button"
                      className={grantTool === "with-cred" ? "is-active" : ""}
                      onClick={() => setGrantTool("with-cred")}
                    >
                      with-cred
                    </button>
                    <button
                      type="button"
                      className={grantTool === "aws" ? "is-active" : ""}
                      onClick={() => setGrantTool("aws")}
                    >
                      aws
                    </button>
                  </div>
                </div>
                <div className="secrets-tab__field">
                  <span>TTL</span>
                  <div className="secrets-tab__ttl-picker">
                    {TTL_PRESETS.map((preset) => (
                      <button
                        key={preset.seconds}
                        type="button"
                        className={ttlSeconds === preset.seconds ? "is-active" : ""}
                        onClick={() => setTtlSeconds(preset.seconds)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {grantTool === "with-cred" && withCredConflicts.length > 0 ? (
                  <div className="secrets-tab__warning">
                    <strong>Env key conflict</strong>
                    {withCredConflicts.map((conflict) => (
                      <div key={conflict.secretId}>
                        {conflict.secretId}: {conflict.keys.join(", ")}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="secrets-tab__grant-actions">
                  <button
                    type="button"
                    className="secrets-tab__button"
                    disabled={!draftId}
                    onClick={() => void enableGrant()}
                  >
                    Enable
                  </button>
                  {activeGrantByTool.get(grantTool) ? (
                    <button
                      type="button"
                      className="secrets-tab__button secrets-tab__button--ghost"
                      onClick={() => void disableGrant(grantTool, draftId)}
                    >
                      Revoke {grantTool}
                    </button>
                  ) : null}
                </div>

                <div className="secrets-tab__active">
                  <h4>Active grants</h4>
                  {grants.length === 0 ? (
                    <div className="secrets-tab__empty">No active grants for this terminal.</div>
                  ) : (
                    <ul className="secrets-tab__grant-list">
                      {grants.map((grant) => (
                        <li key={`${grant.secret_id}-${grant.tool}`} className="secrets-tab__grant-row">
                          <div>
                            <div className="secrets-tab__grant-title">
                              {grant.secret_id} · {grant.tool}
                            </div>
                            <div className="secrets-tab__grant-meta">
                              expires {relativeExpiry(grant.expires_at)}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="secrets-tab__icon-button"
                            aria-label={`Revoke ${grant.secret_id}`}
                            onClick={() => void disableGrant(grant.tool, grant.secret_id)}
                          >
                            <Icon name="x" size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function nextEnvKey(env: Record<string, string>) {
  let index = 1;
  while (env[`NEW_KEY_${index}`] !== undefined) index += 1;
  return `NEW_KEY_${index}`;
}

function renameEnvKey(env: Record<string, string>, from: string, to: string) {
  if (from === to || to.trim() === "") return env;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    next[key === from ? to : key] = value;
  }
  return next;
}

function removeEnvKey(env: Record<string, string>, keyToRemove: string) {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key !== keyToRemove) next[key] = value;
  }
  return next;
}

function trimEnvMap(env: Record<string, string>) {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) continue;
    next[trimmedKey] = value;
  }
  return next;
}

function relativeExpiry(value: string) {
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `in ${hours}h`;
}
