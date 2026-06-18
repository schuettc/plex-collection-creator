/**
 * MCP server for Plex Collection Creator.
 *
 * Exposes the app's Plex capabilities as tools so an MCP client (e.g. Claude
 * Code) can drive a Plex library conversationally: browse libraries, manage
 * collections, fix bad posters, and verify collection accuracy against TMDB.
 *
 * Transport is stdio, so anything written to stdout must be JSON-RPC. The DB
 * and encryption layers log to stdout on first use, so we redirect console.log
 * to stderr before doing any work.
 */
console.log = (...args: unknown[]) => console.error(...args);

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { resolveConnection, resolveSection, listSections } from "./connection";
import * as plex from "./plex";
import * as tmdb from "./tmdb";

const server = new McpServer({
  name: "plex-collection-creator",
  version: "1.0.0",
});

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function text(s: string): ToolResult {
  return { content: [{ type: "text", text: s }] };
}

// The SDK's tool() has several overloads that don't resolve cleanly through a
// generic wrapper; register through a loosened signature (runtime is correct).
const register = server.tool.bind(server) as unknown as (
  name: string,
  description: string,
  schema: z.ZodRawShape,
  cb: (args: Record<string, unknown>) => Promise<ToolResult>
) => void;

/** Register a tool whose thrown errors become a clean tool error result. */
function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  schema: S,
  handler: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<string>
) {
  register(name, description, schema, async (args) => {
    try {
      return text(await handler(args as z.objectOutputType<S, z.ZodTypeAny>));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  });
}

// ---- library / server ----------------------------------------------------

tool("list_libraries", "List the movie and TV library sections on the Plex server.", {}, async () => {
  const conn = await resolveConnection();
  const sections = await listSections(conn);
  if (!sections.length) return "No movie or TV libraries found.";
  return sections.map((s) => `- ${s.title} (type=${s.type}, key=${s.key})`).join("\n");
});

tool(
  "list_items",
  "List items in a library with rating keys and TMDB ids. `library` accepts a type (movie/tv), title, or section key. Use the ratingKey values with the collection tools.",
  { library: z.string(), search: z.string().optional() },
  async ({ library, search }) => {
    const conn = await resolveConnection();
    const section = await resolveSection(conn, library);
    const items = await plex.listItems(conn, section, search);
    if (!items.length) return "No items found.";
    const lines = items
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((i) => `${i.ratingKey}\t${i.title} (${i.year ?? "?"})\ttmdb=${i.tmdbId ?? "-"}`);
    return `${items.length} items in ${section.title}:\nratingKey\ttitle\ttmdb\n${lines.join("\n")}`;
  }
);

tool(
  "scan_library",
  "Trigger a Plex library scan (e.g. after adding files).",
  { library: z.string() },
  async ({ library }) => {
    const conn = await resolveConnection();
    const section = await resolveSection(conn, library);
    await plex.scanSection(conn, section);
    return `Triggered scan of ${section.title}.`;
  }
);

// ---- collections ----------------------------------------------------------

tool(
  "list_collections",
  "List collections in a library with their item counts.",
  { library: z.string() },
  async ({ library }) => {
    const conn = await resolveConnection();
    const section = await resolveSection(conn, library);
    const cols = await plex.listCollections(conn, section);
    if (!cols.length) return "No collections found.";
    return cols
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((c) => `- ${c.title} (${c.childCount ?? 0} items)`)
      .join("\n");
  }
);

tool(
  "get_collection",
  "List the items in a collection by name.",
  { library: z.string(), name: z.string() },
  async ({ library, name }) => {
    const conn = await resolveConnection();
    const section = await resolveSection(conn, library);
    const col = await plex.findCollection(conn, section, name);
    if (!col) return `No collection named "${name}".`;
    const items = await plex.collectionItems(conn, col.ratingKey);
    if (!items.length) return `"${col.title}" is empty.`;
    return `${col.title} (${items.length}):\n${items
      .map((i) => `- ${i.title} (${i.year ?? "?"}) [rk=${i.ratingKey}]`)
      .join("\n")}`;
  }
);

const collectionWrite = {
  library: z.string(),
  name: z.string(),
  ratingKeys: z.array(z.string()).describe("Plex rating keys (from list_items)"),
};

tool(
  "create_or_update_collection",
  "Add items to a collection by name, creating it if it doesn't exist. Idempotent and additive — items keep any other collection memberships.",
  collectionWrite,
  async ({ library, name, ratingKeys }) => {
    const conn = await resolveConnection();
    const section = await resolveSection(conn, library);
    const existed = !!(await plex.findCollection(conn, section, name));
    await plex.setCollection(conn, section, name, ratingKeys);
    return `${existed ? "Updated" : "Created"} "${name}" with ${ratingKeys.length} item(s) in ${section.title}.`;
  }
);

tool(
  "add_to_collection",
  "Add items to an existing collection by name.",
  collectionWrite,
  async ({ library, name, ratingKeys }) => {
    const conn = await resolveConnection();
    const section = await resolveSection(conn, library);
    await plex.setCollection(conn, section, name, ratingKeys);
    return `Added ${ratingKeys.length} item(s) to "${name}".`;
  }
);

tool(
  "remove_from_collection",
  "Remove items from a collection by name.",
  collectionWrite,
  async ({ library, name, ratingKeys }) => {
    const conn = await resolveConnection();
    const section = await resolveSection(conn, library);
    await plex.setCollection(conn, section, name, ratingKeys, true);
    return `Removed ${ratingKeys.length} item(s) from "${name}".`;
  }
);

tool(
  "delete_collection",
  "Delete a collection by name (does not delete the media).",
  { library: z.string(), name: z.string() },
  async ({ library, name }) => {
    const conn = await resolveConnection();
    const section = await resolveSection(conn, library);
    const col = await plex.findCollection(conn, section, name);
    if (!col) return `No collection named "${name}".`;
    await plex.deleteCollection(conn, col.ratingKey);
    return `Deleted collection "${col.title}".`;
  }
);

// ---- posters --------------------------------------------------------------

tool(
  "audit_posters",
  "Scan a library for bad posters (frame-grabs, banners, square crops) by aspect ratio. Real posters are ~2:3; anything wider is flagged.",
  { library: z.string() },
  async ({ library }) => {
    const conn = await resolveConnection();
    const section = await resolveSection(conn, library);
    const { scanned, issues } = await plex.auditPosters(conn, section);
    if (!issues.length) return `Scanned ${scanned} posters — all look like proper posters.`;
    const lines = issues
      .sort((a, b) => (b.ratio ?? 99) - (a.ratio ?? 99))
      .map(
        (i) =>
          `${i.ratingKey}\t${i.title} (${i.year ?? "?"})\t${i.dimensions}\tratio=${
            i.ratio === null ? "unreadable" : i.ratio.toFixed(2)
          }`
      );
    return `Scanned ${scanned}; ${issues.length} suspect poster(s):\nratingKey\ttitle\tdimensions\tratio\n${lines.join("\n")}\n\nUse fix_poster or fix_all_posters to replace them with official posters.`;
  }
);

tool(
  "fix_poster",
  "Replace one item's poster with an official portrait poster (or a specific posterUrl).",
  { ratingKey: z.string(), posterUrl: z.string().optional() },
  async ({ ratingKey, posterUrl }) => {
    const conn = await resolveConnection();
    const res = await plex.fixPoster(conn, ratingKey, posterUrl);
    return res.ok
      ? `Set poster for ${ratingKey}.`
      : `No suitable poster found for ${ratingKey} (no remote poster available).`;
  }
);

tool(
  "fix_all_posters",
  "Audit a library and replace every bad poster with an official portrait poster. Returns a per-item summary.",
  { library: z.string() },
  async ({ library }) => {
    const conn = await resolveConnection();
    const section = await resolveSection(conn, library);
    const { scanned, issues } = await plex.auditPosters(conn, section);
    if (!issues.length) return `Scanned ${scanned} posters — nothing to fix.`;
    const results: string[] = [];
    for (const issue of issues) {
      try {
        const r = await plex.fixPoster(conn, issue.ratingKey);
        results.push(`${r.ok ? "fixed" : "no poster"}: ${issue.title}`);
      } catch (e) {
        results.push(`error: ${issue.title} (${e instanceof Error ? e.message : e})`);
      }
    }
    const fixed = results.filter((r) => r.startsWith("fixed")).length;
    return `Scanned ${scanned}; fixed ${fixed}/${issues.length}:\n${results.join("\n")}`;
  }
);

// ---- TMDB accuracy --------------------------------------------------------

tool(
  "tmdb_search",
  "Search TMDB for a movie or TV show. Returns tmdb ids for use with tmdb_movie_details.",
  { query: z.string(), type: z.enum(["movie", "tv"]).default("movie") },
  async ({ query, type }) => {
    const results = await tmdb.search(query, type);
    if (!results.length) return "No TMDB results.";
    return results.map((r) => `${r.tmdbId}\t${r.title} (${r.year})`).join("\n");
  }
);

tool(
  "tmdb_movie_details",
  "Get a movie's director(s), production companies, genres, and official franchise/collection membership from TMDB. Use to verify a collection member belongs.",
  { tmdbId: z.number() },
  async ({ tmdbId }) => {
    const d = await tmdb.movieDetails(tmdbId);
    return [
      `${d.title} (${d.year})`,
      `Directors: ${d.directors.join(", ") || "-"}`,
      `Studios: ${d.productionCompanies.join(", ") || "-"}`,
      `Genres: ${d.genres.join(", ") || "-"}`,
      `Franchise: ${d.belongsToCollection ? d.belongsToCollection.name : "none"}`,
    ].join("\n");
  }
);

tool(
  "tmdb_director_filmography",
  "List the films a director made, per TMDB. Use to find missing members or wrong attributions in a director collection.",
  { name: z.string() },
  async ({ name }) => {
    const { person, films } = await tmdb.directorFilmography(name);
    if (!films.length) return `No directed films found for "${name}".`;
    return `${person} directed:\n${films.map((f) => `${f.tmdbId}\t${f.title} (${f.year})`).join("\n")}`;
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("plex-collection-creator MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal MCP server error:", err);
  process.exit(1);
});
