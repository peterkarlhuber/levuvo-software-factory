# Levuvo SF egress proxy. Build context: this folder. No dependencies besides Node.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS base
RUN install -d -m 0755 /opt/levuvo /etc/levuvo
COPY --chmod=0644 proxy.mjs /opt/levuvo/proxy.mjs
COPY --chmod=0644 allowlist-model.txt allowlist-build.txt /etc/levuvo/

# unit tests: docker build --target test factory/egress-proxy
FROM base AS test
COPY --chmod=0644 allowlist-model.txt allowlist-build.txt proxy.test.mjs /opt/levuvo/
RUN node --test /opt/levuvo/proxy.test.mjs

FROM base
USER node
EXPOSE 3128
ENTRYPOINT ["node", "/opt/levuvo/proxy.mjs"]
