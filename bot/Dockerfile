# syntax=docker/dockerfile:1

# The bot is a plain gateway client with one dependency and no build step, so
# it gets its own small image rather than riding along in the app's.
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# data/ holds channel registrations; created here so a fresh volume mounted
# over it inherits the bot user's ownership.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs bot \
    && mkdir -p /app/data \
    && chown -R bot:nodejs /app

USER bot

CMD ["node", "index.js"]
