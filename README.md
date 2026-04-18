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

Deploying to TrueNAS uses the standard ahara path: Docker Compose via Komodo, auto-provisioned shared TrueNAS Postgres, no manual stack registration. You only need two setups: the ahara-infra registration (one-time) and the on-host dataset (one-time per machine).

### 1. Register in ahara-infra (one-time, cross-repo)

Add two files in `ahara-infra`:

**`infrastructure/terraform/control/project-shuttlecraft.tf`** — deployer role + komodo-deploy policy:

```hcl
module "project_shuttlecraft" {
  source = "./modules/managed-project"

  oidc_provider_arn = aws_iam_openid_connect_provider.github.arn
  account_id        = local.account_id

  github_pat         = local.github_pat
  allowed_repos      = ["shuttlecraft"]
  allowed_branches   = ["main"]
  allow_pull_request = true

  prefix           = "shuttlecraft"
  state_key_prefix = "projects/shuttlecraft"

  module_bundles = []
  policy_modules = ["terraform-state", "komodo-deploy"]
}
```

And add `shuttlecraft = { db_name = "shuttlecraft" }` to `var.truenas_db_projects` in `infrastructure/terraform/services/db-migrate-truenas.tf`. Apply `ahara-infra`. This provisions the OIDC role, the Postgres database + app role, and publishes `/ahara/truenas-db/shuttlecraft/{username,password}` to SSM.

### 2. Bootstrap the dataset on TrueNAS

SSH into TrueNAS as root (one-time per host):

```bash
./scripts/truenas-bootstrap.sh
```

Creates `/tank/dev/shuttlecraft/{home,repos}` owned by UID/GID 1000:1000 — the container's `dev` user writes here. Idempotent. Paths and UIDs are overridable via env vars (`SHUTTLECRAFT_DATASET=`, `SHUTTLECRAFT_DEV_UID=`).

Drop in per-user state:

- SSH keys → `/tank/dev/shuttlecraft/home/.ssh/` (chmod 0600 for private keys)
- Git identity → `/tank/dev/shuttlecraft/home/.gitconfig`
- Claude auth → `/tank/dev/shuttlecraft/home/.claude/` (the bootstrap script pre-writes `settings.json` with the SessionStart hook)
- `gh` token (optional) → `/tank/dev/shuttlecraft/home/.config/gh/hosts.yml`

### 3. Deploy

Push to `main`. The ahara shared CI workflow builds both images, pushes to GHCR, and the `deploy-truenas` action:

1. Invokes `ahara-db-migrate-truenas` with `project: "shuttlecraft"` — ensures DB + role + SSM creds.
2. Lists Komodo servers, creates the `shuttlecraft` stack on-demand (tolerant of already-exists), points it at this repo's `compose.yaml`.
3. Resolves `DB_USER`/`DB_PASSWORD` from SSM via `secret-paths.yml`, sets them as Komodo stack environment variables, and deploys.

No manual SSM puts, no manual Komodo UI steps.

### 4. Verify

```bash
curl -sf http://192.168.66.3:30080/health
# → {"status":"ok","db":"ok"}
```

Open the UI at `http://192.168.66.3:30080/`, create a repo, spawn a session, run `claude` inside. The SessionStart hook correlates the session; the timeline populates via the ingester polling the bind-mounted `~/.claude/projects/`.

## Ingestion model

All JSONL reads happen in the backend ingester — the REST API and WebSocket paths query Postgres only. See `CLAUDE.md` for the full list of architectural invariants.

## License

MIT — see [`LICENSE`](LICENSE).
