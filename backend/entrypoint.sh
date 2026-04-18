#!/usr/bin/env bash
#
# shuttlecraft container entrypoint. Runs as the `dev` user (set via
# USER in the Dockerfile). Self-provisions the dataset layout so the
# TrueNAS operator only has to create the dataset and chown it to
# the dev UID — nothing else.
#
# All state lives under $HOME (which is bind-mounted from the dataset
# root), so mkdirs here persist across container restarts.

set -euo pipefail

HOME_DIR="${HOME:-/home/dev}"

mkdir -p \
  "${HOME_DIR}/.claude" \
  "${HOME_DIR}/.ssh" \
  "${HOME_DIR}/.local/bin" \
  "${HOME_DIR}/.config/gh" \
  "${HOME_DIR}/repos"

# SSH refuses to read keys from directories that aren't 0700.
chmod 0700 "${HOME_DIR}/.ssh"

# Pre-wire the SessionStart hook the first time the dataset sees a
# .claude/ dir. Never overwrite an existing user-customised file.
SETTINGS="${HOME_DIR}/.claude/settings.json"
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
fi

exec /usr/local/bin/shuttlecraft
