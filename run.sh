#!/bin/bash

echo "Starting CasaDash..."

# Sincronizza o crea il database sqlite nel Persistent Volume
mkdir -p /data
if [ ! -f /data/cdash.db ]; then
    echo "Nessun database trovato in /data, creandone uno vuoto..."
    touch /data/cdash.db
fi

# Rendi la cartella uploads permanente collegandola al volume /data
mkdir -p /data/uploads
if [ ! -L /app/uploads ]; then
    rm -rf /app/uploads 2>/dev/null || true
    ln -s /data/uploads /app/uploads
fi

# Leggi porta da Options di Home Assistant, oppure da env var PORT, oppure default 8099
PORT_CONFIG=$(jq --raw-output '.port // 8099' /data/options.json 2>/dev/null || echo "${PORT:-8099}")
PORT_CONFIG="${PORT_CONFIG:-${PORT:-8099}}"

# Avvia l'app Node.js (SvelteKit compilato)
export DATABASE_URL=/data/cdash.db
export PORT=$PORT_CONFIG
export HOST=0.0.0.0

cd /app

# Ensure database tables and users are provisioned
node seed.js

# Start server
node build/index.js
