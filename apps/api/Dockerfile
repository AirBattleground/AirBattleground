# 7xen API — production image.
# Works with the classic builder and BuildKit. Build from the repo root:  docker build -f apps/api/Dockerfile -t 7xen-api .

ARG NODE_VERSION=24-alpine

# ---------- base: node + pnpm (via corepack) ----------
FROM node:${NODE_VERSION} AS base
# openssl is required by the Prisma query engine on Alpine
RUN apk add --no-cache openssl libc6-compat
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /repo

# ---------- build: install, generate prisma client, bundle, deploy prod deps ----------
FROM base AS build
# manifests first so the dependency layer caches across source changes
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@7xen/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @7xen/api exec prisma generate \
 && pnpm --filter @7xen/api build \
 && node -p "require('./apps/api/node_modules/prisma/package.json').version" > /prisma-version
# self-contained production node_modules for the api (no dev deps)
RUN pnpm --filter @7xen/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
RUN apk add --no-cache openssl libc6-compat tini
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /prisma-version /tmp/prisma-version
# prisma CLI (same version as the lockfile) for `migrate deploy` + client generation
RUN npm install -g "prisma@$(cat /tmp/prisma-version)" && npm cache clean --force
COPY --from=build /out ./
RUN prisma generate --schema prisma/schema.prisma
COPY deploy/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
