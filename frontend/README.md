# VTNet FWS — Frontend (Flood Warning System)

Giao diện web cho hệ thống **Cảnh báo lũ (Flood Warning System)** của VTNet: giám sát thời tiết thời gian thực, dự báo nguy cơ ngập theo trạm, quản lý nhà trạm / sự kiện thiên tai và phân quyền người dùng.

> **Trạng thái tích hợp (đang chuyển từ prototype → kết nối backend thật):**
> Các màn hình đã **gọi API NestJS thật** qua [`app/src/lib/api.ts`](app/src/lib/api.ts) — **Login, Accounts, Stations, Map, Health, Forecast** và chip nguồn/đồng bộ trên **Topbar**. Riêng **Map** nay đã merge sâu hơn: panel chi tiết trạm (dự báo 7 ngày + lịch sử cảnh báo, **API 38/39**) và thanh "Mốc dự báo" cấp tỉnh (**API 37**) đều là dữ liệu thật. Các phần **còn mock** của Map (lớp thời tiết/lũ overlay, polygon sự kiện, panel "Cảnh báo nguy cơ" phụ thuộc `riskScore`/`weather` mà viewport chưa trả) và hai màn hình **Events, Import** vẫn dùng dữ liệu mock trong [`app/src/data/mockData.ts`](app/src/data/mockData.ts) vì phụ thuộc các nhóm API chưa xây (sự kiện/Group D, import, weather-tiles/API 29…). Xem bảng chi tiết ở **mục 4 — API đã tích hợp** và lịch sử thay đổi ở **mục 7**.

---

## 1. Công nghệ

| Thành phần | Phiên bản |
|---|---|
| React | 19 |
| TypeScript | ~6.0 |
| Vite | 8 (`@vitejs/plugin-react`) |
| Leaflet + leaflet.markercluster | 1.9 / 1.5 (bản đồ & gom cụm marker) |
| ESLint | 10 (flat config + typescript-eslint + react-hooks) |

Không dùng thư viện router, state manager hay UI framework ngoài — routing và state đều tự quản lý; styling viết inline + một file CSS toàn cục. Tầng gọi REST tự viết trong `lib/api.ts` (không dùng axios/react-query).

---

## 2. Cấu trúc thư mục

```
frontend/
└── app/                         # Toàn bộ ứng dụng Vite nằm ở đây
    ├── index.html               # HTML gốc, nạp font (Be Vietnam Pro, IBM Plex Mono)
    ├── package.json             # Scripts & dependencies
    ├── vite.config.ts           # Cấu hình Vite
    ├── eslint.config.js         # Cấu hình ESLint (flat config)
    ├── tsconfig*.json           # Cấu hình TypeScript (app / node)
    ├── public/                  # Tài nguyên tĩnh (favicon, icons)
    └── src/
        ├── main.tsx             # Entry point — mount <App/> vào #root
        ├── App.tsx              # Shell: chọn Login hoặc layout chính theo route
        ├── index.css            # CSS toàn cục + animation + style cho Leaflet
        ├── types.ts             # Toàn bộ type/interface dùng chung
        ├── state/
        │   └── AppStateContext.tsx   # Context: state tập trung + các action
        ├── lib/
        │   ├── api.ts          # ★ Tầng REST: JWT, header, refresh 401, mọi endpoint backend
        │   └── role.ts          # RBAC: thứ hạng vai trò, khóa route, cầu nối RoleCode ↔ FE
        ├── data/
        │   └── mockData.ts      # Dữ liệu mock (phần chưa có API: weather, risk, events, import…)
        └── components/
            ├── Login.tsx        # Đăng nhập thật (POST /auth/login)
            ├── Sidebar.tsx      # Điều hướng trái + khóa mục theo quyền + đăng xuất (POST /auth/logout)
            ├── Topbar.tsx       # Tiêu đề trang; chip nguồn (API 35) + đồng bộ thời tiết (API 31) — chỉ Admin
            ├── Toast.tsx        # Thông báo nổi
            ├── MapView.tsx      # Bản đồ Leaflet: trạm (GET /stations/viewport) + panel chi tiết (API 38/39) + scrubber tỉnh (API 37); lớp thời tiết/lũ overlay vẫn mock
            ├── ForecastView.tsx # Bảng dự báo nguy cơ ngập 5–7 ngày (GET /risk/stations — API 36; mock làm fallback)
            ├── StationsView.tsx # CRUD nhà trạm (GET/POST/PUT/DELETE /stations + thresholds + provinces)
            ├── ImportView.tsx   # Nhập trạm hàng loạt (mock — 4 bước, xử lý theo lô)
            ├── EventsView.tsx   # Sự kiện thiên tai + phạm vi ảnh hưởng (mock)
            ├── AccountsView.tsx # Tài khoản & phân quyền (Group B — /users, /roles)
            └── HealthView.tsx   # Tình trạng nguồn dữ liệu ngoài (GET /integrations/health)
```

---

## 3. Kiến trúc & luồng logic

### Tầng API — [`lib/api.ts`](app/src/lib/api.ts)
- **Điểm vào REST duy nhất.** Mọi component gọi backend qua các hàm `apiXxx` ở đây, **không** dùng `fetch` thô trong component.
- Lưu cặp JWT (`access` + `refresh`) trong `localStorage`, tự gắn header `Authorization: Bearer …`.
- **Tự refresh 1 lần khi gặp 401**: gọi `/auth/refresh` (dùng chung một promise đang chạy để gộp nhiều request 401 cùng lúc), xoay token rồi phát lại request gốc.
- `ApiError` mang theo HTTP status để component rẽ nhánh (401/403/409/429…).
- Base URL đọc từ biến môi trường `VITE_API_BASE` (mặc định `http://localhost:3000`).

### State tập trung — [`AppStateContext.tsx`](app/src/state/AppStateContext.tsx)
- Một đối tượng `AppState` duy nhất giữ mọi trạng thái UI (route hiện tại, vai trò, lớp bản đồ đang bật, trạm đang chọn, các bộ lọc, bước import, drawer đang mở…).
- Cập nhật qua hàm `patch(p)` — nhận object hoặc hàm `(state) => partial`. Hook `useApp()` để đọc state và gọi action.
- Action hiệu ứng-thời-gian giữ timer qua `useRef`: `showToast` (tự ẩn ~2.6s), `doSync`, `togglePlay`, `runImport`/`resetImport`.

### Routing — [`App.tsx`](app/src/App.tsx)
- Không dùng react-router. `state.route` quyết định màn hình: `login` → `<Login/>`; còn lại → `Sidebar` + `Topbar` + view (qua bảng tra `VIEWS`) + `Toast`.

### Phân quyền (RBAC) — [`lib/role.ts`](app/src/lib/role.ts)
- 3 vai trò: `viewer` < `operator` < `admin` (`ROLE_ORDER`). `LOCK_MIN` quy định quyền tối thiểu mỗi route; `isLocked(role, route)` khóa mục trên Sidebar. **Health đã nâng thành Admin-only** (khớp `@Roles(ADMIN)` của API 35).
- `roleFromCode` / `accountRoleToCode` là **cầu nối** giữa `RoleCode` backend (ADMIN/OPERATOR/VIEWER) và mô hình vai trò FE — dùng khi nhận response đăng nhập / tài khoản.

### Bản đồ — [`MapView.tsx`](app/src/components/MapView.tsx)
- Khởi tạo Leaflet một lần; giữ map/layer qua `useRef`. Trạm lấy **thật** qua `GET /stations/viewport` (BBOX, GIST index), **fetch lại theo viewport** mỗi lần pan/zoom (debounce). Marker gom cụm (markercluster); click → chọn trạm, mở panel.
- Phần phụ thuộc dữ liệu làm giàu chưa có (`riskScore`, `weather`) đọc null-safe nên hiển thị `—`; lớp thời tiết/lũ, dự báo 7 ngày, lịch sử cảnh báo, polygon "Bão số 3 WIPHA" và timeline vẫn là mock.

---

## 4. API đã tích hợp (merge backend) — theo từng component

> Backend là NestJS + PostGIS (xem `backend/` và `CLAUDE.md` ở gốc repo). Đánh số API theo tài liệu thiết kế.

| Component | API đã gọi | Endpoint | Hàm trong `api.ts` |
|---|---|---|---|
| **Login.tsx** | API 1 — Đăng nhập | `POST /auth/login` | `apiLogin` |
| **Sidebar.tsx** | API 3 — Đăng xuất | `POST /auth/logout` | `apiLogout` |
| **AccountsView.tsx** | API 5 — DS người dùng | `GET /users` | `apiListUsers` |
| | API 6 — Tạo người dùng | `POST /users` | `apiCreateUser` |
| | API 7 — Sửa / bật-tắt hoạt động | `PATCH /users/:id` | `apiUpdateUser` |
| | API 8 — Xóa người dùng | `DELETE /users/:id` | `apiDeleteUser` |
| | API 9 — Đổi vai trò | `PUT /users/:id/role` | `apiChangeRole` |
| | API 11 — DS vai trò | `GET /roles` | `apiListRoles` |
| **StationsView.tsx** | API 12 — DS trạm (phân trang, lọc) | `GET /stations` | `apiListStations` |
| | API 14 — Tạo trạm | `POST /stations` | `apiCreateStation` |
| | API 15 — Sửa trạm | `PUT /stations/:id` | `apiUpdateStation` |
| | API 16 — Xóa mềm trạm | `DELETE /stations/:id` | `apiDeleteStation` |
| | API 17 — Đặt ngưỡng lũ | `PUT /stations/:id/thresholds` | `apiSetStationThresholds` |
| | (phụ trợ) DS tỉnh/thành | `GET /provinces` | `apiListProvinces` |
| **MapView.tsx** | (Group C) Trạm theo khung nhìn | `GET /stations/viewport` | `apiListStationsInViewport` |
| | API 37 — Dự báo tổng hợp tỉnh (scrubber "Mốc dự báo") | `GET /forecasts/provinces/:id` | `apiGetProvinceForecast` |
| | API 38 — Dự báo 7 ngày theo trạm (panel chi tiết) | `GET /forecasts/stations/:id` | `apiGetStationForecast` |
| | API 39 — Lịch sử cảnh báo theo trạm (panel chi tiết) | `GET /stations/:id/alert-history` | `apiGetStationAlertHistory` |
| **ForecastView.tsx** | API 36 — DS trạm nguy cơ 5–7 ngày | `GET /risk/stations` | `apiListRiskStations` |
| | API 12 — Tổng số trạm (KPI "Trạm theo dõi") | `GET /stations` | `apiListStations` |
| **HealthView.tsx** | API 35 — Sức khỏe nguồn ngoài | `GET /integrations/health` | `apiGetIntegrationsHealth` |
| **Topbar.tsx** | API 35 — Chip nguồn chính *(Admin)* | `GET /integrations/health` | `apiGetIntegrationsHealth` |
| | API 31 — Đồng bộ thời tiết thủ công *(Admin)* | `POST /weather/refresh` | `apiRefreshWeather` |

**Nhóm API theo backend:** A — Auth (1,3) · B — Accounts/RBAC (5–11) · C — Stations & provinces (12–17 + viewport) · F — Weather integration (31, 35) · **G — Risk/Forecast (36 ở ForecastView; 37/38/39 ở MapView)**.

**Lưu ý về ForecastView (Group G):** gọi `apiListRiskStations({ size: 100, sort: 'severity', includeLow: true })` — **`size` phải ≤ 100** vì DTO backend giới hạn `@Max(100)` (gửi >100 → `400` → rơi về mock). Nếu Risk Engine chưa có dữ liệu / call lỗi, view **giữ dữ liệu mẫu** và đổi chip thành "Dữ liệu mẫu"; có dữ liệu thật → "Dữ liệu trực tiếp". 2 KPI *Nguy cơ Cao (≥50) / Rất cao (≥70)* hiện đếm từ trang đã tải (top 100 theo điểm) — chính xác cho nhóm điểm cao nhất, chưa phải tổng toàn mạng.

**Lưu ý về Topbar (Group F):** chip + nút đồng bộ **chỉ hiện với Admin** (vai trò khác bị ẩn). Chip poll API 35 định kỳ nhưng **chỉ phản ánh nguồn chính** (Open-Meteo + GDACS); các nguồn còn lại là fallback nên DOWN không cảnh báo. Nút đồng bộ xử lý `429` (đang có lượt chạy) riêng.

**Đã định nghĩa trong `api.ts` nhưng component chưa dùng:** `apiMe` (`GET /auth/me`), `apiGetWeatherJob` (`GET /weather/refresh/:jobId`), `apiGetStation` (`GET /stations/:id`), `apiListAllStations` (tải hết theo trang — giữ làm fallback của viewport). *(Group G đã dùng hết: 36 ở ForecastView, 37/38/39 ở MapView.)*

### Phần **còn mock** (chưa merge — chờ nhóm API khác)
- **EventsView.tsx** — sự kiện thiên tai & phạm vi N–N (chờ Group D).
- **ImportView.tsx** — import CSV theo lô (chờ API import + BullMQ).
- **MapView.tsx** (một phần) — panel chi tiết (dự báo 7 ngày, lịch sử cảnh báo) và scrubber "Mốc dự báo" **đã là thật** (API 38/39/37); còn mock: lớp overlay thời tiết/mưa/gió (chờ **API 29** weather-tiles), lớp lũ + panel "Cảnh báo nguy cơ" (đọc `riskScore`/`weather` mà `GET /stations/viewport` chưa trả), và polygon "Bão số 3 WIPHA" (chờ Group D).
- **ForecastView.tsx** (một phần) — nút *Xuất Word / Xuất PDF* mới chỉ hiện toast (chờ API render báo cáo); bảng dữ liệu đã là thật (API 36).
- **Realtime:** **chưa có Socket.IO client** — gateway risk (API 44–47) hiện chỉ ở backend.

---

## 5. Cách chạy

> Yêu cầu: **Node.js ≥ 20** (khuyến nghị 22) và npm. Để các màn hình đã merge hoạt động, **cần backend đang chạy** (mặc định `http://localhost:3000`, xem `backend/`), và DB đã seed (CSV trong `data/`).

Mọi lệnh chạy trong thư mục `frontend/app`:

```bash
cd frontend/app

# 1. Cài dependencies (lần đầu)
npm install

# 2. (Tùy chọn) trỏ tới backend khác mặc định
echo "VITE_API_BASE=http://localhost:3000" > .env.local

# 3. Chạy môi trường phát triển (HMR) — mặc định http://localhost:5173
npm run dev

# 4. Build production (type-check rồi bundle vào dist/)
npm run build

# 5. Xem thử bản build / kiểm tra lint
npm run preview
npm run lint
```

| Script | Mô tả |
|---|---|
| `npm run dev` | Khởi động Vite dev server kèm hot reload |
| `npm run build` | `tsc -b` (type-check) + `vite build` → xuất `dist/` |
| `npm run preview` | Phục vụ thư mục `dist/` để xem thử |
| `npm run lint` | Chạy ESLint trên toàn bộ mã nguồn |

### Đăng nhập
Login gọi **`POST /auth/login` thật**: nhập username/password của tài khoản trong DB (seed ở `data/`). Vai trò trả về từ backend quyết định mục được mở khóa trên sidebar. *(Tài khoản chưa được tạo/seed thì không đăng nhập được — đây không còn là đăng nhập giả lập.)*

---

## 6. Ghi chú trạng thái mã nguồn

- ✅ **Type-check (`tsc -b`) sạch**, `vite build` chạy được.
- ⚠️ **`npm run lint` có baseline 4 vấn đề (chấp nhận, không chặn build):**
  - `react-refresh/only-export-components` tại [`AppStateContext.tsx`](app/src/state/AppStateContext.tsx) (vừa export component vừa export hook `useApp`).
  - `react-hooks/set-state-in-effect` ×3 — 2 ở `StationsView.tsx`, 1 ở `HealthView.tsx` (gọi `setState` đồng bộ trong effect khi tải dữ liệu).
  - **Quy ước khi merge API mới:** đặt `setState` trong callback async/event/timer (không đặt thẳng trong thân effect) để không tăng số cảnh báo này — luồng fetch theo viewport của Map làm đúng mẫu đó.
- Các màn hình đã merge ghi dữ liệu **thật** xuống backend (tạo/sửa/xóa trạm, đổi vai trò…). Các màn hình còn mock vẫn chỉ hiển thị toast mô phỏng; khi tích hợp tiếp, thêm hàm vào `api.ts` rồi thay phần đọc `mockData.ts` trong component tương ứng.

---

## 7. Lịch sử thay đổi gần đây (đồng bộ với backend)

### Nhóm G — merge Forecast/AlertHistory vào panel & scrubber của **MapView**
- **Panel chi tiết trạm** chuyển từ mock → **API thật**: 4 ô số liệu + biểu đồ 7 ngày ← **API 38** (`apiGetStationForecast`); timeline lịch sử cảnh báo ← **API 39** (`apiGetStationAlertHistory`). Bỏ `sel.weather`, `forecast7d`, và lịch sử hardcode.
- **Proxy cho stat tiles:** spec không có endpoint "thời tiết hiện tại theo trạm" → 4 ô lấy điểm dự báo **"hôm nay"** (`series[0]`). Ô **Độ ẩm → Mực nước sông** (`river_water_level`) vì schema `weather_forecasts` không có cột độ ẩm.
- **Thanh "Mốc dự báo" (scrubber)** wiring **API 37** (`apiGetProvinceForecast`) theo **tỉnh của trạm đang chọn** (keyed theo `provinceId` → không refetch khi pan): cột cao theo lượng mưa, nhãn ngày thật (thứ + d/M), badge xanh hiện **tên tỉnh** đang dùng, và **readout đầy đủ 4 trường** của ngày đang kéo (nhiệt độ · mưa · gió + hướng la bàn · mực nước sông) + tooltip mỗi cột. Chưa chọn trạm hoặc lỗi → tự về bars mock 7 ngày.
- Thêm `scrubDayCount` vào `AppState` ([`AppStateContext.tsx`](app/src/state/AppStateContext.tsx)) để nút **Play** cycle đúng số ngày thật (5–7) thay vì cố định `% 7`.

### Nhóm G — merge Risk/Forecast vào **ForecastView**
- Thêm client + type Nhóm G vào [`api.ts`](app/src/lib/api.ts): `apiListRiskStations` (API 36), `apiGetProvinceForecast` (37), `apiGetStationForecast` (38), `apiGetStationAlertHistory` (39); kèm type `RiskAssessment`, `RiskSeverity`, `ForecastPoint`, `ClassifiedForecastPoint`, `AlertHistoryEntry` trong [`types.ts`](app/src/types.ts).
- **ForecastView** chuyển từ mock → **API 36 thật** (mock làm fallback): nhóm các bản ghi rủi ro theo trạm → sparkline 5–7 ngày + ngày đỉnh; tổng số trạm lấy từ API 12.
- **Thang điểm rủi ro chuẩn hóa 0–100** trong [`mockData.ts`](app/src/data/mockData.ts) để khớp `risk_score` của backend (severity `LOW/MEDIUM/HIGH`); `MapView` đổi ngưỡng/bán kính theo thang mới.

### Nhóm F — đổi nguồn dữ liệu (ảnh hưởng Health & Topbar)
- **Chuỗi dự báo** backend: `Open-Meteo → MET Norway → WeatherAPI` (**đã bỏ OpenWeatherMap**). **Chuỗi thiên tai**: `GDACS → ReliefWeb → EONET`. **Mực nước sông**: GloFAS (Copernicus).
- **HealthView** — cập nhật `SOURCE_META` cho khớp 7 `code` mà API 35 trả: `OpenMeteo, MetNorway, WeatherAPI, GDACS, ReliefWeb, EONET, GloFAS` (bỏ `OpenWeatherMap`; thêm MET Norway / ReliefWeb / GloFAS với nhãn tiếng Việt). Nguồn thiếu key/appname hiển thị *Chưa cấu hình*.
- **Topbar** — chip "nguồn chính" đổi sang **Open-Meteo + GDACS** (trước là Open-Meteo + EONET).

### Sửa lỗi
- **ForecastView nạp dữ liệu mẫu dù backend có dữ liệu:** do gọi `size: 200` vượt `@Max(100)` của DTO → backend trả `400` → rơi vào nhánh fallback mock. Đã hạ `size` xuống **100**.
