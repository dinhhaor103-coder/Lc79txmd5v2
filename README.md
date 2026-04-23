# TOOL VIP VI LONG - SUPER AI LC79 V9.3

## Changelog v9.3 (đã fix)
- **server.js — LỖI NGHIÊM TRỌNG**: parser API đọc sai field name. Tele68 trả `dices: [d1,d2,d3]` và `point` (tổng), nhưng code cũ đọc `dice1/dice2/dice3` (không tồn tại) → `sum` luôn = 0 → rơi vào fallback dùng **tổng giả** (14 cho mọi phiên Tài, 7 cho mọi phiên Xỉu). Hậu quả: tất cả logic phân tích tổng thật + xúc xắc thật (L3, L5, L8, L14, L15, L16, L17, L18, L23) đều chạy trên dữ liệu rác. **Đã sửa: dùng đúng `x.dices[]` và `x.point`.**
- **prediction.js**:
  - Thêm `timestamp` vào history → `predictLogic19` hoạt động đúng (trước đây luôn `null`).
  - Sửa `predictLogic22` bỏ tham số thừa `cauLogData`.
  - Viết lại `analyzePatterns` (trước là stub) — giờ thực sự dùng `PATTERN_DATA`.
  - Mở rộng `ensembleVote` từ 9 → **24 logic** (nhóm phụ trọng số 0.5) + bonus pattern matcher.
- **server.js**:
  - Persist thêm `logicPerformance` (accuracy không reset sau restart).
  - `fetchGameData` log lỗi khi token Tele68 chết / API 4xx-5xx.
  - Tracking `FETCH_STATUS` per game; `/health` báo `503 degraded` khi fail ≥ 10 lần.
  - Hỗ trợ env `LC79_HU_API`, `LC79_MD5_API` để đổi token không cần sửa code.
  - Hỗ trợ env `DATA_DIR` để trỏ persistence vào Railway volume mount.


Backend dự đoán Tài Xỉu LC79 (lc79_hu & lc79_md5) — chạy trên Node.js + Express, sẵn sàng deploy lên Railway.

## Cấu trúc

```
.
├── server.js          # Express server + logic dự đoán (V3..V16, ensemble vote, đảo nhịp)
├── package.json
├── public/
│   └── index.html     # Giao diện god-pill (cùng origin với server)
├── Procfile
├── railway.json
└── .gitignore
```

## Endpoints

- `GET /predict/lc79_hu` — dự đoán phiên tới (Tài Xỉu Hủ)
- `GET /predict/lc79_md5` — dự đoán phiên tới (Tài Xỉu MD5)
- `GET /history/lc79_hu` — lịch sử dự đoán + tỉ lệ đúng
- `GET /history/lc79_md5`
- `GET /health`
- `GET /` — giao diện HTML

## Chạy local

```bash
npm install
npm start
# mở http://localhost:3000
```

## Push lên GitHub & Deploy Railway

1. Tạo repo mới trên GitHub.
2. Trong thư mục này:
   ```bash
   git init
   git add .
   git commit -m "init vi long ai v9.2"
   git branch -M main
   git remote add origin https://github.com/<USER>/<REPO>.git
   git push -u origin main
   ```
3. Vào https://railway.app → **New Project** → **Deploy from GitHub repo** → chọn repo vừa push.
4. Railway tự nhận diện Node.js, build và chạy `node server.js`. Không cần biến môi trường.
5. Sau khi deploy xong, vào **Settings → Networking → Generate Domain** để có URL public dạng `https://<ten>.up.railway.app`.

## Ghi chú

- Server tự fetch dữ liệu game mỗi 3 giây từ API Tele68.
- Lịch sử dự đoán được lưu trong RAM (mất khi restart). Muốn lâu dài có thể gắn DB sau.
- Logic dự đoán dịch trực tiếp từ userscript v9.2 (V3, V4, V5, V6, V7, V8, V11, V13, V14, V15, V16, ensemble vote, đảo nhịp 4 phiên, MD5 branch).
