---
name: audit-library
description: Quality-check a Plex library via the plex-collection-creator MCP tools — verify collection accuracy against TMDB and replace bad posters (frame-grabs, banners) with official artwork. Use when a user wants to clean up, audit, or verify the accuracy of their collections or posters.
---

# Audit & clean up a Plex library

Two independent passes, both using the MCP server (see [[setup-mcp]]). Requires
`TMDB_API_KEY` for the accuracy pass.

## Pass 1 — Poster cleanup
Plex sometimes shows a video frame-grab or banner instead of a real poster.

1. `audit_posters(library)` — flags items whose artwork isn't portrait-shaped
   (real posters are ~2:3; frame-grabs/banners are wider, square crops ~1:1).
2. Fix them:
   - All at once: `fix_all_posters(library)` — audits then replaces each flagged
     item with its official portrait poster.
   - One at a time: `fix_poster(ratingKey)`, or `fix_poster(ratingKey, posterUrl)`
     to set a specific image.
3. Re-run `audit_posters` to confirm none remain.

## Pass 2 — Collection accuracy
Make sure each collection actually contains the right titles.

For every **franchise / director / theme** collection:
1. `get_collection(library, name)` — list current members.
2. Verify membership against TMDB:
   - **Director collections**: `tmdb_director_filmography(name)` → the films they
     actually directed. Cross-check against the library (`list_items`).
   - **Any title in doubt**: `tmdb_movie_details(tmdbId)` → confirms director,
     studio, and official franchise (`belongs_to_collection`).
3. Correct it:
   - Wrong member (not actually by that director / not in that franchise):
     `remove_from_collection(library, name, [ratingKey])`.
   - Missing title you own: `add_to_collection(library, name, [ratingKey])`.
   - Redundant/duplicate collection (its lone title already lives elsewhere):
     `delete_collection(library, name)`.

### Common accuracy traps to check
- A sequel directed by someone else (e.g. *Sicario: Day of the Soldado* is **not**
  Denis Villeneuve).
- "Studio" collections that mean **distributor**, not production company —
  confirm intent before removing (TMDB lists production companies).
- Standalone films mistaken for a shared universe (e.g. Toho's *Godzilla Minus
  One* is **not** the Legendary MonsterVerse).
- A collection named for a sub-universe that's been filled with the director's
  unrelated films — decide whether to fix membership or rename.

## Reporting
Summarize findings as: collections fixed (what was added/removed and why),
posters replaced (count), and any judgment calls to confirm with the user before
deleting collections.
