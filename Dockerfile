# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build -w @qwiza/minigames && npm run build -w @qwiza/api

FROM build AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts && mkdir -p apps/api/node_modules

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 WEB_ORIGIN=http://localhost:3000
COPY --from=production-dependencies --chown=node:node /app/package.json ./package.json
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/packages/minigames ./packages/minigames
COPY --from=production-dependencies --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
RUN mkdir -p .local-data/media && chown -R node:node .local-data
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
