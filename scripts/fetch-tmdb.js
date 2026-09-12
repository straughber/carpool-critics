/**
 * scripts/fetch-tmdb.js
 * Build-time script to enrich episode movie profiles via TMDb API
 * Usage: TMDB_READ_TOKEN="<token>" node scripts/fetch-tmdb.js
 *    OR: TMDB_API_KEY="<key>" node scripts/fetch-tmdb.js
 */
const fs = require('fs');
const path = require('path');

const TMDB_TOKEN = process.env.TMDB_READ_TOKEN;
const TMDB_KEY = process.env.TMDB_API_KEY;

if (!TMDB_TOKEN && !TMDB_KEY) {
  console.error('ERROR: TMDB_READ_TOKEN or TMDB_API_KEY environment variable required.');
  process.exit(1);
}

const headers = TMDB_TOKEN 
  ? { Authorization: `Bearer ${TMDB_TOKEN}`, Accept: 'application/json' }
  : { Accept: 'application/json' };

const episodesPath = path.join(__dirname, '../data/episodes.json');
const outputPath = path.join(__dirname, '../data/movies.json');

function formatRuntime(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h > 0 ? `${h}h ` : ''}${m}m`;
}

function getUsCertification(releaseDates) {
  if (!releaseDates || !releaseDates.results) return null;
  const us = releaseDates.results.find(r => r.iso_3166_1 === 'US');
  if (!us || !us.release_dates) return null;
  const rated = us.release_dates.find(d => d.certification && d.certification.trim() !== '');
  return rated ? rated.certification : null;
}

const episodeMovieQueries = {
  ep42: { query: 'Alien', year: 1979 },
  ep41: { query: 'Top Gun: Maverick', year: 2022 },
  ep40: { query: 'The Thing', year: 1982 }
};

async function fetchFromTmdb(endpoint, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  if (TMDB_KEY && !TMDB_TOKEN) {
    url.searchParams.set('api_key', TMDB_KEY);
  }
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`TMDb error ${res.status}: ${res.statusText}`);
  return res.json();
}

async function run() {
  const episodes = JSON.parse(fs.readFileSync(episodesPath, 'utf8'));
  const moviesCatalog = {};

  for (const ep of episodes) {
    const searchConfig = ep.movieQuery 
      ? { query: ep.movieQuery, year: ep.movieYear }
      : episodeMovieQueries[ep.id];

    if (!searchConfig || !searchConfig.query) {
      console.warn(`[Skip] No movie search configuration for ${ep.id}`);
      continue;
    }

    try {
      console.log(`[TMDb] Searching for "${searchConfig.query}" (${ep.id})...`);
      const searchRes = await fetchFromTmdb('/search/movie', {
        query: searchConfig.query,
        ...(searchConfig.year ? { year: searchConfig.year } : {})
      });

      if (!searchRes.results || searchRes.results.length === 0) {
        console.warn(`[TMDb] No results found for "${searchConfig.query}"`);
        continue;
      }

      const topMatch = searchRes.results[0];
      const details = await fetchFromTmdb(`/movie/${topMatch.id}`, {
        append_to_response: 'release_dates'
      });

      const year = details.release_date ? details.release_date.split('-')[0] : '';
      const runtime = formatRuntime(details.runtime);
      const certification = getUsCertification(details.release_dates);
      const genres = (details.genres || []).map(g => g.name).slice(0, 3);
      const posterPath = details.poster_path 
        ? `https://image.tmdb.org/t/p/w300${details.poster_path}`
        : null;

      moviesCatalog[ep.id] = {
        id: details.id,
        title: details.title,
        year,
        rating: details.vote_average ? details.vote_average.toFixed(1) : 'N/A',
        runtime,
        certification,
        genres,
        overview: details.overview,
        posterPath,
        tmdbUrl: `https://www.themoviedb.org/movie/${details.id}`
      };

      console.log(`[Success] Processed ${details.title} (${year}) for ${ep.id}`);
    } catch (err) {
      console.error(`[Error] Failed processing ${ep.id}:`, err.message);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(moviesCatalog, null, 2), 'utf8');
  console.log(`[Done] Generated static metadata file at: ${outputPath}`);
}

run();
