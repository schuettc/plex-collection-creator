---
name: organize-collections
description: Create and curate Plex collections (franchises, director sets, themes) using the plex-collection-creator MCP tools. Use when a user wants to build, populate, or tidy collections in their Plex library via Claude Code.
---

# Organize Plex collections

Use the MCP server's tools to build accurate collections. Requires the MCP
server connected — see [[setup-mcp]].

## Core workflow
1. **Pick the library**: `list_libraries` (or just pass `movie` / `tv`).
2. **Get the items**: `list_items` with the library. Each row is
   `ratingKey  title (year)  tmdb=<id>`. The **ratingKey** is what the
   collection tools take; the **tmdb id** is for matching against franchises/
   filmographies.
3. **Decide groupings** from the item list:
   - **Franchises** — Alien, Harry Potter, MCU, etc.
   - **Directors** — Nolan, Tarantino, Villeneuve (verify with
     `tmdb_director_filmography`; see [[audit-library]]).
   - **Themes** — A24, baseball movies, 90s thrillers.
4. **Create / populate**: `create_or_update_collection(library, name, ratingKeys)`.
   - It **auto-creates** the collection if missing, otherwise **adds** to it.
   - It is **idempotent and additive** — re-running is safe, and an item keeps
     its other collection memberships (a film can live in many collections).
5. **Verify**: `list_collections` for counts; `get_collection(library, name)`
   to see members.

## Adjusting membership
- Add more later: `add_to_collection(library, name, ratingKeys)`.
- Remove wrong entries: `remove_from_collection(library, name, ratingKeys)`.
- Delete a collection (media is untouched): `delete_collection(library, name)`.

## Tips
- Map titles → ratingKeys via the `list_items` output; prefer matching by tmdb
  id when reconciling against TMDB results — it's unique.
- Batch all of a collection's ratingKeys into one
  `create_or_update_collection` call rather than one-by-one.
- For TV, items may not carry tmdb ids; match by exact title from `list_items`.
- After big changes, optionally `scan_library` so Plex refreshes metadata.

## Example
> "Group my Alien movies."
1. `list_items movie` → collect the ratingKeys for Alien, Aliens, Alien³,
   Resurrection, Prometheus, Covenant, Romulus.
2. `create_or_update_collection(movie, "Alien Franchise", [<those ratingKeys>])`.
3. `get_collection(movie, "Alien Franchise")` to confirm.
