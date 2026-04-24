# Setup Máy Kia (Gửi Cho AI Bên Máy Thứ 2)

Mục tiêu: cài app trên máy thứ 2 để dùng **chung kho kiến thức** với máy chính.

Máy chính đã chạy sẵn:
- Qdrant domain: `https://qdrant-kb.vivutrade.io.vn`
- Assistant domain: `https://assistant-kb.vivutrade.io.vn`
- Qdrant API key: `hJLmXoBhi+Xg8YbctZC73zuv1BJryjaY`

---

## Prompt gửi cho AI ở máy thứ 2

Copy nguyên khối này:

```text
Bạn đang ở repo D:\mcp-local-first-ai-assistant trên máy thứ 2.
Hãy cài và chạy app theo shared-memory mode để dùng chung Qdrant từ máy chính.

Yêu cầu:
1) Chạy npm install
2) Chạy:
   npm run setup:shared-client -- --qdrant-url https://qdrant-kb.vivutrade.io.vn --qdrant-api-key hJLmXoBhi+Xg8YbctZC73zuv1BJryjaY
3) Chạy:
   npm run app:stop
   npm run app:start
4) Kiểm tra:
   npm run app:status
5) Verify kết nối shared memory:
   - GET http://localhost:3000/api/memory/stats (hoặc cổng thực tế nếu khác 3000)
   - phải trả JSON hợp lệ
6) Nếu lỗi, tự sửa tới khi chạy được, rồi báo:
   - nội dung .env.local quan trọng (MEMORY_PROVIDER, START_LOCAL_QDRANT, QDRANT_URL, QDRANT_API_KEY, PORT)
   - trạng thái PM2
   - kết quả gọi /api/memory/stats

Lưu ý:
- Máy thứ 2 KHÔNG chạy qdrant local (START_LOCAL_QDRANT=false)
- Không đổi domain/API key.
- Không sửa logic app, chỉ setup runtime cho chạy được.
```

---

## Lệnh tay (nếu bạn tự chạy trên máy thứ 2)

```powershell
cd D:\mcp-local-first-ai-assistant
npm install
npm run setup:shared-client -- --qdrant-url https://qdrant-kb.vivutrade.io.vn --qdrant-api-key hJLmXoBhi+Xg8YbctZC73zuv1BJryjaY
npm run app:stop
npm run app:start
npm run app:status
```

Test API local:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/memory/stats
```

---

## Troubleshoot nhanh cho AI

1. Nếu `pm2` chưa có:
```powershell
npm i -g pm2
```

2. Nếu lỗi policy PowerShell:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

3. Nếu port 3000 đã dùng:
- sửa `PORT` trong `.env.local` (ví dụ `3001`)
- gọi test theo port mới.

4. Nếu không kết nối được domain Qdrant:
```powershell
Invoke-WebRequest -UseBasicParsing https://qdrant-kb.vivutrade.io.vn/collections -Headers @{ "api-key" = "hJLmXoBhi+Xg8YbctZC73zuv1BJryjaY" }
```
- Kỳ vọng `200`.
