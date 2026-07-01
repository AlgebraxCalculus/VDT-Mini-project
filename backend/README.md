# Backend — Hệ thống Cảnh báo Ngập lụt (Flood Warning System)

Dịch vụ API cho hệ thống cảnh báo ngập lụt viễn thông: theo dõi hơn 10.000 nhà trạm, giám sát bão/lũ theo thời gian thực và tính sẵn nguy cơ ngập 5–7 ngày cho từng trạm. Toàn bộ phép toán không gian (spatial) chạy trong PostGIS; cảnh báo rủi ro được đẩy tới client qua WebSocket.

---

## 1. Tổng quan

Backend là trung tâm nghiệp vụ của hệ thống, đảm nhiệm:

- **Xác thực & phân quyền (RBAC):** JWT hai token (access/refresh), guard toàn cục theo vai trò `ADMIN / OPERATOR / VIEWER`.
- **Quản lý dữ liệu không gian:** CRUD nhà trạm, tỉnh/thành, ngưỡng cảnh báo lũ; tự gán tỉnh bằng point-in-polygon (PostGIS).
- **Tích hợp dữ liệu bên thứ ba:** đồng bộ dự báo thời tiết, sự kiện thiên tai và mực nước sông từ các nguồn ngoài qua job bất đồng bộ.
- **Risk Engine:** tính sẵn `risk_score` / mức cảnh báo cho từng trạm theo công thức ngập 4 lớp, ghi vào bảng pre-computed để API đọc chỉ việc truy vấn.
- **Realtime:** gateway Socket.IO đẩy thay đổi rủi ro theo khung nhìn bản đồ (tile room).
- **Xuất báo cáo & import hàng loạt:** job bất đồng bộ (CSV/HTML, import CSV nhà trạm).

---

## 2. Kiến trúc & Công nghệ

### Công nghệ chính

| Thành phần | Công nghệ |
|---|---|
| Ngôn ngữ / Runtime | TypeScript · Node.js 20 |
| Framework | NestJS 10 |
| ORM & CSDL | TypeORM 0.3 · PostgreSQL 16 + PostGIS 3.4 |
| Cache / Message bus | Redis 7 |
| Hàng đợi bất đồng bộ | BullMQ |
| Realtime | Socket.IO 4 (+ Redis adapter) |
| Xác thực | Passport JWT · bcrypt |
| Lịch chạy nền | `@nestjs/schedule` (cron) |

### Mô hình kiến trúc

Kiến trúc **module hóa theo domain** với tách lớp rõ ràng (gần với Clean Architecture):

- **Controller** chỉ marshal request/response, **toàn bộ nghiệp vụ nằm ở Service**; repository TypeORM chỉ được inject vào service, không đụng từ controller.
- **Xử lý bất đồng bộ (async workers):** các tác vụ nặng (đồng bộ thời tiết, import CSV, xuất báo cáo) chạy qua **BullMQ processor** trên các hàng đợi riêng (`weather`, `stations-import`, `reports`). API trả `202 { jobId }` ngay và client **poll** trạng thái. Worker chạy **in-process** trong container API — mở rộng bằng cách tăng số replica của container API (Risk Engine dùng Redis lock để chống tính trùng khi chạy nhiều instance).
- **Event-driven backbone:** một event bus có kiểu (typed) trên nền Redis Pub/Sub. Các trigger phát `WEATHER_SNAPSHOT` / `THRESHOLD_CHANGED` / `EVENT_*`; **Risk Engine** là consumer, tính lại rủi ro rồi phát `RISK_DELTA` → gateway đẩy tới client. Mọi publish là fire-and-forget: lỗi bus không bao giờ làm hỏng mutation DB đã commit.
- **Raw PostGIS qua `DataSource`:** hình học (geometry) không round-trip qua TypeORM entity save (tránh mất SRID). Đọc theo khung nhìn dùng `ST_MakeEnvelope` + GIST index.
- **Single-source TypeORM config:** `src/database/data-source.ts` dùng chung cho cả app và CLI; `synchronize` luôn `false` — mọi thay đổi schema đi qua migration SQL viết tay.

### Cấu trúc thư mục

```
backend/
├── Dockerfile                    # build image API (multi-stage), tự chạy migration khi khởi động
├── docker-compose.yaml           # db (PostGIS) + redis + api + web
├── .env.example                  # mẫu biến môi trường
├── docker/
│   ├── init-postgis.sql          # bật extension PostGIS khi khởi tạo DB
│   └── reset-sequences.sql       # resync sequence sau khi seed dữ liệu
├── scripts/                      # sidecar Python trích xuất GloFAS (cfgrib)
└── src/
    ├── database/data-source.ts   # cấu hình TypeORM (app + CLI)
    ├── migrations/               # migration SQL viết tay (13 bảng)
    └── modules/                  # các domain: auth, users, stations, events,
                                  #   weather, risk, map, reports, realtime…
```

---

## 3. Yêu cầu & Cấu hình môi trường

### Công cụ

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (kèm `docker compose`) — cách chạy khuyến nghị.
- (Tùy chọn, khi chạy ngoài Docker) Node.js ≥ 20 + npm; một PostgreSQL 16 + PostGIS và Redis 7 truy cập được.

### Dịch vụ phụ thuộc

- **PostgreSQL 16 + PostGIS 3.4** — CSDL không gian (13 bảng).
- **Redis 7** — event bus, BullMQ, Socket.IO adapter, token store, lock.

### Biến môi trường

Tạo file `.env` từ mẫu rồi chỉnh sửa:

```bash
cp .env.example .env
```

**Nhóm bắt buộc / thường dùng:**

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `flood` / `flood_secret` / `flood_warning` | Thông tin container Postgres |
| `POSTGRES_PORT` | `5432` | Cổng Postgres map ra host |
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | Host DB (trong compose bị ghi đè thành `db`) |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | `flood` / `flood_secret` / `flood_warning` | Kết nối DB của API |
| `DB_LOGGING` | `false` | Bật log câu lệnh SQL của TypeORM |
| `API_PORT` | `3000` | Cổng API |
| `WEB_PORT` | `8080` | Cổng phục vụ SPA frontend (nginx) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:8080` | Danh sách origin được phép gọi API |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` | `localhost` / `6379` / *(trống)* / `0` | Kết nối Redis (compose ghi đè host thành `redis`) |

**Xác thực (JWT):**

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `change_me_*` | Hai secret **phải khác nhau** |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `900s` / `7d` | Vòng đời access / refresh token |
| `BCRYPT_SALT_ROUNDS` | `12` | Độ mạnh băm mật khẩu |

**Tích hợp bên thứ ba (tùy chọn — thiếu key thì nguồn bị bỏ qua):**

| Biến | Ý nghĩa |
|---|---|
| `INTERNAL_API_TOKEN` | Bí mật cho các endpoint nội bộ (`X-Internal-Token`); để trống = đóng endpoint |
| `WEATHERAPI_KEY` | Key WeatherAPI (fallback dự báo; Open-Meteo & MET Norway không cần key) |
| `MET_NORWAY_USER_AGENT` | User-Agent có liên hệ (điều khoản MET Norway bắt buộc) |
| `RELIEFWEB_APPNAME` | `appname` ReliefWeb đã duyệt (free); trống → bỏ qua ReliefWeb |
| `EWDS_PAT` | Personal Access Token GloFAS/Copernicus (mực nước sông) |
| `WEATHER_CRON` / `WEATHER_HEALTHCHECK_CRON` / `DISASTER_CRON` / `GLOFAS_CRON` | Lịch cron ingest / healthcheck / thiên tai / GloFAS |
| `RISK_AHP_RIVER_VS_RAIN` | Phán đoán AHP: mực nước sông quan trọng gấp mấy lần mưa (mặc định `2`) |

> Xem `.env.example` để biết đầy đủ tham số (bán kính footprint thiên tai, timeout/retry HTTP, tinh chỉnh rating-curve GloFAS, reverse-geocoding Nominatim…).

---

## 4. Chạy ở máy local

> Yêu cầu: đã `npm install`, có DB + Redis truy cập được, và đặt `DB_HOST=localhost` / `REDIS_HOST=localhost` trong `.env`. Có thể chạy nhanh DB + Redis bằng Docker: `docker compose up -d db redis`.

```bash
cd backend
npm install                # cài dependencies

npm run migration:run      # áp dụng migration (tạo 13 bảng)
npm run start:dev          # chạy Nest ở chế độ watch (hot reload)
```

Các script khác:

| Script | Mô tả |
|---|---|
| `npm run build` | `nest build` → xuất `dist/` |
| `npm run start:prod` | Chạy bản đã build (`node dist/main.js`) |
| `npm run migration:run` | Áp dụng migration |
| `npm run migration:revert` | Rollback migration gần nhất |
| `npm run migration:generate -- src/migrations/<Tên>` | Sinh migration từ diff entity |
| `npm run migration:create -- src/migrations/<Tên>` | Tạo migration rỗng |

> **Lưu ý:** backend **không cấu hình test runner/linter** (không có script `test`/`lint`). Kiểm tra thay đổi bằng `npm run build`.

Kiểm tra API sống:

```bash
curl http://localhost:3000/health
# {"status":"ok","db":"connected"}
```

Các tác vụ nền (async worker) là **BullMQ processor chạy trong cùng tiến trình API** — không cần khởi động riêng. Cron ingest thời tiết/thiên tai cũng tự chạy theo lịch trong `.env`.

---

## 5. Tài liệu API

- **Base URL:** `http://localhost:3000`
- **Xác thực:** mọi route yêu cầu header `Authorization: Bearer <access_token>`, **trừ** route công khai: `GET /health`, `POST /auth/login`, `POST /auth/refresh`. Route nội bộ (scheduler-only) dùng header `X-Internal-Token`.
- **Định dạng:** JSON (`Content-Type: application/json`). `ValidationPipe` toàn cục bật `whitelist` + `forbidNonWhitelisted` — payload sai DTO trả `400`.
- **RBAC:** route không gắn `@Roles` mở cho mọi user đã đăng nhập (Viewer+); ghi dữ liệu thường yêu cầu `OPERATOR`/`ADMIN`; quản trị tài khoản & healthcheck chỉ `ADMIN`.

### Cấu trúc route theo domain

| Nhóm | Prefix | API tiêu biểu |
|---|---|---|
| A — Xác thực | `/auth` | `login` · `refresh` · `logout` · `me` |
| B — Tài khoản & RBAC | `/users`, `/roles` | CRUD user · đổi vai trò · danh mục vai trò |
| C — Nhà trạm & tỉnh | `/stations`, `/provinces` | list/detail/CRUD · thresholds · `/stations/viewport` (BBOX) · import CSV (`/stations/import`) |
| D — Sự kiện thiên tai | `/events` | list/detail · close · gán phạm vi (`/impact`) · trạm trong phạm vi (auto-tracking, không tạo tay) |
| E — Bản đồ / GIS | `/map` | `/map/stations` (kèm cluster) · `/map/events` · `/map/weather` · `/map/stations/search` |
| F — Thời tiết bên thứ ba | `/weather`, `/integrations` | `refresh` · `snapshots/latest` · `integrations/health` |
| G — Risk & dự báo | `/risk`, `/forecasts` | `/risk/stations` · dự báo tỉnh/trạm · lịch sử cảnh báo |
| H — Báo cáo | `/reports` | tạo · list · trạng thái · download (CSV/HTML) |
| I — Realtime | `/socket.io` | Socket.IO: `subscribe:viewport` · `risk:delta` |

### Cách kiểm thử

Hệ thống **không cung cấp Swagger UI**. Thử API bằng:

- **`curl`** — đăng nhập lấy token rồi gắn Bearer:

  ```bash
  # Đăng nhập
  curl -s -X POST http://localhost:3000/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"nguyenvanan","password":"Anviettel@"}'

  # Gán token và gọi endpoint có bảo vệ
  TOKEN="<access_token>"
  curl -s http://localhost:3000/stations -H "Authorization: Bearer $TOKEN"
  ```

- **Postman** — tạo request `POST /auth/login`, ở tab **Scripts → Post-response** lưu token vào biến collection; đặt Authorization ở cấp Collection là `Bearer {{access_token}}`, các request con để **Inherit auth from parent**.

- **Realtime** — dùng request loại **Socket.IO** trong Postman: URL `ws://localhost:3000`, gắn `Authorization: Bearer {{access_token}}`, gửi event `subscribe:viewport` với `{ "bbox": [102, 8, 110, 23.5] }` rồi lắng nghe `risk:delta`.

---

## 6. Triển khai bằng Docker

Container API dùng **multi-stage build** để giữ image gọn: stage `builder` cài toàn bộ dependency và biên dịch TypeScript → `dist/`; stage `runner` chỉ cài dependency production (`npm install --omit=dev`) và copy `dist/` (kèm sidecar Python cho GloFAS). Khi khởi động, container **tự chạy migration** rồi start API.

### 6.1. Cách nhanh nhất — Docker Compose (khuyến nghị)

`docker-compose.yaml` đã dựng sẵn toàn bộ: `db` (PostGIS) → `redis` → `api` (chờ healthcheck của db + redis, chạy migration, start) → `web` (SPA qua nginx, reverse-proxy API + WebSocket về `api`).

```bash
cp .env.example .env          # lần đầu
docker compose up --build     # build + chạy toàn bộ stack
docker compose up --build -d  # ...hoặc chạy nền

curl http://localhost:3000/health   # kiểm tra API
# Mở SPA tại http://localhost:8080
```

Lệnh quản lý thường dùng:

```bash
docker compose ps               # trạng thái các service
docker compose logs -f api      # log API (gồm log migration)
docker compose up -d db redis   # chỉ chạy DB + Redis (dev app từ host)
docker compose down             # dừng (GIỮ dữ liệu)
docker compose down -v          # dừng & XÓA dữ liệu (volume db_data/redis_data)
```

### 6.2. Build & chạy riêng image API

Build image (multi-stage — image runtime chỉ chứa dependency production + `dist/`):

```bash
cd backend
docker build -t vdt-flood-api:latest .
```

Chạy container API, trỏ tới DB + Redis sẵn có bằng cờ biến môi trường và map cổng:

```bash
docker run -d --name vdt-flood-api \
  -p 3000:3000 \
  -e DB_HOST=host.docker.internal -e DB_PORT=5432 \
  -e DB_USER=flood -e DB_PASSWORD=flood_secret -e DB_NAME=flood_warning \
  -e REDIS_HOST=host.docker.internal -e REDIS_PORT=6379 \
  -e JWT_ACCESS_SECRET=change_me_access -e JWT_REFRESH_SECRET=change_me_refresh \
  -e CORS_ORIGINS=http://localhost:8080 \
  vdt-flood-api:latest
```

> Trên Linux, thay `host.docker.internal` bằng IP host hoặc dùng `--network` chung với các container DB/Redis. Có thể nạp cả file `.env` bằng `--env-file .env` thay cho từng cờ `-e`.

### 6.3. `docker-compose.yml` hoàn chỉnh (production-ready)

Cấu hình dưới đây orchestrate container ứng dụng cùng các dịch vụ phụ thuộc — **Database (PostGIS)**, **Redis cache** và **async worker**. Các BullMQ processor chạy in-process trong `api`; service `worker` (tùy chọn) là **thêm replica cùng image** để tăng thông lượng xử lý job nền, tách khỏi lưu lượng HTTP.

```yaml
services:
  # --- PostgreSQL + PostGIS ---
  db:
    image: postgis/postgis:16-3.4
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-flood}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-flood_secret}
      POSTGRES_DB: ${POSTGRES_DB:-flood_warning}
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./docker/init-postgis.sql:/docker-entrypoint-initdb.d/00-init-postgis.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-flood} -d ${POSTGRES_DB:-flood_warning}"]
      interval: 5s
      timeout: 5s
      retries: 10

  # --- Redis (cache · event bus · BullMQ · Socket.IO adapter) ---
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  # --- API NestJS (chạy migration khi khởi động, rồi serve app) ---
  api:
    build:
      context: .
      dockerfile: Dockerfile
    image: vdt-flood-api:latest
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
    env_file:
      - .env
    environment:
      DB_HOST: db
      DB_PORT: 5432
      DB_USER: ${POSTGRES_USER:-flood}
      DB_PASSWORD: ${POSTGRES_PASSWORD:-flood_secret}
      DB_NAME: ${POSTGRES_DB:-flood_warning}
      API_PORT: 3000
      REDIS_HOST: redis
      REDIS_PORT: 6379
    ports:
      - "${API_PORT:-3000}:3000"

  # --- Async worker (tùy chọn) ---
  # Thêm replica cùng image để cân tải xử lý job BullMQ (weather / import /
  # reports) tách khỏi lưu lượng HTTP. KHÔNG publish cổng để tránh chạm cổng của
  # `api`; bỏ qua bước migration (api đã lo). Đặt DISABLE_CRON để tránh nhân đôi
  # cron nếu backend hỗ trợ cờ này.
  worker:
    image: vdt-flood-api:latest
    restart: unless-stopped
    depends_on:
      api: { condition: service_started }
      redis: { condition: service_healthy }
    env_file:
      - .env
    environment:
      DB_HOST: db
      REDIS_HOST: redis
    command: ["node", "dist/main.js"]

volumes:
  db_data:
  redis_data:
```

> **Về async worker:** trong bản hiện tại, BullMQ processor và cron chạy in-process ngay trong `api`, nên stack tối thiểu chỉ cần `db` + `redis` + `api`. Service `worker` là bước mở rộng ngang khi tải job tăng — chạy nhiều instance an toàn nhờ Risk Engine chiếm Redis lock để chống tính trùng.

---

## 7. Sự cố thường gặp

- **`port 5432 already in use`** → đổi `POSTGRES_PORT` trong `.env` (vd `5433`).
- **API `ECONNREFUSED` tới DB** → kiểm tra service `db` đã `healthy` chưa (`docker compose ps`).
- **Khởi tạo lại sạch** → `docker compose down -v` rồi `docker compose up --build` (mất toàn bộ dữ liệu).
- **`duplicate key ... _pkey` khi tạo mới sau seed** → sequence chưa nâng theo id seed. Resync (idempotent):

  ```bash
  docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < docker/reset-sequences.sql
  ```

- **Kiểm tra DB / Redis nhanh:**

  ```bash
  docker compose exec db psql -U flood -d flood_warning   # \dt · SELECT postgis_version();
  docker compose exec redis redis-cli                     # KEYS integrations:health:*
  ```
