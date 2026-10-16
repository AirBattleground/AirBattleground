# 7xen web — static Vite build served by nginx (proxies /api to the API service).
# Works with the classic builder and BuildKit. Build from the repo root:  docker build -f apps/web/Dockerfile -t 7xen-web .

ARG NODE_VERSION=24-alpine

FROM node:${NODE_VERSION} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter "@7xen/web..."
COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY apps/web apps/web
RUN pnpm --filter @7xen/web build

FROM nginx:1.27-alpine AS runtime
ENV API_UPSTREAM=http://api:4000
# the nginx image renders /etc/nginx/templates/*.template into /etc/nginx/conf.d/
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/spa.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
