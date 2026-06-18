/**
 * Minimal TMDB client for the accuracy-audit tools. These give Claude the
 * building blocks to verify collection membership (director attribution,
 * official franchise/collection membership) the way it would by hand.
 *
 * Requires the TMDB_API_KEY environment variable.
 */
const TMDB = "https://api.themoviedb.org/3";

function apiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    throw new Error(
      "TMDB_API_KEY is not set — required for the tmdb_* tools. " +
        "Get a free key at https://www.themoviedb.org/settings/api"
    );
  }
  return key;
}

async function tmdbGet(
  path: string,
  params: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const url = new URL(TMDB + path);
  url.searchParams.set("api_key", apiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDB ${path} -> HTTP ${res.status}`);
  return res.json();
}

export interface TmdbSearchResult {
  tmdbId: number;
  title: string;
  year: string;
  overview: string;
}

export async function search(
  query: string,
  type: "movie" | "tv"
): Promise<TmdbSearchResult[]> {
  const data = await tmdbGet(`/search/${type}`, { query });
  const results = (data.results ?? []) as Record<string, unknown>[];
  return results.slice(0, 10).map((r) => {
    const date = (r.release_date ?? r.first_air_date ?? "") as string;
    return {
      tmdbId: r.id as number,
      title: (r.title ?? r.name ?? "") as string,
      year: date ? date.slice(0, 4) : "",
      overview: ((r.overview as string) ?? "").slice(0, 200),
    };
  });
}

export interface MovieDetails {
  tmdbId: number;
  title: string;
  year: string;
  directors: string[];
  productionCompanies: string[];
  genres: string[];
  belongsToCollection: { id: number; name: string } | null;
}

export async function movieDetails(tmdbId: number): Promise<MovieDetails> {
  const data = await tmdbGet(`/movie/${tmdbId}`, {
    append_to_response: "credits",
  });
  const credits = (data.credits ?? {}) as { crew?: { job: string; name: string }[] };
  const collection = data.belongs_to_collection as
    | { id: number; name: string }
    | null;
  return {
    tmdbId,
    title: (data.title as string) ?? "",
    year: ((data.release_date as string) ?? "").slice(0, 4),
    directors: (credits.crew ?? [])
      .filter((c) => c.job === "Director")
      .map((c) => c.name),
    productionCompanies: ((data.production_companies ?? []) as { name: string }[]).map(
      (c) => c.name
    ),
    genres: ((data.genres ?? []) as { name: string }[]).map((g) => g.name),
    belongsToCollection: collection
      ? { id: collection.id, name: collection.name }
      : null,
  };
}

export interface DirectedFilm {
  tmdbId: number;
  title: string;
  year: string;
}

/** Films directed by the person best matching `name`. */
export async function directorFilmography(
  name: string
): Promise<{ person: string; films: DirectedFilm[] }> {
  const found = await tmdbGet("/search/person", { query: name });
  const people = (found.results ?? []) as { id: number; name: string }[];
  if (people.length === 0) return { person: name, films: [] };
  const person = people[0];
  const credits = await tmdbGet(`/person/${person.id}/movie_credits`);
  const crew = (credits.crew ?? []) as {
    id: number;
    job: string;
    title?: string;
    release_date?: string;
  }[];
  const films = crew
    .filter((c) => c.job === "Director")
    .map((c) => ({
      tmdbId: c.id,
      title: c.title ?? "",
      year: (c.release_date ?? "").slice(0, 4),
    }))
    .sort((a, b) => a.year.localeCompare(b.year));
  return { person: person.name, films };
}
