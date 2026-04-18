# shuttlecraft

Session broker for Claude Code terminal sessions. Hosts persistent PTYs on a TrueNAS server and provides a web UI with structured timeline scrollback.

See `session-broker-design.md` for the full architectural design and rationale.

## Stack

- **Backend**: Rust (`axum`, `tokio`, `sqlx`, `portable-pty`, `vt100`, `notify`) — `backend/`
- **Frontend**: TypeScript + React + Vite, `xterm.js`, `react-virtuoso` — `frontend/`
- **Database**: PostgreSQL 16 (sidecar in compose stack, not shared platform RDS)
- **Deploy**: Docker Compose via Komodo on TrueNAS (ahara standard)

## Ahara ecosystem integration

Shuttlecraft is a standard TrueNAS/Komodo deploy. The pattern matches `nas-sonarqube`:

- **Shared TrueNAS Postgres** at `192.168.66.3:5432`. Registered in `ahara-infra/infrastructure/terraform/services/db-migrate-truenas.tf` under `var.truenas_db_projects`. The `ahara-db-migrate-truenas` Lambda creates the DB + app role and publishes credentials to `/ahara/truenas-db/shuttlecraft/{username,password}` in SSM.
- **Deploy-truenas action auto-creates the Komodo stack** on first push (tolerant of already-exists). No manual UI setup.
- **No `infrastructure/terraform/`** in this repo. Nothing to apply from the project's own state. Cross-repo registration only: the `project-shuttlecraft.tf` file in ahara-infra's control layer grants the deployer role `terraform-state` + `komodo-deploy` policies.
- **No reverse-proxy route** for MVP. LAN-only via WireGuard, bound to `192.168.66.3:30080`. Add a `reverse_proxy_routes` entry in ahara-network with `auth = "jwt-validation"` when public exposure is wanted.

Shuttlecraft-specific divergence from typical ahara services:

- **Thick backend container.** Carries `git`, `openssh-client`, `node`, `bash` — the PTY shell is the product, not an accident. See `backend/Dockerfile`.
- **Dataset-backed workbench.** `/tank/dev/shuttlecraft/` on TrueNAS is bind-mounted into the backend container at `/home/dev/`. All user state (SSH keys, Claude creds, installed tools under `.local/`) lives in this dataset and survives image rebuilds.

## Dataset-backed workbench (TrueNAS)

The backend bind-mounts `/tank/dev/shuttlecraft/` from TrueNAS:

```
/tank/dev/shuttlecraft/
  home/    → /home/dev/ in container
  repos/   → /home/dev/repos/ in container
  postgres/ → postgres sidecar data
```

UID/GID of the container's `dev` user must match dataset ownership. All dev state (Claude creds, SSH keys, gitconfig, user-installed tools under `~/.local/`) lives in the dataset and persists across image rebuilds.

## Architectural invariants — do not break

1. **Only the ingester reads JSONL.** REST handlers and WebSocket event pushes query Postgres. Never `fs::read` the `~/.claude/projects/` files from the request path.
2. **The terminal pane lives outside React's reconciliation.** Mount `xterm.js` imperatively; pipe WebSocket bytes directly. React must not re-render the terminal container in response to PTY data.
3. **Ingester must tolerate partial lines and unknown event types.** Partial lines: only commit on trailing `\n`. Unknown types: log and skip, do not crash. JSONL format is not a stable public API.
4. **Shadow terminal emulator is fed continuously**, including while no clients are attached. Otherwise snapshot-on-reconnect lags.
5. **Ingester idempotency key:** `(session_uuid, byte_offset)`. JSONL is append-only, so byte offset is stable.
6. **Schema includes `parent_session_uuid NULL`** from day one. Cheap now; avoids a migration when compaction UI arrives.

## Session correlation

Backend injects `SHUTTLECRAFT_PTY_ID=<pty_id>` into the PTY shell environment. A Claude Code `SessionStart` hook reads that env var and posts `{pty_id, claude_session_uuid}` to `/run/shuttlecraft/correlate.sock`. The backend records the association. When the user starts a new Claude session in the same PTY, the hook fires again and updates the current-claude-session pointer.

The hook script ships in this repo at `scripts/claude-hooks/session-start.sh`. Install it once per dataset:

```bash
mkdir -p /tank/dev/shuttlecraft/home/.claude
cat > /tank/dev/shuttlecraft/home/.claude/settings.json <<'EOF'
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "/opt/shuttlecraft/hooks/session-start.sh" }] }
    ]
  }
}
EOF
```

The container image places the hook at `/opt/shuttlecraft/hooks/session-start.sh`. Hook failure is silent — if the socket is gone, Claude continues without correlation (the session is still ingested from the JSONL file; only the pty↔claude-session link is missing).

## Local development

```
make ci          # run the full CI check locally
make lint-rust   # clippy
make fmt-rust    # fmt --check
make test-rust   # cargo test
make lint-ts     # eslint
make typecheck-ts
make test-ts     # vitest run
```

## CI

`.github/workflows/ci.yml` is a minimal caller of the shared ahara workflow at `chris-arsenault/ahara/.github/workflows/ci.yml@main`. The shared workflow handles lint/test/build/Docker push/Komodo deploy based on `platform.yml`.
