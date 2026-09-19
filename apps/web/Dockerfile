# syntax=docker/dockerfile:1
# ============================================================
# kennote web —— build 後交給 nginx 靜態託管
# ============================================================
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ui/package.json packages/ui/
COPY packages/editor-core/package.json packages/editor-core/
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @kennote/web... --no-frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["pnpm", "--filter", "@kennote/web", "dev", "--host", "0.0.0.0"]

FROM deps AS build
COPY packages ./packages
COPY apps/web ./apps/web
COPY tsconfig.base.json ./
# 同源部署：API 走 /api，WS 走 /ws（由 nginx 反向代理）
ENV VITE_API_BASE_URL=""
ENV VITE_WS_URL=""
RUN pnpm --filter @kennote/web build

FROM nginx:alpine AS prod
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
