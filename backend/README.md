# Backend — Hệ thống cảnh báo ngập lụt (NestJS + TypeORM + PostGIS)

Hướng dẫn chạy **database (PostgreSQL + PostGIS)** và **API NestJS** bằng Docker.

## 0. Thay đổi gần đây

### Nhóm C — Import trạm hàng loạt (API 18–19) *(mới nhất)*

- **Thêm API 18** `POST /stations/import` (OP/ADMIN) — upload **CSV** dạng multipart (field `file`, ≤5 MB, ≤10.000 dòng). Backend validate *hình dạng* file đồng bộ (trả `400` nếu hỏng) rồi đẩy **BullMQ job** (queue riêng `stations-import`, `attempts: 1`) → `202 { jobId }`. Worker validate từng dòng + insert theo **lô 1.000/transaction**, tự gán tỉnh bằng `ST_Contains`, **bỏ qua dòng lỗi** (gom vào report).
- **Thêm API 19** `GET /stations/import/:jobId` — trạng thái job + `progress` + `report` (số thành công/lỗi + danh sách dòng bị bỏ qua).
- Chi tiết + hướng dẫn test: **mục [9.4](#94-nhóm-c--import-trạm-hàng-loạt-api-1819)**.
- **Frontend (ngoài phạm vi README này):** realtime WebSocket client (API 44–47, `src/lib/realtime.ts`) và view Import đã được nối vào UI.

### Nhóm D — Sự kiện thiên tai (tracking tự động)

- **Gỡ API 22** (`POST /events` tạo thủ công). Sự kiện nay **tracking tự động** từ GDACS qua `EventIngestionService` (cron `DISASTER_CRON`): parse hazard STORM/FLOOD liên quan VN → upsert `disaster_events` (dedupe theo `event_code`) → **tự gán scope N–N** (`event_provinces`/`event_stations`, raw PostGIS) → publish `EVENT_SCOPE_ASSIGNED`; sự kiện rớt feed tự `CLOSED`.
- **Thêm API 25** `POST /events/:id/impact` (OP/ADMIN) — gán/ghi đè phạm vi thủ công (`provinceIds` và/hoặc `affectedArea` GeoJSON), thay thế scope auto.
- **Thêm API 26** `GET /events/:id/stations` (Bearer) — xem tỉnh + trạm trong phạm vi (phân trang).
- **Thêm** endpoint nội bộ `POST /internal/events/ingest` (`X-Internal-Token`) để kích hoạt ingest GDACS ngay.
- **Biến `.env` mới:** `DISASTER_CRON`, `DISASTER_STORM_RADIUS_DEG`, `DISASTER_FLOOD_RADIUS_DEG`.
- Chi tiết + hướng dẫn test: **mục [9.2](#92-nhóm-d--events-sự-kiện-thiên-tai--tracking-tự-động)**.

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

### 9.2. Nhóm D — `/events` (Sự kiện thiên tai — **tracking tự động**)

> **⚠️ Thay đổi thiết kế (so với bản trước):** API **22 (`POST /events` tạo thủ công) đã bị GỠ**. Sự kiện thiên tai nay được **theo dõi tự động** từ chuỗi nguồn disaster (GDACS → ReliefWeb → EONET; hiện chạy **GDACS**) bởi `EventIngestionService` (`src/modules/events/ingestion/`):
> 1. Cron `DISASTER_CRON` kéo feed GDACS events4app, parser giữ lại hazard **STORM/FLOOD** liên quan Việt Nam (giao cắt không gian với bảng `provinces`).
> 2. **Upsert** `disaster_events` theo `event_code` dạng `GDACS-TC1000810` (chống trùng tự nhiên).
> 3. **Tự gán phạm vi N–N**: ghi `event_provinces` (đa giác footprint đã clip) + `event_stations` bằng raw PostGIS, rồi publish `EVENT_SCOPE_ASSIGNED` → Risk Engine tính lại các trạm vừa gán.
> 4. Sự kiện rớt khỏi feed → tự chuyển `ONGOING → CLOSED` + publish `EVENT_CLOSED`.

| # | Method | Endpoint | Auth | Mô tả |
|---|--------|----------|------|-------|
| 20 | GET | `/events?status=&page=&size=` | Bearer | Danh sách sự kiện + số tỉnh/trạm trong phạm vi |
| 21 | GET | `/events/:id` | Bearer | Chi tiết sự kiện |
| 23 | PUT | `/events/:id` | OP/ADMIN | Sửa mô tả (bị **khóa** nếu đã `CLOSED`) |
| 24 | POST | `/events/:id/close` | OP/ADMIN | Đóng sự kiện (`ONGOING → CLOSED`) |
| **25** | **POST** | **`/events/:id/impact`** | **OP/ADMIN** | **Gán/ghi đè phạm vi thủ công** (`provinceIds[]` và/hoặc `affectedArea` GeoJSON) — *thay thế* scope auto, publish `EVENT_SCOPE_ASSIGNED` |
| **26** | **GET** | **`/events/:id/stations`** | **Bearer** | **Xem phạm vi**: tỉnh + danh sách trạm (phân trang) trong scope |
| — | POST | `/internal/events/ingest` | `X-Internal-Token` | (scheduler-only) Chạy 1 lượt ingest GDACS **ngay**; trả summary |

- `status` ∈ `ONGOING | CLOSED`. `CLOSED` là trạng thái cuối, không sửa được.
- `id` sự kiện là **BIGINT** (truyền dạng chuỗi).
- **API 25 — hai chế độ** (ít nhất một trong hai, nếu thiếu cả hai → `400`):
  - **Chỉ tỉnh:** `provinceIds[]` → trạm gán theo `stations.province_id`, `affected_area = NULL`.
  - **Polygon:** `affectedArea` (GeoJSON `Polygon`/`MultiPolygon`, SRID 4326) → tỉnh giao cắt + trạm nằm trong vùng; kèm `provinceIds` để giới hạn thêm.
  - Mỗi lần gọi **xóa toàn bộ scope cũ rồi ghi lại** (authoritative override). Khóa khi sự kiện `CLOSED` (→ `403`).

```bash
# Xuất token nội bộ (trùng INTERNAL_API_TOKEN trong .env)
export INTERNAL_TOKEN=change_me_internal_token

# (internal) Kích hoạt ingest GDACS NGAY — không cần đợi cron
curl -s -X POST http://localhost:3000/internal/events/ingest \
  -H "X-Internal-Token: $INTERNAL_TOKEN"
# -> { "created": n, "updated": n, "scopedStations": n, "closed": n }

# (20) Danh sách sự kiện đang diễn ra (sau khi ingest có dữ liệu)
curl -s "http://localhost:3000/events?status=ONGOING&page=1&size=20" \
  -H "Authorization: Bearer $TOKEN"
# -> lấy "id" của một sự kiện, gán vào biến shell để dùng tiếp:
export EV=<ID>

# (21) Chi tiết sự kiện
curl -s http://localhost:3000/events/$EV -H "Authorization: Bearer $TOKEN"

# (26) Xem phạm vi: tỉnh + trạm (phân trang)
curl -s "http://localhost:3000/events/$EV/stations?page=1&size=20" \
  -H "Authorization: Bearer $TOKEN"

# (25) Gán phạm vi thủ công — CHẾ ĐỘ TỈNH (ghi đè scope + kích hoạt Risk Engine)
curl -s -X POST http://localhost:3000/events/$EV/impact \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"provinceIds":[1,2,3]}'

# (25) Gán phạm vi thủ công — CHẾ ĐỘ POLYGON (GeoJSON, vành khép kín)
curl -s -X POST http://localhost:3000/events/$EV/impact \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"affectedArea":{"type":"Polygon","coordinates":[[[105.6,18.4],[107.1,18.2],[108.6,16.3],[107.6,15.2],[105.6,18.4]]]}}'

# (23) Cập nhật mô tả (chỉ khi chưa CLOSED)
curl -s -X PUT http://localhost:3000/events/$EV \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"description":"Ghi chú vận hành"}'

# (24) Đóng sự kiện
curl -s -X POST http://localhost:3000/events/$EV/close \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"endTime":"2026-06-25T12:00:00Z"}'
```

**Seed thủ công khi GDACS không có hazard VN tại thời điểm test** (để vẫn test được API 23–26):

```sql
-- chạy: docker compose exec db psql -U flood -d flood_warning
INSERT INTO disaster_types (code, name) VALUES ('STORM','Bão')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO disaster_events (event_code, disaster_type_id, name, status, start_time, created_by)
VALUES ('TEST-STORM-001', (SELECT id FROM disaster_types WHERE code='STORM'),
        'Bão thử nghiệm', 'ONGOING', now(), NULL);
SELECT id, event_code, name FROM disaster_events WHERE event_code='TEST-STORM-001';
-- dùng id trả về làm $EV; sau đó gọi (25) chế độ tỉnh để khoanh vùng + sinh event_stations.
```

**Test trên Postman (Nhóm D):**

1. Dùng lại Bearer token đã lấy ở mục 8.4 (Authorization → Bearer Token = `{{access_token}}`).
2. Tạo request `POST {{baseUrl}}/internal/events/ingest`, tab **Headers** thêm `X-Internal-Token: {{internalToken}}` (không cần Bearer) → chạy để có dữ liệu.
3. `GET {{baseUrl}}/events?status=ONGOING` → copy một `id` vào biến môi trường `eventId`.
4. `GET {{baseUrl}}/events/{{eventId}}/stations?page=1&size=20` → kiểm tra mảng `provinces` + `stations.data`.
5. `POST {{baseUrl}}/events/{{eventId}}/impact` (Body → raw → JSON) với `{"provinceIds":[1,2,3]}` → response trả lại scope mới; gọi lại bước 4 thấy danh sách trạm đổi theo.

### 9.3. Các ca kiểm thử nghiệp vụ (kỳ vọng lỗi)

| Tình huống | Cách tái hiện | Kết quả mong đợi |
|------------|---------------|------------------|
| Sai phân quyền | Login VIEWER rồi `POST /stations` | `403 Forbidden` |
| Trùng mã trạm | `POST /stations` với `stationCode` đã tồn tại (kể cả đã xóa mềm) | `409 Conflict` |
| Tọa độ ngoài khoảng | `POST /stations` với `latitude: 200` | `400 Bad Request` |
| Ngưỡng trùng mức | Gửi 2 threshold cùng `alertLevel` | `400 Bad Request` |
| Đổi 1 nửa tọa độ | `PUT /stations/:id` chỉ gửi `latitude` (thiếu `longitude`) | `400 Bad Request` |
| Sửa sự kiện đã đóng | `PUT /events/:id` sau khi đã `close` | `403 Forbidden` |
| Đóng lại sự kiện | `POST /events/:id/close` lần 2 | `409 Conflict` |
| Gán phạm vi rỗng | `POST /events/:id/impact` với body `{}` (thiếu cả `provinceIds` lẫn `affectedArea`) | `400 Bad Request` |
| Gán phạm vi tỉnh không tồn tại | `POST /events/:id/impact` với `provinceIds:[999999]` | `400 Bad Request` |
| Gán phạm vi sự kiện đã đóng | `POST /events/:id/impact` sau khi `close` | `403 Forbidden` |
| VIEWER gán phạm vi | Login VIEWER rồi `POST /events/:id/impact` | `403 Forbidden` |
| Sai/thiếu token nội bộ | `POST /internal/events/ingest` thiếu header `X-Internal-Token` | `401 Unauthorized` |

### 9.4. Nhóm C — Import trạm hàng loạt (API 18–19)

Upload **CSV** để tạo nhiều trạm trong một lần qua **async job (BullMQ)** — giống mô hình Nhóm F: API trả `202 { jobId }` ngay, việc nặng (validate từng dòng + insert) chạy nền theo **lô 1.000 dòng/transaction**, rồi **poll** trạng thái. Cần **Redis** đang chạy.

| # | Method | Endpoint | Auth | Mô tả |
|---|--------|----------|------|-------|
| 18 | POST | `/stations/import` | OP/ADMIN | Upload CSV (multipart, field `file`) → `202 { jobId }` |
| 19 | GET | `/stations/import/:jobId` | OP/ADMIN | Trạng thái job + `progress` (0–100) + `report` |

**Định dạng CSV** (UTF-8, phân tách bằng dấu phẩy, có dòng tiêu đề; header không phân biệt hoa/thường):

| Cột | Bắt buộc | Alias chấp nhận | Ràng buộc |
|-----|----------|-----------------|-----------|
| `station_code` | ✅ | `code`, `ma_tram` | chữ/số/`-`/`_`, ≤50, **duy nhất** (toàn bảng + trong file) |
| `name` | ✅ | `ten`, `ten_tram` | ≤255 ký tự |
| `latitude` | ✅ | `lat`, `vi_do` | 6–24 |
| `longitude` | ✅ | `lng`, `lon`, `kinh_do` | 102–118 |
| `elevation` | — | `elev`, `do_cao` | -500–9000 (m) |
| `threshold_l1` / `_l2` / `_l3` | — | `th1`/`th2`/`th3`, `nguong_1..3` | mực nước ngưỡng (m) cho cấp 1/2/3 |

- **Validate đồng bộ (trả `400` ngay):** thiếu file, file rỗng/chỉ có dòng tiêu đề, thiếu cột bắt buộc, hoặc vượt **10.000** dòng.
- **Validate bất đồng bộ (trong job):** từng dòng được kiểm (định dạng mã, trùng mã, khoảng tọa độ VN, độ cao, ngưỡng…). **Dòng lỗi bị bỏ qua** và gom vào `report.errors` (cap 500 dòng); **dòng hợp lệ vẫn được nhập**. Mỗi lô 1.000 dòng nằm trong 1 transaction; tỉnh tự gán bằng `ST_Contains` (giống API 14).
- Job **không retry** (`attempts: 1`) — các lô trước đã commit nên chạy lại sẽ tính nhầm.
- `report` = `{ total, success, failed, errors: [{ row, stationCode, message }], truncatedErrors }`. `row` là **số dòng trong file** (tính cả dòng tiêu đề là dòng 1).
- Hiện hỗ trợ **CSV** (chưa có XLSX — tránh phụ thuộc nặng).

```bash
# Tạo 1 file CSV mẫu: dòng 1 hợp lệ, dòng 2 cố tình sai tọa độ để thấy report bỏ qua
cat > /tmp/stations.csv <<'CSV'
station_code,name,latitude,longitude,elevation,threshold_l1,threshold_l2,threshold_l3
VTS-IMP-001,Trạm Import 1,16.8163,107.1003,8.5,2.0,3.5,5.0
VTS-IMP-002,Trạm Lỗi,200,107.2,,,,
CSV

# (18) Upload CSV (multipart) -> 202 { jobId }
curl -s -X POST http://localhost:3000/stations/import \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/stations.csv;type=text/csv"
# -> {"jobId":"<uuid>"}
export JOB=<jobId>

# (19) Poll trạng thái + report (lặp tới khi state=completed)
curl -s http://localhost:3000/stations/import/$JOB \
  -H "Authorization: Bearer $TOKEN"
# -> {"jobId":"...","state":"completed","progress":100,
#     "report":{"total":2,"success":1,"failed":1,
#               "errors":[{"row":3,"stationCode":"VTS-IMP-002","message":"Vĩ độ không hợp lệ (cần trong khoảng 6–24)."}],
#               "truncatedErrors":false}}
```

**Test trên Postman (Nhóm C — Import):**

1. `POST {{baseUrl}}/stations/import`, tab **Body → form-data**: thêm key `file`, đổi kiểu cột từ *Text* sang **File**, chọn file `.csv`. Authorization để **Inherit** (Bearer của OP/ADMIN). **Đừng** tự set `Content-Type` — Postman tự thêm boundary multipart. Send → `202 { jobId }`.
2. Tab **Scripts → Post-response**: `pm.collectionVariables.set("import_job", pm.response.json().jobId);`
3. `GET {{baseUrl}}/stations/import/{{import_job}}` → bấm Send lặp lại tới khi `state = completed`, đọc `report` (success/failed + mảng `errors`).
4. Kiểm tra DB: `SELECT station_code, name, province_id FROM stations WHERE station_code LIKE 'VTS-IMP-%';` — trạm hợp lệ đã được tạo và **tự gán `province_id`** nếu tọa độ nằm trong ranh giới một tỉnh.

**Các ca kiểm thử (kỳ vọng lỗi):**

| Tình huống | Cách tái hiện | Kết quả mong đợi |
|------------|---------------|------------------|
| Thiếu file | `POST /stations/import` không kèm form-data `file` | `400 Bad Request` |
| Thiếu cột bắt buộc | CSV không có cột `latitude` | `400` — *Thiếu cột bắt buộc* |
| File rỗng | CSV chỉ có dòng tiêu đề | `400 Bad Request` |
| Vượt giới hạn | CSV > 10.000 dòng | `400 Bad Request` |
| Sai phân quyền | Login VIEWER rồi `POST /stations/import` | `403 Forbidden` |
| Job không tồn tại | `GET /stations/import/khong-co` | `404 Not Found` |

## 10. Test API — Nhóm F (Thời tiết bên thứ 3) bằng Postman

Nhóm F đồng bộ dữ liệu thời tiết/thiên tai từ các nguồn ngoài qua **async job (BullMQ)** rồi ghi `weather_snapshots` + `weather_forecasts`. Các endpoint **không trả dữ liệu ngay** mà trả `202 Accepted + jobId` — phải **poll** trạng thái job.

> **⚠️ Thay đổi nguồn (cập nhật 2026-06-28):**
> - **Chuỗi dự báo (forecast)**: `Open-Meteo → MET Norway → WeatherAPI`. **Đã bỏ hẳn OpenWeatherMap** (provider + biến `OPENWEATHERMAP_*` đã xóa). Open-Meteo & MET Norway **không cần key**; chỉ WeatherAPI cần key.
> - **Chuỗi thiên tai (disaster)**: `GDACS → ReliefWeb → EONET` (fallback theo thứ tự). ReliefWeb bị **bỏ qua** tới khi có `RELIEFWEB_APPNAME` → thực tế chạy `GDACS → EONET`.
> - **Mực nước sông (river)**: lấy từ **GloFAS (Copernicus EWDS)** theo cron **ngày riêng** + trigger thủ công — xem **mục 10.6**.

### 10.1. Chuẩn bị `.env`

Điền các biến (xem `.env.example`) trước khi build lại:

| Biến | Bắt buộc | Ghi chú |
|------|----------|---------|
| `WEATHERAPI_KEY` | cho fallback WeatherAPI | Open-Meteo, MET Norway & GDACS/EONET không cần key |
| `MET_NORWAY_USER_AGENT` | nên đặt | Điều khoản MET Norway **bắt buộc** User-Agent có liên hệ (vd `vtnet-flood-warning/1.0 (contact: email)`) |
| `RELIEFWEB_APPNAME` | tùy chọn | `appname` đã duyệt (free) tại apidoc.reliefweb.int; trống → ReliefWeb bị skip |
| `INTERNAL_API_TOKEN` | cho API 34 + GloFAS | Bí mật gửi qua header `X-Internal-Token`; **để trống = đóng endpoint** |
| `EWDS_PAT` | cho GloFAS (river) | Personal Access Token từ ewds.climate.copernicus.eu (+ accept licence CEMS-FLOODS) |
| `WEATHER_CRON` / `WEATHER_HEALTHCHECK_CRON` / `GLOFAS_CRON` | tùy chọn | Lịch cron ingest / healthcheck / GloFAS (mặc định mỗi giờ / 2 phút / 06:30 UTC ngày) |

> Cần **Redis** đang chạy (`docker compose up -d redis`) — BullMQ + lock chống spam + cache healthcheck đều dùng Redis.

### 10.2. Danh sách endpoint

| # | Method | Endpoint | Auth | Mô tả |
|---|--------|----------|------|-------|
| 31 | POST | `/weather/refresh` | OP/ADMIN | Làm mới thủ công; debounce-lock; trả `202 {jobId}` |
| 32 | GET | `/weather/refresh/:jobId` | OP/ADMIN | Trạng thái job + `snapshotId` khi xong |
| 33 | GET | `/weather/snapshots/latest?source=` | Bearer | Snapshot mới nhất (lọc theo `source`) |
| 34 | POST | `/internal/weather/ingest` | `X-Internal-Token` | Trigger ingest (scheduler-only, không dùng JWT) |
| 35 | GET | `/integrations/health` | **ADMIN** | Trạng thái các nguồn (đọc từ Redis cache) |
| — | POST | `/internal/weather/glofas` | `X-Internal-Token` | **(Mới)** Trigger GloFAS lấy mực nước sông ngay — xem **mục 10.6** |

- `source` ∈ `OpenMeteo | MetNorway | WeatherAPI | GDACS`. Bỏ trống ở API 31 → dùng fallback forecast **Open-Meteo → MET Norway → WeatherAPI**; đặt `GDACS` → chạy chuỗi thiên tai **GDACS → ReliefWeb → EONET**.
- API 31 body (tùy chọn): `{ "stationIds": [..], "provinceIds": [..], "source": ".." }`. Bỏ trống → đồng bộ **toàn bộ trạm đang hoạt động**.
- API 35 trả trạng thái mọi nguồn được khai báo: forecast (Open-Meteo, MET Norway, WeatherAPI), disaster (GDACS, ReliefWeb, EONET) và GloFAS. Nguồn thiếu key/appname → `status: "UNKNOWN", configured: false`.

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

5. **(35) Healthcheck (Admin)** — `GET {{baseUrl}}/integrations/health` bằng token **ADMIN**. Sau ≥1 chu kỳ cron sẽ thấy `status/latencyMs/errorRate` của các nguồn (forecast + disaster + GloFAS); nguồn thiếu key/appname → `status: "UNKNOWN", configured: false`.

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

### 10.6. GloFAS — mực nước sông (river_water_level)

Chuỗi forecast (Open-Meteo/MET Norway/WeatherAPI) **không** cho mực nước sông; Open-Meteo Flood API thì bị **chặn TCP** từ mạng VN. Vì vậy mực nước sông lấy riêng từ **GloFAS (Copernicus EWDS)** — một field GRIB2 dạng lưới, cập nhật **1 lần/ngày** nên chạy theo **cron ngày riêng** (`GLOFAS_CRON`, mặc định 06:30 UTC), tách khỏi chuỗi forecast theo giờ.

**Luồng**: submit job `cems-glofas-forecast` cho bbox Việt Nam → poll job async → tải GRIB2 → **sidecar Python** (`scripts/glofas_extract.py`, dùng cfgrib — đã cài sẵn trong image) trích về từng trạm theo ô lưới gần nhất → ghi `weather_forecasts.river_water_level` của snapshot SUCCESS mới nhất → **republish `WEATHER_SNAPSHOT`** để Risk Engine tính lại kèm dữ liệu sông.

**Quy đổi đơn vị (rating curve, KHÔNG đổi DB).** GloFAS trả **lưu lượng DISCHARGE (m³/s)** nhưng `flood_thresholds` là **mực nước STAGE (m)** với datum riêng từng trạm — so trực tiếp m³/s với m là vô nghĩa. Service quy đổi discharge → stage **trên thang ngưỡng riêng của từng trạm**, neo theo **dòng chảy nền** của chính ô lưới (min trong cửa sổ dự báo):

- `Q = GLOFAS_ONSET_RATIO × nền` (mặc định 1.5×) → ứng với **BĐ1** (ngưỡng tier-1)
- `Q = GLOFAS_DANGER_RATIO × nền` (mặc định 4×) → ứng với **BĐ3** (ngưỡng cao nhất)
- log-linear ở giữa; độc lập magnitude (sông lớn & suối nhỏ đều xét theo dòng chảy nền của nó).

Nhờ vậy không phải sửa `flood_thresholds`, hard-gate giữ nguyên. *(Chính xác tuyệt đối vẫn cần rating curve hiệu chỉnh theo trạm từ KTTV/NCHMF — bản hiện tại là proxy hợp lý, đúng thứ tự ưu tiên rủi ro.)*

#### Test trên Postman

Endpoint là **internal** (giống API 34): **No Auth** (bỏ Bearer) + header `X-Internal-Token`.

1. **Trigger** — `POST {{baseUrl}}/internal/weather/glofas`, header `X-Internal-Token: <INTERNAL_API_TOKEN>`, **không** body. Kỳ vọng `202 { "started": true }`. Job chạy **bất đồng bộ** (vài phút: submit→poll→download→extract).
2. **Theo dõi** qua log container (không có REST poll riêng):

   ```bash
   docker compose logs -f api | grep -i glofas
   # ... GloFAS job <uuid> submitted; polling…
   # ... GloFAS: river levels written for N stations on snapshot <id>
   ```

3. **Kiểm tra DB** — mực nước giờ ở thang **mét** (so được với ngưỡng), không còn là discharge nghìn-m³/s:

   ```sql
   -- Khoảng giá trị river giờ ~ mét (vd 0–135m), không còn ~ nghìn m³/s
   SELECT min(river_water_level), max(river_water_level), round(avg(river_water_level)::numeric,2)
   FROM weather_forecasts
   WHERE snapshot_id = (SELECT max(id) FROM weather_snapshots
                        WHERE status='SUCCESS' AND source_code NOT IN ('GDACS','EONET','ReliefWeb','GloFAS'))
     AND river_water_level IS NOT NULL;

   -- Trạm HIGH: mực nước dự báo (m) vượt ngưỡng riêng của trạm (m) một cách hợp lý
   SELECT station_id, severity, risk_score,
          round(predicted_water_level::numeric,2) AS river_m,
          round(threshold_value::numeric,2) AS thr_m, is_exceeded
   FROM station_risk_assessments
   WHERE severity='HIGH' AND predicted_water_level IS NOT NULL
   ORDER BY risk_score DESC LIMIT 10;
   ```

> Lưu ý cadence: GloFAS chạy theo ngày còn forecast theo giờ. Sau mỗi lần ingest forecast mới, river của snapshot mới sẽ NULL **cho tới** lần GloFAS kế (hoặc trigger thủ công). Khi đó severity sông có thể tạm tụt về LOW — chạy lại endpoint này để bù.
>
> **Lỗi thường gặp:** `403 required licences not accepted` → vào ewds.climate.copernicus.eu **accept licence CEMS-FLOODS**. `EWDS_PAT` trống → endpoint trả `202` nhưng log báo *skipped: EWDS_PAT not configured* (không ghi gì).

## 11. Test Realtime — WebSocket (Socket.IO, API 44–47)

Gateway risk-delta đẩy thay đổi rủi ro của trạm về client theo **phòng (room) tile bản đồ**. Đây là **Socket.IO** (không phải WebSocket thuần), chạy cùng cổng API (`ws://localhost:3000`, path mặc định `/socket.io`). Cần **Redis** đang chạy (adapter Socket.IO + event bus). *(Frontend đã có client tại `src/lib/realtime.ts` — `MapView` mở 1 kết nối JWT, `subscribe:viewport` theo khung nhìn, merge `risk:delta` vào trạm đang hiển thị. Các bước dưới giúp test gateway độc lập bằng Postman/script.)*

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

Risk Engine (Group G) — bên *phát* delta — **đã được xây** (xem **mục 12**). Cách tự nhiên để sinh `risk:delta` là kích hoạt một luồng tính lại rủi ro: `POST /weather/refresh` (API 31) hoặc `PUT /stations/:id/thresholds` (API 17). Khi engine tính xong, mọi trạm **đổi `risk_status`** sẽ phát `risk:delta` về đúng room tile chứa tọa độ trạm.

Để kiểm thử **riêng đường đẩy** (không cần dữ liệu thời tiết), vẫn có thể **publish thẳng vào kênh Redis** mà gateway lắng nghe (`risk.delta`):

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

## 12. Test API — Nhóm G (Cảnh báo rủi ro 5–7 ngày & chi tiết khí tượng)

Nhóm G gồm **Risk Engine** (tính rủi ro nền) + **4 API đọc** (36–39). Risk Engine **không có REST trigger**: nó là consumer trên event bus, tự chạy khi có `WEATHER_SNAPSHOT` / `THRESHOLD_CHANGED` / `EVENT_SCOPE_ASSIGNED` / `EVENT_CLOSED`, ghi sẵn bảng `station_risk_assessments` + `alert_histories`, cập nhật `stations.risk_status` và phát `risk:delta`. Các API đọc **chỉ truy vấn bảng đã tính sẵn** (không tính inline). Cần **Redis** đang chạy.

### 12.1. Kích hoạt Risk Engine để có dữ liệu rủi ro

Engine chạy nền nên trước khi gọi API 36/38 cần "mồi" một lượt tính. Hai cách:

1. **Qua thời tiết (đầy đủ nhất)** — sau khi có ít nhất 1 snapshot `SUCCESS` (mục 10): gọi `POST /weather/refresh` → job xong → bus phát `WEATHER_SNAPSHOT` → engine tính **toàn bộ trạm** trong khung [hôm nay, +7 ngày]. Chỉ **một instance** chiếm lock `risk:recompute:lock` để tính (chống trùng khi chạy nhiều instance).
2. **Qua đổi ngưỡng (1 trạm)** — `PUT /stations/:id/thresholds` (API 17) phát `THRESHOLD_CHANGED` → engine **tính lại đúng trạm đó** từ snapshot mới nhất.

> Công thức 4 lớp (mưa R + nước sông V + độ cao E → `risk_score` ∈ [0,100] → severity/alert_level + cổng ngưỡng cứng). Trọng số hiểm họa qua `RISK_WEIGHT_RAIN` / `RISK_WEIGHT_RIVER` trong `.env` (mặc định 0.4 / 0.6, tự chuẩn hóa tổng = 1).

### 12.2. Danh sách endpoint

| # | Method | Endpoint | Auth | Mô tả |
|---|--------|----------|------|-------|
| 36 | GET | `/risk/stations?from=&to=&severity=&provinceId=&eventId=&sort=&page=&size=` | Bearer | Danh sách trạm nguy cơ 5–7 ngày (quét bảng tính sẵn) |
| 37 | GET | `/forecasts/provinces/:id?from=&to=` | Bearer | Chuỗi dự báo tổng hợp cấp **tỉnh** |
| 38 | GET | `/forecasts/stations/:id?from=&to=` | Bearer | Chuỗi dự báo điểm cấp **trạm** + phân loại theo ngưỡng |
| 39 | GET | `/stations/:id/alert-history?page=&size=` | Bearer | Lịch sử cảnh báo (giá trị thực tế vs ngưỡng + lý do) |

- Mọi endpoint **đọc** (Viewer+). `from`/`to` định dạng `YYYY-MM-DD`; bỏ trống → mặc định **[hôm nay, hôm nay + 7]**.
- `severity` ∈ `LOW | MEDIUM | HIGH`. API 36 **bỏ trống severity** → chỉ trả trạm `severity <> LOW` (đúng nghĩa "nguy cơ"); truyền severity cụ thể để lọc hẹp.
- `sort` ∈ `severity` (mặc định, `risk_score` giảm dần) | `timeline` (`forecast_date` tăng dần).
- `eventId` là **BIGINT** (chuỗi) — lọc các bản ghi rủi ro gắn với 1 sự kiện.
- API 38 phân loại **on-the-fly** từng ngày (severity/alertLevel/riskScore) chỉ để hiển thị — **không** ghi DB.

### 12.3. Luồng test bằng `curl`

Đặt sẵn `TOKEN="<access_token>"` như mục 8.3. Trước đó hãy chạy mục 12.1 để engine có dữ liệu.

```bash
# (36) Danh sách trạm nguy cơ trong 7 ngày tới, sắp theo độ nghiêm trọng
curl -s "http://localhost:3000/risk/stations?sort=severity&page=1&size=20" \
  -H "Authorization: Bearer $TOKEN"

# (36) Lọc theo tỉnh + mức nghiêm trọng + khoảng ngày, sắp theo timeline
curl -s "http://localhost:3000/risk/stations?provinceId=1&severity=HIGH&from=2026-06-27&to=2026-07-04&sort=timeline" \
  -H "Authorization: Bearer $TOKEN"

# (37) Dự báo tổng hợp cấp tỉnh (avg nhiệt độ/mưa/gió theo ngày)
curl -s "http://localhost:3000/forecasts/provinces/1?from=2026-06-27&to=2026-07-04" \
  -H "Authorization: Bearer $TOKEN"

# (38) Dự báo điểm cấp trạm + phân loại cảnh báo theo ngưỡng của trạm
curl -s "http://localhost:3000/forecasts/stations/1" \
  -H "Authorization: Bearer $TOKEN"

# (39) Lịch sử cảnh báo của trạm (actual vs threshold + reason)
curl -s "http://localhost:3000/stations/1/alert-history?page=1&size=20" \
  -H "Authorization: Bearer $TOKEN"
```

### 12.4. Kiểm tra dữ liệu engine ghi trong DB

```sql
-- Rủi ro tính sẵn cho timeline 5-7 ngày
SELECT station_id, forecast_date, risk_score, severity, alert_level, is_exceeded
FROM station_risk_assessments
ORDER BY risk_score DESC LIMIT 10;

-- Trạng thái rủi ro cache trên trạm (nguồn của risk:delta)
SELECT id, name, risk_status FROM stations WHERE risk_status IS NOT NULL;

-- Lịch sử cảnh báo (chỉ ghi khi leo thang lên WARNING/DANGER)
SELECT station_id, alert_level, actual_value, threshold_value, reason, triggered_at
FROM alert_histories ORDER BY triggered_at DESC LIMIT 10;
```

> Ghi chú: nếu `station_risk_assessments` rỗng sau khi refresh, kiểm tra snapshot có **forecast theo trạm** chưa (`weather_forecasts.station_id` khác NULL) — engine chỉ tính cho trạm có dữ liệu dự báo trong snapshot.

### 12.5. Các ca kiểm thử nghiệp vụ (kỳ vọng lỗi)

| Tình huống | Cách tái hiện | Kết quả mong đợi |
|------------|---------------|------------------|
| Sai `severity` | `?severity=Foo` | `400 Bad Request` |
| Sai `sort` | `?sort=abc` | `400 Bad Request` |
| Sai định dạng ngày | `?from=27-06-2026` | `400 Bad Request` |
| Tỉnh không tồn tại | `GET /forecasts/provinces/99999` | `404 Not Found` |
| Trạm không tồn tại | `GET /forecasts/stations/99999` hoặc `/stations/99999/alert-history` | `404 Not Found` |
| Chưa có snapshot | Gọi API 37/38 khi chưa ingest thời tiết lần nào | `200` với `series: []` |

## 13. Sự cố thường gặp

- **`port 5432 already in use`**: đổi `POSTGRES_PORT` trong `.env` (ví dụ `5433`).
- **API báo `ECONNREFUSED` tới DB**: kiểm tra service `db` đã `healthy` chưa (`docker compose ps`); API tự chờ healthcheck nên thường chỉ xảy ra khi DB lỗi khởi động.
- **Muốn khởi tạo lại sạch sẽ**: `docker compose down -v` rồi `docker compose up --build` (lưu ý sẽ mất toàn bộ dữ liệu).
- **`init-postgis.sql` không chạy lại**: file trong `/docker-entrypoint-initdb.d` chỉ chạy khi volume DB còn **trống**. Migration đã có `CREATE EXTENSION IF NOT EXISTS postgis` nên PostGIS vẫn được đảm bảo.
- **`duplicate key value violates unique constraint "..._pkey"` khi tạo/sửa (trạm, ngưỡng, sự kiện…)**: các CSV trong `data/` seed bằng `id` tường minh nên **sequence không được nâng** → INSERT mới cấp id trùng. Khắc phục (chạy 1 lần sau khi seed, idempotent):

  ```bash
  docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < backend/docker/reset-sequences.sql
  ```

  Script này resync mọi sequence `SERIAL/BIGSERIAL` về `MAX(id)+1`.
