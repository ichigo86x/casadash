# CasaDash image, used both as Home Assistant add-on and as a standalone container.
# The official multi-arch Node image is used for every target (amd64, aarch64, armv7):
# the BUILD_FROM argument passed by the Home Assistant builder is intentionally ignored,
# because its base images do not ship Node.js.

# --- Build stage: native modules (better-sqlite3) and the SvelteKit bundle ---
FROM node:26-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# --- Runtime stage ---
FROM node:26-alpine
RUN apk add --no-cache tini su-exec
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json /app/seed.js /app/start.mjs /app/run.sh ./

# Normalise line endings in case the repository was checked out on Windows
RUN sed -i 's/\r$//' /app/run.sh && chmod a+x /app/run.sh

EXPOSE 8099
VOLUME ["/data"]

# run.sh starts as root only to fix the ownership of the data folders, then drops to the unprivileged "node" user
HEALTHCHECK --interval=60s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8099}/login" || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/app/run.sh"]
