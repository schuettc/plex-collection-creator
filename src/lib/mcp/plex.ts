/**
 * Plex operations for the MCP server.
 *
 * Reads (collections, collection items) reuse the existing web-app client.
 * Writes use Plex's tag-based collection editing, which is more robust across
 * server versions than the URI-based `POST /library/collections` flow:
 *   - additive (never disturbs an item's other collections)
 *   - auto-creates the collection when first tagging an item
 *   - one batched request for many items
 */
import {
  type PlexConnection,
  type PlexSection,
  sectionTypeId,
} from "./connection";

export interface PlexCollection {
  ratingKey: string;
  title: string;
  childCount?: number;
}

export interface CollectionItem {
  ratingKey: string;
  title: string;
  year?: number;
}

const headers = (token: string) => ({
  Accept: "application/json",
  "X-Plex-Token": token,
});

async function plexJson(
  conn: PlexConnection,
  path: string,
  params: Record<string, string | number> = {}
): Promise<Record<string, unknown>> {
  const url = new URL(conn.serverUrl + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: headers(conn.token) });
  if (!res.ok) throw new Error(`Plex GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

// ---- library items -------------------------------------------------------

export interface LibraryItem {
  ratingKey: string;
  title: string;
  year?: number;
  type: string;
  tmdbId?: number;
  thumb?: string;
  directors: string[];
  genres: string[];
}

interface RawItem {
  ratingKey: string;
  title: string;
  year?: number;
  type: string;
  thumb?: string;
  Guid?: { id: string }[];
  Genre?: { tag: string }[];
  Director?: { tag: string }[];
  Media?: { Part?: { file?: string }[] }[];
}

function extractTmdbId(item: RawItem): number | undefined {
  for (const g of item.Guid ?? []) {
    const m = /tmdb:\/\/(\d+)/.exec(g.id);
    if (m) return Number(m[1]);
  }
  // Fallback: {tmdb-12345} embedded in the file path
  for (const media of item.Media ?? []) {
    for (const part of media.Part ?? []) {
      const m = /\{tmdb-(\d+)\}/.exec(part.file ?? "");
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}

/** Fetch all items in a section (paginated), including TMDB ids and posters. */
export async function listItems(
  conn: PlexConnection,
  section: PlexSection,
  search?: string
): Promise<LibraryItem[]> {
  const PAGE = 200;
  const out: LibraryItem[] = [];
  let offset = 0;
  for (;;) {
    const data = await plexJson(conn, `/library/sections/${section.key}/all`, {
      includeGuids: 1,
      "X-Plex-Container-Start": offset,
      "X-Plex-Container-Size": PAGE,
    });
    const mc = (data.MediaContainer ?? {}) as {
      totalSize?: number;
      size?: number;
      Metadata?: RawItem[];
    };
    const page = mc.Metadata ?? [];
    for (const it of page) {
      out.push({
        ratingKey: it.ratingKey,
        title: it.title,
        year: it.year,
        type: it.type,
        tmdbId: extractTmdbId(it),
        thumb: it.thumb,
        directors: (it.Director ?? []).map((d) => d.tag),
        genres: (it.Genre ?? []).map((g) => g.tag),
      });
    }
    const total = mc.totalSize ?? out.length;
    offset += PAGE;
    if (page.length === 0 || offset >= total) break;
  }

  if (search) {
    const q = search.toLowerCase();
    return out.filter((i) => i.title.toLowerCase().includes(q));
  }
  return out;
}

// ---- collections ---------------------------------------------------------

export async function listCollections(
  conn: PlexConnection,
  section: PlexSection
): Promise<PlexCollection[]> {
  const data = await plexJson(
    conn,
    `/library/sections/${section.key}/collections`
  );
  const mc = (data.MediaContainer ?? {}) as { Metadata?: PlexCollection[] };
  return (mc.Metadata ?? []).map((c) => ({
    ratingKey: c.ratingKey,
    title: c.title,
    childCount: c.childCount,
  }));
}

export async function findCollection(
  conn: PlexConnection,
  section: PlexSection,
  name: string
): Promise<PlexCollection | undefined> {
  const all = await listCollections(conn, section);
  const q = name.toLowerCase().trim();
  return all.find((c) => c.title.toLowerCase().trim() === q);
}

export async function collectionItems(
  conn: PlexConnection,
  collectionKey: string
): Promise<CollectionItem[]> {
  const data = await plexJson(
    conn,
    `/library/collections/${collectionKey}/children`
  );
  const mc = (data.MediaContainer ?? {}) as { Metadata?: CollectionItem[] };
  return (mc.Metadata ?? []).map((i) => ({
    ratingKey: i.ratingKey,
    title: i.title,
    year: i.year,
  }));
}

/**
 * Add or remove a collection tag on the given items. Tagging auto-creates the
 * collection; the edit is additive and leaves other collections intact.
 */
export async function setCollection(
  conn: PlexConnection,
  section: PlexSection,
  name: string,
  ratingKeys: string[],
  remove = false
): Promise<void> {
  if (ratingKeys.length === 0) return;
  const url = new URL(conn.serverUrl + `/library/sections/${section.key}/all`);
  url.searchParams.set("type", String(sectionTypeId(section)));
  url.searchParams.set("id", ratingKeys.join(","));
  url.searchParams.set(
    remove ? "collection[].tag.tag-" : "collection[0].tag.tag",
    name
  );
  if (!remove) url.searchParams.set("collection.locked", "1");

  const res = await fetch(url.toString(), {
    method: "PUT",
    headers: headers(conn.token),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to ${remove ? "remove from" : "write"} collection "${name}" -> HTTP ${res.status}`
    );
  }
}

export async function deleteCollection(
  conn: PlexConnection,
  collectionKey: string
): Promise<void> {
  const res = await fetch(
    `${conn.serverUrl}/library/collections/${collectionKey}`,
    { method: "DELETE", headers: headers(conn.token) }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete collection -> HTTP ${res.status}`);
  }
}

export async function scanSection(
  conn: PlexConnection,
  section: PlexSection
): Promise<void> {
  const res = await fetch(
    `${conn.serverUrl}/library/sections/${section.key}/refresh`,
    { headers: headers(conn.token) }
  );
  if (!res.ok) throw new Error(`Failed to trigger scan -> HTTP ${res.status}`);
}

// ---- posters --------------------------------------------------------------

/** Read width/height from a JPEG or PNG buffer without any image library. */
export function imageDimensions(
  buf: Uint8Array
): { width: number; height: number } | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // PNG: signature + IHDR width/height at bytes 16..24
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG: scan segments for a Start-Of-Frame marker
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + dv.getUint16(i + 2);
    }
  }
  return null;
}

export interface PosterIssue {
  ratingKey: string;
  title: string;
  year?: number;
  dimensions: string;
  ratio: number | null; // width/height; null = unreadable
}

async function posterRatio(
  conn: PlexConnection,
  thumb: string
): Promise<{ dims: string; ratio: number | null }> {
  const url = `${conn.serverUrl}${thumb}?X-Plex-Token=${conn.token}`;
  const res = await fetch(url);
  if (!res.ok) return { dims: "?", ratio: null };
  const buf = new Uint8Array(await res.arrayBuffer());
  const d = imageDimensions(buf);
  if (!d) return { dims: "?", ratio: null };
  return { dims: `${d.width}x${d.height}`, ratio: d.width / d.height };
}

async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/**
 * Find items whose current poster is not portrait-shaped — i.e. frame-grabs,
 * banners, or square crops rather than real posters. A legit poster is ~2:3
 * (ratio ~0.67); anything with ratio > 0.9 (or unreadable) is flagged.
 */
export async function auditPosters(
  conn: PlexConnection,
  section: PlexSection
): Promise<{ scanned: number; issues: PosterIssue[] }> {
  const items = (await listItems(conn, section)).filter((i) => i.thumb);
  const results = await inBatches(items, 12, async (it) => {
    const { dims, ratio } = await posterRatio(conn, it.thumb!);
    return { it, dims, ratio };
  });
  const issues: PosterIssue[] = [];
  for (const { it, dims, ratio } of results) {
    if (ratio === null || ratio > 0.9) {
      issues.push({
        ratingKey: it.ratingKey,
        title: it.title,
        year: it.year,
        dimensions: dims,
        ratio,
      });
    }
  }
  return { scanned: items.length, issues };
}

interface PosterOption {
  provider?: string;
  key: string;
  selected?: boolean;
}

export async function getPosterOptions(
  conn: PlexConnection,
  ratingKey: string
): Promise<PosterOption[]> {
  const data = await plexJson(conn, `/library/metadata/${ratingKey}/posters`);
  const mc = (data.MediaContainer ?? {}) as { Metadata?: PosterOption[] };
  return mc.Metadata ?? [];
}

export async function setPoster(
  conn: PlexConnection,
  ratingKey: string,
  posterKey: string
): Promise<void> {
  const url = new URL(`${conn.serverUrl}/library/metadata/${ratingKey}/poster`);
  url.searchParams.set("url", posterKey);
  const res = await fetch(url.toString(), {
    method: "PUT",
    headers: headers(conn.token),
  });
  if (!res.ok) throw new Error(`Failed to set poster -> HTTP ${res.status}`);
}

/**
 * Replace an item's poster. If `posterUrl` is given it is used directly;
 * otherwise the first remote (TMDB/TVDB) poster — always a real portrait
 * poster — is selected.
 */
export async function fixPoster(
  conn: PlexConnection,
  ratingKey: string,
  posterUrl?: string
): Promise<{ ok: boolean; chosen?: string }> {
  let key = posterUrl;
  if (!key) {
    const options = await getPosterOptions(conn, ratingKey);
    const remote = options.find(
      (p) =>
        ["tmdb", "themoviedb", "tvdb", "thetvdb"].includes(p.provider ?? "") &&
        p.key.startsWith("http")
    );
    key = remote?.key;
  }
  if (!key) return { ok: false };
  await setPoster(conn, ratingKey, key);
  return { ok: true, chosen: key };
}
