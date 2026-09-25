# syntax=docker/dockerfile:1.7
# CadSandbox — one image serving the web app, the API and the collaboration socket.
#   docker build -t cadsandbox .
#   docker run -p 8787:8787 -e PUBLIC_URL=... -e BETTER_AUTH_SECRET=... -v cadsandbox-data:/data cadsandbox

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------- workspace manifests (cache layer)
FROM ${NODE_IMAGE} AS base
ENV CI=true PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
COPY packages/shared/package.json packages/shared/
COPY packages/doc/package.json packages/doc/
COPY packages/geometry/package.json packages/geometry/
COPY packages/io/package.json packages/io/
COPY packages/render/package.json packages/render/

# ---------------------------------------------------------------- build web + server
FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @cadsandbox/web build \
 && pnpm --filter @cadsandbox/server build

# ---------------------------------------------------------------- production dependencies (server only)
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts --filter "@cadsandbox/server..."

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    BETTER_AUTH_TELEMETRY=0 \
    NODE_OPTIONS=--enable-source-maps
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data && chown node:node /data
WORKDIR /app/apps/server
# Keep pnpm's workspace layout so the relative node_modules symlinks resolve.
COPY --from=prod-deps --chown=node:node /repo/node_modules /app/node_modules
COPY --from=prod-deps --chown=node:node /repo/apps/server/node_modules /app/apps/server/node_modules
COPY --chown=node:node apps/server/package.json /app/apps/server/package.json
COPY --from=build --chown=node:node /repo/apps/server/dist /app/apps/server/dist
COPY --from=build --chown=node:node /repo/apps/server/drizzle /app/apps/server/drizzle
COPY --from=build --chown=node:node /repo/apps/web/dist /app/apps/web/dist
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
