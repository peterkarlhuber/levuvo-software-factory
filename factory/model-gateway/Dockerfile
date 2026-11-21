# Levuvo SF model gateway (API billing mode). Build context: this folder. No dependencies besides Node.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS base
# the volumes mounted at these paths take their owner from the image on first use
RUN install -d -m 0755 /opt/levuvo \
 && install -d -m 0700 -o node -g node /run/levuvo/key /var/lib/levuvo/usage \
 && install -d -m 0755 -o node -g node /run/levuvo/tokens
COPY --chmod=0644 gateway.mjs /opt/levuvo/gateway.mjs

# unit tests: docker build --target test factory/model-gateway
FROM base AS test
COPY --chmod=0644 gateway.test.mjs /opt/levuvo/
RUN node --test /opt/levuvo/gateway.test.mjs

# test image only (factory/tests): may point the upstream at the fake model API through LEVUVO_SF_TEST_UPSTREAM
FROM base AS testable
RUN touch /opt/levuvo/ALLOW_TEST_UPSTREAM
USER node
ENTRYPOINT ["node", "/opt/levuvo/gateway.mjs"]

FROM base
USER node
EXPOSE 8080
ENTRYPOINT ["node", "/opt/levuvo/gateway.mjs"]
