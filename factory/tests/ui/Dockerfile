# Browser test image for factory/tests/run.sh only (never part of the factory): the official Playwright image with
# Chromium and WebKit (Safari's engine), pinned by digest, and the matching playwright package from the lockfile.
FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
WORKDIR /opt/ui-test
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=extra_ca,required=false,mode=0444 \
    if [ -s /run/secrets/extra_ca ]; then export npm_config_cafile=/run/secrets/extra_ca; fi; \
    npm ci --ignore-scripts --no-audit --no-fund
COPY ui.mjs ./
ENTRYPOINT ["node", "/opt/ui-test/ui.mjs"]
