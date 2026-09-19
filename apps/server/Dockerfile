# syntax=docker/dockerfile:1
# ============================================================
# kennote server —— multi-stage
#   deps  : 只裝相依（快取層）
#   dev   : docker compose 開發用，跑 tsx watch
#   build : esbuild 打包成 dist/
#   prod  : node:22-alpine + 只有 production 相依，啟動前先跑 migrate
# ============================================================
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# argon2 在沒有 musl prebuild 時需要編譯
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app

# ── deps ────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui/package.json packages/ui/
COPY apps/server/package.json apps/server/
RUN pnpm install --filter @kennote/server... --no-frozen-lockfile

# ── dev ─────────────────────────────────────────────────
FROM deps AS dev
COPY . .
EXPOSE 4000
CMD ["pnpm", "--filter", "@kennote/server", "dev"]

# ── build ───────────────────────────────────────────────
FROM deps AS build
COPY packages ./packages
COPY apps/server ./apps/server
COPY tsconfig.base.json ./
RUN pnpm --filter @kennote/server build

# ── prod ────────────────────────────────────────────────
FROM node:22-alpine AS prod
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apk add --no-cache libc6-compat tini
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY apps/server/migrations ./apps/server/migrations

RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node
WORKDIR /app/apps/server
EXPOSE 4000

# 啟動前先跑 migration（冪等：已套用的會自動略過）
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
