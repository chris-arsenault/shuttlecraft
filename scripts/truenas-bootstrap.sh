#!/usr/bin/env bash
#
# shuttlecraft TrueNAS dataset bootstrap.
#
# Run on the TrueNAS host (as root) before the first Komodo deploy.
# Creates the dataset subtree the backend bind-mounts, with the correct
# UID/GID ownership so the containerized `dev` user can read and write.
#
#   - /tank/dev/shuttlecraft/home          → /home/dev            (uid/gid 1000)
#   - /tank/dev/shuttlecraft/repos         → /home/dev/repos      (uid/gid 1000)
#   - /tank/dev/shuttlecraft/postgres      → /var/lib/postgresql  (uid/gid 999)
#
# Idempotent: running it multiple times is safe.

set -euo pipefail

ROOT="${SHUTTLECRAFT_DATASET:-/tank/dev/shuttlecraft}"
DEV_UID="${SHUTTLECRAFT_DEV_UID:-1000}"
DEV_GID="${SHUTTLECRAFT_DEV_GID:-1000}"

if [[ "$(id -u)" != "0" ]]; then
  echo "error: run as root (need to chown to UIDs the container will use)" >&2
  exit 1
fi

echo "== shuttlecraft bootstrap =="
echo "dataset root : ${ROOT}"
echo "dev user     : ${DEV_UID}:${DEV_GID}"
echo
echo "Note: the Postgres database is the platform's shared TrueNAS"
echo "      Postgres at 192.168.66.3:5432 — no data dir needed here."
echo "      shuttlecraft must be registered in ahara-infra's"
echo "      truenas_db_projects before first deploy."
echo

mkdir -p \
  "${ROOT}/home/.claude" \
  "${ROOT}/home/.ssh" \
  "${ROOT}/home/.local/bin" \
  "${ROOT}/home/.config/gh" \
  "${ROOT}/repos"

# Ownership
chown -R "${DEV_UID}:${DEV_GID}" "${ROOT}/home"
chown -R "${DEV_UID}:${DEV_GID}" "${ROOT}/repos"

# Permissions
chmod 0700 "${ROOT}/home/.ssh"

# Install the SessionStart hook settings if one doesn't already exist.
SETTINGS="${ROOT}/home/.claude/settings.json"
if [[ ! -f "${SETTINGS}" ]]; then
  cat > "${SETTINGS}" <<'JSON'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "/opt/shuttlecraft/hooks/session-start.sh" }
        ]
      }
    ]
  }
}
JSON
  chown "${DEV_UID}:${DEV_GID}" "${SETTINGS}"
  echo "installed default Claude settings.json with SessionStart hook"
else
  echo "keeping existing settings.json at ${SETTINGS}"
fi

echo
echo "Bootstrap complete. Next steps:"
echo "  1. Drop SSH keys into ${ROOT}/home/.ssh (for git clone)"
echo "  2. Drop a .gitconfig into ${ROOT}/home/.gitconfig"
echo "  3. Put your Claude credentials into ${ROOT}/home/.claude/"
echo "     (the container reads /home/dev/.claude which mounts here)"
echo "  4. Ensure shuttlecraft is registered in ahara-infra:"
echo "     - control/project-shuttlecraft.tf"
echo "     - services/db-migrate-truenas.tf truenas_db_projects"
echo "  5. Push to main — shared CI deploys via Komodo automatically"
