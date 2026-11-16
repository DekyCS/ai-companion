# Khina, always on: the sim with Claude as the brain, on the real clock, served to the browser.
# Railway sets PORT; mount a volume at /app/data so Khina's life and the spend ledger survive
# redeploys. Needs ANTHROPIC_API_KEY; KHINA_DAILY_CAP_USD (default 1) caps spend per day; TZ sets
# whose night it is.
FROM node:25-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY web ./web
COPY art/export ./art/export
CMD ["node", "src/live.ts", "--model", "--clock", "real", "--persist", "data/khina-state.json", "--max-spend", "1000"]
