# BÁO CÁO MINI-PROJECT: Hệ thống Web GIS Cảnh báo Nguy cơ Ngập lụt cho Mạng lưới Trạm Viễn thông theo Thời gian thực

## Thông tin chung

* **Sinh viên thực hiện:** Trần Thanh Thúy
* **Chương trình:** Viettel Digital Talent 2026
* **Lĩnh vực:** Software Engineer
* **Mentor:** [Placeholder: Tên Mentor]
* **Đơn vị:** [Placeholder: Tên Đơn vị]

---

## Lời mở đầu

Hạ tầng viễn thông là xương sống của hoạt động thông tin liên lạc quốc gia, song lại là một trong những đối tượng dễ tổn thương nhất trước thiên tai. Tại Việt Nam — quốc gia thường xuyên hứng chịu bão, lũ và ngập lụt trên diện rộng — hàng chục nghìn nhà trạm BTS, trạm tiếp phát và thiết bị đầu cuối được phân bố trên khắp các địa hình, bao gồm cả những khu vực trũng thấp ven sông và ven biển. Mỗi khi một cơn bão hoặc đợt lũ tràn về, việc **không nắm được trạm nào đang đứng trước nguy cơ ngập** khiến công tác ứng phó rơi vào thế bị động: đội kỹ thuật chỉ biết sự cố khi trạm đã mất điện, mất kết nối, dẫn tới gián đoạn dịch vụ đúng vào thời điểm người dân cần liên lạc khẩn cấp nhất.

Bài toán cốt lõi đặt ra là chuyển hoạt động vận hành từ **bị động khắc phục** sang **chủ động phòng ngừa**: cần một hệ thống có khả năng giám sát diễn biến thời tiết — thiên tai theo thời gian thực, tính toán trước nguy cơ ngập cho từng trạm trong khung 5–7 ngày, và cảnh báo tức thời tới người vận hành trên nền bản đồ số. Dự án Mini-Project này được thực hiện nhằm giải quyết trực tiếp bài toán đó: xây dựng một **hệ thống Web GIS cảnh báo nguy cơ ngập lụt** cho mạng lưới hơn 10.000 trạm viễn thông, kết hợp dữ liệu không gian (GIS/PostGIS), dữ liệu khí tượng — thủy văn từ nhiều nguồn quốc tế, và một cơ chế tính toán rủi ro tự động để hỗ trợ ra quyết định vận hành.

---

## Tóm tắt nội dung và đóng góp

Dự án hiện thực hóa một hệ thống hoàn chỉnh gồm hai phần độc lập: **backend** (NestJS + TypeORM + PostGIS) đóng vai trò trung tâm nghiệp vụ và tính toán, và **frontend** (React 19 + Vite + Leaflet) cung cấp giao diện bản đồ tương tác. Toàn bộ 47 API thuộc 9 nhóm chức năng (Xác thực & RBAC, Quản lý tài khoản, Nhà trạm & tỉnh, Sự kiện thiên tai, Bản đồ GIS, Tích hợp thời tiết bên thứ ba, Risk Engine & dự báo, Xuất báo cáo, Realtime) đã được xây dựng và tích hợp đầu-cuối.

**Kết quả chính đạt được:**

* **Nền tảng dữ liệu không gian** trên PostgreSQL + PostGIS với 13 bảng, tự động gán trạm về tỉnh bằng phép toán point-in-polygon và truy vấn theo khung nhìn (viewport BBOX) tận dụng chỉ mục GIST — cho phép render mượt hơn 10.000 trạm.
* **Pipeline tích hợp dữ liệu bên thứ ba** dạng bất đồng bộ: chuỗi dự phòng 3 nhà cung cấp dự báo (Open-Meteo → MET Norway → WeatherAPI), chuỗi 3 nguồn thiên tai (GDACS → EONET → ReliefWeb), và tích hợp mực nước sông GloFAS/Copernicus qua sidecar Python xử lý GRIB2.
* **Risk Engine** tính sẵn điểm rủi ro theo **công thức ngập 4 lớp** với trọng số suy ra bằng phương pháp phân tích thứ bậc **AHP (Analytic Hierarchy Process)** — ghi kết quả vào bảng pre-computed để API đọc chỉ truy vấn, không tính toán trực tuyến.
* **Kênh realtime** trên Socket.IO với phòng theo ô bản đồ (tile room), đẩy thay đổi rủi ro (`RISK_DELTA`) tới client đúng-một-lần trên toàn cụm nhờ Redis adapter.
* **Tác vụ nền bất đồng bộ** (import CSV hàng loạt, xuất báo cáo CSV/HTML) chạy trên hàng đợi BullMQ riêng biệt với cơ chế trả `202 { jobId }` + poll trạng thái.

**Công nghệ và kiến trúc cốt lõi:** kiến trúc **module hóa theo domain** với tách lớp Controller/Service rõ ràng (tiệm cận Clean Architecture), **event-driven backbone** trên Redis Pub/Sub, xử lý **bất đồng bộ** qua BullMQ, và đóng gói toàn bộ bằng **Docker Compose**. Đóng góp thiết thực của dự án là một khung giám sát chủ động, có khả năng mở rộng ngang, biến dữ liệu khí tượng — thủy văn thô thành cảnh báo hành động được cho đội vận hành hạ tầng viễn thông.

---

## I. Giới thiệu

### Đặt vấn đề

Việc vận hành mạng lưới viễn thông quy mô lớn trong điều kiện thiên tai gặp phải nút thắt cốt lõi: **thiếu khả năng dự báo và định vị nguy cơ ngập ở cấp độ từng trạm**. Các hạn chế cụ thể:

* Dữ liệu khí tượng — thiên tai nằm rải rác ở nhiều nguồn quốc tế, định dạng khác nhau (JSON, GRIB2), độ phủ và độ tin cậy không đồng đều.
* Nguy cơ ngập của một trạm không chỉ phụ thuộc lượng mưa mà còn phụ thuộc **mực nước sông**, **cao độ địa hình** và **ngưỡng chịu ngập riêng** của từng trạm — cần một mô hình tổng hợp đa yếu tố thay vì một chỉ số đơn lẻ.
* Với hơn 10.000 trạm, việc tính rủi ro trực tuyến mỗi lần đọc là bất khả thi về hiệu năng; đồng thời việc hiển thị toàn bộ trạm trên bản đồ dễ làm nghẽn trình duyệt.
* Cảnh báo cần đến tay người vận hành **tức thời** và chỉ trong phạm vi họ đang quan tâm, thay vì đẩy tràn lan.

### Mục tiêu của báo cáo/dự án

**Mục tiêu nghiệp vụ:**

* Giám sát diễn biến bão/lũ theo thời gian thực và tự động khoanh vùng phạm vi ảnh hưởng tới từng tỉnh/trạm.
* Tính sẵn nguy cơ ngập 5–7 ngày cho từng trạm, phân mức cảnh báo rõ ràng để hỗ trợ ưu tiên ứng phó.
* Cung cấp bản đồ trực quan và báo cáo xuất khẩu phục vụ điều hành và tổng hợp.

**Mục tiêu kỹ thuật:**

* Xây dựng nền tảng dữ liệu không gian chính xác và có chỉ mục tốt (PostGIS + GIST).
* Thiết kế pipeline tích hợp dữ liệu chịu lỗi (fallback nhiều nguồn) và bất đồng bộ, không chặn luồng API.
* Bảo đảm hệ thống mở rộng ngang được (stateless API, worker nền, realtime đa-instance).
* Áp dụng bảo mật chuẩn: xác thực JWT hai token và phân quyền RBAC toàn cục.

### Phạm vi triển khai

Dự án triển khai đầy đủ 9 nhóm chức năng, ánh xạ trực tiếp tới cấu trúc mã nguồn:

| Nhóm | Phạm vi |
|---|---|
| **A — Xác thực** | Đăng nhập / refresh / logout / me; JWT hai token; guard RBAC toàn cục. |
| **B — Tài khoản & RBAC** | CRUD người dùng, gán vai trò, danh mục vai trò; các quy tắc bảo vệ (last-admin, self-mutation). |
| **C — Nhà trạm & tỉnh** | List phân trang, chi tiết, CRUD, ngưỡng cảnh báo, viewport BBOX, import CSV hàng loạt. |
| **D — Sự kiện thiên tai** | Tự động theo dõi (auto-ingestion) từ nguồn ngoài, tự gán phạm vi, override thủ công, đọc phạm vi. |
| **E — Bản đồ / GIS** | Trạm theo khung nhìn (kèm gộp cụm khi zoom-out), lớp sự kiện, lớp thời tiết, tìm kiếm không gian. |
| **F — Thời tiết bên thứ ba** | Chuỗi dự phòng đa nguồn dự báo/thiên tai/mực nước sông, healthcheck, cron ingest. |
| **G — Risk Engine & dự báo** | Tính rủi ro 4 lớp + AHP, đọc rủi ro/dự báo/lịch sử cảnh báo. |
| **H — Báo cáo** | Xuất báo cáo bất đồng bộ CSV/HTML (station-inventory, risk-summary). |
| **I — Realtime** | Socket.IO tile-room, đẩy `RISK_DELTA`, xác thực qua JWT handshake. |

---

## II. Nội dung và phương pháp

### Kiến thức nền tảng & Tổng quan công nghệ

| Lớp | Công nghệ | Vai trò |
|---|---|---|
| Backend runtime | TypeScript · Node.js 20 · **NestJS 10** | Framework module hóa, DI, guard/interceptor. |
| ORM & CSDL | **TypeORM 0.3** · **PostgreSQL 16 + PostGIS 3.4** | Truy vấn không gian, geometry, chỉ mục GIST. |
| Cache / Message bus | **Redis 7** (ioredis) | Event bus Pub/Sub, token store, lock, Socket.IO adapter. |
| Hàng đợi bất đồng bộ | **BullMQ** | Job nền: weather / stations-import / reports. |
| Realtime | **Socket.IO 4** + Redis adapter | Đẩy cảnh báo theo tile room, fan-out đa-instance. |
| Xác thực | **Passport JWT** · bcrypt | JWT hai token, băm mật khẩu. |
| Lịch nền | `@nestjs/schedule` (cron) | Cron ingest thời tiết / thiên tai / GloFAS / healthcheck. |
| Xử lý dữ liệu khoa học | **Python + cfgrib** (sidecar) | Trích xuất GRIB2 GloFAS (mực nước sông). |
| Frontend | **React 19** · Vite · **Leaflet** + markercluster · socket.io-client | Bản đồ GIS tương tác, render số lượng lớn, realtime. |
| Đóng gói | **Docker · Docker Compose** | Orchestrate db + redis + api + web; tự chạy migration. |

**Các khái niệm và mẫu thiết kế nền tảng được vận dụng:**

* **RESTful API** với chuẩn hóa DTO qua `class-validator`/`class-transformer` và `ValidationPipe` toàn cục (`whitelist` + `forbidNonWhitelisted`).
* **RBAC (Role-Based Access Control)** theo mô hình opt-out: mọi route mặc định yêu cầu JWT hợp lệ, mở công khai bằng `@Public()`, giới hạn theo vai trò bằng `@Roles()`.
* **Message Queue / Async processing**: mô hình *enqueue → 202 + jobId → poll* tách tác vụ nặng khỏi vòng đời request.
* **Event-Driven Architecture**: một event bus có kiểu (typed `EventPayloadMap`) trên Redis Pub/Sub, giao tiếp cross-instance, publish fire-and-forget.
* **Spatial database design**: geometry Point/MultiPolygon, point-in-polygon (`ST_Contains`), envelope query (`ST_MakeEnvelope`), gộp cụm (`ST_SnapToGrid`), hợp/đơn giản hóa vùng (`ST_UnaryUnion`/`ST_Simplify`).
* **AHP (Analytic Hierarchy Process)**: phương pháp ra quyết định đa tiêu chí (thang Saaty → ma trận nghịch đảo → vector ưu tiên geometric-mean → kiểm tra tính nhất quán CR) để suy trọng số công thức rủi ro.

### Phương pháp thực hiện & Thiết kế hệ thống

**1. Kiến trúc phân lớp theo domain.** Mỗi domain nằm dưới `src/modules/<domain>/` gồm controller/service/module + `entities/`, `dto/`. Controller chỉ marshal request/response; **toàn bộ nghiệp vụ nằm ở Service**; repository TypeORM chỉ được inject vào service. Cấu hình TypeORM là **single-source-of-truth** (`data-source.ts`) dùng chung cho app và CLI, `synchronize` luôn `false` — mọi thay đổi schema đi qua migration SQL viết tay (13 bảng, tạo theo thứ tự phụ thuộc khóa ngoại).

**2. Xử lý không gian bằng raw PostGIS.** Geometry không round-trip qua TypeORM entity save (tránh mất SRID); thay vào đó thao tác qua `DataSource`/transaction manager. Hai mẫu chủ đạo: (a) khi tạo/sửa trạm, một câu `UPDATE … ST_SetSRID(ST_MakePoint(lng,lat),4326)` đặt geom và **tự gán tỉnh** bằng point-in-polygon trong cùng transaction; (b) khi đọc theo khung nhìn, `ST_Contains(ST_MakeEnvelope(...), geom)` được phục vụ bởi bbox pre-filter của chỉ mục GIST. Cột `geom` để `select: false` nên WKB không lọt vào payload.

**3. Pipeline tích hợp bất đồng bộ & chịu lỗi.** Tác vụ nặng chạy trên **BullMQ processor** (hàng đợi riêng `weather` / `stations-import` / `reports`). Tích hợp thời tiết theo **chuỗi dự phòng**: dự báo Open-Meteo → MET Norway → WeatherAPI, thiên tai GDACS → EONET → ReliefWeb — nguồn đầu tiên phản hồi sẽ thắng, mỗi nguồn có normalizer riêng đưa về cùng cấu trúc chuẩn hóa. Mực nước sông lấy từ GloFAS/Copernicus qua giao thức OGC API (submit → poll → download GRIB2), rồi **sidecar Python cfgrib** trích ô lưới gần nhất mỗi trạm, quy đổi lưu lượng (m³/s) sang mực nước (stage) trên thang ngưỡng riêng của trạm bằng đường cong rating tự-neo. Các provider triển khai chung interface và được inject dạng **tập hợp DI-token có thứ tự**; provider thiếu key thì tự bỏ qua.

**4. Cơ chế event-driven & Risk Engine.** Ba nhóm trigger phát sự kiện lên bus: `WEATHER_SNAPSHOT` (sau mỗi lần ingest thời tiết), `THRESHOLD_CHANGED` (đổi ngưỡng trạm), `EVENT_*` (sự kiện thiên tai). **Risk Engine** là consumer: với mỗi snapshot, nó tổng hợp dự báo theo trạm/ngày, áp **công thức ngập 4 lớp** (chuẩn hóa các chỉ số Mưa R / Mực nước V / Phơi nhiễm E → `risk_score` có trọng số theo nhóm trạm) rồi phân mức severity/alert với cổng ngưỡng cứng, ghi `station_risk_assessments` + `alert_histories`, và phát `RISK_DELTA` (kèm lng/lat để định tuyến không cần tra DB). Trọng số suy từ **AHP**: một phán đoán môi trường duy nhất (`RISK_AHP_RIVER_VS_RAIN`) sinh ra profile trọng số; trạm có giám sát mực nước sông dùng AHP 2 tiêu chí {mưa, sông}, trạm chỉ mưa dùng trọng số mưa 1.0. Cả write-side và read-side suy profile giống hệt nhau từ cùng biến môi trường.

**5. Realtime theo khung nhìn.** `RiskGateway` (Socket.IO) xác thực JWT ngay trong **handshake middleware** (tái sử dụng kiểm tra epoch của token store) nên socket trái phép không bao giờ mở. Client `subscribe:viewport` với một bbox → gateway tham gia các **tile room** (zoom cố định) mà bbox phủ. Khi `RISK_DELTA` về từ bus, gateway ánh xạ tọa độ trạm sang đúng tile room và emit bằng `.local` — vì Redis adapter đã chia sẻ room xuyên instance và delta tới mọi instance qua bus, `.local` bảo đảm giao **đúng-một-lần** trên toàn cụm.

**6. Bảo mật.** JWT hai token: access ngắn hạn mang `{ sub, username, role, permissions }`, refresh dài hạn mang `jti` và **xoay vòng mỗi lần refresh**, hai secret khác nhau. `TokenStoreService` giữ whitelist refresh + **epoch vô hiệu hóa theo user** — bump epoch giết tức thì mọi token đang sống (logout, đổi vai trò, khóa/xóa tài khoản), được kiểm tra cả ở `JwtStrategy` và handshake WebSocket.

---

## III. Kết quả thực hiện và đánh giá

### Mô tả quá trình thử nghiệm & Triển khai

**Triển khai bằng Docker Compose (khuyến nghị).** `docker-compose.yaml` dựng sẵn toàn bộ stack: `db` (PostGIS) → `redis` → `api` (chờ healthcheck db + redis, tự chạy migration, start) → `web` (SPA qua nginx, reverse-proxy API + WebSocket).

```bash
cd backend
cp .env.example .env           # lần đầu
docker compose up --build      # build + chạy toàn bộ stack
curl http://localhost:3000/health   # -> {"status":"ok","db":"connected"}
# Mở SPA tại http://localhost:8080
```

**Chạy ngoài Docker (dev).** Cần `npm install`, có DB + Redis truy cập được, đặt `DB_HOST=localhost`/`REDIS_HOST=localhost`:

```bash
docker compose up -d db redis  # chỉ DB + Redis
npm run migration:run          # tạo 13 bảng
npm run start:dev              # Nest watch mode
```

**Chiến lược kiểm thử.** Backend **không cấu hình test runner/linter** (không có script `test`/`lint`) — thay đổi được xác minh bằng `npm run build`. API được kiểm thử thủ công qua `curl`/Postman: đăng nhập `POST /auth/login` lấy access token, gắn `Authorization: Bearer` cho các endpoint có bảo vệ; kênh realtime kiểm thử bằng request Socket.IO (`subscribe:viewport` với bbox → lắng nghe `risk:delta`). Frontend kiểm thử qua `npm run build` (`tsc -b && vite build`) và `npm run lint` (baseline 4 cảnh báo đã biết và chấp nhận).

### Kết quả đạt được

* **47/47 API thuộc 9 nhóm A–I đã hoàn thiện** và tích hợp đầu-cuối với frontend (16 controller backend, 11 view frontend).
* **Nền tảng dữ liệu không gian** 13 bảng vận hành ổn định: tự gán tỉnh point-in-polygon, viewport BBOX phục vụ bởi GIST, gộp cụm marker khi zoom-out.
* **Pipeline tích hợp** chạy theo cron: chuỗi dự phòng 3 nguồn dự báo + 3 nguồn thiên tai + GloFAS mực nước sông; healthcheck 7 nguồn ghi vào Redis, đọc qua API `GET /integrations/health` (Admin).
* **Risk Engine** hoạt động theo sự kiện, ghi bảng pre-computed và phát `RISK_DELTA`; công thức 4 lớp + trọng số AHP có kiểm tra nhất quán CR.
* **Realtime** đẩy cảnh báo theo tile room đúng-một-lần đa-instance; frontend hiển thị pill trạng thái live và merge delta vào trạm trong khung nhìn.
* **Tác vụ nền bất đồng bộ**: import CSV >10k dòng theo transaction 1000-dòng có báo cáo lỗi từng dòng; xuất báo cáo CSV (BOM Excel-friendly) / HTML print-ready lưu artifact Redis TTL 1h.
* **Frontend GIS** hoàn chỉnh: bản đồ Leaflet render >10.000 trạm, tô màu theo rủi ro thật, vẽ vùng ảnh hưởng GeoJSON, lớp thời tiết điểm, tìm kiếm không gian, scrubber mốc dự báo 5–7 ngày.

### Đánh giá

**Hiệu năng.** Việc **tính sẵn rủi ro** (pre-computed) tách hoàn toàn chi phí tính toán khỏi đường đọc — API chỉ truy vấn bảng kết quả, đáp ứng độ trễ thấp ngay cả với 10k trạm. Truy vấn không gian tận dụng chỉ mục GIST và bbox pre-filter thay vì quét toàn bảng; báo cáo dùng CTE tổng hợp trước thay cho `LATERAL` per-row (từng gây 10k subquery), cải thiện đáng kể thời gian xuất. Ở tầng bản đồ, gộp cụm phía server khi zoom-out giảm mạnh số điểm truyền về client.

**Khả năng mở rộng.** Kiến trúc **stateless + Redis dùng chung** cho phép mở rộng ngang: nhiều instance API/worker cùng tiêu thụ hàng đợi BullMQ, Socket.IO fan-out xuyên instance qua Redis adapter, Risk Engine dùng Redis lock chống tính trùng. Event bus fire-and-forget bảo đảm lỗi phụ trợ không phá vỡ mutation DB đã commit.

**Chất lượng mã & tính chịu lỗi.** Tách lớp Controller/Service nhất quán, migration mirror với entity, single-source config giúp dễ bảo trì. Chuỗi dự phòng đa nguồn (dự báo/thiên tai) và cơ chế carry-forward mực nước sông giúp hệ thống bền bỉ khi một nguồn ngoài gián đoạn.

**Hạn chế hiện tại.** (1) `TokenStoreService` vẫn là placeholder in-memory (`Map`) thay vì Redis — cần thay khi chạy nhiều instance thật; (2) chưa có test tự động (unit/integration) và linter backend; (3) "PDF" hiện là HTML print-ready qua trình duyệt, chưa có engine PDF phía server; (4) worker nền hiện chạy in-process trong container API (tách replica là bước mở rộng tùy chọn).

---

## IV. Kết luận

### Tóm tắt phát hiện chính

* Bài toán cảnh báo ngập cho hạ tầng viễn thông về bản chất là bài toán **tổng hợp dữ liệu không gian đa nguồn** — thành công phụ thuộc vào một nền tảng GIS vững (PostGIS + GIST) và pipeline tích hợp **chịu lỗi bằng dự phòng nhiều nguồn**.
* **Tách tính toán khỏi đọc** (pre-computed risk) và **kiến trúc hướng sự kiện** là hai quyết định then chốt giúp hệ thống vừa nhanh vừa mở rộng được với quy mô 10k trạm.
* Áp dụng **AHP** cho trọng số rủi ro biến một phán đoán chuyên gia đơn giản thành mô hình đa tiêu chí có cơ sở và nhất quán, thay cho trọng số gán tùy tiện.
* Mẫu **async + poll + realtime push** cân bằng tốt giữa trải nghiệm phản hồi tức thì và độ ổn định của các tác vụ nặng.

### Hướng phát triển tương lai

* **Thay `TokenStoreService` bằng Redis** (giữ nguyên public API) để token store nhất quán đa-instance — hạ tầng Redis đã sẵn sàng.
* **Bổ sung kiểm thử tự động** (unit cho công thức rủi ro/AHP, integration cho pipeline ingest) và cấu hình linter backend để nâng độ tin cậy.
* **Tách worker nền thành service riêng** (scale độc lập theo tải job) và bổ sung cờ vô hiệu hóa cron ở replica để tránh nhân đôi cron.
* **Engine PDF phía server** thay cho HTML print, và mở rộng định dạng báo cáo (xlsx thật thay cho CSV).
* **Làm giàu mô hình rủi ro**: thêm lớp dữ liệu (triều cường, độ ẩm đất, DEM chi tiết), hiệu chỉnh rating-curve GloFAS theo lịch sử thực đo, và học trọng số từ dữ liệu sự cố thay vì chỉ AHP tĩnh.
* **Quan trắc & vận hành**: bổ sung metrics/tracing (Prometheus/OpenTelemetry), dead-letter queue cho job thất bại, và CI/CD tự động hóa build–migrate–deploy.

---

## Tài liệu tham khảo

1. **NestJS Documentation** — https://docs.nestjs.com
2. **TypeORM Documentation** — https://typeorm.io
3. **PostGIS Documentation** (PostgreSQL spatial extension) — https://postgis.net/documentation/
4. **PostgreSQL 16 Documentation** — https://www.postgresql.org/docs/16/
5. **Redis Documentation** — https://redis.io/docs/
6. **BullMQ Documentation** (message queue trên Redis) — https://docs.bullmq.io
7. **Socket.IO Documentation** & Redis adapter — https://socket.io/docs/v4/
8. **React 19 Documentation** — https://react.dev
9. **Vite Documentation** — https://vitejs.dev
10. **Leaflet Documentation** (thư viện bản đồ) — https://leafletjs.com/reference.html
11. **Passport JWT / JSON Web Tokens** — https://www.passportjs.org , https://jwt.io
12. **Open-Meteo API** — https://open-meteo.com/en/docs
13. **MET Norway Weather API (Locationforecast)** — https://api.met.no/weatherapi/
14. **WeatherAPI** — https://www.weatherapi.com/docs/
15. **GDACS — Global Disaster Alert and Coordination System** — https://www.gdacs.org
16. **NASA EONET (Earth Observatory Natural Event Tracker)** — https://eonet.gsfc.nasa.gov/docs/v3
17. **ReliefWeb API** — https://apidoc.reliefweb.int
18. **Copernicus Emergency Management Service — GloFAS (Global Flood Awareness System)** — https://global-flood.emergency.copernicus.eu
19. **cfgrib / ecCodes** (đọc dữ liệu GRIB2) — https://github.com/ecmwf/cfgrib
20. **Saaty, T. L. — Analytic Hierarchy Process (AHP)**, *The Analytic Hierarchy Process*, McGraw-Hill.
21. **Docker & Docker Compose Documentation** — https://docs.docker.com
