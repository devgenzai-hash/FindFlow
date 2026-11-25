# Trendsetter

Trendsetter is a local-first prototype for content research. It includes:

- A Manifest V3 WebExtensions collector for Chrome, Edge, and Firefox.
- A Fastify API server that stores collected Instagram, X/Twitter, and YouTube content in SQLite.
- A replaceable RAG layer with embedding, vector-store, reranking, and answer-generation interfaces.

New to the project? Start with [docs/NOOBS_GUIDE.md](docs/NOOBS_GUIDE.md).

## What the Extension Does

Open a supported public page, click the extension, and it will scroll the page, accumulate discovered items, download a JSON export, and send the same payload to the local server.

Supported first-pass pages:

- Instagram profile grids and reels links available to the current browser session.
- X/Twitter profile timelines available to the current browser session.
- YouTube channel videos pages for `@handle`, `/channel/...`, `/c/...`, or `/user/...` channels, including mobile YouTube pages.

The collector is intentionally compliant and best-effort. It does not bypass logins, paywalls, anti-abuse systems, private content, or platform access controls. Some platforms do not expose every metric in profile grids, so unavailable values are stored as `null`/missing and can be filled later by official API adapters.

## Setup

```powershell
npm install
Copy-Item .env.example .env
npm run build
npm run check
```

Start the server:

```powershell
npm run dev:server
```

The API listens on `http://127.0.0.1:3318` by default and stores SQLite data under `data/trendsetter.sqlite` unless `TRENDSETTER_DATA_DIR` or `SQLITE_PATH` is set. Large collection payloads are accepted up to `BODY_LIMIT_BYTES` in `.env.example`.

## Load the Extension

Build output is in `apps/extension/dist`.

Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose **Load unpacked** and select `apps/extension/dist`.

Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select `apps/extension/dist/manifest.json`.

## API

Useful endpoints:

- `GET /health`
- `POST /api/ingest`
- `GET /api/accounts`
- `GET /api/items?platform=youtube&accountHandle=@mkbhd&sort=views`
- `POST /api/search`
- `POST /api/rag/query`
- `POST /api/rag/reindex`

Smoke test with the sample payload:

```powershell
$payload = Get-Content .\examples\sample-ingest.json -Raw
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3318/api/ingest -ContentType 'application/json' -Body $payload

$query = @{ query = 'camera comparison with strong audience response'; platform = 'youtube'; accountHandle = '@mkbhd'; topK = 5 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3318/api/rag/query -ContentType 'application/json' -Body $query
```

## RAG Configuration

The default `AI_PROVIDER=none` uses local hash embeddings and extractive answers, so no API key is needed for smoke tests.

Supported beginner provider presets are:

- `openai`
- `openrouter`
- `nvidia-nim`
- `ollama`
- `llama-cpp`

Example NVIDIA NIM shape for your local `.env` file:

```env
AI_PROVIDER=nvidia-nim
AI_API_KEY=your-nvidia-nim-api-key
AI_MODEL=meta/llama-3.1-8b-instruct
EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5
EMBEDDING_DIMENSIONS=1024
```

See [docs/NOOBS_GUIDE.md](docs/NOOBS_GUIDE.md) for OpenAI, OpenRouter, Ollama, llama.cpp, Cohere reranking, and no-build server usage.

## Project Layout

```text
apps/extension   Cross-browser WebExtensions collector
apps/server      Fastify API, SQLite persistence, RAG orchestration
packages/shared  Shared TypeScript contracts
examples         Sample ingest payloads
```

## Production Notes

- Use official platform APIs for production-grade completeness and stable metric coverage.
- Keep the extension as a user-controlled collector; do not automate credential use or access restrictions.
- SQLite repositories are isolated from routes so Postgres can replace them later.
- The current SQLite vector store is a portable fallback. For larger corpora, replace it with a dedicated vector database behind `VectorStore`.