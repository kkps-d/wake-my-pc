# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_FILE=/app/data/pcs.json
WORKDIR /app
# ping probes reachability; ip/arp resolve MAC addresses from the LAN cache.
RUN apt-get update \
    && apt-get install -y --no-install-recommends iputils-ping iproute2 net-tools \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data \
    && chown node:node /app/data
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/views ./src/views
COPY --from=build /app/src/public/app.css /app/src/public/app.js /app/src/public/theme.js ./src/public/
COPY --from=build /app/src/public/icons ./src/public/icons
COPY package.json ./
COPY docker/healthcheck.mjs ./docker/healthcheck.mjs
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "docker/healthcheck.mjs"]
CMD ["node", "dist/server.js"]
