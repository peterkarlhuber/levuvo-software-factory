# Levuvo SF worker image: the official Claude CLI (pinned in package-lock.json) plus the factory's run launcher and
# its stdio MCP relay. No shell tools are needed by the agent; it gets none (launch.mjs). Build context: this folder.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS base
WORKDIR /opt/levuvo/cli
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=extra_ca,required=false,mode=0444 \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund \
 && ln -s /opt/levuvo/cli/node_modules/.bin/claude /usr/local/bin/claude \
 && claude --version
COPY --chmod=0644 mcp.mjs launch.mjs /opt/levuvo/
RUN install -d -m 0755 /run/levuvo/in /run/levuvo/io

# unit tests: docker build --target test factory/worker
FROM base AS test
COPY --chmod=0644 worker.test.mjs /opt/levuvo/
RUN node --test /opt/levuvo/worker.test.mjs

FROM base
USER node
WORKDIR /home/node
ENTRYPOINT ["node", "/opt/levuvo/launch.mjs"]
