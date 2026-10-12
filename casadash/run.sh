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
else
    echo "Standalone container mode."
    export PORT="${PORT:-8099}"
fi
export HOST="${HOST:-0.0.0.0}"

cd /app
# start.mjs runs the database migrations and supervises the server
exec node start.mjs
