---
name: setup-mcp
description: Configure the Plex Collection Creator MCP server so Claude Code can drive a Plex library (collections, posters, TMDB accuracy). Use when a user wants to set up, connect, or troubleshoot the MCP server, or add it to their Claude Code / MCP client config.
---

# Set up the MCP server

Goal: get the `plex-collection-creator` MCP server connected to an MCP client
(e.g. Claude Code) so the user can manage Plex conversationally.

## 1. Install dependencies
```bash
npm install
```
Node **22+** is required (`.nvmrc` / `engines`). On some very new Node releases
the native `better-sqlite3` build can still fail — but the MCP server runs
**standalone without SQLite**, so you can install just the JS deps:
```bash
npm install --ignore-scripts
```

## 2. Get Plex connection details
The server resolves Plex two ways:
1. **Standalone (recommended)** — `PLEX_URL` + `PLEX_TOKEN` env vars. No web
   setup or database needed.
2. **Reuse the web app** — if those env vars are unset, it falls back to the
   connection saved by the web app (requires [[setup-app]] done first).

Find the token: Plex → any item → "Get Info" → "View XML", copy the
`X-Plex-Token` from the URL
([guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)).
`PLEX_URL` is usually `http://<server-ip>:32400`.

`TMDB_API_KEY` is optional — only the `tmdb_*` accuracy tools need it
([free key](https://www.themoviedb.org/settings/api)).

## 3. Add to the MCP client
For Claude Code, write `.mcp.json` in the project (or add to `~/.claude.json`):
```jsonc
{
  "mcpServers": {
    "plex-collection-creator": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"],
      "cwd": "/absolute/path/to/plex-collection-creator",
      "env": {
        "PLEX_URL": "http://localhost:32400",
        "PLEX_TOKEN": "<plex-token>",
        "TMDB_API_KEY": "<tmdb-key>"
      }
    }
  }
}
```
`npm run mcp` runs `tsx src/lib/mcp/server.ts` over stdio.

## 4. Verify
- Quick local check (no client needed):
  ```bash
  PLEX_URL=... PLEX_TOKEN=... npm run mcp
  ```
  It should print `MCP server running on stdio` to stderr (Ctrl-C to stop).
- In Claude Code: reload MCP servers (`/mcp`), confirm
  `plex-collection-creator` is connected, then ask **"list my Plex libraries"**
  (calls `list_libraries`).

## Troubleshooting
- **"No Plex connection configured"** — set `PLEX_URL` + `PLEX_TOKEN`, or run
  [[setup-app]] and connect a server.
- **TMDB tools error** — set `TMDB_API_KEY`.
- **Server not appearing** — check the `cwd` path is absolute and reload `/mcp`.

When connected, point the user at [[organize-collections]] and
[[audit-library]] for what to do next.
