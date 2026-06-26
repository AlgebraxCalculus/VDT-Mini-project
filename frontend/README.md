# VTNet FWS — Frontend (Flood Warning System)

Giao diện web cho hệ thống **Cảnh báo lũ (Flood Warning System)** của VTNet: giám sát thời tiết thời gian thực, dự báo nguy cơ ngập theo trạm, quản lý nhà trạm / sự kiện thiên tai và phân quyền người dùng.

> **Trạng thái tích hợp (đang chuyển từ prototype → kết nối backend thật):**
> Một số màn hình đã **gọi API NestJS thật** qua [`app/src/lib/api.ts`](app/src/lib/api.ts) — **Login, Accounts, Stations, Map, Health** và nút đồng bộ/health trên **Topbar**. Các màn hình còn lại (**Events, Import, Forecast**) cùng một số phần của Map (lớp thời tiết, lớp lũ, dự báo 7 ngày, lịch sử cảnh báo, polygon sự kiện) **vẫn dùng dữ liệu mock** trong [`app/src/data/mockData.ts`](app/src/data/mockData.ts) vì phụ thuộc các nhóm API chưa xây (Risk Engine/Group G, sự kiện/Group D…). Xem bảng chi tiết ở **mục 4 — API đã tích hợp**.

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
            ├── MapView.tsx      # Bản đồ Leaflet: trạm (GET /stations/viewport) + lớp thời tiết/lũ/timeline (mock)
            ├── ForecastView.tsx # Bảng dự báo nguy cơ ngập 7 ngày (mock)
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
| **HealthView.tsx** | API 35 — Sức khỏe nguồn ngoài | `GET /integrations/health` | `apiGetIntegrationsHealth` |
| **Topbar.tsx** | API 35 — Chip nguồn chính *(Admin)* | `GET /integrations/health` | `apiGetIntegrationsHealth` |
| | API 31 — Đồng bộ thời tiết thủ công *(Admin)* | `POST /weather/refresh` | `apiRefreshWeather` |

**Nhóm API theo backend:** A — Auth (1,3) · B — Accounts/RBAC (5–11) · C — Stations & provinces (12–17 + viewport) · F — Weather integration (31, 35).

**Lưu ý về Topbar (Group F):** chip + nút đồng bộ **chỉ hiện với Admin** (vai trò khác bị ẩn). Chip poll API 35 định kỳ nhưng **chỉ phản ánh nguồn chính** (Open-Meteo + EONET); 3 nguồn còn lại là fallback nên DOWN không cảnh báo. Nút đồng bộ xử lý `429` (đang có lượt chạy) riêng.

**Đã định nghĩa trong `api.ts` nhưng component chưa dùng:** `apiMe` (`GET /auth/me`), `apiGetWeatherJob` (`GET /weather/refresh/:jobId`), `apiGetStation` (`GET /stations/:id`), `apiListAllStations` (tải hết theo trang — giữ làm fallback của viewport).

### Phần **còn mock** (chưa merge — chờ nhóm API khác)
- **EventsView.tsx** — sự kiện thiên tai & phạm vi N–N (chờ Group D).
- **ImportView.tsx** — import CSV theo lô (chờ API import + BullMQ).
- **ForecastView.tsx** — dự báo nguy cơ ngập 7 ngày (chờ Group F snapshot + Group G risk).
- **MapView.tsx** (một phần) — lớp thời tiết/lũ, biểu đồ dự báo, lịch sử cảnh báo, polygon sự kiện, và mọi thứ phụ thuộc `riskScore`/`weather`.
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
```
