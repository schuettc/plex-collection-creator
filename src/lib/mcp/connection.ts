/**
 * Resolve a working Plex connection for the MCP server.
 *
 * Priority:
 *   1. PLEX_URL + PLEX_TOKEN environment variables (standalone use)
 *   2. The connection the web app already saved (DB-backed fallback)
 *
 * The web app's client/auth/DB layer (and its native SQLite dependency) is
 * only imported in the fallback path, so standalone (env) usage runs with no
 * database and no native modules.
 */

export interface PlexConnection {
  serverUrl: string;
  token: string;
}

export interface PlexSection {
  key: string;
  title: string;
  type: "movie" | "show";
}

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function resolveConnection(): Promise<PlexConnection> {
  const envUrl = process.env.PLEX_URL;
  const envToken = process.env.PLEX_TOKEN;
  if (envUrl && envToken) {
    return { serverUrl: trimSlashes(envUrl), token: envToken };
  }

  // Fallback: reuse the connection the web app stored. Imported lazily so the
  // env-only path never loads the database layer or its native SQLite module.
  const { getCurrentServerUrl } = await import("@/lib/plex/client");
  const { db, settings } = await import("@/lib/db");
  const rows = await db.select().from(settings).limit(1);
  if (!rows.length || !rows[0].plexServerId) {
    throw new Error(
      "No Plex connection configured. Set PLEX_URL and PLEX_TOKEN, " +
        "or connect a Plex server in the web app first."
    );
  }

  const conn = await getCurrentServerUrl(rows[0].plexServerId);
  if (!conn) {
    throw new Error(
      "Saved Plex server is unreachable. Set PLEX_URL/PLEX_TOKEN " +
        "or verify the connection in the web app."
    );
  }
  return { serverUrl: trimSlashes(conn.uri), token: conn.token };
}

interface RawDirectory {
  key: string;
  title: string;
  type: string;
}

/** List movie and TV library sections on the server. */
export async function listSections(
  conn: PlexConnection
): Promise<PlexSection[]> {
  const res = await fetch(`${conn.serverUrl}/library/sections`, {
    headers: { Accept: "application/json", "X-Plex-Token": conn.token },
  });
  if (!res.ok) throw new Error(`Failed to list libraries -> HTTP ${res.status}`);
  const data = await res.json();
  const dirs: RawDirectory[] = data.MediaContainer?.Directory ?? [];
  return dirs
    .filter((d) => d.type === "movie" || d.type === "show")
    .map((d) => ({ key: d.key, title: d.title, type: d.type as "movie" | "show" }));
}

/**
 * Resolve a user-supplied library reference to a section. Accepts a section
 * key, a type alias ("movie"/"movies"/"film", "tv"/"show"/"series"), or a
 * library title (case-insensitive).
 */
export async function resolveSection(
  conn: PlexConnection,
  library: string
): Promise<PlexSection> {
  const sections = await listSections(conn);
  const q = library.toLowerCase().trim();

  const byKey = sections.find((s) => s.key === library);
  if (byKey) return byKey;

  if (["movie", "movies", "film", "films"].includes(q)) {
    const s = sections.find((x) => x.type === "movie");
    if (s) return s;
  }
  if (["tv", "show", "shows", "series", "television"].includes(q)) {
    const s = sections.find((x) => x.type === "show");
    if (s) return s;
  }

  const byTitle = sections.find((s) => s.title.toLowerCase() === q);
  if (byTitle) return byTitle;

  const avail = sections
    .map((s) => `${s.title} (type=${s.type}, key=${s.key})`)
    .join("; ");
  throw new Error(`Library "${library}" not found. Available: ${avail}`);
}

/** Plex metadata type id used by tag edits: movie=1, show=2. */
export function sectionTypeId(section: PlexSection): number {
  return section.type === "movie" ? 1 : 2;
}
