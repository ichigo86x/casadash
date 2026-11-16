#!/bin/sh
# Container entrypoint for both the Home Assistant add-on and plain Docker.
set -e

echo "Starting CasaDash..."

# Persistent data (database + receipts) always lives in /data:
# the add-on's private folder in Home Assistant, a volume in Docker.
export DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/uploads"

if [ -f /data/options.json ]; then
    echo "Home Assistant add-on mode (Ingress and optional direct port)."
    # Ingress forwards to the fixed ingress_port in config.yaml
    export PORT=8099
    # Automatic backups go to the shared folder: visible via Samba, kept if the add-on is removed
    export BACKUP_DIR="${BACKUP_DIR:-/share/casadash/backups}"
else
    echo "Standalone container mode."
    export PORT="${PORT:-8099}"
fi
export HOST="${HOST:-0.0.0.0}"

cd /app

if [ "$(id -u)" = "0" ]; then
    # Data folders may have been created by root (older versions, Home Assistant): hand them to the app user,
    # then run without privileges. Only done when the owner differs, so restarts stay fast.
    BACKUP="${BACKUP_DIR:-$DATA_DIR/backups}"
    mkdir -p "$BACKUP"
    for dir in "$DATA_DIR" "$BACKUP"; do
        if [ "$(stat -c %u "$dir")" != "$(id -u node)" ]; then
            chown -R node:node "$dir"
        fi
    done
    # start.mjs runs the database migrations and supervises the server
    exec su-exec node:node node start.mjs
fi

exec node start.mjs
