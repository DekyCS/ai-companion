# Khina, always on: the sim with Claude as the brain, a Khina day every real hour (--rate 24),
# served to the browser.
# Railway sets PORT; mount a volume at /app/data so Khina's life and the spend ledger survive
# redeploys. Needs ANTHROPIC_API_KEY; KHINA_DAILY_CAP_USD (default 1) caps spend per day; TZ sets
# whose night it is.
# An exact Node, so a redeploy never changes it unseen. 25.9.0 is what node:25-slim already was (the same
# image, sha256:81db02c4…), the last Node 25 release (March 2026); the tests ran on 25.4.0 locally on
# 2026-11-20. Node 25 has had no fixes since June 2026: moving to 24 or 26 (LTS) is a decision to make.
FROM node:25.9.0-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY web ./web
COPY art/export ./art/export
CMD ["node", "src/live.ts", "--model", "--clock", "real", "--rate", "24", "--persist", "data/khina-state.json", "--max-spend", "1000"]
