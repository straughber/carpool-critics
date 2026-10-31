/**
 * scripts/build-episode-pages.js
 * Build-time script that renders real, crawlable, shareable HTML pages:
 *
 *   episodes/index.html            -> full episode archive
 *   episodes/<slug>/index.html     -> one page per episode
 *   sitemap.xml, robots.txt        -> so search engines can find them
 *
 * Inputs are the generated catalogs (never hand-edited):
 *   data/episodes.json  (scripts/fetch-youtube.js)
 *   data/movies.json    (scripts/fetch-tmdb.js)
 *   data/transcripts/*  (scripts/fetch-transcript.js)
 *
 * Usage: node scripts/build-episode-pages.js
 */
const fs = require('fs');
const path = require('path');

// ========================================================
// 1. SITE CONFIGURATION
// ========================================================
// Absolute URLs are required for canonical/Open Graph/sitemap entries.
// Local preview (http://localhost:8080) uses relative asset paths, so it works.
// The site lives at the apex of its own domain (GitHub Pages custom domain),
// so there is no repo subpath to prefix onto absolute URLs.
const SITE_ORIGIN = 'https://carpoolcritics.com';
const BASE_PATH = '';
const SITE_NAME = 'Carpool Critics';
const SITE_TAGLINE = 'Fresh Out the Doors, Straight to the Dash · Austin, TX';
const GOOGLE_SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION || '';
const OG_IMAGE_FALLBACK = `${SITE_ORIGIN}${BASE_PATH}/assets/images/og-cover.jpg`;

const ROOT = path.join(__dirname, '..');
const EPISODES_DIR = path.join(ROOT, 'episodes');
const PIPELINE_DIR = path.join(ROOT, 'data/pipeline');
const GENERATED_MARKER = '.generated';

// The cockpit's live feed shows exactly this many cameras, newest first.
// CAM 01 is always the latest dispatch; older episodes drop off the feed and
// only exist here. Keep in step with FEED_SIZE in /script.js.
const FEED_SIZE = 5;

const siteUrl = p => `${SITE_ORIGIN}${BASE_PATH}${p}`;

// ========================================================
// 2. HELPERS
// ========================================================
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  } catch {
    return fallback;
  }
}

/** One payload per finished episode, written by tools/export_website_payload.py. */
function readPipelinePayloads() {
  try {
    const payloads = fs.readdirSync(PIPELINE_DIR)
      .filter(file => file.endsWith('.json'))
      .sort()
      .map(file => {
        try {
          return JSON.parse(fs.readFileSync(path.join(PIPELINE_DIR, file), 'utf8'));
        } catch (err) {
          console.warn(`[Pages] Ignoring malformed payload ${file}: ${err.message}`);
          return null;
        }
      })
      .filter(payload => payload && payload.siteId);
    const seen = new Set();
    return payloads.filter(payload => {
      if (seen.has(payload.siteId)) {
        console.warn(`[Pages] Duplicate pipeline payload for ${payload.siteId}; keeping the first`);
        return false;
      }
      seen.add(payload.siteId);
      return true;
    });
  } catch {
    return [];
  }
}

function isLiveEpisode(episode) {
  return episode.status !== 'scheduled' && episode.status !== 'draft' && Boolean(episode.youtubeId);
}

/**
 * Pipeline payloads carry content that the YouTube scrape cannot know (host
 * seats, scorecards, the ranked best moment). The public catalog remains
 * authoritative for live state and YouTube's own duration. Shorts are never
 * part of either: the site publishes full-length episodes only.
 */
function mergeCatalogs(catalog, payloads) {
  const byVideoId = new Map();
  const byId = new Map();
  const catalogVideoIds = new Set();
  for (const episode of catalog) {
    if (episode.youtubeId) {
      byVideoId.set(episode.youtubeId, episode);
      catalogVideoIds.add(episode.youtubeId);
    }
    if (episode.id) byId.set(episode.id, episode);
  }

  const merged = [];
  const seen = new Set();
  const seenSlugs = new Set();
  for (const payload of payloads) {
    const base = (payload.youtubeId && byVideoId.get(payload.youtubeId))
      || byId.get(payload.siteId)
      || {};
    // The public catalog is the API-free proof that a video is live. A payload
    // that claims live but is absent from a non-empty catalog is still a
    // private draft, so never let it become indexable by accident.
    let status = base.status || payload.status || 'live';
    if (
      status === 'live'
      && payload.youtubeId
      && catalogVideoIds.size > 0
      && !catalogVideoIds.has(payload.youtubeId)
    ) {
      status = payload.publishAt ? 'scheduled' : 'draft';
    }
    const episode = {
      ...base,
      ...payload,
      id: payload.siteId || base.id,
      youtubeId: (status === 'live' && base.youtubeId)
        ? base.youtubeId
        : (payload.youtubeId || base.youtubeId || null),
      status,
      // The live catalog is what YouTube actually shows. A package title is
      // copy the pipeline proposed, not proof it shipped; it must not pin the
      // page after the creator changes the title in Studio.
      title: (status === 'live' && base.title)
        ? base.title
        : (payload.title || base.title),
      shortTitle: payload.shortTitle || base.shortTitle,
      description: payload.descriptionOverride || base.descriptionOverride || payload.description || base.description || '',
      descriptionOverride: payload.descriptionOverride || base.descriptionOverride || null,
      duration: base.duration || payload.duration,
      durationSeconds: base.durationSeconds || payload.durationSeconds,
      publishedAt: base.publishedAt || payload.publishedAt,
      publishAt: payload.publishAt || base.publishAt || null,
      thumbnail: (status === 'live' && (base.youtubeId || payload.youtubeId))
        ? `https://i.ytimg.com/vi/${base.youtubeId || payload.youtubeId}/hqdefault.jpg`
        : (base.thumbnail || payload.thumbnail),
      ogImage: payload.ogImage || base.ogImage || null,
      chapters: payload.chapters && payload.chapters.length ? payload.chapters : (base.chapters || []),
      movieQuery: payload.movieQuery || base.movieQuery,
      movieYear: payload.movieYear || base.movieYear,
      movie: payload.movie || base.movie,
      transcriptFile: payload.transcriptFile || base.transcriptFile,
      signal: payload.signal || base.signal || null
    };
    if (episode.slug && seenSlugs.has(episode.slug)) {
      console.warn(`[Pages] Duplicate slug ${episode.slug}; keeping the first payload`);
      continue;
    }
    merged.push(episode);
    if (episode.slug) seenSlugs.add(episode.slug);
    if (episode.id) seen.add(episode.id);
    if (episode.youtubeId) seen.add(episode.youtubeId);
  }

  for (const episode of catalog) {
    if (seen.has(episode.id) || (episode.youtubeId && seen.has(episode.youtubeId))) continue;
    merged.push(episode);
  }
  return merged;
}

/** A repo-relative asset path -> a path that works from episodes/<slug>/. */
function pageAsset(value, depth) {
  if (!value) return value;
  if (/^(https?:)?\/\//.test(value)) return value;
  return `${'../'.repeat(depth)}${String(value).replace(/^\/+/, '')}`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function truncate(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;

  // Cut on a word boundary, then drop a dangling article/preposition so the
  // snippet never ends on "…the…".
  const cut = value.slice(0, max - 1).replace(/[,;:.\s]+\S*$/, '');
  const trimmed = cut.replace(/\s+(?:the|a|an|and|or|of|to|in|on|at|with|from|that|this|for|by)$/i, '');
  return `${trimmed}…`;
}

function formatLongDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * TMDb is the source of truth for a film's year. Upload descriptions are typed
 * by hand and drift; patch the first parenthesised year on the page even when
 * the stored payload predates the TMDb lookup.
 */
function applyCanonicalYear(description, year) {
  if (!description || !year) return description;
  const match = String(description).match(/\(((?:19|20)\d{2})\)/);
  if (!match) return description;
  const existing = Number(match[1]);
  const canonical = Number(year);
  if (!Number.isFinite(canonical) || Math.abs(existing - canonical) > 2) return description;
  return description.slice(0, match.index) + `(${canonical})` + description.slice(match.index + match[0].length);
}

/** "01:34" or "1:02:07" -> seconds */
function parseTimeToSeconds(stamp) {
  const parts = String(stamp || '').trim().split(':').map(Number);
  if (parts.some(Number.isNaN) || !parts.length) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** 1256 -> "PT20M56S" */
function isoDuration(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}

function watchUrl(videoId, seconds) {
  return `https://www.youtube.com/watch?v=${videoId}${seconds ? `&t=${seconds}s` : ''}`;
}

/** Best available still: pipeline thumbnail, then YouTube, then the site fallback. */
function pickSocialImage(videoId, storedThumbnail) {
  if (storedThumbnail) return storedThumbnail;
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return OG_IMAGE_FALLBACK;
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

function speakerClass(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  return ['alex', 'dave', 'shane'].includes(key) ? `speaker-${key}` : 'speaker-dave';
}

/** The only score renderer. Mirrors asciiGauge() in script.js and BRAND.md. */
function asciiGauge(value, cells = 10) {
  const numeric = Number(value);
  if (value === null || value === '' || !Number.isFinite(numeric)) {
    return `[${'░'.repeat(cells)}] --/--`;
  }
  const clamped = Math.min(Math.max(numeric, 0), 10);
  const filled = Math.round((clamped / 10) * cells);
  return `[${'▓'.repeat(filled)}${'░'.repeat(cells - filled)}] ${clamped.toFixed(1)}/10`;
}

function episodeNumber(episode, fallback = '') {
  const number = Number(episode.number);
  return Number.isFinite(number) && number > 0
    ? String(number).padStart(2, '0')
    : fallback;
}

// Host seats are per-episode facts, measured by the spatial calibration stage
// and carried in data/pipeline/<site_id>.json. Never hardcode them here.

// ========================================================
// 3. PAGE TEMPLATES
// ========================================================
// The site bar is the same component as index.html (assets/css/site-bar.css).
// Same five items, same order, same look on every page; only aria-current moves.
function siteBar(asset, current) {
  const button = (href, label, key) =>
    `<a class="deck-btn" href="${href}"${key === current ? ' aria-current="page"' : ''}>[ ${label} ]</a>`;

  const home = asset('');
  return `  <header class="brand-bar is-sticky">
    <div class="wordmark" aria-hidden="true">
      <span class="wordmark-bar">═══════</span>
      <span class="wordmark-diamond">◊</span>
      <span class="wordmark-name">Carpool Critics</span>
      <span class="wordmark-diamond">◊</span>
      <span class="wordmark-bar">═══════</span>
    </div>
    <div class="brand-row">
      <div class="nav-group">
        <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="Menu" />
        <label class="nav-burger" for="nav-toggle" aria-hidden="true">
          <span class="nav-burger-text"><span class="when-closed">MENU</span><span class="when-open">CLOSE</span></span>
          <span class="nav-burger-glyph">≡</span>
        </label>
        <nav class="deck-nav" aria-label="Primary">
          ${button(home, 'DASH', 'home')}
          ${button(`${home}#episodes`, 'EPISODES', 'episodes')}
          ${button(`${home}#about`, 'HOSTS', 'hosts')}
          ${button(asset('episodes/'), 'ARCHIVE', 'archive')}
          ${button(`${home}#contact`, 'CONTACT', 'contact')}
        </nav>
      </div>
      <div class="hud-strip" aria-hidden="true">
        <span class="hud-item">◊ HOV-3</span>
        <span class="hud-item hud-rpm">RPM [▓▓▓▓▓▓░░░░]</span>
      </div>
    </div>
  </header>`;
}

function pageShell({ title, description, canonical, ogImage, ogType = 'article', jsonLd, depth, body, current = 'archive', robots = 'index, follow', wide = false }) {
  const asset = p => `${'../'.repeat(depth)}${p}`;
  const jsonLdBlocks = (Array.isArray(jsonLd) ? jsonLd : [jsonLd])
    .filter(Boolean)
    .map(block => `<script type="application/ld+json">\n${JSON.stringify(block, null, 2)}\n</script>`)
    .join('\n  ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />

  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <meta name="robots" content="${escapeAttr(robots)}" />
  ${GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${escapeAttr(GOOGLE_SITE_VERIFICATION)}" />` : ''}
  <meta name="theme-color" content="#0A0A0C" />
  <meta name="color-scheme" content="dark" />
  <link rel="canonical" href="${canonical}" />

  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="${escapeAttr(description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${ogImage}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttr(title)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  <meta name="twitter:image" content="${ogImage}" />

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="icon" href="${asset('assets/favicon.svg')}" type="image/svg+xml">
  <link rel="icon" href="${asset('assets/favicon-32.png')}" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="${asset('assets/apple-touch-icon.png')}">
  <link rel="alternate" type="application/rss+xml" title="${SITE_NAME} episodes" href="${siteUrl('/feed.xml')}">
  <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@400;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${asset('assets/css/episode.css')}?v=5.6.0" />
  <link rel="stylesheet" href="${asset('assets/css/site-bar.css')}?v=1.2.0" />
  <link rel="stylesheet" href="${asset('assets/css/design-system.css')}?v=1.1.0" />
  <link rel="stylesheet" href="${asset('assets/css/interference.css')}?v=1.0.0" />
  <script src="${asset('assets/js/site-bar.js')}?v=1.0.0" defer></script>
  <script src="${asset('assets/js/ascii-visualizer.js')}?v=1.1.0" defer></script>
  ${jsonLdBlocks}
</head>
<body>

  <a class="ds-skip-link" href="#content">[ SKIP TO CONTENT ]</a>

  <div class="scanline-plane" aria-hidden="true"></div>

  <div class="page-frame">
${siteBar(asset, current)}

  <main id="content" class="wrap${wide ? ' wrap--wide' : ''}">
${body}
  </main>

  <footer class="site-foot">
    <div class="wrap">
      <span>&copy; ${new Date().getFullYear()} ${SITE_NAME} · ${escapeHtml(SITE_TAGLINE)}</span>
      <span>◊ HOV-3 // PARKED IN AUSTIN, TEXAS</span>
      <a class="foot-link" href="https://www.youtube.com/@CarpoolCritics" rel="noopener">[ YOUTUBE ↗ ]</a>
    </div>
  </footer>
  </div>

</body>
</html>
`;
}

function filmCard(movie) {
  if (!movie) return '';
  const pills = [
    movie.rating ? `<span class="pill pill-rating">${escapeHtml(asciiGauge(movie.rating))}</span>` : '',
    movie.year ? `<span class="pill">${escapeHtml(movie.year)}</span>` : '',
    movie.runtime ? `<span class="pill">${escapeHtml(String(movie.runtime).toUpperCase())}</span>` : '',
    movie.certification ? `<span class="pill pill-cert">${escapeHtml(String(movie.certification).toUpperCase())}</span>` : '',
    ...(Array.isArray(movie.genres) ? movie.genres.map(g => `<span class="pill">${escapeHtml(String(g).toUpperCase())}</span>`) : [])
  ].filter(Boolean).join('\n          ');

  return `
      <section class="section section--film" aria-labelledby="film-heading">
        <h2 class="section-title" id="film-heading">◊ THE FILM</h2>
        <div class="film-card ticket">
          <div class="ticket-head">
            <span>CARPOOL CRITICS // RECEIPT</span>
            <span class="ticket-head-right">FILM FILE</span>
          </div>
          <div class="film-card-body">
            ${movie.posterPath ? `<img src="${escapeAttr(movie.posterPath)}" alt="${escapeAttr(`${movie.title} poster`)}" width="116" height="174" loading="lazy" decoding="async" />` : ''}
            <div class="film-body">
              <h3 class="film-title">${escapeHtml(String(movie.title).toUpperCase())}${movie.year ? ` <span class="movie-year">(${escapeHtml(movie.year)})</span>` : ''}</h3>
              ${movie.director ? `<p class="film-director">DIRECTED BY ${escapeHtml(String(movie.director).toUpperCase())}</p>` : ''}
              <div class="pills">
            ${pills}
              </div>
              ${movie.overview ? `<p class="film-synopsis">${escapeHtml(movie.overview)}</p>` : ''}
              ${movie.tmdbUrl ? `<a class="film-link" href="${escapeAttr(movie.tmdbUrl)}" rel="noopener">[ VIEW ON TMDB ↗ ]</a>` : ''}
            </div>
          </div>
        </div>
      </section>`;
}

function chapterSection(episode, isLive) {
  const maxSeconds = Number(episode.durationSeconds) || null;
  const chapters = (episode.chapters || [])
    .filter(c => c && c.time)
    .filter(c => {
      const seconds = parseTimeToSeconds(c.time);
      return maxSeconds == null || seconds == null || seconds < maxSeconds - 1;
    });
  if (!chapters.length) return '';
  const items = chapters.map(chapter => {
    const seconds = parseTimeToSeconds(chapter.time);
    if (!isLive) {
      return `        <li><span class="chapter-time">${escapeHtml(chapter.time)}</span><span>${escapeHtml(chapter.label)}</span></li>`;
    }
    const href = seconds != null ? watchUrl(episode.youtubeId, seconds) : watchUrl(episode.youtubeId);
    return `        <li><a href="${escapeAttr(href)}" rel="noopener"><span class="chapter-time">${escapeHtml(chapter.time)}</span><span>${escapeHtml(chapter.label)}</span></a></li>`;
  }).join('\n');

  return `
      <section class="section section--chapters" aria-labelledby="chapters-heading">
        <h2 class="section-title" id="chapters-heading">◊ CHAPTERS</h2>
        <ol class="chapter-list">
${items}
        </ol>
      </section>`;
}

function scorecardSection(episode) {
  const scores = episode.scorecards || {};
  const names = Object.keys(scores);
  if (!names.length) return '';
  const rows = names.map(name =>
    `<div class="score-row"><strong>◊ ${escapeHtml(String(name).toUpperCase())}</strong><span class="gauge">${escapeHtml(asciiGauge(scores[name]))}</span></div>`
  ).join('\n          ');
  return `
      <section class="section section--scores" aria-labelledby="scores-heading">
        <h2 class="section-title" id="scores-heading">◊ FINAL TACHOMETER</h2>
        <div class="scorecard ds-scoreboard">
          ${rows}
        </div>
      </section>`;
}

function bestMomentSection(episode, isLive) {
  const moment = episode.bestMoment;
  if (!moment || !moment.quote) return '';
  const href = isLive && episode.youtubeId
    ? watchUrl(episode.youtubeId, moment.seconds != null ? moment.seconds : 0)
    : null;
  return `
      <section class="section section--moment" aria-labelledby="moment-heading">
        <h2 class="section-title" id="moment-heading">◊ BEST MOMENT</h2>
        <blockquote class="best-moment">
          <p>“${escapeHtml(moment.quote)}”</p>
          <footer>${escapeHtml(String(moment.label || 'Highlight').toUpperCase())}${href ? ` · <a href="${escapeAttr(href)}" rel="noopener">[ JUMP TO ${escapeHtml(moment.time || '')} ↗ ]</a>` : ''}</footer>
        </blockquote>
      </section>`;
}

// ========================================================
// 3b. FULL-LENGTH ONLY
// ========================================================
// The site is a catalogue of full-length episodes, nothing else. A YouTube Short
// is not an episode: no act structure, no movie, no transcript, and no business
// being an "Ep. N" beside the real ones. Every Short is under five minutes, so a
// measured runtime decides this - never a title, never a guess. A record with no
// duration yet (a scheduled episode whose master has not landed) is not a Short;
// it is gated by its own status instead.
const SHORT_MAX_SECONDS = 300;

function measuredSeconds(episode) {
  const seconds = Number(episode && episode.durationSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const label = String((episode && episode.duration) || '');
  if (!label) return null;
  const hours = label.match(/(\d+(?:\.\d+)?)\s*h/i);
  const minutes = label.match(/(\d+(?:\.\d+)?)\s*m/i);
  if (!hours && !minutes) return null;
  const total = (hours ? parseFloat(hours[1]) : 0) * 3600 + (minutes ? parseFloat(minutes[1]) : 0) * 60;
  return total > 0 ? total : null;
}

function isShortForm(episode) {
  const seconds = measuredSeconds(episode);
  return seconds != null && seconds < SHORT_MAX_SECONDS;
}

function hostsByline(episode) {
  const hosts = (episode.hosts || []).filter(host => host && host.name);
  if (!hosts.length) return 'Hosts: Alex, Shane &amp; Dave';
  const names = hosts.map(host => escapeHtml(host.name));
  const joined = names.length > 1
    ? `${names.slice(0, -1).join(', ')} &amp; ${names[names.length - 1]}`
    : names[0];
  return `Hosts: ${joined}`;
}

function transcriptSection(transcript, source) {
  if (!transcript || !Array.isArray(transcript.dialogue) || !transcript.dialogue.length) return '';
  const dropped = Number(source && source.droppedTranscriptTurns) || 0;
  const heading = dropped > 0 ? '◊ PARTIAL TRANSCRIPT' : '◊ FULL TRANSCRIPT';
  const note = dropped > 0
    ? `<p class="transcript-note">${dropped} raw turn(s) were cut from the master and are not shown. This is the dialogue that survived the edit.</p>`
    : '';
  const turns = transcript.dialogue.map(turn => `      <div class="transcript-turn">
        <div class="turn-meta">
          <span class="turn-time">${escapeHtml(turn.time)}</span>
          <span class="speaker-pill ${speakerClass(turn.speaker)}">◊ ${escapeHtml(turn.speaker)}</span>
        </div>
        <p class="turn-text">${escapeHtml(turn.text)}</p>
      </div>`).join('\n');

  return `
      <section class="section section--transcript" aria-labelledby="transcript-heading">
        <h2 class="section-title" id="transcript-heading">${heading}</h2>
        ${note}
${turns}
      </section>`;
}

async function buildEpisodePage(episode, movie, transcript, siblings) {
  const slug = episode.slug;
  const depth = 2; // episodes/<slug>/index.html
  const canonical = siteUrl(`/episodes/${slug}/`);
  const title = episode.title || episode.shortTitle;
  const isLive = isLiveEpisode(episode);
  const publishLabel = episode.publishAt ? formatLongDate(episode.publishAt) : 'date to be announced';

  // Live pages use YouTube's best still. Pre-release pages use the custom 4K
  // thumbnail copied into the site repo by export_website_payload.py.
  const localThumb = episode.thumbnail && !/^https?:/.test(episode.thumbnail)
    ? pageAsset(episode.thumbnail, depth)
    : episode.thumbnail;
  let ogImage = episode.ogImage || null;
  if (!ogImage && isLive && episode.youtubeId) {
    const maxres = `https://i.ytimg.com/vi/${episode.youtubeId}/maxresdefault.jpg`;
    ogImage = (await headOk(maxres)) ? maxres : `https://i.ytimg.com/vi/${episode.youtubeId}/hqdefault.jpg`;
  }
  if (!ogImage) ogImage = OG_IMAGE_FALLBACK;
  const heroImage = isLive ? ogImage : (localThumb || ogImage);

  const description = applyCanonicalYear(episode.description, movie && movie.year);
  const metaDescription = truncate(description || `${title}. A ${episode.duration || ''} film review recorded live from the car.`, 155);

  const year = movie && movie.year ? ` (${movie.year})` : '';
  // The visible title must be the title the audience actually clicked on
  // YouTube, not a second title invented by the site builder.
  const h1 = title;

  const byline = [
    episode.number ? `<span>EPISODE ${escapeHtml(String(episode.number))}</span>` : '',
    isLive && episode.duration ? `<span>${escapeHtml(episode.duration)}</span>` : '',
    isLive && episode.publishedAt ? `<span>${escapeHtml(formatLongDate(episode.publishedAt))}</span>` : '',
    !isLive ? `<span class="pill pill-rating">[ PREMIERES ${escapeHtml(publishLabel.toUpperCase())} ]</span>` : '',
    `<span>${hostsByline(episode)}</span>`
  ].filter(Boolean).join('\n        ');

  const index = siblings.findIndex(s => s.slug === slug);
  const prev = index > 0 ? siblings[index - 1] : null; // newer
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const pager = `
      <nav class="pager" aria-label="Episode navigation">
        ${prev ? `<a href="../${escapeAttr(prev.slug)}/"><span class="pager-label">← Newer</span><span class="pager-title">${escapeHtml(prev.shortTitle || prev.title)}</span></a>` : '<span></span>'}
        ${next ? `<a class="next" href="../${escapeAttr(next.slug)}/"><span class="pager-label">Older →</span><span class="pager-title">${escapeHtml(next.shortTitle || next.title)}</span></a>` : '<span></span>'}
      </nav>`;

  const poster = isLive
    ? `<a class="poster-link ds-figure" href="${escapeAttr(watchUrl(episode.youtubeId))}" rel="noopener" aria-label="[ ▶ PLAY ] Watch ${escapeAttr(title)} on YouTube">
        <img src="${escapeAttr(heroImage)}" alt="${escapeAttr(`${title} video thumbnail`)}" width="1280" height="720" decoding="async" />
        <span class="play-badge" aria-hidden="true">[ ▶ PLAY ]</span>
      </a>
      <p class="poster-note">FULL EPISODE ON YOUTUBE // ${escapeHtml(episode.duration || '')}</p>`
    : `<div class="poster-link ds-figure is-preview">
        <img src="${escapeAttr(heroImage)}" alt="${escapeAttr(`${title} preview thumbnail`)}" width="1280" height="720" decoding="async" />
        <span class="premiere-badge">[ PREMIERES ]</span>
      </div>
      <p class="poster-note">PREMIERES ${escapeHtml(publishLabel.toUpperCase())} // FULL EPISODE DROPS ON YOUTUBE</p>`;

  const signalStrip = episode.signal && episode.signal.url
    ? `<div class="ascii-viz-row" aria-hidden="true">
        <span>SIGNAL // ARCHIVE</span>
        <pre class="ascii-viz" data-ascii-viz data-style="bars" data-width="32" data-fps="12"
             data-envelope="${escapeAttr(pageAsset(episode.signal.url, depth))}"></pre>
      </div>`
    : '';

  const body = `
    <article class="ep-article">
      <header class="ep-head ds-page-header">
        <p class="eyebrow ds-eyebrow">◊ ${escapeHtml(SITE_NAME)} // EPISODE ${escapeHtml(String(episode.number || ''))}</p>
        <h1 class="ep-title">${escapeHtml(h1)}</h1>
        <div class="ep-byline">
        ${byline}
        </div>
      </header>

      ${poster}
      ${signalStrip}

      <div class="ep-body">
        <aside class="ep-rail" aria-label="Film and verdict">
${[filmCard(movie), scorecardSection(episode)].filter(Boolean).join('\n')}
        </aside>
        <div class="ep-main">
${[
  description ? `<section class="section section--description"><p class="ep-description">${escapeHtml(description)}</p></section>` : '',
  bestMomentSection(episode, isLive),
  chapterSection(episode, isLive),
  transcriptSection(transcript, episode.source),
].filter(Boolean).join('\n')}
        </div>
      </div>
      ${pager}
    </article>`;

  const podcastEpisode = {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    url: canonical,
    name: title,
    episodeNumber: episode.number || undefined,
    datePublished: episode.publishAt || episode.publishedAt || undefined,
    description: description || metaDescription,
    partOfSeries: {
      '@type': 'PodcastSeries',
      name: SITE_NAME,
      url: siteUrl('/')
    }
  };
  if (isLive) {
    podcastEpisode.associatedMedia = {
      '@type': 'VideoObject',
      name: title,
      description: description || metaDescription,
      thumbnailUrl: [ogImage],
      uploadDate: episode.publishedAt || undefined,
      duration: isoDuration(episode.durationSeconds) || undefined,
      contentUrl: watchUrl(episode.youtubeId),
      embedUrl: `https://www.youtube-nocookie.com/embed/${episode.youtubeId}`
    };
  }

  const jsonLd = [
    podcastEpisode,
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Episodes', item: siteUrl('/episodes/') },
        { '@type': 'ListItem', position: 3, name: title, item: canonical }
      ]
    }
  ];

  return pageShell({
    title: isLive
      ? `${h1} · Episode ${episode.number} | ${SITE_NAME}`
      : `${h1} · Premieres ${publishLabel} | ${SITE_NAME}`,
    description: metaDescription,
    canonical,
    ogImage,
    jsonLd,
    depth,
    robots: isLive ? 'index, follow' : 'noindex, follow',
    body
  });
}

// A sealed premiere shows a mosaic instead of a poster. The asset is a real
// 32x18 PNG produced by tools/export_website_payload.py, so the detail is not
// in the file at all. This ASCII field is the no-Pillow fallback.
const SEALED_STATIC = '▒░▓░▒▓░▒░▓▒░▓░▒░▒▓░▒▓░▒░▓▒░▓░'.repeat(8);

function sealedStub(ep) {
  const number = escapeHtml(episodeNumber(ep, ''));
  const premiere = ep.publishAt
    ? formatLongDate(ep.publishAt).toUpperCase()
    : 'DATE TO BE ANNOUNCED';
  const plate = ep.sealedThumb
    ? `<img src="${escapeAttr(pageAsset(ep.sealedThumb, 1))}" alt="" class="sealed-plate"
             width="132" height="74" loading="lazy" decoding="async" />`
    : `<span class="sealed-plate sealed-static" aria-hidden="true">${SEALED_STATIC}</span>`;

  // Nothing identifiable may reach this markup: no title, no shortTitle, no
  // description and no real thumbnail. The archive is indexable and the film
  // is the whole premise of the episode.
  return `        <li class="archive-item archive-item--sealed ticket intf-host">
          <span class="intf intf--noise intf--still" aria-hidden="true"></span>
          <div class="ticket-head">
            <span>ADMIT ONE // EP #${number}</span>
            <span class="ticket-head-right">[ SEALED ]</span>
          </div>
          <div class="archive-row">
            ${plate}
            <div class="archive-body">
              <div class="archive-title">PREMIERES ${escapeHtml(premiere)}</div>
              <div class="archive-meta">SIGNAL // SEALED · TITLE // TAKE // SCORE WITHHELD</div>
              <p class="archive-desc">The film, the takes and the scores stay in the glovebox until the premiere.</p>
            </div>
          </div>
        </li>`;
}

function buildArchivePage(episodes, movies) {
  const depth = 1; // episodes/index.html
  const canonical = siteUrl('/episodes/');
  const title = `All Episodes | ${SITE_NAME}`;
  const description = `Every ${SITE_NAME} episode: in-car film reviews recorded live in Austin, Texas. Full transcripts, chapters, and scorecards.`;

  // A scheduled page is a creator review surface, not a catalogue entry.
  // It may appear here only as a sealed stub: date and episode number, never a
  // title or thumbnail that would leak the premiere before YouTube does.
  //
  // A draft is not scheduled yet, so it has no premiere date. It still gets a
  // stub: the archive is the record, and an episode that exists but is withheld
  // reads as `DATE TO BE ANNOUNCED` rather than as nothing at all. The date is
  // the only thing that changes when the upload is scheduled.
  const archiveEpisodes = episodes.filter(isLiveEpisode);
  const sealedEpisodes = episodes
    .filter(ep => !isLiveEpisode(ep))
    // Undated drafts sort after dated premieres, not before them: `new Date(null)`
    // is the epoch, which would file "date to be announced" ahead of a real date.
    .sort((a, b) => (a.publishAt ? new Date(a.publishAt).getTime() : Infinity)
                  - (b.publishAt ? new Date(b.publishAt).getTime() : Infinity));

  // The live feed claims the newest five. Anything past that is archive-only,
  // and says so on the stub. That status is the whole difference between the
  // two tabs: the feed is a broadcast, this page is the record.
  const feedIndex = new Map();
  archiveEpisodes.slice(0, FEED_SIZE).forEach((ep, index) => {
    feedIndex.set(ep.id, index + 1);
  });

  const years = new Map();
  archiveEpisodes.forEach((ep, index) => {
    const stamp = ep.publishedAt || ep.publishAt;
    const parsed = stamp ? new Date(stamp) : null;
    const year = parsed && !Number.isNaN(parsed.getTime())
      ? String(parsed.getFullYear())
      : 'UNDATED';
    if (!years.has(year)) years.set(year, []);
    years.get(year).push({ ep, index });
  });

  const groups = [...years.entries()].map(([year, entries]) => {
    const items = entries.map(({ ep, index }) => {
      const movie = movies[ep.id] || ep.movie;
      const meta = [ep.duration, formatLongDate(ep.publishedAt), movie && movie.rating ? asciiGauge(movie.rating) : '']
        .filter(Boolean).map(escapeHtml).join(' // ');
      const cam = feedIndex.get(ep.id);
      const badge = cam
        ? `<span class="archive-cam">CAM ${String(cam).padStart(2, '0')}</span>`
        : 'ON FILE';
      const description = applyCanonicalYear(ep.description, movie && movie.year);
      const thumbnail = ep.thumbnail && !/^https?:/.test(ep.thumbnail)
        ? pageAsset(ep.thumbnail, depth)
        : pickSocialImage(ep.youtubeId, ep.thumbnail);
      return `        <li class="archive-item ticket">
          <div class="ticket-head">
            <span>ADMIT ONE // EP #${escapeHtml(episodeNumber(ep, String(index + 1).padStart(2, '0')))}</span>
            <span class="ticket-head-right">${badge}</span>
          </div>
          <div class="archive-row">
            <a href="./${escapeAttr(ep.slug)}/" aria-label="${escapeAttr(ep.shortTitle || ep.title)}">
              <img src="${escapeAttr(thumbnail)}" alt="" width="132" height="74" loading="lazy" decoding="async" />
            </a>
            <div class="archive-body">
              <div class="archive-title"><a href="./${escapeAttr(ep.slug)}/">${escapeHtml(ep.shortTitle || ep.title)}</a></div>
              <div class="archive-meta">${meta}</div>
              ${description ? `<p class="archive-desc">${escapeHtml(truncate(description, 130))}</p>` : ''}
            </div>
          </div>
        </li>`;
    }).join('\n');

    return `      <section class="archive-year" aria-label="${escapeHtml(year)}">
        <h2 class="archive-year-label">${escapeHtml(year)}</h2>
        <ol class="archive-list">
${items}
        </ol>
      </section>`;
  }).join('\n\n');

  const sealedBlock = sealedEpisodes.length
    ? `      <section class="archive-year archive-year--next" aria-label="Next dispatch">
        <h2 class="archive-year-label">◊ NEXT DISPATCH // SEALED</h2>
        <ol class="archive-list">
${sealedEpisodes.map(sealedStub).join('\n')}
        </ol>
      </section>`
    : '';

  const onFile = `${archiveEpisodes.length} EPISODE${archiveEpisodes.length === 1 ? '' : 'S'} ON FILE`;

  const body = `
    <header class="archive-head">
      <div class="subpage-nav-bar">
        <div class="view-heading-group">
          <p class="view-eyebrow">FILE // 04</p>
          <h1 class="subpage-heading">◊ THE ARCHIVE</h1>
        </div>
        <a class="btn-back-car" href="../">[ ← BACK TO DASH ]</a>
      </div>
      <p class="archive-status">
        <span>${onFile}${sealedEpisodes.length ? ` // ${sealedEpisodes.length} SEALED` : ''}</span>
        <span>NEWEST FIRST // AUSTIN, TX</span>
      </p>
      <p class="archive-feed-link">
        <a href="../#episodes">[ ◊ THE LIVE FEED CARRIES THE LATEST ${FEED_SIZE} ]</a>
      </p>
    </header>

${sealedBlock}${sealedBlock ? '\n\n' : ''}${groups || `    <section class="section">
      <p class="ds-notice intf-host" data-state="empty">
        <span class="intf intf--noise intf--still" aria-hidden="true"></span>
        [ NO DISPATCH ] Nothing has cleared the archive yet. The feed opens with the first episode.
      </p>
    </section>`}
`;

  return pageShell({
    title,
    description,
    canonical,
    ogImage: OG_IMAGE_FALLBACK,
    ogType: 'website',
    depth,
    wide: true,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: title,
      url: canonical,
      description,
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: siteUrl('/') }
    },
    body
  });
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildFeed(episodes) {
  const live = episodes.filter(isLiveEpisode);
  const items = live.map(ep => {
    const url = siteUrl(`/episodes/${ep.slug}/`);
    const date = ep.publishedAt ? new Date(ep.publishedAt) : null;
    const pubDate = date && !Number.isNaN(date.getTime()) ? date.toUTCString() : '';
    return `    <item>
      <title>${escapeXml(ep.shortTitle || ep.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
      <description>${escapeXml(ep.description || '')}</description>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${escapeXml(siteUrl('/'))}</link>
    <description>${escapeXml(SITE_TAGLINE)}</description>
    <language>en-us</language>
${items}
  </channel>
</rss>
`;
}

function buildSitemap(episodes) {
  // Scheduled/draft pages are real pages, but they are noindex and must never
  // be advertised to crawlers before YouTube makes the video public.
  const live = episodes.filter(isLiveEpisode);
  const newest = live[0] && (live[0].publishedAt || live[0].publishAt);
  const urls = [
    { loc: siteUrl('/'), priority: '1.0', lastmod: newest },
    { loc: siteUrl('/episodes/'), priority: '0.9', lastmod: newest },
    ...live.map(ep => ({
      loc: siteUrl(`/episodes/${ep.slug}/`),
      priority: '0.8',
      lastmod: ep.publishedAt
    }))
  ];

  const entries = urls.map(u => `  <url>
    <loc>${u.loc}</loc>
${u.lastmod ? `    <lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>\n` : ''}    <changefreq>weekly</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

function buildRobots() {
  return `User-agent: *
Allow: /
Disallow: /prep/
Disallow: /data/

Sitemap: ${siteUrl('/sitemap.xml')}
`;
}

// ========================================================
// 4. HOME HERO (GENERATED REGIONS INSIDE index.html)
// ========================================================
// index.html is hand-authored except for three marked regions: the dispatch
// ticket, the PLAY button and the signal strip. They are rendered here from the
// same catalogue the archive reads, so the front door cannot advertise last
// week's episode, and a pre-release episode can never be promoted into it:
// `isLiveEpisode` excludes `scheduled` and `draft`, exactly as `sealedStub` does.
// Nothing below is invented. A missing field renders as absent, never as a
// plausible number, because the ticket is the one place a viewer reads a score
// before clicking anything.
const HERO_REGIONS = {
  ticket: ['<!-- HERO-TICKET:START -->', '<!-- HERO-TICKET:END -->'],
  button: ['<!-- HERO-BUTTON:START -->', '<!-- HERO-BUTTON:END -->'],
  signal: ['<!-- HERO-SIGNAL:START -->', '<!-- HERO-SIGNAL:END -->'],
};


/** HH:MM:SS — the REC stamp, derived from the measured runtime. */
function clockStamp(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** The newest episode a viewer can actually watch. Null when there is none. */
function newestLiveEpisode(episodes) {
  return episodes.find(isLiveEpisode) || null;
}

function heroTicket(ep) {
  if (!ep) {
    return `      <aside class="hero-ticket is-empty" aria-label="Latest dispatch">
        <div class="hero-ticket-head">
          <span>ADMIT ONE // --</span>
          <span class="hero-ticket-state">AWAITING</span>
        </div>
        <div class="hero-ticket-perf" aria-hidden="true"></div>
        <div class="hero-ticket-body">
          <div class="hero-ticket-film">No dispatch on file</div>
          <div class="hero-ticket-meta">The archive carries every episode.</div>
        </div>
      </aside>`;
  }

  const number = episodeNumber(ep, '--');
  const movie = ep.movie || {};
  const film = movie.title || ep.title || 'Untitled';
  const year = movie.year ? String(movie.year) : '';
  const seconds = measuredSeconds(ep);
  const runtime = seconds != null ? clockStamp(seconds) : '';
  const minutes = seconds != null ? `${Math.floor(seconds / 60)} MIN` : '';
  const scores = ep.scorecards || {};
  const names = Object.keys(scores);
  const hostNames = Array.isArray(ep.hosts) ? ep.hosts.filter(host => host && host.name) : [];
  const hostCount = hostNames.length || names.length;
  const hostLabel = hostCount ? `${hostCount} HOST${hostCount === 1 ? '' : 'S'}` : '';

  // A score is only ever a value someone said on the tape. `asciiGauge` renders
  // an unknown as `--/--`, so a missing host cannot become a fabricated number.
  const tach = names.length
    ? `
          <div class="hero-ticket-tach">
            <div class="hero-ticket-tach-label">
              <span>◊ FINAL TACHOMETER</span>
              <span>${hostLabel}</span>
            </div>
            ${names.map(name =>
              `<div class="hero-ticket-score"><strong>${escapeHtml(String(name).toUpperCase())}</strong><span>${escapeHtml(asciiGauge(scores[name]))}</span></div>`
            ).join('\n            ')}
          </div>`
    : '';

  const meta = [year, minutes, hostLabel].filter(Boolean).join(' // ');

  return `      <aside class="hero-ticket" aria-label="Latest dispatch">
        <div class="hero-ticket-head">
          <span>ADMIT ONE // EP. ${escapeHtml(number)}</span>
          <span class="hero-ticket-state">ON FILE</span>
        </div>
        <div class="hero-ticket-perf" aria-hidden="true"></div>
        <div class="hero-ticket-body">
          <div class="hero-ticket-film">${escapeHtml(film)}</div>
          <div class="hero-ticket-meta">${escapeHtml(meta)}</div>${tach}
          <div class="hero-ticket-foot">
            <span>● REC [${escapeHtml(runtime)}]</span>
            <span>AUSTIN, TX</span>
          </div>
        </div>
      </aside>`;
}

function heroPlayButton(ep) {
  if (!ep || !ep.slug) {
    return `<a class="btn-hero-primary" href="episodes/">[ ▶ LATEST ]</a>`;
  }
  const number = episodeNumber(ep, '');
  const label = number ? `[ ▶ PLAY EP. ${escapeHtml(number)} ]` : '[ ▶ PLAY ]';
  return `<a class="btn-hero-primary" href="${escapeAttr(pageAsset(`episodes/${ep.slug}/`, 0))}">${label}</a>`;
}

/**
 * A static frame set of the episode's own baked envelope, labelled SIGNAL //
 * ARCHIVE. The bytes are the ones tools/export_website_payload.py wrote: one
 * byte per band per frame at 12fps, and each byte is already an index into the
 * glyph table the payload carries (`signal.glyphs`), which is why the site reads
 * the table instead of assuming it. Each column is the loudest band of an evenly
 * sampled frame, so the strip is the episode's audio, not a decorative waveform.
 */
function heroSignal(ep) {
  const COLUMNS = 120;
  if (!ep || !ep.signal || !ep.signal.url) return '';
  const glyphs = [...String(ep.signal.glyphs || '')];
  if (!glyphs.length) return '';
  let bin;
  try {
    bin = fs.readFileSync(path.join(ROOT, ep.signal.url));
  } catch {
    return '';
  }
  const width = Number(ep.signal.width) || 32;
  const frames = Math.floor(bin.length / width);
  if (!frames) return '';

  // Two passes: the mean of the 32 band indices is the level, then the episode
  // is normalized against its own loudest sampled frame. Without that, speech
  // sits at 2-3 of 8 in every column and the strip is a flat line; the
  // normalization is per file, exactly how ascii_visualizer ranks its glyphs.
  const levels = [];
  for (let column = 0; column < COLUMNS; column++) {
    const frame = Math.round((column / (COLUMNS - 1)) * (frames - 1));
    let sum = 0;
    for (let band = 0; band < width; band++) {
      sum += bin[frame * width + band];
    }
    levels.push(sum / width);
  }
  const loudest = Math.max(...levels, 1);
  const rack = levels
    .map(level => glyphs[Math.min(glyphs.length - 1, Math.round((level / loudest) * (glyphs.length - 1)))])
    .join('');

  return `<div class="hero-signal-label"><b>◊ SIGNAL</b>ARCHIVE // EP. ${escapeHtml(episodeNumber(ep, '--'))}</div>
<div class="hero-rack" aria-hidden="true">${rack}</div>`;
}

/** Swap the contents of one marked region. A missing marker is a hard failure:
 *  silently skipping it would ship a hero frozen on an old episode. */
function replaceHeroRegion(html, name, block) {
  const [start, end] = HERO_REGIONS[name];
  const from = html.indexOf(start);
  const to = html.indexOf(end, from === -1 ? 0 : from);
  if (from === -1 || to === -1) {
    throw new Error(`index.html is missing the ${name} hero markers (${start} … ${end})`);
  }
  // Match the marker's own indentation so the generated block sits in the tree
  // like the hand-authored lines around it: dedent the generator's output first,
  // then indent it once, so a template's own base indent cannot compound.
  const lineStart = html.lastIndexOf('\n', from) + 1;
  const indent = html.slice(lineStart, from);
  const endLineStart = html.lastIndexOf('\n', to) + 1;
  const endIndent = html.slice(endLineStart, to);
  const lines = block.split('\n');
  const widths = lines.filter(line => line.trim()).map(line => line.match(/^[ \t]*/)[0].length);
  const common = widths.length ? Math.min(...widths) : 0;
  const indented = lines
    .map(line => (line.trim() ? indent + line.slice(common) : line))
    .join('\n');
  // The end marker's own indentation sits inside the replaced span, so it is
  // re-emitted rather than silently stripped on every build.
  return `${html.slice(0, from + start.length)}\n${indented}\n${endIndent}${html.slice(to)}`;
}

function writeHomepage(episodes) {
  const file = path.join(ROOT, 'index.html');
  const latest = newestLiveEpisode(episodes);

  let html = fs.readFileSync(file, 'utf8');
  html = replaceHeroRegion(html, 'ticket', heroTicket(latest));
  html = replaceHeroRegion(html, 'button', heroPlayButton(latest));
  html = replaceHeroRegion(html, 'signal', heroSignal(latest));
  fs.writeFileSync(file, html, 'utf8');

  console.log(`[Pages] index.html (hero ticket: ${latest ? `${latest.id} ${latest.movie ? latest.movie.title : ''}`.trim() : 'no live episode'})`);
}

// ========================================================
// 5. RUN
// ========================================================
async function run() {
  const catalog = readJson('data/episodes.json', []);
  const payloads = readPipelinePayloads();
  // Full-length episodes only. This is the one choke point that feeds every
  // page, the archive, sitemap.xml and feed.xml, so a Short that somehow reaches
  // a catalog or payload record can never become an "Ep. N" anywhere on the site.
  const merged = mergeCatalogs(catalog, payloads);
  const episodes = merged.filter(episode => {
    if (!isShortForm(episode)) return true;
    console.warn(`[Pages] Rejecting ${episode.id || episode.youtubeId}: ${episode.duration} is a Short, not an episode`);
    return false;
  });
  const shorts = merged.length - episodes.length;
  if (shorts > 0) console.warn(`[Pages] ${shorts} Short(s) excluded from the catalogue`);
  const movies = readJson('data/movies.json', {});

  if (!episodes.length) {
    console.warn('[Pages] No episodes in data/episodes.json or data/pipeline/ — run scripts/fetch-youtube.js first.');
    return;
  }

  const missingSlug = episodes.filter(ep => !ep.slug);
  if (missingSlug.length) {
    console.error('[Pages] Episodes without a slug. Re-run: node scripts/fetch-youtube.js or export the pipeline payload.');
    process.exit(1);
  }

  // Newest first. A scheduled episode sorts by its release date so it sits at
  // the top of the archive without pretending to be live.
  const dateOf = ep => ep.publishAt || ep.publishedAt || 0;
  episodes.sort((a, b) => new Date(dateOf(b)) - new Date(dateOf(a)));

  const written = new Set();
  for (const episode of episodes) {
    const transcript = episode.transcriptFile ? readJson(episode.transcriptFile, null) : null;
    const html = await buildEpisodePage(episode, movies[episode.id] || episode.movie, transcript, episodes);

    const dir = path.join(EPISODES_DIR, episode.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    fs.writeFileSync(path.join(dir, GENERATED_MARKER), '', 'utf8');
    written.add(episode.slug);

    console.log(`[Pages] episodes/${episode.slug}/index.html  [${episode.status || 'live'}] (${transcript && transcript.dialogue ? transcript.dialogue.length : 0} transcript turns)`);
  }

  fs.mkdirSync(EPISODES_DIR, { recursive: true });
  fs.writeFileSync(path.join(EPISODES_DIR, 'index.html'), buildArchivePage(episodes, movies), 'utf8');
  console.log('[Pages] episodes/index.html');

  // Prune pages for episodes that no longer exist (only ones we generated).
  for (const entry of fs.readdirSync(EPISODES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || written.has(entry.name)) continue;
    const marker = path.join(EPISODES_DIR, entry.name, GENERATED_MARKER);
    if (fs.existsSync(marker)) {
      fs.rmSync(path.join(EPISODES_DIR, entry.name), { recursive: true, force: true });
      console.warn(`[Pages] Pruned stale page episodes/${entry.name}/`);
    }
  }

  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), buildSitemap(episodes), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), buildRobots(), 'utf8');
  fs.writeFileSync(path.join(ROOT, 'feed.xml'), buildFeed(episodes), 'utf8');
  // The hero is regenerated from the same catalogue, so the front door and the
  // archive cannot disagree about what the latest episode is.
  writeHomepage(episodes);
  const liveCount = episodes.filter(isLiveEpisode).length;
  console.log(`[Pages] sitemap.xml (${liveCount + 2} urls, ${episodes.length - liveCount} pre-release excluded) + robots.txt + feed.xml`);
}

if (require.main === module) {
  run().catch(err => {
    console.error('[Pages] Fatal:', err);
    process.exit(1);
  });
}

module.exports = { sealedStub, buildArchivePage, buildEpisodePage, mergeCatalogs, heroTicket, heroPlayButton, heroSignal, newestLiveEpisode, replaceHeroRegion, HERO_REGIONS };
