# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install Chromium + all libs whatsapp-web.js / Puppeteer needs
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-color-emoji \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell puppeteer-core to use the system Chromium
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Run headless — no display server in Railway containers
ENV WHATSAPP_HEADLESS=true
# WhatsApp session lives on a Railway persistent volume mounted at /data
ENV WHATSAPP_SESSION_DIR=/data/whatsapp-session

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000

CMD ["node", "dist/index.js"]
