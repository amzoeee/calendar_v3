# syntax=docker/dockerfile:1

# ---- deps: full install (incl. devDependencies) for the build step ----
FROM node:20-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile the Next.js app ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: production-only install, native module built for this image ----
FROM node:20-bookworm-slim AS prod-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runner: minimal runtime image ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
# Stamped in by the publish workflow so the running app can report which
# commit it was built from (shown at the bottom of the settings page).
ARG GIT_COMMIT=""
ARG BUILD_TIME=""
ENV NODE_ENV=production \
    PORT=4000 \
    HOSTNAME=0.0.0.0 \
    GIT_COMMIT=$GIT_COMMIT \
    BUILD_TIME=$BUILD_TIME

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY docker-entrypoint.js ./docker-entrypoint.js

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 4000

CMD ["node", "docker-entrypoint.js"]
