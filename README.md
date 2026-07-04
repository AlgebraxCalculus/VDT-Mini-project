# 🌊 Hệ thống Cảnh báo Nguy cơ Ngập lụt cho Trạm Viễn thông

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/version-0.1.0-blue.svg" alt="Version" />
  <img src="https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/PostGIS-16--3.4-336791?logo=postgresql&logoColor=white" alt="PostGIS" />
  <img src="https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker" />
</p>

> Nền tảng GIS thời gian thực giám sát bão/lũ và **tính toán trước nguy cơ ngập lụt 5–7 ngày** cho hơn 10.000 trạm viễn thông, đẩy cảnh báo tới trình duyệt qua WebSocket.

---

## 📖 1. Giới thiệu dự án (Overview)

**VDT Flood Warning System** là một ứng dụng web GIS được xây dựng để bảo vệ hạ tầng viễn thông trước rủi ro thiên tai ngập lụt tại Việt Nam.

Hệ thống giải quyết bài toán cốt lõi:

- **Giám sát hạ tầng phân tán trên diện rộng:** theo dõi vị trí, cao độ và ngưỡng an toàn của hơn **10.000 trạm viễn thông** trải khắp các tỉnh/thành.
- **Dự báo chủ động thay vì bị động:** thay vì chỉ ghi nhận sự cố sau khi xảy ra, hệ thống **tính toán trước điểm số nguy cơ ngập (risk score)** cho từng trạm theo từng ngày trong khung 5–7 ngày, dựa trên dữ liệu mưa, mực nước sông và các sự kiện thiên tai đang diễn ra.
- **Cảnh báo tức thời:** khi mức độ rủi ro của một trạm thay đổi, thông tin được đẩy trực tiếp (real-time) tới bản đồ mà người dùng đang xem qua WebSocket.

**Mục đích cốt lõi:** cung cấp cho đội vận hành (Operator) và quản trị (Admin) một bức tranh trực quan, cập nhật liên tục về nguy cơ ngập lụt, giúp ra quyết định phòng ngừa (di dời thiết bị, chuẩn bị nguồn dự phòng, ứng cứu) **trước khi** thiên tai gây thiệt hại.

---

## ✨ 2. Tính năng chính (Key Features)

- 🔐 **Xác thực & Phân quyền (RBAC):** cơ chế JWT hai token (access + refresh, xoay vòng), guard toàn cục theo vai trò `Admin / Operator / Viewer`, thu hồi token tức thời trên toàn cụm.
- 👥 **Quản lý người dùng & vai trò:** CRUD tài khoản, gán vai trò, bảo vệ "admin cuối cùng", chống tự khóa tài khoản.
- 🗼 **Quản lý trạm & tỉnh thành:** danh sách phân trang, chi tiết, tạo/sửa/xóa mềm, quản lý ngưỡng cảnh báo nhiều mức, tự động gán tỉnh bằng phép **point-in-polygon** trong PostGIS.
- 📤 **Nhập liệu hàng loạt (CSV Import):** tải lên CSV, tiền kiểm định dạng phía client, xử lý bất đồng bộ theo lô 1.000 dòng qua hàng đợi, báo cáo tiến độ và dòng lỗi.
- 🗺️ **Bản đồ GIS theo Viewport:** hiển thị trạm theo khung nhìn (bbox), **gộp marker khi zoom-out** (server-side clustering), tô màu theo mức rủi ro thực tế, vẽ vùng ảnh hưởng của sự kiện, lớp phủ thời tiết (mưa/gió/nhiệt) và tìm kiếm theo vùng.
- 🌦️ **Tích hợp thời tiết đa nguồn:** chuỗi dự phòng dự báo **Open-Meteo → MET Norway → WeatherAPI** và chuỗi thiên tai **GDACS → EONET → ReliefWeb**, cùng tích hợp **GloFAS (Copernicus EWDS)** cho mực nước sông.
- 🌀 **Tự động theo dõi sự kiện thiên tai:** cron kéo dữ liệu bão/lũ liên quan tới Việt Nam, tự động gán phạm vi ảnh hưởng (tỉnh + trạm), đóng sự kiện khi hết hiệu lực; hỗ trợ ghi đè thủ công.
- 🧮 **Risk Engine (Bộ tính rủi ro):** công thức ngập lụt 4 lớp với **trọng số suy ra bằng AHP** (Analytic Hierarchy Process) theo nhóm trạm, tự động tính lại khi có dữ liệu mới.
- 📡 **Real-time qua WebSocket:** Socket.IO xác thực qua JWT handshake, chia phòng theo ô bản đồ (tile rooms), phân phối cảnh báo **chính xác một lần** trên nhiều instance nhờ Redis adapter.
- 📄 **Xuất báo cáo bất đồng bộ:** báo cáo tồn kho trạm & tổng hợp rủi ro, xuất **CSV / HTML in-được (PDF) / Word (.doc)**.
- 🩺 **Healthcheck tích hợp:** giám sát tình trạng của cả 7 nguồn dữ liệu bên ngoài.

---

## 🛠️ 3. Công nghệ sử dụng (Tech Stack)

| Hạng mục | Công nghệ |
| --- | --- |
| **Ngôn ngữ** | TypeScript, Python (sidecar trích xuất GRIB2 cho GloFAS) |
| **Backend Framework** | NestJS 10 (Express platform) |
| **Frontend Framework** | React 19 + Vite 8 |
| **ORM / Truy vấn** | TypeORM 0.3 (kèm truy vấn PostGIS thô qua `DataSource`) |
| **Cơ sở dữ liệu** | PostgreSQL 16 + **PostGIS 3.4** (dữ liệu không gian) |
| **Cache / Pub-Sub / Store** | Redis 7 (ioredis) |
| **Message Queue** | BullMQ (hàng đợi `weather`, `stations-import`, `reports`) |
| **Real-time** | Socket.IO 4 + `@socket.io/redis-adapter` |
| **Xác thực** | JWT (`@nestjs/jwt`), Passport-JWT, bcrypt |
| **Bản đồ (FE)** | Leaflet + Leaflet.markercluster |
| **HTTP Client** | undici / native `fetch` + `AbortController` |
| **Lịch chạy** | `@nestjs/schedule` (cron) |
| **DevOps** | Docker, Docker Compose, Nginx (phục vụ SPA + reverse-proxy API) |
| **Kiểm định dữ liệu** | class-validator, class-transformer |

---

## 📂 4. Cấu trúc thư mục (Project Structure)

```text
VDT-Mini-project/
├── backend/                        # API NestJS + TypeORM + PostGIS (codebase chính)
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/                # Nhóm A: đăng nhập, JWT, guard RBAC
│   │   │   ├── users/              # Nhóm B: tài khoản, vai trò
│   │   │   ├── stations/           # Nhóm C: trạm, ngưỡng, import CSV, viewport
│   │   │   ├── provinces/          # Ranh giới tỉnh (MultiPolygon)
│   │   │   ├── events/             # Nhóm D: sự kiện thiên tai + auto-ingestion
│   │   │   ├── weather/            # Nhóm F: tích hợp thời tiết & GloFAS
│   │   │   ├── risk/               # Nhóm G: Risk Engine + API đọc dự báo
│   │   │   ├── map/                # Nhóm E: dữ liệu bản đồ GIS theo bbox
│   │   │   ├── reports/            # Nhóm H: xuất báo cáo bất đồng bộ
│   │   │   ├── realtime/           # Cổng WebSocket (Socket.IO gateway)
│   │   │   ├── geocoding/          # Reverse geocode (OSM Nominatim)
│   │   │   └── system/            # Tiện ích hệ thống
│   │   ├── database/               # data-source.ts (cấu hình TypeORM dùng chung)
│   │   ├── migrations/             # Migration SQL viết tay (schema 13 bảng)
│   │   ├── event-bus/             # Event bus typed trên Redis Pub/Sub
│   │   ├── redis/                 # RedisService (client dùng chung)
│   │   └── scripts/               # glofas_extract.py (trích xuất GRIB2)
│   ├── docker/                     # init-postgis.sql
│   ├── docker-compose.yaml         # db · redis · api · web
│   └── .env.example                # Mẫu cấu hình
│
├── frontend/app/                   # SPA React 19 + Vite + Leaflet
│   └── src/
│       ├── components/             # Login, Map, Stations, Forecast, Events, Health...
│       ├── lib/                    # api.ts (REST), realtime.ts (WS), report.ts, csv.ts
│       ├── state/                 # AppStateContext (state thủ công, không dùng thư viện)
│       └── types.ts               # Kiểu dữ liệu dùng chung
│
├── data/                           # CSV seed (provinces, stations, roles, users...)
├── docs/                           # Tài liệu thiết kế
└── queries/                        # Truy vấn SQL tham khảo
```

---

## ✅ 5. Yêu cầu hệ thống (Prerequisites)

### Chạy bằng Docker (khuyến nghị)
- **Docker Engine** 24+ và **Docker Compose** v2

### Chạy trực tiếp trên máy (không dùng Docker)
- **Node.js** 20+ (kèm npm)
- **PostgreSQL** 16 với extension **PostGIS** 3.4
- **Redis** 7+
- **Python** 3 + thư viện `cfgrib` *(chỉ cần khi bật tích hợp GloFAS)*

---

## 🚀 6. Hướng dẫn Cài đặt & Khởi chạy (Getting Started)

### 🐳 Cách 1 — Chạy toàn bộ bằng Docker (khuyến nghị)

Container `api` sẽ tự chạy migration khi khởi động, sau đó phục vụ ứng dụng. Nginx phục vụ SPA và reverse-proxy API + WebSocket, nên trình duyệt chỉ làm việc với **một origin duy nhất** (không cần cấu hình CORS).

```bash
# 1. Clone mã nguồn
git clone <repository-url>
cd VDT-Mini-project/backend

# 2. Tạo file cấu hình từ mẫu
cp .env.example .env
# → mở .env và chỉnh các secret (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET phải KHÁC nhau)

# 3. Build và khởi chạy toàn bộ stack (db + redis + api + web)
docker compose up --build

# 4. Kiểm tra API đã sống
curl http://localhost:3000/health   # -> {"status":"ok","db":"connected"}
```

Sau khi chạy xong, mở ứng dụng tại: **http://localhost:8080**

### 💻 Cách 2 — Chạy trực tiếp trên máy (Development)

**Backend:**

```bash
cd backend
cp .env.example .env                # đặt DB_HOST=localhost, REDIS_HOST=localhost

# Chỉ bật DB + Redis bằng Docker
docker compose up -d db redis

npm install
npm run migration:run               # áp dụng migration
npm run start:dev                   # chạy Nest watch mode (cổng 3000)
```

**Frontend:**

```bash
cd frontend/app
npm install
npm run dev                         # Vite dev server (mặc định cổng 5173)
```

> ⚠️ **Lưu ý:** Backend **chưa cấu hình test runner hay linter** — kiểm tra thay đổi bằng `npm run build`. Frontend có `npm run lint` (còn 4 cảnh báo nền đã được chấp nhận).

---

## ⚙️ 7. Cấu hình Môi trường (Environment Variables)

Toàn bộ biến được tài liệu hóa trong `backend/.env.example`. Các nhóm quan trọng:

### Cơ sở dữ liệu & hạ tầng
| Biến | Ý nghĩa |
| --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Thông tin container PostgreSQL/PostGIS |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Kết nối DB của API (`db` trong Docker, `localhost` khi chạy host) |
| `API_PORT` | Cổng API NestJS (mặc định `3000`) |
| `WEB_PORT` | Cổng phục vụ SPA qua nginx (mặc định `8080`) |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` | Kết nối Redis |
| `CORS_ORIGINS` | Danh sách origin trình duyệt được phép gọi API (phân tách bởi dấu phẩy) |

### Xác thực / JWT
| Biến | Ý nghĩa |
| --- | --- |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Secret ký token — **bắt buộc khác nhau** |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | Thời hạn access (`900s`) / refresh (`7d`) token |
| `BCRYPT_SALT_ROUNDS` | Số vòng băm mật khẩu (mặc định `12`) |

### Tích hợp thời tiết & thiên tai (Nhóm F/D)
| Biến | Ý nghĩa |
| --- | --- |
| `WEATHERAPI_KEY` | Khóa WeatherAPI (nguồn cuối trong chuỗi dự báo; bỏ trống sẽ bị skip) |
| `INTERNAL_API_TOKEN` | Secret bảo vệ các endpoint nội bộ dành cho scheduler (header `X-Internal-Token`) |
| `WEATHER_CRON` / `WEATHER_HEALTHCHECK_CRON` | Lịch cron ingest thời tiết & healthcheck |
| `DISASTER_CRON` / `DISASTER_STALE_CLOSE_HOURS` | Lịch kéo sự kiện thiên tai & tự đóng sự kiện "zombie" |
| `WEATHER_FORECAST_DAYS` | Số ngày dự báo (mặc định `7`) |
| `EWDS_PAT` / `GLOFAS_CRON` / `GLOFAS_AREA` | Token & cấu hình tích hợp GloFAS (mực nước sông) |

### Risk Engine (Nhóm G)
| Biến | Ý nghĩa |
| --- | --- |
| `RISK_AHP_RIVER_VS_RAIN` | Phán đoán Saaty "mực nước sông quan trọng gấp mấy lần lượng mưa" → suy ra trọng số bằng AHP (mặc định `2` → mưa 0.333 / sông 0.667) |

### Frontend
| Biến | Ý nghĩa |
| --- | --- |
| `VITE_API_BASE` | Base URL của API (mặc định `http://localhost:3000`; để trống khi chạy Docker same-origin) |

---

## 🔌 8. Tài liệu API (API Reference)

Hệ thống hiện **không tích hợp Swagger UI**. API là REST thuần, tổ chức theo 8 nhóm chức năng (A–H) + gateway real-time (44–47), tổng cộng **47 endpoint**. Toàn bộ đều yêu cầu JWT (trừ route đánh dấu `@Public()`).

### Kiểm tra liveness

```http
GET /health
→ 200 { "status": "ok", "db": "connected" }
```

### Ví dụ 1 — Đăng nhập (Nhóm A)

```http
POST /auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your_password"
}

→ 200 {
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "user": { "id": "...", "username": "admin", "role": "ADMIN" }
}
```

Các request sau đính kèm header:

```http
Authorization: Bearer <accessToken>
```

### Ví dụ 2 — Lấy trạm theo khung nhìn bản đồ (Nhóm C)

```http
GET /stations/viewport?minLng=105.0&minLat=20.5&maxLng=106.0&maxLat=21.5
Authorization: Bearer <accessToken>

→ 200 [ { "id": "...", "stationCode": "...", "latitude": 21.02, "longitude": 105.85, ... } ]
```

> 💡 **WebSocket:** kết nối Socket.IO tới cùng origin (JWT truyền trong handshake), phát sự kiện `subscribe:viewport` với bbox để nhận các bản tin `risk:delta` theo thời gian thực.

---

## 🤝 9. Hướng dẫn Đóng góp (Contributing)

Chào mừng mọi đóng góp! Vui lòng làm theo các bước:

```bash
# 1. Fork repository trên GitHub, sau đó clone bản fork của bạn
git clone <your-fork-url>

# 2. Tạo nhánh tính năng
git checkout -b feature/ten-tinh-nang

# 3. Commit thay đổi (theo Conventional Commits)
git commit -m "feat: mô tả ngắn gọn tính năng"

# 4. Push và mở Pull Request về nhánh main
git push origin feature/ten-tinh-nang
```

**Quy ước:**
- Tuân thủ kiến trúc module hiện có: **controller chỉ marshal request/response, toàn bộ business logic nằm ở service**.
- Mọi thay đổi schema phải đi qua **migration** (không dùng `synchronize`).
- Kiểm tra backend bằng `npm run build`; frontend bằng `npm run lint` + `npm run build` trước khi gửi PR.
- Viết mã đồng nhất với phong cách xung quanh (đặt tên, comment, idiom).

---

## 📜 10. Giấy phép (License)

Dự án được phân phối theo giấy phép **MIT** — xem toàn văn trong file [`LICENSE`](LICENSE) ở thư mục gốc. Trường `license` trong `backend/package.json` cũng đã được đặt là `"MIT"`, đồng nhất trên toàn dự án.

---

## 👩‍💻 11. Tác giả (Author / Contact)

| | |
| --- | --- |
| **Tên** | Trần Thanh Thúy |
| **Email** | [thuyptit2004@gmail.com](mailto:thuyptit2004@gmail.com) |

---

<p align="center"><i>🌊 Được xây dựng để bảo vệ hạ tầng viễn thông trước thiên tai ngập lụt.</i></p>
