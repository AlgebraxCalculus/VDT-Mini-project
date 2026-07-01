# ---- Build stage ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Same-origin build: an EMPTY base makes every REST call root-relative
# (fetch("/auth/...")) and lets Socket.IO's io("") resolve to the current origin.
# nginx (runtime stage) reverse-proxies the API routes + /socket.io to the `api`
# container, so the browser only ever talks to this one origin — no CORS, no
# hardcoded host. Override with `--build-arg VITE_API_BASE=http://host:3000` to
# instead point the SPA straight at a published API port.
ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# ---- Runtime stage ----
FROM nginx:1.27-alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
