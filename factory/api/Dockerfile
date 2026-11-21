# Levuvo SF factory service. Build context: the repo root (it needs skills/ and templates/ from the factory repo).
FROM zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f AS gitleaks

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS deps
WORKDIR /opt/levuvo/app
COPY factory/api/package.json factory/api/package-lock.json ./
# optional build secret `extra_ca`: a CA bundle for networks with a TLS-intercepting proxy (never baked into the image)
RUN --mount=type=secret,id=extra_ca,required=false,mode=0444 \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca; fi; \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS base
COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks
# the volumes mounted at these paths take their owner from the image on first use
RUN install -d -m 0700 -o node -g node /var/lib/levuvo/data /var/lib/levuvo/runs \
 && install -d -m 0755 -o node -g node /run/levuvo/tokens /var/lib/levuvo/usage /run/levuvo/git
COPY --from=deps /opt/levuvo/app/node_modules /opt/levuvo/app/node_modules
COPY factory/api/package.json /opt/levuvo/app/
COPY factory/api/src /opt/levuvo/app/src
COPY factory/api/prices.json /opt/levuvo/prices.json
COPY skills /opt/levuvo/skills
COPY templates /opt/levuvo/templates
COPY factory/ui /opt/levuvo/ui
RUN chmod -R a+rX,go-w /opt/levuvo
ENV LEVUVO_SF_TEMPLATES=/opt/levuvo/templates

# unit tests with the coverage floor: docker build --target test -f factory/api/Dockerfile .
FROM base AS test
COPY factory/api/test /opt/levuvo/app/test
WORKDIR /opt/levuvo/app
RUN node --test --experimental-test-coverage --test-coverage-lines=90 --test-coverage-include='src/**' 'test/*.test.mjs'

FROM base
USER node
WORKDIR /opt/levuvo/app
EXPOSE 3100
ENTRYPOINT ["node", "/opt/levuvo/app/src/main.mjs"]
