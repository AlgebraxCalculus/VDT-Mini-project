# Frontend — Hệ thống Cảnh báo Ngập lụt (Flood Warning System)

Giao diện web (SPA) cho hệ thống cảnh báo ngập lụt: giám sát thời tiết thời gian thực, hiển thị nguy cơ ngập theo trạm trên bản đồ GIS, quản lý nhà trạm / sự kiện thiên tai và phân quyền người dùng.

---

## 1. Tổng quan

Ứng dụng phía client cung cấp toàn bộ trải nghiệm vận hành của hệ thống:

- **Bản đồ GIS (Leaflet):** trạm tô màu theo rủi ro thật, gộp cụm marker khi zoom-out, polygon vùng ảnh hưởng sự kiện, overlay thời tiết và cập nhật rủi ro **realtime** qua WebSocket.
- **Dự báo & cảnh báo:** bảng nguy cơ ngập 5–7 ngày, panel chi tiết trạm (chuỗi dự báo + lịch sử cảnh báo).
- **Quản trị:** CRUD nhà trạm + ngưỡng cảnh báo, import CSV hàng loạt, quản lý tài khoản & vai trò, theo dõi sức khỏe nguồn dữ liệu ngoài.
- **Xuất báo cáo:** danh sách trạm và tổng hợp nguy cơ ra CSV / HTML (in ra PDF/Word).

Toàn bộ màn hình gọi **API NestJS thật** qua một tầng REST tập trung; chuỗi UI bằng tiếng Việt.

---

## 2. Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Framework | React 19 |
| Ngôn ngữ | TypeScript ~6.0 |
| Build tool | Vite 8 (`@vitejs/plugin-react`) |
| Bản đồ | Leaflet 1.9 + leaflet.markercluster 1.5 |
| Realtime | socket.io-client 4 |
| Lint | ESLint 10 (flat config + typescript-eslint + react-hooks) |

**Không dùng** thư viện router, state manager hay UI framework ngoài: routing và state đều tự quản lý, styling viết inline + một file CSS toàn cục, tầng REST tự viết trong `lib/api.ts` (không axios/react-query).

### Kiến trúc rút gọn

- **Tầng API — `src/lib/api.ts`:** điểm vào REST duy nhất. Lưu cặp JWT trong `localStorage`, tự gắn `Authorization`, **tự refresh 1 lần khi gặp 401** rồi phát lại request. Thêm endpoint mới ở đây, không dùng `fetch` thô trong component.
- **State tập trung — `src/state/AppStateContext.tsx`:** một `AppState` cập nhật qua hàm `patch(p)`; hook `useApp()` đọc state + gọi action.
- **Routing — `src/App.tsx`:** không dùng react-router; `state.route` quyết định màn hình.
- **RBAC — `src/lib/role.ts`:** ba vai trò `viewer < operator < admin`, khóa mục sidebar theo quyền, cầu nối `RoleCode` backend ↔ mô hình FE.
- **Realtime — `src/lib/realtime.ts`:** một kết nối Socket.IO dùng chung, JWT qua `auth.token` callback, `subscribe:viewport` theo BBOX, merge `risk:delta` vào trạm đang hiển thị.

---

## 3. Yêu cầu & Cấu hình môi trường

- **Node.js ≥ 20** (khuyến nghị 22) + npm.
- Để các màn hình hoạt động cần **backend đang chạy** (mặc định `http://localhost:3000`) và DB đã seed.

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `VITE_API_BASE` | `http://localhost:3000` | Base URL của backend. Đặt **rỗng** khi triển khai Docker để dùng same-origin (nginx reverse-proxy API/WebSocket) |

Trỏ sang backend khác mặc định bằng `.env.local` trong `frontend/app`:

```bash
echo "VITE_API_BASE=http://localhost:3000" > .env.local
```

---

## 4. Chạy môi trường phát triển

Mọi lệnh chạy trong thư mục `frontend/app`:

```bash
cd frontend/app
npm install        # cài dependencies (lần đầu)
npm run dev        # Vite dev server + HMR → http://localhost:5173
```

| Script | Mô tả |
|---|---|
| `npm run dev` | Khởi động Vite dev server kèm hot reload |
| `npm run build` | `tsc -b` (type-check) + `vite build` → xuất `dist/` |
| `npm run preview` | Phục vụ thư mục `dist/` để xem thử bản build |
| `npm run lint` | Chạy ESLint trên toàn bộ mã nguồn |

> **Đăng nhập:** dùng tài khoản có thật trong DB (seed ở `data/`); vai trò trả về quyết định mục được mở khóa trên sidebar.
>
> **Trạng thái lint:** `npm run lint` có baseline **4 vấn đề** đã chấp nhận (set-state-in-effect ×3 + `react-refresh/only-export-components` ×1), không chặn build. Khi thêm dữ liệu vào view, giữ `setState` trong callback async/event/timer để không tăng số này.

---

## 5. Build & Triển khai

Tạo asset production (type-check rồi bundle):

```bash
cd frontend/app
npm run build      # xuất thư mục dist/ (HTML + JS + CSS đã tối ưu)
npm run preview    # (tùy chọn) xem thử bản build trước khi deploy
```

Thư mục `dist/` là **tĩnh hoàn toàn**, có thể phục vụ bằng bất kỳ web server nào (nginx, CDN, static hosting). Khi build cho môi trường same-origin (nginx proxy API), build với `VITE_API_BASE` rỗng để mọi lời gọi REST/WebSocket thành đường dẫn tương đối.

---

## 6. Triển khai bằng Docker

Frontend dùng **multi-stage build**:

- **Stage 1 (Node):** cài dependency và `npm run build` → tạo asset tĩnh trong `dist/`.
- **Stage 2 (Nginx):** copy `dist/` vào `nginx:alpine` và phục vụ. Cấu hình `nginx.conf` còn **reverse-proxy** các route API + `/socket.io` về container `api` → trình duyệt chỉ nói chuyện với một origin duy nhất (không CORS, không hardcode host API).

`Dockerfile` (tham khiếu — đã có sẵn trong `frontend/app`):

```dockerfile
# ---- Stage 1: build asset tĩnh ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_API_BASE=          # rỗng = same-origin (nginx proxy API/WebSocket)
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# ---- Stage 2: nginx phục vụ tĩnh + reverse proxy ----
FROM nginx:1.27-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
```

### Build & chạy container

```bash
cd frontend/app

# Build image (same-origin: VITE_API_BASE rỗng — nginx proxy API về container `api`)
docker build -t vdt-flood-web:latest .

# ...hoặc trỏ thẳng SPA tới một API đã publish:
docker build -t vdt-flood-web:latest --build-arg VITE_API_BASE=http://localhost:3000 .

# Chạy, map cổng 80 của container ra host
docker run -d --name vdt-flood-web -p 80:80 vdt-flood-web:latest
# Mở ứng dụng tại http://localhost
```

> **Same-origin cần backend cùng mạng Docker:** khi build với `VITE_API_BASE` rỗng, nginx proxy các route API/`/socket.io` tới host `api`. Chạy độc lập bằng `docker run` như trên sẽ **không** có upstream `api` — hãy dùng `docker compose` ở gốc `backend/` (đã orchestrate `db` + `redis` + `api` + `web` chung mạng, SPA phục vụ ở `http://localhost:8080`) hoặc build với `--build-arg VITE_API_BASE=<url API>` để trỏ thẳng.
