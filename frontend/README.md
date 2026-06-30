# VTNet FWS — Frontend (Flood Warning System)

Giao diện web cho hệ thống **Cảnh báo lũ (Flood Warning System)** của VTNet: giám sát thời tiết thời gian thực, dự báo nguy cơ ngập theo trạm, quản lý nhà trạm / sự kiện thiên tai và phân quyền người dùng.

> **Trạng thái tích hợp (đang chuyển từ prototype → kết nối backend thật):**
> Các màn hình đã **gọi API NestJS thật** qua [`app/src/lib/api.ts`](app/src/lib/api.ts) — **Login, Accounts, Stations, Map, Health, Forecast, Events, Import** và chip nguồn/đồng bộ trên **Topbar**. Riêng **Map** nay đã merge sâu hơn: panel chi tiết trạm (dự báo 7 ngày + lịch sử cảnh báo, **API 38/39**), thanh "Mốc dự báo" cấp tỉnh (**API 37**) đều là dữ liệu thật, và **realtime WebSocket (API 44–47)** đã nối qua [`app/src/lib/realtime.ts`](app/src/lib/realtime.ts) — đẩy `risk:delta` vào trạm đang hiển thị + chip "Trực tiếp". **Events** (**Nhóm D**): danh sách (**API 20**) + drawer phạm vi (**API 26**) + gán/khoanh vùng thủ công (**API 25**) — sự kiện **tự động tracking** từ chuỗi thiên tai (GDACS→ReliefWeb→EONET), **không còn form tạo tay**. **Import** (**Nhóm C, API 18–19**): chọn CSV → tiền kiểm định dạng phía client → upload async (BullMQ) → poll tiến độ + báo cáo. **Stations** (**Nhóm H, API 40–43**): nút "Xuất báo cáo" → tạo báo cáo danh sách trạm theo bộ lọc đang xem → poll → tải **CSV** hoặc mở **HTML in được (PDF)**. Các phần **còn mock**: lớp thời tiết/lũ overlay của Map và panel "Cảnh báo nguy cơ" (phụ thuộc `riskScore`/`weather` mà `GET /stations/viewport` chưa trả) — xem [`app/src/data/mockData.ts`](app/src/data/mockData.ts). Xem bảng chi tiết ở **mục 4 — API đã tích hợp** và lịch sử thay đổi ở **mục 7**.

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
        │   ├── realtime.ts      # Socket.IO client (API 44–47): subscribe viewport, risk:delta, trạng thái kết nối
        │   ├── csv.ts           # Tiền kiểm CSV phía client cho Import (parse + validate định dạng, file mẫu)
        │   └── role.ts          # RBAC: thứ hạng vai trò, khóa route, cầu nối RoleCode ↔ FE
        ├── data/
        │   └── mockData.ts      # Dữ liệu mock (phần chưa có API: weather, risk, events, import…)
        └── components/
            ├── Login.tsx        # Đăng nhập thật (POST /auth/login)
            ├── Sidebar.tsx      # Điều hướng trái + khóa mục theo quyền + đăng xuất (POST /auth/logout)
            ├── Topbar.tsx       # Tiêu đề trang; chip nguồn (API 35) + đồng bộ thời tiết (API 31) — chỉ Admin
            ├── Toast.tsx        # Thông báo nổi
            ├── MapView.tsx      # Bản đồ Leaflet: trạm (GET /stations/viewport) + panel chi tiết (API 38/39) + scrubber tỉnh (API 37) + realtime risk:delta (API 44–47); lớp thời tiết/lũ overlay vẫn mock
            ├── ForecastView.tsx # Bảng dự báo nguy cơ ngập 5–7 ngày (GET /risk/stations — API 36; mock làm fallback)
            ├── StationsView.tsx # CRUD nhà trạm (GET/POST/PUT/DELETE /stations + thresholds + provinces) + Xuất báo cáo (API 40–43): tạo → poll → tải CSV / in HTML (PDF)
            ├── ImportView.tsx   # Nhập trạm hàng loạt thật (API 18/19): CSV → tiền kiểm client → upload async → poll báo cáo
            ├── EventsView.tsx   # Sự kiện thiên tai (GET /events — API 20) + drawer phạm vi (API 26) + gán scope (API 25); auto-tracking, không có form tạo
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
- Panel chi tiết (dự báo 7 ngày **API 38**, lịch sử cảnh báo **API 39**) và scrubber "Mốc dự báo" cấp tỉnh (**API 37**) đã là **dữ liệu thật**. Còn mock: lớp overlay thời tiết/mưa/gió, lớp lũ + panel "Cảnh báo nguy cơ" (đọc `riskScore`/`weather` mà viewport chưa trả) đọc null-safe nên hiển thị `—`, và polygon sự kiện trên bản đồ.

### Realtime — [`lib/realtime.ts`](app/src/lib/realtime.ts)
- **Một kết nối Socket.IO dùng chung/tab** (gateway risk-delta của backend nói giao thức Socket.IO, không phải WebSocket thuần). JWT gửi qua `auth.token` dạng **callback** → token được đọc lại mỗi lần reconnect (tự bắt token đã xoay vòng).
- `MapView` `subscribe:viewport` theo đúng BBOX đang xem (re-subscribe khi pan/zoom, `unsubscribe` khi unmount), **merge `risk:delta`** vào đúng trạm trong tầm nhìn, và hiển thị **chip trạng thái** (Trực tiếp / Đang kết nối / Mất kết nối). Socket bị **đóng khi đăng xuất** (`closeRiskSocket` trong Sidebar).

### Import — [`ImportView.tsx`](app/src/components/ImportView.tsx) + [`lib/csv.ts`](app/src/lib/csv.ts)
- 4 bước: chọn CSV → **tiền kiểm định dạng phía client** (`previewCsv`: parse + bảng hợp lệ/lỗi, **chỉ cảnh báo**, alias header + khoảng tọa độ VN soi gương backend) → `apiImportStations` upload file gốc (multipart) → **poll** `apiGetImportJob` lấy tiến độ + báo cáo (số thành công/lỗi + bảng dòng bị bỏ qua + nút tải CSV lỗi). Backend mới là nơi validate có thẩm quyền. `runImport` (mock cũ trong `AppStateContext`) **không còn dùng**.

---

## 4. API đã tích hợp (merge backend) — theo từng component

> Backend là NestJS + PostGIS (xem `backend/` và `CLAUDE.md` ở gốc repo). Đánh số API theo tài liệu thiết kế.

| Component | API đã gọi | Endpoint | Hàm trong `api.ts` |
|---|---|---|---|
| **Login.tsx** | API 1 — Đăng nhập | `POST /auth/login` | `apiLogin` |
| **Sidebar.tsx** | API 3 — Đăng xuất | `POST /auth/logout` | `apiLogout` |
| | API 36 — Badge "Dự báo": số trạm nguy cơ hôm nay | `GET /risk/stations?from=to=hôm nay` | `apiListRiskStations` |
| | API 20 — Badge "Sự kiện": số sự kiện đang hoạt động | `GET /events?status=ONGOING` | `apiListEvents` |
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
| | API 40 — Tạo báo cáo danh sách trạm | `POST /reports` | `apiCreateReport` |
| | API 42 — Trạng thái job báo cáo (poll) | `GET /reports/:jobId` | `apiGetReportJob` |
| | API 43 — Tải file báo cáo (CSV / HTML) | `GET /reports/:jobId/download` | `apiDownloadReport` |
| | (phụ trợ) DS tỉnh/thành | `GET /provinces` | `apiListProvinces` |
| **ImportView.tsx** | API 18 — Import trạm hàng loạt (CSV) | `POST /stations/import` | `apiImportStations` |
| | API 19 — Trạng thái job + báo cáo | `GET /stations/import/:jobId` | `apiGetImportJob` |
| **MapView.tsx** | (Group C) Trạm theo khung nhìn | `GET /stations/viewport` | `apiListStationsInViewport` |
| | API 37 — Dự báo tổng hợp tỉnh (scrubber "Mốc dự báo") | `GET /forecasts/provinces/:id` | `apiGetProvinceForecast` |
| | API 38 — Dự báo 7 ngày theo trạm (panel chi tiết) | `GET /forecasts/stations/:id` | `apiGetStationForecast` |
| | API 39 — Lịch sử cảnh báo theo trạm (panel chi tiết) | `GET /stations/:id/alert-history` | `apiGetStationAlertHistory` |
| | API 44–47 — Realtime risk:delta theo viewport | `WS /socket.io` (Socket.IO) | `subscribeViewport`/`onRiskDelta`/`onRealtimeStatus` *(realtime.ts)* |
| **EventsView.tsx** | API 20 — DS sự kiện (+ số tỉnh/trạm) | `GET /events` | `apiListEvents` |
| | API 26 — Phạm vi: tỉnh + trạm (phân trang) | `GET /events/:id/stations` | `apiGetEventStations` |
| | API 25 — Gán/khoanh vùng phạm vi *(OP/Admin)* | `POST /events/:id/impact` | `apiAssignImpact` |
| | (phụ trợ) DS tỉnh/thành cho multiselect | `GET /provinces` | `apiListProvinces` |
| **ForecastView.tsx** | API 36 — DS trạm nguy cơ 5–7 ngày | `GET /risk/stations` | `apiListRiskStations` |
| | API 12 — Tổng số trạm (KPI "Trạm theo dõi") | `GET /stations` | `apiListStations` |
| | API 20 — Số sự kiện đang hoạt động (KPI) | `GET /events?status=ONGOING` | `apiListEvents` |
| | API 40/42/43 — Xuất báo cáo nguy cơ (Word/PDF) | `POST /reports` + poll + download | `exportReport` *(report.ts)* |
| **HealthView.tsx** | API 35 — Sức khỏe nguồn ngoài | `GET /integrations/health` | `apiGetIntegrationsHealth` |
| **Topbar.tsx** | API 35 — Chip nguồn chính *(Admin)* | `GET /integrations/health` | `apiGetIntegrationsHealth` |
| | API 31 — Đồng bộ thời tiết thủ công *(Admin)* | `POST /weather/refresh` | `apiRefreshWeather` |

**Nhóm API theo backend:** A — Auth (1,3) · B — Accounts/RBAC (5–11) · C — Stations & provinces (12–17 + viewport) + **Import (18, 19 ở ImportView)** · **D — Events (20, 25, 26 ở EventsView)** · F — Weather integration (31, 35) · **G — Risk/Forecast (36 ở ForecastView; 37/38/39 ở MapView)** · **H — Báo cáo (40, 42, 43 ở StationsView + ForecastView qua `report.ts`)** · **I — Realtime WebSocket (44–47 ở MapView qua `realtime.ts`)**.

**Lưu ý về ForecastView (Group G):** gọi `apiListRiskStations({ size: 100, sort: 'severity', includeLow: true })` — **`size` phải ≤ 100** vì DTO backend giới hạn `@Max(100)` (gửi >100 → `400` → rơi về mock). Nếu Risk Engine chưa có dữ liệu / call lỗi, view **giữ dữ liệu mẫu** và đổi chip thành "Dữ liệu mẫu"; có dữ liệu thật → "Dữ liệu trực tiếp". 2 KPI *Nguy cơ Cao (≥50) / Rất cao (≥70)* hiện đếm từ trang đã tải (top 100 theo điểm) — chính xác cho nhóm điểm cao nhất, chưa phải tổng toàn mạng.

**Lưu ý về Topbar (Group F):** chip + nút đồng bộ **chỉ hiện với Admin** (vai trò khác bị ẩn). Chip poll API 35 định kỳ nhưng **chỉ phản ánh nguồn chính** (Open-Meteo + GDACS); các nguồn còn lại là fallback nên DOWN không cảnh báo. Nút đồng bộ xử lý `429` (đang có lượt chạy) riêng.

**Lưu ý về EventsView (Group D):** sự kiện thiên tai được **tự động tracking** từ chuỗi API thiên tai (GDACS→ReliefWeb→EONET) — **API 22 (tạo tay) đã bị gỡ**, view không còn form "Tạo sự kiện". Vòng đời chỉ có **2 trạng thái** `ONGOING`/`CLOSED` (bỏ draft/monitor); cột **"Mức độ" đã bỏ**; cột *Type* lấy từ `disasterType.name`. Drawer gọi **API 26** để hiển thị phạm vi (tỉnh + danh sách trạm N–N). **Lối vào ghi duy nhất** còn lại là **API 25**: chỉ **Operator/Admin** trên sự kiện **`ONGOING`** mới thấy multiselect tỉnh để gán/khoanh lại phạm vi (`provinceIds`) — lưu sẽ **thay thế** scope cũ và kích hoạt Risk Engine tính lại; Viewer hoặc sự kiện đã đóng chỉ xem chip read-only. Card hiển thị `provinceCount / stationCount` do backend trả kèm; sau khi lưu, số đếm được cập nhật **tại chỗ** (không reload, tránh nháy drawer).

**Đã định nghĩa trong `api.ts` nhưng component chưa dùng:** `apiMe` (`GET /auth/me`), `apiGetWeatherJob` (`GET /weather/refresh/:jobId`), `apiGetStation` (`GET /stations/:id`), `apiListAllStations` (tải hết theo trang — giữ làm fallback của viewport), `apiListReports` (**API 41** — lịch sử báo cáo, chưa hiển thị ở UI). *(Group G đã dùng hết: 36 ở ForecastView, 37/38/39 ở MapView. Group D: 20/25/26 dùng ở EventsView; API 25 cũng nhận `affectedArea` GeoJSON nhưng UI hiện chỉ dùng chế độ chọn tỉnh. Group C Import: 18/19 dùng ở ImportView. **Group H Báo cáo: 40/42/43 dùng ở StationsView (`station-inventory`) + ForecastView (`risk-summary`) qua `report.ts`**. Group I Realtime: 44–47 dùng ở MapView qua `realtime.ts`.)*

### Phần **còn mock** (chưa merge — chờ nhóm API khác)
- **MapView.tsx** (một phần) — panel chi tiết (dự báo 7 ngày, lịch sử cảnh báo), scrubber "Mốc dự báo" (API 38/39/37) và realtime risk:delta (API 44–47) **đã là thật**; còn mock: lớp overlay thời tiết/mưa/gió (chờ **API 29** weather-tiles), lớp lũ + panel "Cảnh báo nguy cơ" (đọc `riskScore`/`weather` mà `GET /stations/viewport` chưa trả), và polygon sự kiện trên bản đồ (chưa wiring `affectedArea` của Group D vào layer Leaflet — drawer của EventsView đã có scope thật).
- **Nhóm H — Xuất báo cáo (API 40–43):** **backend đã xong** và **đã nối UI ở 2 chỗ**: **StationsView** xuất `station-inventory` (CSV / HTML in được), **ForecastView** xuất `risk-summary` (nút *Xuất Word* tải `.doc`, *Xuất PDF* mở bản in). Còn lại ở dạng "có API chưa gắn UI": **lịch sử báo cáo** (API 41) chưa có màn hình riêng.

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

### Sidebar — badge điều hướng dùng dữ liệu thật (API 36 + 20) *(mới nhất)*
- Gỡ 2 badge **mock cứng** (`'8'` ở "Dự báo nguy cơ ngập", `'2'` ở "Sự kiện thiên tai") trong [`Sidebar.tsx`](app/src/components/Sidebar.tsx).
- Badge **Dự báo** = số trạm nguy cơ **hôm nay** (`apiListRiskStations({from:today,to:today})` — cửa sổ 1 ngày ⇒ ~1 dòng/trạm, ẩn LOW); badge **Sự kiện** = số sự kiện `ONGOING` (`apiListEvents`). Hiển thị `99+` khi vượt 99, **ẩn khi = 0**. Tên/vai trò người dùng vốn đã là thật (`currentUser`).

### Nhóm H — merge **StationsView** + **ForecastView** vào API xuất báo cáo (API 40–43)
- Thêm client + type vào [`api.ts`](app/src/lib/api.ts): `apiCreateReport` (**API 40**), `apiListReports` (**API 41**), `apiGetReportJob` (**API 42**), `apiDownloadReport` (**API 43**, trả `Blob` + tên file đọc từ `Content-Disposition`, tự refresh 401); kèm type `ReportKind`, `ReportFormat`, `ReportMeta`, `ReportStatus`, `ReportSummary`, `CreateReportPayload`. Helper dùng chung ở [`lib/report.ts`](app/src/lib/report.ts): `exportReport` (tạo → poll → tải/in) + `pollReportJob`/`downloadBlob`/`printHtmlBlob`.
- **StationsView** thêm nút **"Xuất báo cáo"** (Viewer+) với menu **CSV** / **Tài liệu in (PDF)**: tạo báo cáo `station-inventory` theo **đúng bộ lọc đang xem** (`provinceId`/`q`) → tải CSV hoặc mở HTML in được rồi `print()`.
- **ForecastView** nối 2 nút **Xuất Word / Xuất PDF** (trước chỉ là toast) vào báo cáo `risk-summary`: *Word* tải file `.doc` (Word mở HTML), *PDF* mở bản in. KPI **"Sự kiện đang hoạt động"** chuyển từ mock `EVENTS` → **API 20** (`GET /events?status=ONGOING`, đọc `total`).
- Backend render **CSV** (BOM cho Excel) hoặc **HTML in được** — "PDF/Word" không thêm thư viện. **Tối ưu tốc độ:** query `station-inventory` đổi từ `LATERAL` (chạy 1 lần/trạm ⇒ 10k lần) sang **CTE gộp sẵn** ngưỡng + nguy cơ (nhanh hơn nhiều ở 10k trạm). Lịch sử báo cáo (API 41) đã có ở backend nhưng **chưa gắn UI**.

### Nhóm C — merge **ImportView** vào API thật (import CSV async, API 18–19)
- Thêm [`lib/csv.ts`](app/src/lib/csv.ts): `previewCsv` (parse + tiền kiểm định dạng phía client — alias header, khoảng tọa độ VN, trùng mã trong file; **chỉ cảnh báo**, backend mới có thẩm quyền) + `SAMPLE_CSV` (file mẫu tải xuống).
- Thêm client + type vào [`api.ts`](app/src/lib/api.ts): `apiImportStations` (**API 18**, multipart, tự refresh 401) và `apiGetImportJob` (**API 19**); kèm type `ImportReport`, `ImportRowError`, `ImportStatus`. Export `API_BASE` để dùng chung.
- **ImportView** chuyển từ mock → **luồng thật**: chọn file CSV → bảng preview hợp lệ/lỗi → upload → **poll** tiến độ (`progress`) + báo cáo cuối (success/failed + bảng dòng bị bỏ qua + tải CSV lỗi). `runImport`/timer mock trong [`AppStateContext.tsx`](app/src/state/AppStateContext.tsx) **không còn được dùng**.

### Nhóm I — merge **Realtime WebSocket** vào MapView (API 44–47)
- Thêm `socket.io-client` (khớp `socket.io@4` của backend) và [`lib/realtime.ts`](app/src/lib/realtime.ts): kết nối Socket.IO dùng chung (JWT qua `auth.token` callback), `subscribeViewport`/`unsubscribeViewport` (API 45/47), `onRiskDelta` (API 46), `onRealtimeStatus`, `closeRiskSocket`.
- **MapView** mở 1 kết nối, `subscribe:viewport` theo BBOX (re-subscribe khi pan/zoom), **merge `risk:delta`** vào trạm đang hiển thị (cập nhật `riskStatus`/`severity`), hiển thị **chip trạng thái live**. **Sidebar** gọi `closeRiskSocket()` khi đăng xuất.

### Nhóm D — merge **EventsView** vào API thật (sự kiện auto-tracking)
- **Thay đổi thiết kế:** **bỏ tạo sự kiện thủ công (API 22)** — sự kiện nay được backend **tự động tracking** từ chuỗi thiên tai GDACS→ReliefWeb→EONET (cron `DISASTER_CRON`, tự gán scope N–N). Form "Tạo sự kiện thiên tai" trong [`EventsView.tsx`](app/src/components/EventsView.tsx) đã được **gỡ bỏ**, thay bằng badge "Tự động cập nhật từ GDACS · ReliefWeb · EONET".
- Thêm client + type Nhóm D vào [`api.ts`](app/src/lib/api.ts): `apiListEvents` (**API 20**), `apiGetEventStations` (**API 26**), `apiAssignImpact` (**API 25**); kèm type `ApiEvent`, `EventStatus`, `EventScope`, `EventScopeProvince`, `EventScopeStation`, `PaginatedEvents`, `AssignImpactPayload`, `GeoJsonPolygon`.
- **EventsView** chuyển từ mock → **API 20 thật**: tabs Đang hoạt động / Lịch sử / Tất cả đếm theo `status` (`ONGOING`/`CLOSED`); mỗi card hiển thị `eventCode · disasterType.name · ngày bắt đầu` và số `tỉnh / trạm`.
- **Rút gọn state model** về `ONGOING`/`CLOSED` (bỏ draft/monitor); **bỏ cột "Mức độ" (severity)**; *Type* lấy từ `disasterType.name`.
- **Drawer phạm vi ảnh hưởng** dùng **API 26** (`apiGetEventStations`): stepper vòng đời, danh sách tỉnh + trạm N–N (badge rủi ro mỗi trạm), phân trang trạm.
- **Lối vào ghi (API 25):** chỉ **Operator/Admin** trên sự kiện `ONGOING` thấy **multiselect tỉnh** để gán/khoanh lại phạm vi → `apiAssignImpact({ provinceIds })` **thay thế** scope cũ và kích hoạt Risk Engine; lưu xong cập nhật số đếm **tại chỗ**. Viewer / sự kiện đã đóng chỉ xem chip read-only.

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
