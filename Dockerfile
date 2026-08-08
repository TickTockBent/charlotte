# Charlotte MCP Server Docker Image — HTTP mode, sandbox-enabled self-host image
# Uses Puppeteer's bundled Chromium for reliability. Chromium's own sandbox is
# left ON (verified via spike R4 / decision D22): run this with the surgical
# seccomp profile at docker/chrome-seccomp.json (or the SYS_ADMIN fallback —
# see docker-compose.yml and DOCKER.md). Do NOT add `--security-opt
# apparmor=unconfined`; Docker's default AppArmor profile is required for the
# sandbox to initialize on hosts with the unprivileged-userns AppArmor
# restriction (Ubuntu 23.10+/24.04).

FROM node:22-slim

# Install dependencies for Puppeteer/Chromium
RUN apt-get update && apt-get install -y \
    # Chromium dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    # Fonts for proper text rendering
    fonts-liberation \
    fonts-noto-color-emoji \
    # Utilities
    ca-certificates \
    dumb-init \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r charlotte && useradd -r -g charlotte -G audio,video charlotte \
    && mkdir -p /home/charlotte/Downloads \
    && chown -R charlotte:charlotte /home/charlotte

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies — cache Puppeteer's Chromium inside /app so
# the non-root charlotte user can access it after chown
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
RUN npm ci

# Copy source and build
COPY tsconfig*.json ./
COPY src/ ./src/

RUN npm run build

# Fix ownership so non-root user can access node_modules and dist
RUN chown -R charlotte:charlotte /app

# Switch to non-root user
USER charlotte

# Sandbox posture (D22): CHARLOTTE_NO_SANDBOX is intentionally left UNSET.
# load-config.ts only disables the sandbox when the value is explicitly
# truthy; unset means the code default applies — sandbox ON. This image is
# meant to be run with the surgical seccomp profile (docker/chrome-seccomp.json)
# so Chromium's own namespace + seccomp-BPF sandbox can actually initialize
# in-container. See DOCKER.md / SELF_HOSTING.md for the run/compose incantation.

# Default HTTP port (src/config/schema.ts HttpConfigSchema.port default 3737).
# The operator's mounted charlotte.config.json / CHARLOTTE_AUTH_TOKEN supply
# the rest of the http block (host, authToken, publicOrigin, allowedHosts).
EXPOSE 3737

# Liveness check against the unauthenticated /healthz route. Uses Node's
# built-in fetch (Node 22) instead of installing curl, to keep the image lean.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3737/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Charlotte Remote: streamable HTTP transport, sandbox-enabled Chromium.
CMD ["dumb-init", "node", "dist/index.js", "--http"]
