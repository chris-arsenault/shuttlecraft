# shuttlecraft

Session broker for Claude Code terminal sessions. Persistent PTYs with structured timeline scrollback, served to any LAN device via web UI.

- Architectural design: [`session-broker-design.md`](session-broker-design.md)
- Invariants and contributor guide: [`CLAUDE.md`](CLAUDE.md)

## Status

Early development. Backend and frontend MVPs landed; first Komodo deploy (issue #14) is the next verification step.

## Local development

Requires Rust (for the backend), pnpm + Node 24 (for the frontend), and a local Postgres for backend tests.

```bash
make ci              # full lint + test + build

# Backend
cd backend && cargo run                        # SHUTTLECRAFT_DB_URL must be set

# Backend integration tests (require a real Postgres)
docker run --rm -d --name shuttlecraft-test-db -p 55432:5432 \
  -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=shuttlecraft postgres:16
SHUTTLECRAFT_TEST_DB='postgres://postgres:testpass@localhost:55432/shuttlecraft' \
  cargo test --release -- --ignored

# Frontend
cd frontend && pnpm install && pnpm dev       # proxies /api and /ws to :8080
```

## First-run on TrueNAS

Deploying to TrueNAS uses the standard ahara path: Docker Compose via Komodo, shared TrueNAS Postgres auto-provisioned by the migration Lambda, Komodo stack created on demand by the deploy action.

### 1. ahara-infra registration (one-time, cross-repo)

`project-shuttlecraft.tf` under `control/` and a one-line addition to `truenas_db_projects` under `services/db-migrate-truenas.tf`. Already landed — `ahara-infra` commit `3a221d6`.

### 2. Dataset on TrueNAS (one-time, shell entry only)

Create one dataset at `/mnt/apps/apps/shuttlecraft` and chown it to the container's dev user:

```bash
zfs create apps/apps/shuttlecraft
chown 7321:7321 /mnt/apps/apps/shuttlecraft
```

(`7321` is a deliberately unusual uid chosen to avoid colliding with the 1000-series uid that most consumer apps claim. Match this to the `DEV_UID` / `DEV_GID` build args in `backend/Dockerfile` if you need to change it.)

That's the whole bootstrap. The container's entrypoint self-provisions the home-directory subtree on first boot — `~/.claude/`, `~/.ssh/`, `~/.local/bin/`, `~/.config/gh/`, `~/repos/` — and installs the default `.claude/settings.json` with the SessionStart hook pre-wired. No `mkdir -p`, no `truenas-bootstrap.sh`.

### 3. Deploy

Push to `main`. The ahara shared CI workflow builds both images, pushes to GHCR, and the `deploy-truenas` action:

1. Invokes `ahara-db-migrate-truenas` with `project: "shuttlecraft"` → creates the `shuttlecraft` database, an app role, and publishes `/ahara/truenas-db/shuttlecraft/{username,password}` in SSM.
2. Lists Komodo servers, creates the `shuttlecraft` stack on-demand (tolerant of already-exists), points it at this repo's `compose.yaml`.
3. Resolves the two SSM paths declared in `secret-paths.yml`, sets them as Komodo stack environment variables, and deploys.

### 4. Drop in your credentials

SSH into TrueNAS and put your personal state directly into the dataset — it appears as `/home/dev/` inside the container:

- SSH keys for `git clone`: `/mnt/apps/apps/shuttlecraft/.ssh/` (chmod 0600 for private keys)
- Git identity: `/mnt/apps/apps/shuttlecraft/.gitconfig`
- Claude auth: run `claude login` inside a shuttlecraft PTY session, or copy an existing `~/.claude/.credentials.json` into `/mnt/apps/apps/shuttlecraft/.claude/`
- `gh` token (optional): `/mnt/apps/apps/shuttlecraft/.config/gh/hosts.yml`

### 5. Verify

```bash
curl -sf http://192.168.66.3:30080/health
# → {"status":"ok","db":"ok"}
```

Open the UI at `http://192.168.66.3:30080/`, create a repo, spawn a session, run `claude` inside. The SessionStart hook correlates the session; the timeline populates via the ingester polling the bind-mounted `~/.claude/projects/`.

## Ingestion model

All JSONL reads happen in the backend ingester — the REST API and WebSocket paths query Postgres only. See `CLAUDE.md` for the full list of architectural invariants.

## License

MIT — see [`LICENSE`](LICENSE).
