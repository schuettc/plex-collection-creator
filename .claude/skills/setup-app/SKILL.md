---
name: setup-app
description: Set up and run the Plex Collection Creator web app (Docker or local dev), connect it to a Plex server, choose libraries, and add an AI provider key. Use when a user wants to install, start, or configure the original web application for the first time.
---

# Set up the Plex Collection Creator web app

Goal: get the Next.js web app running and connected so the user can generate AI
collection suggestions in the browser.

## 1. Check prerequisites
- **Docker** (recommended path): `docker --version` and `docker compose version`.
- **Local dev path**: Node **22+** (`node -v`; the repo standardizes on 22 via
  `.nvmrc` / `engines`). Some very new Node releases can fail to build the native
  `better-sqlite3` dependency — see [[setup-mcp]] for the same caveat.

Ask which path they want if it's unclear. Default to Docker.

## 2. Start the app

**Docker:**
```bash
docker compose up -d --build
```
The app is served at **http://localhost:32500** (container port 3000). Data
(SQLite + encryption key) persists in the `plex-collections-data` volume.

**Local dev:**
```bash
npm install
npm run dev   # http://localhost:3000
```

Optional: set `ENCRYPTION_KEY` (generate with `openssl rand -hex 32`) in
`.env` / `docker-compose.yml` for a stable key across rebuilds. If omitted, one
is auto-generated and stored in the data volume.

## 3. Walk the user through the setup wizard
Open the app and complete the three steps in the UI:
1. **Connect to Plex** — click connect, sign in via the Plex OAuth popup. The
   token is stored encrypted locally.
2. **Choose libraries** — select the Movie / TV libraries to manage.
3. **Add an AI key** — pick a provider (Anthropic, OpenAI, Bedrock, or Vertex)
   and paste the key. Keys can also be supplied via env vars (see `.env.example`).

## 4. Verify
- The dashboard shows the connected server and selected libraries.
- Run a scan, then "Generate" to confirm suggestions appear.

## Troubleshooting
- **Port in use**: change the host port mapping in `docker-compose.yml`.
- **Plex won't connect**: ensure the server is reachable and the popup wasn't
  blocked; retry the connect step.
- **better-sqlite3 build fails (local dev)**: use the Node version in `.nvmrc`
  (`nvm use`), or use the Docker path.

Once the app works, offer [[setup-mcp]] so they can also drive Plex from
Claude Code.
