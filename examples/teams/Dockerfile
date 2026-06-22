# Microsoft Teams demo bot for @copilotkit/bot-teams.
#
# This is a *monorepo* image: the example depends on workspace packages
# (@copilotkit/bot, bot-ui, bot-teams, runtime, core, shared) that only exist
# inside this repo, so the build context MUST be the repo root, not
# examples/teams. On whatever host you deploy to, set the build context / root
# directory to the repo root and point it at this file (examples/teams/Dockerfile).
# See examples/teams/README.md.
#
# The install/build are filtered to the teams-example dependency closure so we
# never pull in unrelated workspace packages (e.g. the harness, which builds
# better-sqlite3 natively and would need a C toolchain in the image).
FROM node:22-slim

WORKDIR /app

# `git` is required by the repo's root `prepare` script (lefthook install runs
# on every pnpm install); ca-certificates for HTTPS fetches during install.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# Copy the whole (dockerignore-trimmed) repo: pnpm needs the workspace manifests
# and lockfile to resolve workspace:* deps, and tsx runs the source at runtime.
COPY . .

# Install only teams-example and its dependency closure (workspace + npm),
# including the devDeps each library needs to build (tsc/rolldown) and tsx.
# `--ignore-scripts` skips install-time lifecycle hooks that don't belong in a
# prod image and break without a working tree (the root `lefthook install`
# prepare hook needs a .git repo; the harness's better-sqlite3 native build is
# unused here). The explicit `run build` below is unaffected by this flag.
RUN pnpm install --frozen-lockfile --filter "teams-example..." --ignore-scripts

# Build the workspace libraries the example imports, in topological order.
# `pkg...` expands to the package plus its workspace dependencies.
# The core bundle's dts generation blows past Node's default ~1 GB heap, so
# raise the limit for the build step (scoped to this layer, not the runtime).
RUN NODE_OPTIONS=--max-old-space-size=8192 \
  pnpm --filter "@copilotkit/bot-teams..." --filter "@copilotkit/runtime..." run build

# Most hosts inject PORT and route public traffic to it; the bot binds there
# (POST /api/messages + /healthz). The in-process BuiltInAgent runtime stays on
# RUNTIME_PORT (localhost-only, not exposed).
ENV PORT=3978
EXPOSE 3978

CMD ["pnpm", "--filter", "teams-example", "start"]
