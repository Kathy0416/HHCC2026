FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    SERVE_FRONTEND=1 \
    DB_PATH=/data/data.db

WORKDIR /opt/migraine

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY . .

RUN mkdir -p /data \
    && chown -R node:node /opt/migraine /data

USER node
WORKDIR /opt/migraine/server

EXPOSE 3000

CMD ["node", "server.js"]
