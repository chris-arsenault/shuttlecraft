CREATE SCHEMA IF NOT EXISTS secret_broker;

CREATE TABLE IF NOT EXISTS secret_broker.secrets (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  scope TEXT NOT NULL,
  repo TEXT NULL,
  ciphertext BYTEA NOT NULL,
  nonce BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS secret_broker.grants (
  id UUID PRIMARY KEY,
  pty_session_id UUID NOT NULL,
  secret_id TEXT NOT NULL REFERENCES secret_broker.secrets(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  granted_by_sub TEXT NOT NULL,
  granted_by_username TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS secret_broker_grants_active_idx
  ON secret_broker.grants (pty_session_id, secret_id, tool, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS secret_broker.use_audit (
  id UUID PRIMARY KEY,
  pty_session_id UUID NOT NULL,
  secret_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS secret_broker_use_audit_pty_idx
  ON secret_broker.use_audit (pty_session_id, used_at DESC);
