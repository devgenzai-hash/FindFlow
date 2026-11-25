# Trendsetter Noobs Guide

This guide assumes you are new to Node projects, browser extensions, local servers, SQLite, and RAG. Follow it from top to bottom the first time.

## What This Project Does

Trendsetter has two main parts:

- `apps/extension`: a Chrome, Edge, and Firefox extension that collects public Instagram, X/Twitter, and YouTube channel content visible to your logged-in browser session while scrolling.
- `apps/server`: a local API server that saves collected items to SQLite and lets you search or ask RAG questions over the stored content.

The extension is best-effort and compliant. It does not bypass logins, paywalls, private pages, anti-abuse controls, or platform access rules.

## Do Not Commit API Keys

Keep real keys only in your local `.env` file. `.env` is ignored by git.

Do not paste real keys into `.env.example`, README files, screenshots, issues, or commits. If a real API key was shared in chat or committed by mistake, rotate it in that provider dashboard.

## Requirements

Install these first:

- Node.js 20.11 or newer
- npm, which comes with Node
- Chrome, Edge, or Firefox
- Optional: Ollama, llama.cpp, OpenAI, OpenRouter, NVIDIA NIM, or Cohere account depending on your AI setup

Check Node and npm:

```powershell
node --version
npm --version
```

## First Setup

Open PowerShell in the project root:

```powershell
cd C:\Users\aranjan\Documents\Projects\trendsetter
```

Install packages:

```powershell
npm install
```

Create your local environment file:

```powershell
Copy-Item .env.example .env
```

The server automatically loads `.env` because it uses `dotenv`.

## Run Without Building

You can run the server and test RAG without building compiled JavaScript:

```powershell
npm run dev:server
```

That runs the TypeScript server directly with `tsx watch`.

In a second PowerShell window, check the server:

```powershell
Invoke-RestMethod http://127.0.0.1:3318/health
```

Ingest the sample data without using the browser extension:

```powershell
$payload = Get-Content .\examples\sample-ingest.json -Raw
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3318/api/ingest -ContentType 'application/json' -Body $payload
```

Ask a RAG question:

```powershell
$query = @{ query = 'camera comparison with strong audience response'; platform = 'youtube'; accountHandle = '@mkbhd'; topK = 5 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3318/api/rag/query -ContentType 'application/json' -Body $query
```

Important: the browser extension itself cannot run directly from TypeScript source. Browsers need built JavaScript files in `apps/extension/dist`. So "without building" works for the server/API/RAG workflow, but the extension needs `npm run build:extension` at least once unless `dist` already exists.

## Full Extension Workflow

Build everything:

```powershell
npm run build
```

Start the local server:

```powershell
npm run dev:server
```

Load the extension in Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Click **Load unpacked**.
4. Select `apps/extension/dist`.

Load the extension in Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `apps/extension/dist/manifest.json`.

Collect content:

1. Open a supported public profile or channel page.
2. Click the Trendsetter extension icon.
3. Keep the server URL as `http://localhost:3318` unless you changed the server port.
4. Choose the number of scroll passes.
5. Click **Collect**.

The extension will scroll, collect discovered items, download a JSON file, and send the same data to SQLite through the local server.

Supported page shapes:

- Instagram profile pages and reels/profile grids available to your browser session
- X/Twitter profile timelines available to your browser session
- YouTube channel pages such as `/@handle/videos`, `/channel/...`, `/c/...`, or `/user/...`

## See What Was Saved

List accounts:

```powershell
Invoke-RestMethod http://127.0.0.1:3318/api/accounts
```

List top YouTube items by views:

```powershell
Invoke-RestMethod 'http://127.0.0.1:3318/api/items?platform=youtube&sort=views&limit=20'
```

Search stored content:

```powershell
$body = @{ query = 'which videos performed best'; topK = 5 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3318/api/search -ContentType 'application/json' -Body $body
```

## AI Provider Quick Setup

Edit `.env`, then restart `npm run dev:server` after every env change.

### No API Key

This is the default. It uses local hash embeddings and extractive answers.

```env
AI_PROVIDER=none
```

### NVIDIA NIM

Use this shape for the NVIDIA NIM setup you asked for. Replace the placeholder with your real key only in `.env`.

```env
AI_PROVIDER=nvidia-nim
AI_API_KEY=your-nvidia-nim-api-key
AI_MODEL=meta/llama-3.1-8b-instruct
EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5
EMBEDDING_DIMENSIONS=1024
```

### OpenAI

```env
AI_PROVIDER=openai
AI_API_KEY=your-openai-api-key
AI_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIMENSIONS=3072
```

### OpenRouter

OpenRouter is useful for chat models. This project keeps hash embeddings by default for `AI_PROVIDER=openrouter`; you can override embeddings separately if your chosen OpenRouter model supports embeddings.

```env
AI_PROVIDER=openrouter
AI_API_KEY=your-openrouter-api-key
AI_MODEL=meta-llama/llama-3.1-8b-instruct
```

Optional OpenRouter embedding override:

```env
RAG_EMBEDDING_PROVIDER=openai
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=your-openrouter-api-key
EMBEDDING_MODEL=your-openrouter-embedding-model
EMBEDDING_DIMENSIONS=1024
```

### Ollama

Install Ollama, then pull a chat model and embedding model:

```powershell
ollama pull llama3.1:8b
ollama pull bge-m3
```

Then set `.env`:

```env
AI_PROVIDER=ollama
AI_MODEL=llama3.1:8b
EMBEDDING_MODEL=bge-m3
EMBEDDING_DIMENSIONS=1024
OLLAMA_BASE_URL=http://localhost:11434
```

### llama.cpp

Run a llama.cpp OpenAI-compatible server. Exact command depends on your build and model file, but it usually looks like this:

```powershell
.\llama-server.exe -m .\models\model.gguf --host 127.0.0.1 --port 8080
```

Then set `.env`:

```env
AI_PROVIDER=llama-cpp
AI_BASE_URL=http://127.0.0.1:8080/v1
AI_MODEL=local-model
EMBEDDING_MODEL=local-embedding-model
EMBEDDING_DIMENSIONS=1024
```

If your llama.cpp server is only for chat and does not expose embeddings, keep chat local but use hash embeddings:

```env
AI_PROVIDER=llama-cpp
AI_BASE_URL=http://127.0.0.1:8080/v1
AI_MODEL=local-model
RAG_EMBEDDING_PROVIDER=hash
RAG_EMBEDDING_MODEL=hash-embedding-384
RAG_EMBEDDING_DIMENSIONS=384
```

## Advanced AI Overrides

The beginner settings are usually enough. These override them when needed:

```env
RAG_CHAT_BASE_URL=https://api.openai.com/v1
RAG_CHAT_API_KEY=your-chat-api-key
RAG_CHAT_MODEL=gpt-4.1-mini

RAG_EMBEDDING_PROVIDER=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-embedding-api-key
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIMENSIONS=3072
```

Optional Cohere reranker:

```env
RAG_RERANKER=cohere
COHERE_API_KEY=your-cohere-api-key
COHERE_RERANK_MODEL=rerank-v3.5
```

## Common Problems

`Cannot find module` after cloning:

```powershell
npm install
```

Extension cannot connect to server:

- Start `npm run dev:server`.
- Keep popup server URL as `http://localhost:3318`.
- Check `Invoke-RestMethod http://127.0.0.1:3318/health`.

Extension says no collector response:

- Reload the Instagram, X/Twitter, or YouTube page after installing the extension.
- Make sure you are on a supported profile/channel URL.

RAG answers are basic:

- `AI_PROVIDER=none` uses extractive local answers.
- Set `AI_PROVIDER=nvidia-nim`, `openai`, `openrouter`, `ollama`, or `llama-cpp` for model-generated answers.

SQLite database location:

- Default: `data/trendsetter.sqlite`
- Override with `SQLITE_PATH` or `TRENDSETTER_DATA_DIR` in `.env`.