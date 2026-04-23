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

3. Run in development:
   ```bash
   npm run dev
   ```
   Server runs on `http://localhost:3000`.

4. Run MCP server (stdio) for Codex/clients:
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
