# Charlotte MCP Server Docker Image
# Uses Puppeteer's bundled Chromium for reliability

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

# Charlotte MCP uses stdio transport
CMD ["dumb-init", "node", "dist/index.js"]
