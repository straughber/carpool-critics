/**
 * scripts/fetch-youtube.js
 * Build-time script to build data/episodes.json from the Carpool Critics channel.
 * Usage: node scripts/fetch-youtube.js
 *
 * Strategy (zero API key, zero quota):
 *   1. YouTube channel RSS feed  -> video ids, titles, publish dates
 *   2. Channel /videos page      -> fallback for when RSS has not refreshed yet
 *   3. Per-video watch page      -> real duration + full description + chapters
 *
 * No network calls happen in the browser and no key is ever exposed to a visitor.
 */
const fs = require('fs');
const path = require('path');

const CHANNEL_ID = process.env.YT_CHANNEL_ID || 'UCqd2FV1LVePtMzLAUEtaWOQ';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const BOT_UA = 'Mozilla/5.0 (compatible; CarpoolCriticsBuild/1.0; +https://straughber.github.io/carpool-critics/)';

const episodesPath = path.join(__dirname, '../data/episodes.json');

// ========================================================
// 1. FETCH HELPERS
// ========================================================
async function get(url, ua = UA) {
  const res = await fetch(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Channel RSS feed. Fast, keyless, but can lag behind a fresh upload. */
async function fetchFeedEntries() {
  // A neutral UA is required: YouTube 404s the feed for browser-like agents.
  const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`, BOT_UA);
  const entries = [];
  const blocks = xml.split('<entry>').slice(1);
  for (const block of blocks) {
    const id = (block.match(/<yt:videoId>([^<]+)</) || [])[1];
    if (!id) continue;
    entries.push({
      videoId: id,
      title: decode((block.match(/<media:title>([^<]*)</) || [])[1]),
      publishedAt: (block.match(/<published>([^<]+)</) || [])[1] || null
    });
  }
  return entries;
}

/** Fallback: scrape the /videos tab for ids when the RSS feed is stale. */
async function fetchChannelVideoIds() {
  const html = await get(`https://www.youtube.com/@CarpoolCritics/videos`);
  const ids = new Set();
  for (const match of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) {
    ids.add(match[1]);
  }
  return [...ids].map(videoId => ({ videoId, title: null, publishedAt: null }));
}

/** Authoritative per-video metadata straight from the watch page. */
async function fetchVideoDetails(videoId) {
  const html = await get(`https://www.youtube.com/watch?v=${videoId}`);
  const title = (html.match(/<meta name="title" content="([^"]*)"/) || [])[1];
  const lengthSeconds = (html.match(/"lengthSeconds":"(\d+)"/) || [])[1];
  const uploadDate = (html.match(/"uploadDate":"([^"]+)"/) || [])[1];
  const description = (html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/) || [])[1];
  return {
    title: decode(title),
    lengthSeconds: lengthSeconds ? parseInt(lengthSeconds, 10) : null,
    publishedAt: uploadDate || null,
    description: description ? decode(description) : ''
  };
}

// ========================================================
// 2. PARSING & FORMATTING
// ========================================================
/** Watch-page strings arrive JSON-escaped; meta-tag strings arrive HTML-escaped. */
function decode(str) {
  if (!str) return '';
  let out;
  try {
    out = JSON.parse(`"${str}"`);
  } catch {
    out = String(str)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return htmlUnescape(out);
}

function htmlUnescape(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function formatDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

/** "00:00 - Will He Get Pooped Out?" -> structured chapter list. */
function parseChapters(description) {
  const chapters = [];
  const lines = (description || '').split('\n');
  let inBlock = false;
  for (const line of lines) {
    if (/^\s*(⏱\s*)?CHAPTERS\s*:?\s*$/i.test(line)) { inBlock = true; continue; }
    const match = line.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(.+?)\s*$/);
    if (match) { chapters.push({ time: match[1], label: match[2] }); inBlock = true; continue; }
    if (inBlock && !match && line.trim() === '') { continue; }
    if (inBlock && !match && chapters.length) break;
  }
  return chapters;
}

/** First real paragraph of the description, chapters stripped. */
function firstParagraph(description) {
  const cleaned = (description || '')
    .split('\n')
    .filter(line => !/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]/.test(line))
    .filter(line => !/CHAPTERS\s*:?/i.test(line))
    .join('\n');
  const para = cleaned.split(/\n\s*\n/).map(p => p.trim()).find(p => p.length > 40);
  return para || '';
}

/** "Whalefall: An Extremely Aggressive Way to Avoid Your Problems" -> "Whalefall" */
function deriveShortName(title) {
  if (!title) return '';
  const head = title.split(/\s*[:|•—]\s*/)[0].trim();
  return head.length >= 3 ? head : title.trim();
}

/** Best-effort movie guess from the title (overridable via movieQuery in JSON). */
function deriveMovieQuery(title) {
  const short = deriveShortName(title);
  return short ? { movieQuery: short, movieYear: null } : {};
}

// ========================================================
// 3. BUILD
// ========================================================
async function run() {
  // Preserve hand-authored fields (transcripts, movie overrides) across runs.
  let previous = [];
  try {
    previous = JSON.parse(fs.readFileSync(episodesPath, 'utf8'));
  } catch {
    previous = [];
  }
  const previousByVideoId = new Map(previous.map(ep => [ep.youtubeId, ep]));

  console.log(`[YouTube] Reading channel ${CHANNEL_ID}...`);
  let entries = [];
  try {
    entries = await fetchFeedEntries();
    console.log(`[YouTube] RSS feed returned ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
  } catch (err) {
    // YouTube serves this feed inconsistently for new/small channels; not fatal.
    console.log('[YouTube] RSS feed unavailable, using channel page instead.');
  }

  if (entries.length === 0) {
    console.log('[YouTube] RSS empty or stale, reading the channel /videos page.');
    try {
      entries = await fetchChannelVideoIds();
      console.log(`[YouTube] Channel page returned ${entries.length} video id(s).`);
    } catch (err) {
      console.warn(`[YouTube] Channel page failed: ${err.message}`);
    }
  }

  if (entries.length === 0) {
    console.warn('[YouTube] No public uploads found. Leaving data/episodes.json untouched.');
    return;
  }

  const episodes = [];
  for (const entry of entries) {
    let details;
    try {
      details = await fetchVideoDetails(entry.videoId);
    } catch (err) {
      console.warn(`[YouTube] Could not read ${entry.videoId}: ${err.message}`);
      details = { title: entry.title, lengthSeconds: null, publishedAt: entry.publishedAt, description: '' };
    }

    const prior = previousByVideoId.get(entry.videoId) || {};
    const title = prior.title || details.title || entry.title || 'Untitled Episode';
    const publishedAt = details.publishedAt || entry.publishedAt || null;
    const description = details.description || '';
    const chapters = parseChapters(description);

    // Auto-wire a transcript as soon as the file lands in data/transcripts/.
    const episodeId = prior.id || (prior.number ? `ep${prior.number}` : null);
    const localTranscript = episodeId ? `data/transcripts/${episodeId}.json` : null;
    const transcriptFile = prior.transcriptFile
      || (localTranscript && fs.existsSync(path.join(__dirname, '..', localTranscript)) ? localTranscript : null);

    // The YouTube blurb is the default, but a hand-written correction in
    // "descriptionOverride" always wins so a sync never clobbers it.
    const freshDescription = firstParagraph(description);

    episodes.push({
      youtubeId: entry.videoId,
      title,
      shortTitle: prior.shortTitle || null, // filled below once numbering is known
      duration: formatDuration(details.lengthSeconds) || prior.duration || null,
      durationSeconds: details.lengthSeconds || prior.durationSeconds || null,
      publishedAt,
      date: null, // computed in the browser from publishedAt
      description: prior.descriptionOverride || freshDescription || prior.description || '',
      descriptionOverride: prior.descriptionOverride || null,
      thumbnail: `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`,
      chapters: chapters.length ? chapters : (prior.chapters || []),
      movieQuery: prior.movieQuery || deriveMovieQuery(title).movieQuery || null,
      movieYear: prior.movieYear || deriveMovieQuery(title).movieYear || null,
      transcriptFile,
      number: prior.number || null,
      id: prior.id || null
    });
  }

  // Number chronologically so the oldest upload is Episode 1.
  episodes.sort((a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0));
  episodes.forEach((ep, index) => {
    if (!ep.number) ep.number = index + 1;
    if (!ep.id) ep.id = `ep${ep.number}`;
    if (!ep.shortTitle) ep.shortTitle = `Ep. ${ep.number}: ${deriveShortName(ep.title)}`;
  });
  episodes.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  // Stable key order for clean git diffs.
  const ordered = episodes.map(ep => ({
    id: ep.id,
    number: ep.number,
    title: ep.title,
    shortTitle: ep.shortTitle,
    youtubeId: ep.youtubeId,
    duration: ep.duration,
    durationSeconds: ep.durationSeconds,
    publishedAt: ep.publishedAt,
    date: ep.date,
    description: ep.description,
    descriptionOverride: ep.descriptionOverride,
    thumbnail: ep.thumbnail,
    chapters: ep.chapters,
    movieQuery: ep.movieQuery,
    movieYear: ep.movieYear,
    transcriptFile: ep.transcriptFile
  }));

  fs.writeFileSync(episodesPath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  console.log(`[YouTube] Wrote ${ordered.length} episode(s) to data/episodes.json`);
  ordered.forEach(ep => console.log(`  - ${ep.id} | ${ep.duration || '?:??'} | ${ep.shortTitle}`));
}

run().catch(err => {
  console.error('[YouTube] Fatal:', err);
  process.exit(1);
});
