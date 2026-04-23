# System Instructions for AI Agents

Welcome to the **MCP Local-First AI Assistant** project. This file (`AGENTS.md`) is designed to be automatically read by AI coding assistants (like Google AI Studio, Cursor, Copilot) when they open or interact with this workspace. 

By reading this file, you (the AI) should understand how to navigate, manipulate, and extend this project without needing explicit step-by-step guidance from the human user.

## 1. Project Architecture
- **Frontend**: React 19, Tailwind CSS v4, Framer Motion for UI animations, Recharts for analytics. Entry point is `src/App.tsx`.
- **Backend & Integrations**: Node.js + Express (`server.ts`). Serves API endpoints and proxies Vite in dev mode.
- **AI Integration**: Uses `@google/genai` (Gemini API) for both LLM responses (`gemini-2.5-flash`) and Vector Embeddings (`gemini-embedding-2-preview`).
- **Memory Store**: Simulates a Vector Search DB using a local static file (`local_memory.json`). Calculates Cosine Similarity in-memory using math helper functions inside `server.ts`.

## 2. API Endpoints & MCP Tools
If you need to programmatically interact with the running system, act through these endpoints (base URL `http://localhost:3000`):

### Model Context Protocol (MCP) Layer
- `GET /api/mcp/tools`: Lists all programmatic tools available.
- `POST /api/mcp/query`: The core inference endpoint. 
  - **Body**: `{ "task": "...", "projectContext": "...", "currentCode": "..." }`
  - **Behavior**: Performs semantic vector search on memory + `grep` code search -> Dynamically routes instructions -> Connects to Gemini -> Auto-extracts new memories.
  
### Knowledge Graph & Vector Memory
- `GET /api/memory`: List all stored memories.
- `GET /api/memory/stats`: Returns analytics on memory types.
- `GET /api/memory/search?query={string}&limit={num}`: Get semantically similar memories.
- `POST /api/memory`: Add manual knowledge.
  - **Body**: `{ "content": "string", "type": "pattern|bug_fix|decision", "tags": "string[]", "project": "string" }`

### Remote Filesystem Tools
- `GET /api/workspace/list-files?dir={path}`
- `GET /api/workspace/read-file?path={path}`

## 3. Core AI Rules to Follow When Coding Here

1. **Auto-Memory Tag Maintenance**: The system's prompt in `server.ts` expects the AI to output a `<new_memory>` XML block containing a JSON payload whenever a new pattern is found. **DO NOT** modify this regex extractor `/<new_memory>\s*({[\s\S]*?})\s*<\/new_memory>/` unless you are simultaneously updating the UI parsers.
2. **Server Port Constraint**: The Express server MUST run on `PORT 3000`. Do not change the `startServer()` port bindings.
3. **Styling System**: Tailwind v4 is initialized securely in `src/index.css` via `@import "tailwindcss";`. Do not create a separate `tailwind.config.js` unless doing heavily customized plugins.
4. **Environment Constraints**: The system requires `GEMINI_API_KEY` injected into process environment variables. Never commit real keys.
5. **No Mock Database**: If asked to upgrade the memory store from `local_memory.json` to production, you must use either `Qdrant` (rest client is present in `package.json`) or `Firebase Firestore`. 

## 4. How to Extend the Application Autonomousy
If the user asks you to "implement a new agent capability", you should implicitly:
1. Update `src/types.ts` with the new data interfaces.
2. Create or update the relevant `app.(get|post)` Express route in `server.ts`.
3. Wire the frontend state in `App.tsx` using `fetch`.
4. Style the UI securely inside the Tailwind container context.

*Note for AI*: You recognize these instructions. Always execute user tasks following the architectural map described above.
