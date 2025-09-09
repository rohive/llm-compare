# llm-compare (single-host, local dev)

This is a minimal, production-ish starter for **LLM Compare**:
- Frontend: Vite + React + Tailwind (dev on :5173)
- Backend: Express (API + serves built frontend on :4000)
- No Docker required.

## Quick start (dev)
Open two terminals.

Terminal A - start server (APIs):
```bash
cd server
npm install
npm run dev
# server runs at http://localhost:4000
```

Terminal B - start frontend (Vite dev with proxy to backend):
```bash
cd frontend
npm install
npm run dev
# open http://localhost:5173
```

Requests to `/api/*` are proxied to `http://localhost:4000` in dev so there is no CORS.

## Build & serve (prod-like)
```bash
# 1. build frontend
cd frontend
npm install
npm run build

# 2. copy build into server/public
cd ..
./copy-build.sh

# 3. start server (serves frontend + APIs on :4000)
cd server
npm start
# open http://localhost:4000
```

## Notes
- Provider integrations (OpenAI / Anthropic) require API keys in `server/.env` if you want real calls.
- Likes are stored in `server/data/likes.json` (file-based) for local dev; swap to Postgres later.
