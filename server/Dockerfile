# Matbex API image (also used for one-off migrations: node db/migrate.mjs)
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json* server/
RUN cd server && npm ci --no-audit --no-fund
COPY server server
COPY packages packages
# Shared VAT math used by both the POS screen and the API (server/src/modules/pos).
COPY src/lib/vatInclusive.ts src/lib/vatInclusive.ts
RUN cd server && node scripts/build.mjs && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/package.json server/package.json
COPY db db
# migrate.mjs resolves "postgres" from server/node_modules
RUN ln -s /app/server/node_modules /app/node_modules
# File storage when STORAGE_DRIVER=fs (a named volume is mounted here and keeps this owner).
RUN mkdir -p /data/objects && chown node:node /data/objects
USER node
EXPOSE 8000
EXPOSE 9464
# otel.mjs only starts tracing when OTEL_EXPORTER_OTLP_ENDPOINT is set.
CMD ["node", "--import", "./server/dist/otel.mjs", "server/dist/index.mjs"]
