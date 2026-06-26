# Backend — Hệ thống cảnh báo ngập lụt (NestJS + TypeORM + PostGIS)

Hướng dẫn chạy **database (PostgreSQL + PostGIS)** và **API NestJS** bằng Docker.

## 1. Yêu cầu

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (đã bật, có `docker compose`)
- (Tùy chọn, để chạy ngoài Docker) Node.js >= 20

## 2. Cấu trúc thư mục

```
backend/
├── docker-compose.yaml        # service db (PostGIS) + api (NestJS)
├── Dockerfile                 # build image API, tự chạy migration khi khởi động
├── .env.example               # biến môi trường mẫu
├── docker/
│   └── init-postgis.sql       # bật extension PostGIS khi tạo DB lần đầu
└── src/
    ├── database/data-source.ts   # cấu hình TypeORM (app + CLI)
    └── migrations/               # migration TypeORM (tạo 13 bảng)
```

## 3. Cấu hình biến môi trường

Tạo file `.env` từ mẫu:

```bash
cp .env.example .env
```

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `POSTGRES_USER` | `flood` | User của Postgres |
| `POSTGRES_PASSWORD` | `flood_secret` | Mật khẩu Postgres |
| `POSTGRES_DB` | `flood_warning` | Tên database |
| `POSTGRES_PORT` | `5432` | Cổng Postgres map ra host |
| `API_PORT` | `3000` | Cổng API map ra host |
| `DB_LOGGING` | `false` | Bật log câu lệnh SQL của TypeORM |

> Trong `docker-compose`, API kết nối tới DB qua host `db` (đã set sẵn). Biến `DB_HOST` trong `.env` (`localhost`) chỉ dùng khi chạy app/migration **trực tiếp từ máy host**.

## 4. Chạy bằng Docker (khuyến nghị)

Lệnh dưới sẽ: build image API → chờ DB sẵn sàng (healthcheck) → **tự động chạy migration** → khởi động API.

```bash
docker compose up --build
```

Chạy nền:

```bash
docker compose up --build -d
```

Kiểm tra API sống và kết nối được DB:

```bash
curl http://localhost:3000/health
# {"status":"ok","db":"connected"}
```

### Chỉ chạy mỗi database

Nếu chỉ cần DB (tự code/chạy app ở ngoài):

```bash
docker compose up -d db
```

Chuỗi kết nối:

```
postgres://flood:flood_secret@localhost:5432/flood_warning
```

## 5. Migration

Migration được chạy **tự động** khi container `api` khởi động (xem `CMD` trong `Dockerfile`).

### Chạy migration thủ công

- Trong container API đang chạy:

  ```bash
  docker compose exec api node_modules/.bin/typeorm migration:run -d dist/database/data-source.js
  ```

- Từ máy host (cần `npm install` và DB đang chạy, `DB_HOST=localhost` trong `.env`):

  ```bash
  npm install
  npm run migration:run        # áp dụng migration
  npm run migration:revert     # rollback migration gần nhất
  ```

## 6. Kết nối & kiểm tra database

Mở `psql` bên trong container:

```bash
docker compose exec db psql -U flood -d flood_warning
```

Một số lệnh hữu ích trong `psql`:

```sql
\dt                          -- liệt kê 13 bảng
SELECT postgis_version();    -- xác nhận PostGIS đã bật
\d stations                  -- xem cấu trúc bảng stations
```

## 7. Lệnh quản lý thường dùng

```bash
docker compose ps                  # trạng thái các service
docker compose logs -f api         # xem log API (gồm log migration)
docker compose logs -f db          # xem log database
docker compose down                # dừng & xóa container (GIỮ dữ liệu)
docker compose down -v             # dừng & XÓA luôn dữ liệu (volume db_data)
```

## 8. Test API — Nhóm A (Xác thực) & B (Tài khoản & RBAC)

Tất cả route đều yêu cầu JWT, **trừ** `@Public()`: `/health`, `/auth/login`, `/auth/refresh`. Token gắn ở header `Authorization: Bearer <access_token>`. Body là JSON (`Content-Type: application/json`).

### 8.1. Nhóm A — `/auth`

| # | Method | Endpoint | Auth | Mô tả |
|---|--------|----------|------|-------|
| 1 | POST | `/auth/login` | Public | Đăng nhập, trả `access_token` + `refresh_token` + hồ sơ user |
| 2 | POST | `/auth/refresh` | Public | Cấp access token mới (xoay vòng refresh token) |
| 3 | POST | `/auth/logout` | Bearer | Thu hồi refresh token + vô hiệu access token (`204`) |
| 4 | GET | `/auth/me` | Bearer | Ngữ cảnh tài khoản hiện tại (role + permissions) |

### 8.2. Nhóm B — Quản lý tài khoản (chỉ **ADMIN**)

| # | Method | Endpoint | Mô tả |
|---|--------|----------|-------|
| 11 | GET | `/roles` | Danh mục role + permissions |
| 5 | GET | `/users?role=&q=&page=&size=` | Danh sách user (lọc + phân trang) |
| 6 | GET | `/users/:id` | Chi tiết một tài khoản |
| 7 | POST | `/users` | Tạo tài khoản (tự hash mật khẩu) |
| 8 | PATCH | `/users/:id` | Cập nhật tài khoản |
| 9 | DELETE | `/users/:id` | Xóa tài khoản (`204`) |
| 10 | PUT | `/users/:id/role` | Đổi nhóm quyền (revoke token user đó) |

### 8.3. Luồng test bằng `curl`

```bash
# (1) Đăng nhập, lấy access token
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"nguyenvanan","password":"Anviettel@"}'

# Gán token vào biến shell (thay <...> bằng access_token nhận được)
TOKEN="<access_token>"

# (4) Thông tin tài khoản hiện tại
curl -s http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"

# (11) Danh sách role
curl -s http://localhost:3000/roles -H "Authorization: Bearer $TOKEN"

# (5) Danh sách user (lọc theo role, phân trang)
curl -s "http://localhost:3000/users?role=OPERATOR&page=1&size=20" \
  -H "Authorization: Bearer $TOKEN"

# (7) Tạo tài khoản VIEWER (roleId=3)
curl -s -X POST http://localhost:3000/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"username":"viewer01","email":"viewer01@hsms.vn","password":"Test@1234","fullName":"Viewer 01","roleId":3}'

# (8) Cập nhật, (10) đổi role, (9) xóa — thay :id cho phù hợp
curl -s -X PATCH http://localhost:3000/users/5 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fullName":"Tên mới"}'
```

### 8.4. Test trên Postman

1. Tạo request `POST /auth/login` như trên.
2. Vào tab **Scripts → Post-response**, lưu token vào biến collection:

   ```javascript
   const res = pm.response.json();
   pm.collectionVariables.set("access_token", res.access_token);
   pm.collectionVariables.set("refresh_token", res.refresh_token);
   ```

3. Ở cấp **Collection**, đặt **Authorization → Bearer Token = `{{access_token}}`**; các request con để **Inherit auth from parent**. Từ đó mọi request tự đính token.

### 8.5. Các ca kiểm thử nghiệp vụ (kỳ vọng lỗi)

| Tình huống | Cách tái hiện | Kết quả mong đợi |
|------------|---------------|------------------|
| Thiếu/sai token | Gọi `/users` không kèm Bearer | `401 Unauthorized` |
| Sai phân quyền (RBAC) | Login OPERATOR (`lehoangcuong`) rồi `GET /users` | `403 Forbidden` |
| Chặn tự hạ quyền | Là `nguyenvanan` (id=1) gọi `PUT /users/1/role` `{"roleId":3}` | `403` — *cannot change your own role* |
| Cấm xóa Admin cuối | Để hệ thống còn 1 ADMIN active rồi `DELETE` admin đó | `403` — *last active ADMIN* |
| Trùng dữ liệu | `POST /users` với username/email đã tồn tại | `409 Conflict` |
| Sai định dạng DTO | `POST /users` password < 8 ký tự | `400 Bad Request` |
| Revoke khi đổi role | Đổi role user X → dùng lại access token cũ của X | `401` ở lần gọi kế tiếp |

## 9. Test API — Nhóm C (Trạm) & D (Sự kiện)

Mọi route đều cần JWT. **Đọc** (`GET`) mở cho mọi user đã đăng nhập (Viewer+); **ghi** (`POST/PUT/DELETE`) yêu cầu **OPERATOR** hoặc **ADMIN**. Đặt sẵn `TOKEN="<access_token>"` như ở mục 8.3.

### 9.1. Nhóm C — `/stations` (Quản lý trạm)

| # | Method | Endpoint | Auth | Mô tả |
|---|--------|----------|------|-------|
| 12 | GET | `/stations?provinceId=&riskStatus=&eventId=&q=&page=&size=` | Bearer | Danh sách trạm (lọc + phân trang, chỉ trạm chưa xóa) |
| 13 | GET | `/stations/:id` | Bearer | Chi tiết trạm + ngưỡng cảnh báo |
| 14 | POST | `/stations` | OP/ADMIN | Tạo trạm; tự tính `geom` + gán `province_id` qua `ST_Contains` |
| 15 | PUT | `/stations/:id` | OP/ADMIN | Cập nhật; đổi lat/lng phải gửi **cả cặp**, geom được tính lại |
| 16 | DELETE | `/stations/:id` | OP/ADMIN | Soft-delete (`is_deleted=true`), trả `204` |
| 17 | PUT | `/stations/:id/thresholds` | OP/ADMIN | Thay toàn bộ bộ ngưỡng (tối đa 3 mức) |
| — | GET | `/stations/viewport?minLng=&minLat=&maxLng=&maxLat=&riskStatus=&limit=` | Bearer | **(Mới)** Trạm trong khung nhìn bản đồ (BBOX) — query `GET /stations/viewport` |
| — | GET | `/provinces` | Bearer | **(Mới)** Danh mục tỉnh `[{id,code,name}]` (lọc trạm / gán phạm vi sau này) |

- **`GET /stations/viewport`** — truy vấn theo **khung nhìn bản đồ** (BBOX), dùng cho client clustering thay vì tải hết trạm. 4 góc `minLng/minLat/maxLng/maxLat` **bắt buộc** (lng ∈ [-180,180], lat ∈ [-90,90]); backend chạy `ST_Contains(ST_MakeEnvelope(...,4326), geom)` được **GIST index** trên `station.geom` phục vụ. Trả **mảng phẳng** (không phân trang), đã **sắp theo mức rủi ro** (DANGER→WATCH→NORMAL) nên nếu chạm `limit` (mặc định/tối đa `10000`) thì giữ lại trạm nguy cấp nhất; **không** kèm threshold (bản đồ không cần). Route khai báo **trước** `/:id` nên `viewport` không bị nuốt bởi route id. *(Frontend `MapView` gọi endpoint này, fetch lại theo viewport khi pan/zoom.)*
- **Tìm kiếm `q`**: lọc đồng thời theo **tên trạm**, **tên tỉnh** và **mã trạm** (`ILIKE`, ưu tiên theo thứ tự đó). Gõ tên tỉnh (vd `q=Quảng Trị`) trả về mọi trạm trong tỉnh; gõ tên trạm (vd `q=Đông Hà`) trả về đúng trạm. `ILIKE` không phân biệt hoa/thường nhưng **phân biệt dấu** (gõ "dong ha" sẽ không khớp "Đông Hà").
- `provinceId` lọc theo id tỉnh (số); kết hợp được với `q`.
- `riskStatus` ∈ `NORMAL | WATCH | WARNING | DANGER` (theo enum `RiskStatus`).
- `alertLevel` trong threshold: `1` = Chú ý, `2` = Cảnh báo, `3` = Nguy hiểm. Mỗi mức tối đa 1 lần, tối đa 3 mức.
- `stationCode` chỉ gồm chữ/số/`-`/`_`; **duy nhất trên toàn bộ bảng** (kể cả trạm đã xóa mềm).
- **Tọa độ** giới hạn trong khung Việt Nam (gồm hải đảo): `latitude` 6–24, `longitude` 102–118; ngoài khoảng → `400`.
- **Payload nhẹ**: list/detail **không** trả geometry thô (`stations.geom`, `provinces.boundary/centroid` đã đặt `select: false`); object `province` chỉ gồm `{ id, code, name }`.

```bash
# (14) Tạo trạm — tọa độ nằm trong ranh giới một tỉnh sẽ được tự gán province_id
curl -s -X POST http://localhost:3000/stations \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
        "stationCode": "HN-001",
        "name": "Trạm Hà Nội 1",
        "latitude": 21.028511,
        "longitude": 105.804817,
        "elevation": 12.5,
        "thresholds": [
          { "alertLevel": 1, "thresholdValue": 50.0, "label": "Chú ý" },
          { "alertLevel": 2, "thresholdValue": 80.0, "label": "Cảnh báo" },
          { "alertLevel": 3, "thresholdValue": 120.0, "label": "Nguy hiểm" }
        ]
      }'

# (12) Danh sách trạm — lọc theo tỉnh + phân trang
curl -s "http://localhost:3000/stations?provinceId=1&page=1&size=20" \
  -H "Authorization: Bearer $TOKEN"

# (12) Tìm theo TÊN TỈNH -> mọi trạm trong tỉnh (nhớ URL-encode khoảng trắng)
curl -s "http://localhost:3000/stations?q=Qu%E1%BA%A3ng%20Tr%E1%BB%8B" \
  -H "Authorization: Bearer $TOKEN"

# (12) Tìm theo TÊN TRẠM -> đúng trạm
curl -s "http://localhost:3000/stations?q=%C4%90%C3%B4ng%20H%C3%A0" \
  -H "Authorization: Bearer $TOKEN"

# (13) Chi tiết trạm
curl -s http://localhost:3000/stations/1 -H "Authorization: Bearer $TOKEN"

# (mới) Trạm trong khung nhìn — BBOX phủ toàn Việt Nam (lọc rủi ro tùy chọn)
curl -s "http://localhost:3000/stations/viewport?minLng=102&minLat=8&maxLng=110&maxLat=23.5&riskStatus=DANGER&limit=500" \
  -H "Authorization: Bearer $TOKEN"

# (mới) Danh mục tỉnh (để lọc /stations?provinceId=)
curl -s http://localhost:3000/provinces -H "Authorization: Bearer $TOKEN"

# (15) Cập nhật trạm (đổi tọa độ -> geom + province_id tính lại)
curl -s -X PUT http://localhost:3000/stations/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Trạm HN 1 (mới)","latitude":21.030000,"longitude":105.810000}'

# (17) Thay bộ ngưỡng cảnh báo
curl -s -X PUT http://localhost:3000/stations/1/thresholds \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"thresholds":[{"alertLevel":2,"thresholdValue":90,"label":"Cảnh báo"}]}'

# (16) Soft-delete trạm -> 204
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3000/stations/1 \
  -H "Authorization: Bearer $TOKEN"
```

### 9.2. Nhóm D — `/events` (Quản lý sự kiện thiên tai)

| # | Method | Endpoint | Auth | Mô tả |
|---|--------|----------|------|-------|
| 20 | GET | `/events?status=&page=&size=` | Bearer | Danh sách sự kiện + số tỉnh/trạm trong phạm vi |
| 21 | GET | `/events/:id` | Bearer | Chi tiết sự kiện |
| 22 | POST | `/events` | OP/ADMIN | Tạo sự kiện; trạng thái `ONGOING`, tự sinh `event_code` |
| 23 | PUT | `/events/:id` | OP/ADMIN | Sửa thông tin mô tả (bị **khóa** nếu đã `CLOSED`) |
| 24 | POST | `/events/:id/close` | OP/ADMIN | Đóng sự kiện (`ONGOING → CLOSED`) |

- `status` ∈ `ONGOING | CLOSED`. `CLOSED` là trạng thái cuối, không sửa được nữa.
- Chặn trùng: không cho tồn tại 2 sự kiện **cùng `disasterTypeId`** đang `ONGOING` (→ `409`).
- `id` sự kiện là **BIGINT** (truyền dạng chuỗi).

```bash
# (22) Tạo sự kiện (disasterTypeId tham chiếu bảng disaster_types: 1=STORM, 2=FLOOD...)
curl -s -X POST http://localhost:3000/events \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"disasterTypeId":1,"name":"Bão số 3","startTime":"2026-06-23T00:00:00Z","description":"Bão đổ bộ ven biển Bắc Bộ"}'

# (20) Danh sách sự kiện đang diễn ra
curl -s "http://localhost:3000/events?status=ONGOING&page=1&size=20" \
  -H "Authorization: Bearer $TOKEN"

# (21) Chi tiết sự kiện
curl -s http://localhost:3000/events/1 -H "Authorization: Bearer $TOKEN"

# (23) Cập nhật mô tả (chỉ khi chưa CLOSED)
curl -s -X PUT http://localhost:3000/events/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"description":"Cập nhật hướng di chuyển của bão"}'

# (24) Đóng sự kiện
curl -s -X POST http://localhost:3000/events/1/close \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"endTime":"2026-06-25T12:00:00Z"}'
```

### 9.3. Các ca kiểm thử nghiệp vụ (kỳ vọng lỗi)

| Tình huống | Cách tái hiện | Kết quả mong đợi |
|------------|---------------|------------------|
| Sai phân quyền | Login VIEWER rồi `POST /stations` | `403 Forbidden` |
| Trùng mã trạm | `POST /stations` với `stationCode` đã tồn tại (kể cả đã xóa mềm) | `409 Conflict` |
| Tọa độ ngoài khoảng | `POST /stations` với `latitude: 200` | `400 Bad Request` |
| Ngưỡng trùng mức | Gửi 2 threshold cùng `alertLevel` | `400 Bad Request` |
| Đổi 1 nửa tọa độ | `PUT /stations/:id` chỉ gửi `latitude` (thiếu `longitude`) | `400 Bad Request` |
| Trùng sự kiện đang chạy | `POST /events` cùng `disasterTypeId` khi đã có 1 sự kiện `ONGOING` | `409 Conflict` |
| Sai loại thiên tai | `POST /events` với `disasterTypeId` không tồn tại | `400 Bad Request` |
| Sửa sự kiện đã đóng | `PUT /events/:id` sau khi đã `close` | `403 Forbidden` |
| Đóng lại sự kiện | `POST /events/:id/close` lần 2 | `409 Conflict` |

## 10. Test API — Nhóm F (Thời tiết bên thứ 3) bằng Postman

Nhóm F đồng bộ dữ liệu thời tiết từ 4 nguồn ngoài (Open-Meteo, OWM, WeatherAPI, GDACS) qua **async job (BullMQ)** rồi ghi `weather_snapshots` + `weather_forecasts`. Các endpoint **không trả dữ liệu ngay** mà trả `202 Accepted + jobId` — phải **poll** trạng thái job.

### 10.1. Chuẩn bị `.env`

Điền các biến (xem `.env.example`) trước khi build lại:

| Biến | Bắt buộc | Ghi chú |
|------|----------|---------|
| `OPENWEATHERMAP_API_KEY` | cho fallback OWM | Open-Meteo & GDACS không cần key |
| `WEATHERAPI_KEY` | cho fallback WeatherAPI | |
| `INTERNAL_API_TOKEN` | cho API 34 | Bí mật gửi qua header `X-Internal-Token`; **để trống = đóng endpoint** |
| `WEATHER_CRON` / `WEATHER_HEALTHCHECK_CRON` | tùy chọn | Lịch cron ingest + healthcheck (mặc định mỗi giờ / 2 phút) |

> Cần **Redis** đang chạy (`docker compose up -d redis`) — BullMQ + lock chống spam + cache healthcheck đều dùng Redis.

### 10.2. Danh sách endpoint

| # | Method | Endpoint | Auth | Mô tả |
|---|--------|----------|------|-------|
| 31 | POST | `/weather/refresh` | OP/ADMIN | Làm mới thủ công; debounce-lock; trả `202 {jobId}` |
| 32 | GET | `/weather/refresh/:jobId` | OP/ADMIN | Trạng thái job + `snapshotId` khi xong |
| 33 | GET | `/weather/snapshots/latest?source=` | Bearer | Snapshot mới nhất (lọc theo `source`) |
| 34 | POST | `/internal/weather/ingest` | `X-Internal-Token` | Trigger ingest (scheduler-only, không dùng JWT) |
| 35 | GET | `/integrations/health` | **ADMIN** | Trạng thái 4 nguồn (đọc từ Redis cache) |

- `source` ∈ `OpenMeteo | OpenWeatherMap | WeatherAPI | GDACS`. Bỏ trống ở API 31 → dùng fallback **Open-Meteo → OWM → WeatherAPI**; đặt `GDACS` → lấy dữ liệu thiên tai.
- API 31 body (tùy chọn): `{ "stationIds": [..], "provinceIds": [..], "source": ".." }`. Bỏ trống → đồng bộ **toàn bộ trạm đang hoạt động**.

### 10.3. Luồng test trên Postman

Tận dụng setup ở **mục 8.4** (đã lưu `{{access_token}}` ở cấp Collection). Đăng nhập bằng tài khoản **OPERATOR/ADMIN**.

1. **(31) Kích hoạt refresh** — `POST {{baseUrl}}/weather/refresh`, body `raw → JSON`:

   ```json
   { "source": "OpenMeteo" }
   ```

   Kỳ vọng `202 Accepted` + `{ "jobId": "..." }`. Tab **Scripts → Post-response** lưu lại để dùng cho bước poll:

   ```javascript
   pm.collectionVariables.set("weather_job", pm.response.json().jobId);
   ```

2. **(31) Kiểm tra debounce** — bấm **Send lần 2 ngay lập tức**. Kỳ vọng `429 Too Many Requests` (lock còn hiệu lực `WEATHER_REFRESH_LOCK_TTL_MS`), body kèm `jobId` đang chạy.

3. **(32) Poll trạng thái** — `GET {{baseUrl}}/weather/refresh/{{weather_job}}`. Lặp lại đến khi `state` = `completed`; khi đó có `snapshotId`. Nếu `state` = `failed` → đọc `failedReason`.

4. **(33) Xem snapshot** — `GET {{baseUrl}}/weather/snapshots/latest?source=OpenMeteo`. Kỳ vọng metadata snapshot (`status: "SUCCESS"`, `fetchedAt`, `rawPayload`).

5. **(35) Healthcheck (Admin)** — `GET {{baseUrl}}/integrations/health` bằng token **ADMIN**. Sau ≥1 chu kỳ cron sẽ thấy `status/latencyMs/errorRate` của 4 nguồn (nguồn thiếu key → `status: "UNKNOWN", configured: false`).

6. **(34) Internal ingest** — `POST {{baseUrl}}/internal/weather/ingest`, **tắt** Bearer (chọn **No Auth**), thêm header:

   ```
   X-Internal-Token: <giá trị INTERNAL_API_TOKEN>
   ```

   Kỳ vọng `202 {jobId}`; sai/thiếu header → `401 Unauthorized`.

### 10.4. Kiểm tra dữ liệu trong DB

```sql
SELECT id, source_code, trigger_type, status, fetched_at
FROM weather_snapshots ORDER BY fetched_at DESC LIMIT 5;

-- Chuỗi time-series 5-7 ngày của snapshot vừa tạo (đầu vào tính rủi ro)
SELECT station_id, forecast_time, rainfall, river_water_level
FROM weather_forecasts WHERE snapshot_id = <id> ORDER BY forecast_time LIMIT 10;
```

### 10.5. Các ca kiểm thử nghiệp vụ (kỳ vọng lỗi)

| Tình huống | Cách tái hiện | Kết quả mong đợi |
|------------|---------------|------------------|
| Sai phân quyền | Login VIEWER rồi `POST /weather/refresh` | `403 Forbidden` |
| Spam refresh | Gọi `POST /weather/refresh` 2 lần liên tiếp | `429 Too Many Requests` |
| Healthcheck không phải Admin | OPERATOR gọi `GET /integrations/health` | `403 Forbidden` |
| Internal sai secret | `POST /internal/weather/ingest` thiếu/sai `X-Internal-Token` | `401 Unauthorized` |
| Job không tồn tại | `GET /weather/refresh/khong-co` | `404 Not Found` |
| Sai `source` | `?source=Foo` hoặc body `{"source":"Foo"}` | `400 Bad Request` |

## 11. Test Realtime — WebSocket (Socket.IO, API 44–47)

Gateway risk-delta đẩy thay đổi rủi ro của trạm về client theo **phòng (room) tile bản đồ**. Đây là **Socket.IO** (không phải WebSocket thuần), chạy cùng cổng API (`ws://localhost:3000`, path mặc định `/socket.io`). Cần **Redis** đang chạy (adapter Socket.IO + event bus). *(Phía frontend chưa có client — phần này test bằng Postman/script.)*

### 11.1. Các sự kiện

| # | Hướng | Sự kiện | Payload | Mô tả |
|---|-------|---------|---------|-------|
| 44 | handshake | *(kết nối)* | JWT access token | Xác thực ngay lúc bắt tay; sai/thiếu token → `connect_error` (socket không mở) |
| 45 | client→server | `subscribe:viewport` | `{ "bbox": [minLng,minLat,maxLng,maxLat] }` | Tham gia các room tile mà BBOX phủ; ack `{status:'ok', rooms, clamped}` |
| 47 | client→server | `unsubscribe:viewport` | *(không)* | Rời mọi room viewport; ack `{status:'ok'}` |
| 46 | server→client | `risk:delta` | `{ stationId, riskStatus, severity }` | Phát khi 1 trạm đổi rủi ro; chỉ tới room chứa tọa độ trạm |

- Token nhận từ **một trong** các vị trí (theo thứ tự ưu tiên): `socket.handshake.auth.token` → header `Authorization: Bearer <token>` → query `?token=<token>`. Có/không tiền tố `Bearer ` đều được.
- `bbox` chấp nhận **mảng** `[minLng,minLat,maxLng,maxLat]` hoặc **object** `{minLng,minLat,maxLng,maxLat}`. Viewport quá rộng → số room bị **clamp** (`clamped:true`).
- Token bị thu hồi (logout/đổi role/khóa user — qua `TokenStoreService` epoch) cũng làm **handshake thất bại**, giống REST.

### 11.2. Kết nối trên Postman

Postman hỗ trợ request **Socket.IO** (New → Socket.IO).

1. URL: `ws://localhost:3000` (Postman tự thêm `/socket.io`). Bản Postman cần chọn đúng phiên bản Socket.IO **v4**.
2. Gắn token bằng cách dễ nhất: tab **Headers** thêm `Authorization: Bearer {{access_token}}` *(hoặc URL `ws://localhost:3000?token={{access_token}}`)*.
3. **Connect** — nếu token hợp lệ sẽ thấy `Connected`; sai token → `connect_error: unauthorized`.
4. Tab **Events**: thêm listener cho `risk:delta` (để nhận server→client) và bật hiển thị ack.
5. Tab **Message**: chọn event `subscribe:viewport`, body JSON:

   ```json
   { "bbox": [102, 8, 110, 23.5] }
   ```

   **Send** → nhận ack `{ "status": "ok", "rooms": <n>, "clamped": false }`.

### 11.3. Mô phỏng một `risk:delta`

Risk Engine (Group G) — bên *phát* delta — **chưa được xây**, nên chưa có REST nào sinh ra `risk:delta`. Để kiểm thử đường đẩy, **publish thẳng vào kênh Redis** mà gateway lắng nghe (`risk.delta`):

```bash
# Tọa độ phải nằm trong BBOX bạn đã subscribe ở 11.2 thì client mới nhận được
docker compose exec redis redis-cli PUBLISH risk.delta \
  '{"stationId":1,"riskStatus":"DANGER","severity":"high","lng":105.8,"lat":21.0}'
```

Postman (đang subscribe viewport phủ điểm `(105.8, 21.0)`) sẽ nhận event `risk:delta` với `{ stationId:1, riskStatus:"DANGER", severity:"high" }`. Nếu tọa độ **ngoài** BBOX đã subscribe → không nhận (đúng thiết kế định tuyến theo room tile).

### 11.4. Các ca kiểm thử (kỳ vọng lỗi)

| Tình huống | Cách tái hiện | Kết quả mong đợi |
|------------|---------------|------------------|
| Thiếu/sai token | Connect không kèm token | `connect_error` (`unauthorized`) |
| BBOX sai định dạng | `subscribe:viewport` với `{"bbox":[1,2,3]}` | ack `{status:'error', message:'invalid bbox'}` |
| Token đã thu hồi | Logout rồi connect lại bằng access token cũ | `connect_error` |
| Delta ngoài viewport | Publish `risk.delta` với tọa độ ngoài BBOX đã subscribe | Client **không** nhận event |

## 12. Sự cố thường gặp

- **`port 5432 already in use`**: đổi `POSTGRES_PORT` trong `.env` (ví dụ `5433`).
- **API báo `ECONNREFUSED` tới DB**: kiểm tra service `db` đã `healthy` chưa (`docker compose ps`); API tự chờ healthcheck nên thường chỉ xảy ra khi DB lỗi khởi động.
- **Muốn khởi tạo lại sạch sẽ**: `docker compose down -v` rồi `docker compose up --build` (lưu ý sẽ mất toàn bộ dữ liệu).
- **`init-postgis.sql` không chạy lại**: file trong `/docker-entrypoint-initdb.d` chỉ chạy khi volume DB còn **trống**. Migration đã có `CREATE EXTENSION IF NOT EXISTS postgis` nên PostGIS vẫn được đảm bảo.
- **`duplicate key value violates unique constraint "..._pkey"` khi tạo/sửa (trạm, ngưỡng, sự kiện…)**: các CSV trong `data/` seed bằng `id` tường minh nên **sequence không được nâng** → INSERT mới cấp id trùng. Khắc phục (chạy 1 lần sau khi seed, idempotent):

  ```bash
  docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < backend/docker/reset-sequences.sql
  ```

  Script này resync mọi sequence `SERIAL/BIGSERIAL` về `MAX(id)+1`.
