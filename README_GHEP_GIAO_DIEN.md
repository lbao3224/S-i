# SỔ ƠI V2: Trang giới thiệu gốc + quản lý V2

- `/`: Next.js landing page từ mã nguồn gốc chị cung cấp.
- Nút **Mở Sổ Ơi** (`/app`): chuyển tới `/v2/index.html` — app V2.
- Đăng nhập trên landing: mở trực tiếp màn đăng nhập V2, để không có hai hệ thống đăng nhập.
- Trang quản lý V2 là HTML/JS có sẵn trong `public/v2/`, không sửa web production.
- Nút mic ngoài sidebar bị ẩn trên desktop, giữ các nút mic trong trợ lý và mobile.

## Chạy
1. Cài Node.js 20+ theo yêu cầu Next 16 (Node >=20.9).
2. Mở CMD tại thư mục dự án rồi chạy `npm ci` và `npm run dev`.
3. Mở `http://localhost:3000`. **Không** chạy Python http.server ở root vì Next.js cần máy chủ Next.
4. Để thử Supabase: mở `public/v2/supabase-env.js`, điền chính xác URL và public publishable key của project test; không thêm `/rest/v1/`.
5. AUTO_SYNC mặc định false. Cần kiểm thử RLS và sync trước khi sử dụng dữ liệu thật.
6. Deploy vào Vercel **project mới**, tuyệt đối không sửa `sooi.vercel.app`. Framework Next.js.

## Giới hạn
Đây là bản ghép hai giao diện, giữ JavaScript đồng bộ Safe Retry; chưa kiểm thử full E2E, không cam kết kho/công nợ an toàn khi hai thiết bị thao tác đồng thời. Không có key Supabase được cung cấp trong ZIP.
