# MCP Local-First AI Assistant

Local-first AI assistant with MCP routing, semantic memory retrieval, and autonomous memory extraction.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   - Required: `GEMINI_API_KEY`
   - Memory backend:
     - `MEMORY_PROVIDER=local` (default, stores in `local_memory.json`)
     - `MEMORY_PROVIDER=qdrant` (scalable vector store)
   - When using Qdrant:
     - `QDRANT_URL`
     - `QDRANT_API_KEY` (optional if your Qdrant has no auth)
     - `QDRANT_COLLECTION` (default: `memory_entries`)
     - `QDRANT_VECTOR_SIZE` (default: `768`)

3. Khởi động ứng dụng (Full Stack):
   Ứng dụng sử dụng PM2 để quản lý cả server và cơ sở dữ liệu Qdrant. Đảm bảo bạn đã giải nén Qdrant vào thư mục `qdrant`.
   ```bash
   npm run app:start
   ```
   Để kiểm tra trạng thái:
   ```bash
   npm run app:status
   ```

4. Khởi động MCP server (stdio):
   ```bash
   npm run mcp
   ```

4. Build:
   ```bash
   npm run build
   ```

## Memory Backends

- `local`: JSON file storage, simple for development and demos.
- `qdrant`: scalable vector search backend with the same API contract.

Both providers keep the same endpoints:
- `GET /api/memory`
- `GET /api/memory/stats`
- `GET /api/memory/search`
- `POST /api/memory`
- `POST /api/mcp/query`

## MCP Workflow For Local Drive `D:`

Use the MCP server tools:
- `ingest_directory`: scan a project folder and write compact memories
- `search_memory`: retrieve past patterns
- `code_search`: fast code search with ripgrep
- `memory_stats`: check memory growth and type breakdown

Example ingest target:
- `dir: "D:/TradingWeb/BE_ViewChart/modern-view-chart"`
- `project: "modern-view-chart"`

This enables a long-term loop:
1. Ingest local repos from `D:`
2. Ask coding tasks via MCP
3. Persist new patterns into memory
4. Reuse memory in later coding sessions

## Batch Ingest Many Repos

1. Create your config file:
   - copy `scripts/ingest-targets.example.json` -> `scripts/ingest-targets.json`
   - edit `targets` with your repositories in `D:/...`

2. Start API server:
   ```bash
   npm run dev
   ```

3. Run batch ingest:
   ```bash
   npm run ingest:batch:config
   ```

Or pass custom config path:
```bash
npm run ingest:batch -- --config scripts/ingest-targets.json
```

## Migrate Local JSON to Qdrant

1. Set Qdrant env vars (`QDRANT_URL`, optional `QDRANT_API_KEY`, etc.).
2. Run:
   ```bash
   npm run migrate:memory:qdrant
   ```
3. Switch runtime provider:
   - `MEMORY_PROVIDER=qdrant`

## Use One Shared Knowledge Store Across Multiple PCs (PM2)

Root idea: run **one central Qdrant** and point every app instance to it via `QDRANT_URL`.

1. Choose one machine as shared-memory server (for example `192.168.1.10`):
   - In `.env.local`:
     - `MEMORY_PROVIDER="qdrant"`
     - `START_LOCAL_QDRANT="true"`
     - `QDRANT_URL="http://127.0.0.1:6333"`
   - Start PM2:
     ```bash
     npm run app:stop
     npm run app:start
     ```

2. On other machines:
   - In `.env.local`:
     - `MEMORY_PROVIDER="qdrant"`
     - `START_LOCAL_QDRANT="false"`
     - `QDRANT_URL="http://192.168.1.10:6333"`
     - optional: `QDRANT_API_KEY="..."`
   - Restart PM2:
     ```bash
     npm run app:stop
     npm run app:start
     ```

3. Verify all machines are using the same memory backend:
   - `GET /api/memory/stats` should return the same totals after adding memory from either machine.

Notes:
- `ecosystem.config.cjs` now reads `.env.local`, so PM2 no longer hard-codes `127.0.0.1`.
- If exposing Qdrant beyond localhost, secure network access and set `QDRANT_API_KEY`.

## Fast Setup: Main PC + Secondary PC

Goal:
- Main PC keeps running app + coding + memory updates as normal.
- Secondary PC installs and uses the same shared knowledge immediately.

### On Main PC (always-on)

In `.env.local` set:
- `MEMORY_PROVIDER="qdrant"`
- `START_LOCAL_QDRANT="true"`
- `QDRANT_URL="http://127.0.0.1:6333"`
- `QDRANT_BIND_HOST="0.0.0.0"` (allow LAN clients)
- `QDRANT_BIND_PORT="6333"`

Restart:
```bash
npm run app:stop
npm run app:start
```

### On Secondary PC (one command)

1. Clone repo, run `npm install`.
2. Configure shared mode in one line:
   ```bash
   npm run setup:shared-client -- --qdrant-url http://<MAIN_PC_LAN_IP>:6333
   ```
   Optional:
   ```bash
   npm run setup:shared-client -- --qdrant-url http://<MAIN_PC_LAN_IP>:6333 --qdrant-api-key <KEY> --port 3001
   ```
3. Start:
   ```bash
   npm run app:stop
   npm run app:start
   ```

Result:
- Secondary PC does not start local Qdrant (`START_LOCAL_QDRANT=false`).
- All memory read/write goes to Main PC Qdrant, so updates are shared instantly.

## Cloudflare Subdomain + Security (Recommended)

Use this when Main PC IP/LAN can change.

### A. Create subdomain via Cloudflare Tunnel

Prerequisites:
- Domain is managed in Cloudflare DNS.
- `cloudflared` installed on Main PC.

1. Login once on Main PC:
   ```bash
   cloudflared tunnel login
   ```
2. Create tunnel:
   ```bash
   cloudflared tunnel create mcp-knowledge
   ```
3. Create DNS routes (subdomains):
   ```bash
   cloudflared tunnel route dns mcp-knowledge qdrant.yourdomain.com
   cloudflared tunnel route dns mcp-knowledge assistant.yourdomain.com
   ```
4. Create config from template:
   - copy `cloudflared/config.example.yml` -> `cloudflared/config.yml`
   - update `tunnel`, `credentials-file`, and hostnames

5. Enable tunnel in PM2 (`.env.local` on Main PC):
   ```env
   ENABLE_CLOUDFLARED="true"
   CLOUDFLARED_CONFIG="D:/mcp-local-first-ai-assistant/cloudflared/config.yml"
   CLOUDFLARED_TUNNEL_NAME="mcp-knowledge"
   ```

6. Restart PM2:
   ```bash
   npm run app:stop
   npm run app:start
   npm run app:status
   ```
   You should see `cloudflared` online.

### B. Secondary PC use shared memory by domain

```bash
npm run setup:shared-client -- --qdrant-url https://qdrant.yourdomain.com
npm run app:stop
npm run app:start
```

### C. Secure subdomain (must do)

Minimum recommended:
1. Enable Cloudflare Access for `qdrant.yourdomain.com`
   - Zero Trust -> Access -> Applications -> Add application
   - Type: Self-hosted
   - Policy: only your emails/dev group allowed

2. Set `QDRANT_API_KEY` on Main PC (`.env.local`) and on clients.
   - Then restart PM2.

3. Keep local service private:
   - Keep Qdrant bound to localhost unless needed:
     - `QDRANT_BIND_HOST="127.0.0.1"`
   - Let only Cloudflare Tunnel expose it publicly.

4. Do not commit secrets:
   - Never commit `.env.local`, tunnel token, or tunnel credentials json.

Optional hardening:
- Use token-based tunnel run (`CLOUDFLARED_TUNNEL_TOKEN`) instead of cert-based login on server.
- Add Cloudflare WAF rate limit on `qdrant.yourdomain.com`.
