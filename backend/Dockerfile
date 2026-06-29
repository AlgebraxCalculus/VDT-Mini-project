# ---- Build stage ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Python + GRIB stack for the GloFAS extraction sidecar (scripts/glofas_extract.py).
# python3-cfgrib pulls an apt `ecmwflibs` stub whose find('eccodes') returns None
# (it bundles no library), and gribapi imports `ecmwflibs as findlibs` first — so we
# remove the stub, forcing gribapi to fall back to the real `findlibs`, which locates
# the system libeccodes (from libeccodes-dev, registered via ldconfig).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-cfgrib python3-xarray libeccodes-dev \
    && ldconfig \
    && rm -rf /usr/lib/python3/dist-packages/ecmwflibs \
              /usr/lib/python3/dist-packages/ecmwflibs-*.dist-info \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Ops/PoC scripts: GloFAS PoC + the Python GRIB-extraction sidecar (now runnable —
# python3 + cfgrib + eccodes are installed above).
COPY scripts ./scripts

EXPOSE 3000

# Apply pending TypeORM migrations (compiled data-source) then start the API.
CMD ["sh", "-c", "node_modules/.bin/typeorm migration:run -d dist/database/data-source.js && node dist/main.js"]
