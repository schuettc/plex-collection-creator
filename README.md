# Plex Collection Creator

**Automatically organize your Plex library with AI-powered collections.**

![Plex Collection Creator](https://img.shields.io/badge/Plex-Collection%20Creator-E5A00D?style=for-the-badge&logo=plex&logoColor=white)

---

## What It Does

- **Finds franchises automatically** — Star Wars, Marvel, Harry Potter, etc.
- **Discovers thematic collections** — "Mind-Bending Thrillers", "90s Classics", "Award Winners"
- **Custom searches** — Ask for anything: "Find all Christmas movies" or "Movies with twist endings"
- **One-click apply** — Review suggestions and create collections directly in Plex
- **Drive it from Claude Code** — an [MCP server](#mcp-server-drive-plex-from-claude-code) lets you manage collections, fix bad posters, and verify collection accuracy against TMDB conversationally

If you need help getting started creating collections in your Plex library, give this a try and let me know what you think.

---

## What You Need

| Requirement           | Details                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| **Docker Desktop**    | [Download here](https://www.docker.com/products/docker-desktop/) — free for personal use |
| **Plex Media Server** | Running on your network                                                                  |
| **AI API Key**        | From Anthropic, OpenAI, AWS Bedrock, or Google Vertex AI                                 |

> The Quick Start below uses Docker — nothing else to install. For local
> development or the [MCP server](#mcp-server-drive-plex-from-claude-code) you'll
> need **Node 22+** (pinned in `.nvmrc`).

---

## Quick Start

### 1. Start the App

Open a terminal and run:

```bash
git clone https://github.com/schuettc/plex-collection-creator.git
cd plex-collection-creator
docker compose up -d
```

### 2. Open Your Browser

Go to **[http://localhost:32500](http://localhost:32500)**

![Landing Page](docs/images/01-landing.png)

---

## Setup Guide

The setup wizard walks you through three steps:

### Step 1: Connect to Plex

Click **Connect with Plex** and sign in with your Plex account. The app will find your server automatically.

![Setup Wizard](docs/images/02-setup-wizard.png)

### Step 2: Choose Your Libraries

Select which movie and TV libraries you want to analyze.

### Step 3: Add Your AI Key

Enter your API key from your chosen AI provider.

![Setup Complete](docs/images/03-setup-complete.png)

---

## Creating Collections

Once setup is complete, you'll see the Dashboard:

![Dashboard](docs/images/04-dashboard-create.png)

### 1. Scan Your Library

Click **Start Scan** to fetch your media metadata from Plex.

![Scan Complete](docs/images/05-scan-complete.png)

### 2. Run AI Analysis

Click **Analyze** and let the AI find collection opportunities.

![Analysis Complete](docs/images/06-analysis-complete.png)

### 3. Review Suggestions

Browse the AI's suggestions. Each shows the movies/shows that would be included.

![Suggestions](docs/images/07-suggestions-list.png)

You can filter by type or search for specific collections:

![Filters](docs/images/08-suggestions-filters.png)

### 4. Apply to Plex

Click **Approve** on any suggestion to create it in Plex. Or **Reject** to dismiss it.

![Collections](docs/images/09-collections.png)

---

## Custom Searches

Want something specific? Use **Custom Search** to ask for anything:

- "Find all movies directed by Christopher Nolan"
- "Create a collection of 80s action movies"
- "Group movies with surprise endings"
- "Find all holiday and Christmas movies"

---

## MCP Server (drive Plex from Claude Code)

In addition to the web app, this project ships an **MCP server** so you can manage
your Plex library conversationally from an MCP client like
[Claude Code](https://claude.com/claude-code) — browse libraries, create and edit
collections, fix bad posters, and verify collection accuracy against TMDB.

The web app is unchanged; the MCP server is a separate entry point (`npm run mcp`)
that talks to Plex over stdio.

### Configure

The server resolves a Plex connection two ways:

1. **Standalone** — set `PLEX_URL` and `PLEX_TOKEN` (no database or web setup
   required). [How to find your token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).
2. **Reuse the app's connection** — if those env vars are unset, it falls back to
   the Plex server you already connected in the web UI.

`TMDB_API_KEY` is optional and only needed for the `tmdb_*` accuracy tools
([free key](https://www.themoviedb.org/settings/api)).

### Add to Claude Code

```jsonc
// .mcp.json (or ~/.claude.json)
{
  "mcpServers": {
    "plex-collection-creator": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"],
      "cwd": "/path/to/plex-collection-creator",
      "env": {
        "PLEX_URL": "http://localhost:32400",
        "PLEX_TOKEN": "your-plex-token",
        "TMDB_API_KEY": "your-tmdb-key"
      }
    }
  }
}
```

Then ask Claude things like *"group my A24 films into a collection"*, *"audit my
movie posters and fix any frame-grabs"*, or *"check the Denis Villeneuve
collection is accurate"*.

### Tools

| Area | Tools |
| --- | --- |
| Library | `list_libraries`, `list_items`, `scan_library` |
| Collections | `list_collections`, `get_collection`, `create_or_update_collection`, `add_to_collection`, `remove_from_collection`, `delete_collection` |
| Posters | `audit_posters`, `fix_poster`, `fix_all_posters` |
| TMDB accuracy | `tmdb_search`, `tmdb_movie_details`, `tmdb_director_filmography` |

Collection writes use Plex's tag-based editing — additive (an item keeps its
other collections) and resilient across Plex server versions. Poster auditing
flags non-portrait artwork (frame-grabs, banners) by aspect ratio and replaces it
with the official poster.

### Guided setup with Claude Code

This repo ships **Claude Code skills** (in `.claude/skills/`) so Claude can walk
you through everything — just ask:

| Skill | What it does |
| --- | --- |
| `setup-app` | Install/run the web app, connect Plex, pick libraries, add an AI key |
| `setup-mcp` | Configure and verify the MCP server in your MCP client |
| `organize-collections` | Build and curate collections (franchises, directors, themes) |
| `audit-library` | Verify collection accuracy against TMDB and fix bad posters |

For example: *"set up the MCP server"* or *"audit my movie collections for accuracy"*.

---

## Getting an AI API Key

| Provider             | How to Get a Key                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Anthropic**        | Sign up at [console.anthropic.com](https://console.anthropic.com), add a payment method, create an API key |
| **OpenAI**           | Sign up at [platform.openai.com](https://platform.openai.com), add a payment method, create an API key     |
| **AWS Bedrock**      | Requires AWS account with Bedrock model access enabled                                                     |
| **Google Vertex AI** | Requires GCP project with Vertex AI API enabled                                                            |

Cost-conscious design: The app uses smaller, faster models (like Claude Haiku) for validation and filtering tasks, reserving larger models (like Claude Sonnet) only for creative analysis. Be sure to keep an eye on your costs.

---

## Security & Privacy

**What stays local:**

- Your Plex token is stored in the local database
- The app runs on your machine — no data is sent to us

**What gets sent to your AI provider:**

- Movie and TV metadata (titles, years, directors, genres, summaries)
- This is required for the AI to analyze your library and suggest collections

Your Plex credentials are never sent to the AI provider.

---

## Credential Storage

You need to provide an AI API key. There are two ways to do this:

**Option 1: Environment variables**

Create a `.env` file before starting the app:

```bash
# Anthropic
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# OR OpenAI
echo "OPENAI_API_KEY=sk-..." > .env

# OR AWS Bedrock
cat > .env << 'EOF'
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
EOF

docker compose up -d
```

The UI will show "Configured via environment variable" and won't store anything in the database.

**Option 2: Enter in the UI**

Enter your API key through the setup wizard. It gets encrypted (AES-256-GCM) and stored in the local SQLite database. The encryption key is auto-generated on first startup and stored in the Docker volume.

If you prefer to manage your own encryption key:

```bash
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" > .env
docker compose up -d
```

---

## FAQ

**Q: Does this modify my actual media files?**
No. It only creates collections in Plex's database. Your files are never touched.

**Q: Can I undo a collection?**
Yes. Collections can be deleted from Plex at any time.

**Q: Does it work with TV shows?**
Yes! It finds series, spinoffs, and shared-universe shows.

**Q: How do I stop the app?**
Run `docker compose down` in the terminal. Your data is preserved.

**Q: How do I completely reset?**
Run `docker compose down -v` to remove all data and start fresh.

---

This is a personal project and not associated with or created by Plex. I just love their app and wanted to make something to help me create collections.

---

## License

MIT
