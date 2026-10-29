/**
 * scripts/fetch-youtube.js
 * Build-time script to build data/episodes.json from the Carpool Critics channel.
 * Usage: node scripts/fetch-youtube.js
 *
 * Strategy:
 *   1. YouTube Data API -> exact ids, titles, durations, descriptions (when
 *      YOUTUBE_API_KEY is set)
 *   2. Channel RSS feed  -> keyless fallback for ids/titles/dates
 *   3. Channel /videos page -> fallback when RSS has not refreshed
 *   4. Per-video watch page -> fallback for duration + description + chapters
 *
 * No network calls happen in the browser and no key is ever exposed to a visitor.
 */
const fs = require('fs');
const path = require('path');

const CHANNEL_ID = process.env.YT_CHANNEL_ID || 'UCqd2FV1LVePtMzLAUEtaWOQ';
const API_KEY = process.env.YOUTUBE_API_KEY || '';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const BOT_UA = 'Mozilla/5.0 (compatible; CarpoolCriticsBuild/1.0; +https://carpoolcritics.com/)';

const episodesPath = path.join(__dirname, '../data/episodes.json');
const pipelineDir = path.join(__dirname, '../data/pipeline');

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
// 1b. YOUTUBE DATA API (when YOUTUBE_API_KEY is present)
// ========================================================
// The API is exact: title, description, duration and upload date in one pass,
// with no watch-page scraping. If it fails or the key is absent, the scrapers
// below remain the fallback and the build still works with zero credentials.
function parseISODuration(value) {
  const match = String(value || '').match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return Math.round(
    parseInt(days || '0', 10) * 86400
    + parseInt(hours || '0', 10) * 3600
    + parseInt(minutes || '0', 10) * 60
    + parseFloat(seconds || '0')
  );
}

async function apiJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Data API HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchApiCatalog() {
  const channel = await apiJson(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${encodeURIComponent(CHANNEL_ID)}&key=${encodeURIComponent(API_KEY)}`
  );
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('channel has no uploads playlist');

  const ids = [];
  let pageToken = '';
  do {
    const page = await apiJson(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(uploads)}&key=${encodeURIComponent(API_KEY)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    );
    for (const item of page.items || []) {
      const id = item.contentDetails?.videoId;
      if (id) ids.push(id);
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  const entries = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await apiJson(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${batch.join(',')}&maxResults=50&key=${encodeURIComponent(API_KEY)}`
    );
    for (const item of data.items || []) {
      const videoId = item.id;
      const snippet = item.snippet || {};
      entries.push({
        videoId,
        title: snippet.title || null,
        publishedAt: snippet.publishedAt || null,
        details: {
          title: snippet.title || null,
          lengthSeconds: parseISODuration(item.contentDetails?.duration),
          publishedAt: snippet.publishedAt || null,
          description: snippet.description || ''
        }
      });
    }
  }
  return entries;
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

/** Minimal, dependency-free URL segment: "Ep. 1: Whalefall" -> "whalefall" */
function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'episode';
}

/** Best-effort movie guess from the title (overridable via movieQuery in JSON). */
function deriveMovieQuery(title) {
  const short = deriveShortName(title);
  return short ? { movieQuery: short, movieYear: null } : {};
}

// ========================================================
// 2b. PIPELINE PAYLOADS (authoritative content)
// ========================================================
/**
 * tools/export_website_payload.py writes one JSON file per finished episode.
 * These carry the real title, description, chapters, transcript, host seats and
 * scorecards, so the site does not have to rediscover them from YouTube.
 *
 * YouTube remains authoritative for exactly two things: the video id and
 * whether the video is public.
 */
function loadPipelinePayloads() {
  try {
    return fs.readdirSync(pipelineDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          return JSON.parse(fs.readFileSync(path.join(pipelineDir, file), 'utf8'));
        } catch (err) {
          console.warn(`[YouTube] Ignoring malformed payload ${file}: ${err.message}`);
          return null;
        }
      })
      .filter(payload => payload && payload.siteId);
  } catch {
    return [];
  }
}

/** Pipeline content wins; the scraper only fills gaps. */
function applyPipelinePayload(episode, payload) {
  if (!payload) return episode;
  const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
  return {
    ...episode,
    id: first(payload.siteId, episode.id),
    number: first(payload.number, episode.number),
    slug: first(payload.slug, episode.slug),
    title: first(episode.title, payload.title),
    shortTitle: first(payload.shortTitle, episode.shortTitle),
    // YouTube's own duration wins for a public video; the pipeline's master
    // duration is the fallback for scheduled/draft episodes.
    duration: first(episode.duration, payload.duration),
    durationSeconds: first(episode.durationSeconds, payload.durationSeconds),
    publishedAt: first(episode.publishedAt, payload.publishedAt),
    description: first(payload.descriptionOverride, payload.description, episode.description),
    descriptionOverride: first(payload.descriptionOverride, episode.descriptionOverride),
    thumbnail: first(episode.thumbnail, payload.thumbnail),
    chapters: payload.chapters && payload.chapters.length ? payload.chapters : episode.chapters,
    movieQuery: first(payload.movieQuery, episode.movieQuery),
    movieYear: first(payload.movieYear, episode.movieYear),
    transcriptFile: first(payload.transcriptFile, episode.transcriptFile),
    status: first(episode.status, payload.status, 'live'),
    publishAt: first(payload.publishAt, episode.publishAt)
  };
}

function emptyEpisode(videoId) {
  return {
    youtubeId: videoId,
    title: null,
    shortTitle: null,
    duration: null,
    durationSeconds: null,
    publishedAt: null,
    date: null,
    description: '',
    descriptionOverride: null,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    chapters: [],
    movieQuery: null,
    movieYear: null,
    transcriptFile: null,
    number: null,
    id: null,
    slug: null,
    status: null,
    publishAt: null
  };
}

// ========================================================
// 2c. SHORTS ARE NOT EPISODES
// ========================================================
// The site is a catalogue of full-length episodes. A Short is a vertical clip
// cut from an approved episode - it has no act structure, no film and no
// transcript - so it must never take an "Ep. N", a slug or a page. The runtime
// check alone has already let one through in production: the watch-page scrape
// returned no `lengthSeconds` for the Short, the guard was skipped, and
// "Ep. 2: Dave's Whalefall score, argued at 0 mph" went live. So there are three
// independent tests, and a video is only catalogued when it passes all of them:
//
//   1. measured runtime    - every Short on this channel is under five minutes
//   2. /shorts/<id> probe  - YouTube redirects a normal video to /watch, so an
//                            unknown runtime can still be resolved
//   3. the Shorts ledgers  - the exact video ids this pipeline uploaded
//
// A video that cannot be proven full-length is never added, and is never
// deleted either: it is deferred to the next build, where a real episode's
// runtime will be readable.
const SHORT_MAX_SECONDS = 300;
const WORKSPACE_ROOT = path.join(__dirname, '..', '..');

/** Every 11-character video id stored under a video_id/videoId key. */
function collectVideoIds(node, ids = new Set()) {
  if (!node) return ids;
  if (Array.isArray(node)) {
    for (const item of node) collectVideoIds(item, ids);
    return ids;
  }
  if (typeof node !== 'object') return ids;
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'video_id' || key === 'videoId') && typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value)) {
      ids.add(value);
    } else if (value && typeof value === 'object') {
      collectVideoIds(value, ids);
    }
  }
  return ids;
}

/**
 * The Shorts this pipeline actually uploaded: the channel-wide release ledger,
 * every episode's Shorts manifests/drafts, and any payload that still lists them.
 * This is the one check that cannot be fooled by a failed scrape, because the
 * uploader wrote these ids down itself.
 */
function loadKnownShortVideoIds(payloads = []) {
  const ids = new Set();
  const readInto = file => {
    try {
      collectVideoIds(JSON.parse(fs.readFileSync(file, 'utf8')), ids);
    } catch {
      // Absent or malformed ledger: no contribution.
    }
  };
  readInto(path.join(WORKSPACE_ROOT, 'logs', 'shorts_schedule_ledger.json'));
  for (const payload of payloads) collectVideoIds(payload && payload.shorts, ids);
  try {
    const episodesRoot = path.join(WORKSPACE_ROOT, 'episodes');
    for (const entry of fs.readdirSync(episodesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const shortsDir = path.join(episodesRoot, entry.name, '04_Shorts');
      if (!fs.existsSync(shortsDir)) continue;
      for (const file of fs.readdirSync(shortsDir)) {
        if (file.endsWith('.json')) readInto(path.join(shortsDir, file));
      }
    }
  } catch {
    // No episodes directory (a bare site checkout): the ledgers above still apply.
  }
  return ids;
}

/** True when YouTube serves this id at /shorts/; a normal video redirects to /watch. */
async function probeIsShort(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en' }
    });
    if (!res.ok) return null;
    return /\/shorts\//.test(res.url || '');
  } catch {
    return null;
  }
}

/**
 * Why this video is not a full-length episode, or null when it is one.
 * `UNPROVEN` means neither the runtime nor the probe could answer: the caller
 * defers the video instead of guessing.
 */
const UNPROVEN = 'unproven';
async function shortReasonFor(videoId, lengthSeconds, knownShortIds) {
  if (knownShortIds.has(videoId)) return 'listed in the Shorts ledger';
  const seconds = Number(lengthSeconds);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds < SHORT_MAX_SECONDS ? `${seconds}s runtime` : null;
  }
  const probe = await probeIsShort(videoId);
  if (probe === true) return 'YouTube serves it at /shorts/';
  if (probe === null) return UNPROVEN;
  return null;
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

  // Finished episodes exported by tools/export_website_payload.py. These are
  // the authoritative content source; the scrape below is enrichment only.
  const pipeline = loadPipelinePayloads();
  const pipelineByVideoId = new Map(
    pipeline.filter(payload => payload.youtubeId).map(payload => [payload.youtubeId, payload])
  );
  const pipelineLive = pipeline.filter(payload => payload.status === 'live' && payload.youtubeId);
  const knownShortIds = loadKnownShortVideoIds(pipeline);
  if (knownShortIds.size) {
    console.log(`[YouTube] ${knownShortIds.size} known Short id(s) will never be catalogued as episodes.`);
  }
  if (pipeline.length) {
    console.log(`[YouTube] ${pipeline.length} pipeline payload(s), ${pipelineLive.length} live.`);
  }

  console.log(`[YouTube] Reading channel ${CHANNEL_ID}...`);
  let entries = [];
  if (API_KEY) {
    try {
      entries = await fetchApiCatalog();
      console.log(`[YouTube] Data API returned ${entries.length} video(s).`);
    } catch (err) {
      console.warn(`[YouTube] Data API failed (${err.message}); falling back to scrape.`);
    }
  }

  if (entries.length === 0) {
    try {
      entries = await fetchFeedEntries();
      console.log(`[YouTube] RSS feed returned ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`);
    } catch (err) {
      // YouTube serves this feed inconsistently for new/small channels; not fatal.
      console.log('[YouTube] RSS feed unavailable, using channel page instead.');
    }
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
    if (pipelineLive.length) {
      console.log('[YouTube] Scrape unavailable; rebuilding from live pipeline payloads.');
      entries = pipelineLive.map(payload => ({
        videoId: payload.youtubeId,
        title: payload.title,
        publishedAt: payload.publishedAt
      }));
    } else {
      console.warn('[YouTube] No public uploads and no live pipeline payloads. Leaving data/episodes.json untouched.');
      return;
    }
  }

  const episodes = [];
  // Videos this build positively identified as Shorts. They are not catalogued,
  // and they are not "kept from the previous catalog" either, so a leaked Short
  // is evicted on the next build instead of being pinned forever.
  const excludedVideoIds = new Set();
  for (const entry of entries) {
    const payload = pipelineByVideoId.get(entry.videoId) || null;
    let details;
    if (entry.details) {
      details = entry.details;
    } else {
      try {
        details = await fetchVideoDetails(entry.videoId);
      } catch (err) {
        console.warn(`[YouTube] Could not read ${entry.videoId}: ${err.message}`);
        details = { title: entry.title, lengthSeconds: null, publishedAt: entry.publishedAt, description: '' };
      }
    }

    // A Short is never an episode: it has no act structure, no film and no
    // transcript, and it must never take an "Ep. N" next to the real episodes.
    const shortReason = await shortReasonFor(entry.videoId, details.lengthSeconds, knownShortIds);
    if (shortReason === UNPROVEN) {
      console.warn(`[YouTube] Deferring ${entry.videoId}: runtime unknown and the /shorts/ probe failed (will retry next build)`);
      continue;
    }
    if (shortReason) {
      console.log(`[YouTube] Skipping ${entry.videoId}: Short, not an episode (${shortReason})`);
      excludedVideoIds.add(entry.videoId);
      continue;
    }

    const prior = previousByVideoId.get(entry.videoId) || {};
    // The live channel is authoritative for the title. The previous catalog is
    // a fallback for a transient scrape failure, never a pin.
    const title = details.title || prior.title || entry.title || 'Untitled Episode';
    const publishedAt = details.publishedAt || entry.publishedAt || null;
    const description = details.description || '';
    const chapters = parseChapters(description);

    // Auto-wire a transcript as soon as the file lands in data/transcripts/.
    const episodeId = prior.id || (prior.number ? `ep${prior.number}` : null);
    const localTranscript = episodeId ? `data/transcripts/${episodeId}.json` : null;
    const transcriptFile = prior.transcriptFile
      || (localTranscript && fs.existsSync(path.join(__dirname, '..', localTranscript)) ? localTranscript : null);

    // The YouTube blurb is the default. A descriptionOverride exists for exactly
    // one reason: the canonical TMDb year differs from the year YouTube carries.
    // Once the live description already says the right year, the override is
    // stale and must be dropped - otherwise it pins the old copy forever and a
    // corrected upload never reaches the page.
    const freshDescription = firstParagraph(description);
    const canonicalYear = prior.movieYear || deriveMovieQuery(title).movieYear || null;
    // The year lives in the credit line, not necessarily the first paragraph,
    // so check the whole live description.
    const freshHasCanonicalYear = canonicalYear
      ? String(description || '').includes(`(${canonicalYear})`)
      : true;
    const keepOverride = Boolean(prior.descriptionOverride) && !freshHasCanonicalYear;

    episodes.push(applyPipelinePayload({
      youtubeId: entry.videoId,
      title,
      shortTitle: prior.shortTitle || null, // filled below once numbering is known
      duration: formatDuration(details.lengthSeconds) || prior.duration || null,
      durationSeconds: details.lengthSeconds || prior.durationSeconds || null,
      publishedAt,
      date: null, // computed in the browser from publishedAt
      description: keepOverride
        ? prior.descriptionOverride
        : (freshDescription || prior.description || ''),
      descriptionOverride: keepOverride ? prior.descriptionOverride : null,
      thumbnail: `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`,
      chapters: chapters.length ? chapters : (prior.chapters || []),
      movieQuery: prior.movieQuery || deriveMovieQuery(title).movieQuery || null,
      movieYear: prior.movieYear || deriveMovieQuery(title).movieYear || null,
      transcriptFile,
      number: prior.number || null,
      id: prior.id || null,
      slug: prior.slug || null,
      // A video that appears in the public channel scrape is, by definition, live.
      status: 'live',
      publishAt: null
    }, payload));
  }

  // A live payload whose video the scrape missed (RSS lag, >30 uploads) still
  // belongs in the public catalog. Scheduled/draft payloads do not: their pages
  // are rendered separately and stay noindex until YouTube makes them public.
  const seenVideoIds = new Set(episodes.map(ep => ep.youtubeId));
  for (const payload of pipelineLive) {
    if (seenVideoIds.has(payload.youtubeId)) continue;
    if (knownShortIds.has(payload.youtubeId)) continue;
    console.log(`[YouTube] Adding ${payload.siteId} from pipeline payload (not seen in scrape).`);
    episodes.push(applyPipelinePayload(emptyEpisode(payload.youtubeId), payload));
    seenVideoIds.add(payload.youtubeId);
  }

  // A partial scrape (RSS returns ~15 items, /videos returns one page) must not
  // delete the rest of the catalogue or 404 its already-indexed pages. Keep
  // previous live episodes the current scrape did not mention; a deliberate
  // prune can be done with a later, explicit flag once the API sync is in place.
  //
  // The exception is a Short. Once it is in the catalog it would otherwise be
  // kept on every build - it is never "seen in the scrape", because the scrape
  // rejects it - so a leaked Short would be pinned forever. It is evicted here.
  for (const prior of previous) {
    if (!prior.youtubeId || seenVideoIds.has(prior.youtubeId)) continue;
    if (excludedVideoIds.has(prior.youtubeId)) {
      console.warn(`[YouTube] Dropping ${prior.id || prior.youtubeId} from the catalogue: Short, not an episode`);
      continue;
    }
    const priorReason = await shortReasonFor(prior.youtubeId, prior.durationSeconds, knownShortIds);
    if (priorReason && priorReason !== UNPROVEN) {
      console.warn(`[YouTube] Dropping ${prior.id || prior.youtubeId} from the catalogue: Short, not an episode (${priorReason})`);
      continue;
    }
    console.warn(`[YouTube] ${prior.id || prior.youtubeId} missing from this scrape; keeping the previous live record`);
    episodes.push({ ...prior });
    seenVideoIds.add(prior.youtubeId);
  }

  // Belt and braces: nothing measured as Short-length survives to numbering,
  // whatever source added it.
  for (const ep of episodes.slice()) {
    const seconds = Number(ep.durationSeconds);
    if (Number.isFinite(seconds) && seconds > 0 && seconds < SHORT_MAX_SECONDS) {
      console.warn(`[YouTube] Dropping ${ep.id || ep.youtubeId} from the catalogue: ${seconds}s is a Short, not an episode`);
      episodes.splice(episodes.indexOf(ep), 1);
      seenVideoIds.delete(ep.youtubeId);
    }
  }

  // One number per episode. A dropped Short can leave a gap (numbers are stable,
  // so gaps stay gaps), but a duplicate number is always a bug: two pages would
  // both claim "Ep. 2". The later upload takes the next free number instead.
  const claimedNumbers = new Map();
  for (const ep of episodes) {
    if (!ep.number) continue;
    if (!claimedNumbers.has(ep.number)) {
      claimedNumbers.set(ep.number, ep);
      continue;
    }
    console.warn(`[YouTube] Episode number ${ep.number} is already claimed; ${ep.id || ep.youtubeId} takes the next free number`);
    ep.number = null;
    ep.id = null;
  }

  // Number chronologically so the oldest upload is Episode 1. Existing episodes
  // keep their number; new uploads take the next free number rather than their
  // array index, so a deleted or unlisted video can never create two "ep3"s.
  episodes.sort((a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0));
  let nextNumber = episodes.reduce((max, ep) => Math.max(max, ep.number || 0), 0) + 1;
  episodes.forEach(ep => {
    if (!ep.number) ep.number = nextNumber++;
    if (!ep.id) ep.id = `ep${ep.number}`;
    if (!ep.shortTitle) ep.shortTitle = `Ep. ${ep.number}: ${deriveShortName(ep.title)}`;
    // Stable, human-readable URL segment: ep1-whalefall
    if (!ep.slug) ep.slug = `${ep.id}-${slugify(ep.shortTitle.replace(/^Ep\.\s*\d+\s*:\s*/i, ''))}`;
  });
  episodes.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  // Stable key order for clean git diffs.
  const ordered = episodes.map(ep => ({
    id: ep.id,
    number: ep.number,
    slug: ep.slug,
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
    transcriptFile: ep.transcriptFile,
    status: ep.status || 'live',
    publishAt: ep.publishAt || null
  }));

  fs.writeFileSync(episodesPath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
  console.log(`[YouTube] Wrote ${ordered.length} episode(s) to data/episodes.json`);
  ordered.forEach(ep => console.log(`  - ${ep.id} | ${ep.duration || '?:??'} | ${ep.shortTitle}`));
}

module.exports = {
  SHORT_MAX_SECONDS,
  UNPROVEN,
  shortReasonFor,
  probeIsShort,
  loadKnownShortVideoIds,
  run
};

if (require.main === module) {
  run().catch(err => {
    console.error('[YouTube] Fatal:', err);
    process.exit(1);
  });
}
