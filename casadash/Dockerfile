# CasaDash image, used both as Home Assistant add-on and as a standalone container.
# The official multi-arch Node image is used for every target (amd64, aarch64, armv7):
# the BUILD_FROM argument passed by the Home Assistant builder is intentionally ignored,
# because its base images do not ship Node.js.

# --- Build stage: native modules (better-sqlite3) and the SvelteKit bundle ---
FROM node:24-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# --- Runtime stage ---
FROM node:24-alpine
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json /app/seed.js /app/start.mjs /app/run.sh ./

# Normalise line endings in case the repository was checked out on Windows
RUN sed -i 's/\r$//' /app/run.sh && chmod a+x /app/run.sh

EXPOSE 8099
VOLUME ["/data"]

ENTRYPOINT ["/sbin/tini", "--", "/app/run.sh"]
