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
const SITE_ORIGIN = 'https://straughber.github.io';
const BASE_PATH = '/carpool-critics';
const SITE_NAME = 'Carpool Critics';
const SITE_TAGLINE = 'Fresh Out the Doors, Straight to the Dash — Austin, TX';
const OG_IMAGE_FALLBACK = `${SITE_ORIGIN}${BASE_PATH}/assets/images/cockpit/CurbsideCinema_Background.jpeg`;

const ROOT = path.join(__dirname, '..');
const EPISODES_DIR = path.join(ROOT, 'episodes');
const PIPELINE_DIR = path.join(ROOT, 'data/pipeline');
const GENERATED_MARKER = '.generated';

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
    return fs.readdirSync(PIPELINE_DIR)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          return JSON.parse(fs.readFileSync(path.join(PIPELINE_DIR, file), 'utf8'));
        } catch (err) {
          console.warn(`[Pages] Ignoring malformed payload ${file}: ${err.message}`);
          return null;
        }
      })
      .filter(payload => payload && payload.siteId);
  } catch {
    return [];
  }
}

function isLiveEpisode(episode) {
  return episode.status !== 'scheduled' && episode.status !== 'draft' && Boolean(episode.youtubeId);
}

/**
 * Pipeline payloads carry content that the YouTube scrape cannot know (host
 * seats, scorecards, the ranked best moment, uploaded shorts). The public
 * catalog remains authoritative for live state and YouTube's own duration.
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
      youtubeId: payload.youtubeId || base.youtubeId || null,
      status,
      title: payload.title || base.title,
      shortTitle: payload.shortTitle || base.shortTitle,
      description: payload.descriptionOverride || base.descriptionOverride || payload.description || base.description || '',
      descriptionOverride: payload.descriptionOverride || base.descriptionOverride || null,
      duration: base.duration || payload.duration,
      durationSeconds: base.durationSeconds || payload.durationSeconds,
      publishedAt: base.publishedAt || payload.publishedAt,
      publishAt: payload.publishAt || base.publishAt || null,
      thumbnail: base.thumbnail || payload.thumbnail,
      ogImage: payload.ogImage || base.ogImage || null,
      chapters: payload.chapters && payload.chapters.length ? payload.chapters : (base.chapters || []),
      movieQuery: payload.movieQuery || base.movieQuery,
      movieYear: payload.movieYear || base.movieYear,
      transcriptFile: payload.transcriptFile || base.transcriptFile
    };
    merged.push(episode);
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

// Host seats are per-episode facts, measured by the spatial calibration stage
// and carried in data/pipeline/<site_id>.json. Never hardcode them here.

// ========================================================
// 3. PAGE TEMPLATES
// ========================================================
function pageShell({ title, description, canonical, ogImage, ogType = 'article', jsonLd, depth, body, navEpisodes = true, robots = 'index, follow' }) {
  const asset = p => `${'../'.repeat(depth)}${p}`;
  const jsonLdBlocks = (Array.isArray(jsonLd) ? jsonLd : [jsonLd])
    .filter(Boolean)
    .map(block => `<script type="application/ld+json">\n${JSON.stringify(block, null, 2)}\n</script>`)
    .join('\n  ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <meta name="robots" content="${escapeAttr(robots)}" />
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

  <link rel="stylesheet" href="${asset('assets/css/episode.css')}" />
  ${jsonLdBlocks}
</head>
<body>

  <header class="site-bar">
    <div class="wrap">
      <a class="brand-mark" href="${asset('')}">${SITE_NAME}</a>
      <nav aria-label="Site">
        <a href="${asset('')}">Home</a>
        ${navEpisodes ? `<a href="${asset('episodes/')}">All Episodes</a>` : ''}
        <a href="https://www.youtube.com/@CarpoolCritics" rel="noopener">YouTube</a>
      </nav>
    </div>
  </header>

  <main class="wrap">
${body}
  </main>

  <footer class="site-foot">
    <div class="wrap">
      <span>&copy; ${new Date().getFullYear()} ${SITE_NAME} · ${escapeHtml(SITE_TAGLINE)}</span>
      <span>Recorded in a BMW X5, Austin, Texas</span>
    </div>
  </footer>

</body>
</html>
`;
}

function filmCard(movie) {
  if (!movie) return '';
  const pills = [
    movie.rating ? `<span class="pill pill-rating">TMDb ${escapeHtml(movie.rating)}</span>` : '',
    movie.year ? `<span class="pill">${escapeHtml(movie.year)}</span>` : '',
    movie.runtime ? `<span class="pill">${escapeHtml(movie.runtime)}</span>` : '',
    movie.certification ? `<span class="pill pill-cert">${escapeHtml(movie.certification)}</span>` : '',
    ...(Array.isArray(movie.genres) ? movie.genres.map(g => `<span class="pill">${escapeHtml(g)}</span>`) : [])
  ].filter(Boolean).join('\n          ');

  return `
      <section class="section" aria-labelledby="film-heading">
        <h2 class="section-title" id="film-heading">The Film</h2>
        <div class="film-card">
          ${movie.posterPath ? `<img src="${escapeAttr(movie.posterPath)}" alt="${escapeAttr(`${movie.title} poster`)}" width="116" height="174" loading="lazy" decoding="async" />` : ''}
          <div class="film-body">
            <h3 class="film-title">${escapeHtml(movie.title)}${movie.year ? ` <span class="movie-year">(${escapeHtml(movie.year)})</span>` : ''}</h3>
            <div class="pills">
          ${pills}
            </div>
            ${movie.overview ? `<p class="film-synopsis">${escapeHtml(movie.overview)}</p>` : ''}
            ${movie.tmdbUrl ? `<a class="film-link" href="${escapeAttr(movie.tmdbUrl)}" rel="noopener">View on TMDb ↗</a>` : ''}
          </div>
        </div>
      </section>`;
}

function chapterSection(episode, isLive) {
  const chapters = (episode.chapters || []).filter(c => c && c.time);
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
      <section class="section" aria-labelledby="chapters-heading">
        <h2 class="section-title" id="chapters-heading">Chapters</h2>
        <ol class="chapter-list">
${items}
        </ol>
      </section>`;
}

function scorecardSection(episode) {
  const scores = episode.scorecards || {};
  const names = Object.keys(scores);
  if (!names.length) return '';
  const pills = names.map(name =>
    `<span class="pill"><strong>${escapeHtml(name)}</strong> ${escapeHtml(String(scores[name]))}/10</span>`
  ).join('\n          ');
  return `
      <section class="section" aria-labelledby="scores-heading">
        <h2 class="section-title" id="scores-heading">Final Scorecards</h2>
        <div class="pills">
          ${pills}
        </div>
      </section>`;
}

function bestMomentSection(episode, isLive) {
  const moment = episode.bestMoment;
  if (!moment || !moment.quote) return '';
  const href = isLive && episode.youtubeId
    ? watchUrl(episode.youtubeId, moment.seconds || 0)
    : null;
  return `
      <section class="section" aria-labelledby="moment-heading">
        <h2 class="section-title" id="moment-heading">Best Moment</h2>
        <blockquote class="best-moment">
          <p>“${escapeHtml(moment.quote)}”</p>
          <footer>${escapeHtml(moment.label || 'Highlight')}${href ? ` · <a href="${escapeAttr(href)}" rel="noopener">Jump to ${escapeHtml(moment.time || '')} ↗</a>` : ''}</footer>
        </blockquote>
      </section>`;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function shortsSection(episode) {
  const shorts = (episode.shorts || []).filter(short => short && short.url);
  if (!shorts.length) return '';
  const items = shorts.map(short => `        <li><a href="${escapeAttr(short.url)}" rel="noopener"><span class="chapter-time">${escapeHtml(short.duration ? formatClock(short.duration) : '')}</span><span>${escapeHtml(short.title || 'Short')}</span></a></li>`).join('\n');
  return `
      <section class="section" aria-labelledby="shorts-heading">
        <h2 class="section-title" id="shorts-heading">Clips from This Episode</h2>
        <ol class="chapter-list">
${items}
        </ol>
      </section>`;
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

function transcriptSection(transcript) {
  if (!transcript || !Array.isArray(transcript.dialogue) || !transcript.dialogue.length) return '';
  const turns = transcript.dialogue.map(turn => `      <div class="transcript-turn">
        <div class="turn-meta">
          <span class="turn-time">${escapeHtml(turn.time)}</span>
          <span class="speaker-pill ${speakerClass(turn.speaker)}">${escapeHtml(turn.speaker)}</span>
        </div>
        <p class="turn-text">${escapeHtml(turn.text)}</p>
      </div>`).join('\n');

  return `
      <section class="section" aria-labelledby="transcript-heading">
        <h2 class="section-title" id="transcript-heading">Full Transcript</h2>
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

  const metaDescription = truncate(episode.description || `${title} — a ${episode.duration || ''} film review recorded live from the car.`, 155);

  const year = movie && movie.year ? ` (${movie.year})` : '';
  const h1 = movie ? `${movie.title}${year} Review` : title;

  const byline = [
    episode.number ? `<span>Episode ${episode.number}</span>` : '',
    isLive && episode.duration ? `<span>${escapeHtml(episode.duration)}</span>` : '',
    isLive && episode.publishedAt ? `<span>${escapeHtml(formatLongDate(episode.publishedAt))}</span>` : '',
    !isLive ? `<span class="pill pill-rating">Premieres ${escapeHtml(publishLabel)}</span>` : '',
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
    ? `<a class="poster-link" href="${escapeAttr(watchUrl(episode.youtubeId))}" rel="noopener" aria-label="Watch ${escapeAttr(title)} on YouTube">
        <img src="${escapeAttr(heroImage)}" alt="${escapeAttr(`${title} video thumbnail`)}" width="1280" height="720" decoding="async" />
        <span class="play-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
      </a>
      <p class="poster-note">Full episode on YouTube · ${escapeHtml(episode.duration || '')}</p>`
    : `<div class="poster-link is-preview">
        <img src="${escapeAttr(heroImage)}" alt="${escapeAttr(`${title} preview thumbnail`)}" width="1280" height="720" decoding="async" />
        <span class="premiere-badge">Premieres</span>
      </div>
      <p class="poster-note">Premieres ${escapeHtml(publishLabel)} · Full episode drops on YouTube</p>`;

  const body = `
    <article>
      <header class="ep-head">
        <p class="eyebrow">${escapeHtml(SITE_NAME)} · Episode ${escapeHtml(String(episode.number || ''))}</p>
        <h1 class="ep-title">${escapeHtml(h1)}</h1>
        <div class="ep-byline">
        ${byline}
        </div>
      </header>

      ${poster}

      ${episode.description ? `<section class="section"><p class="ep-description">${escapeHtml(episode.description)}</p></section>` : ''}
      ${filmCard(movie)}
      ${scorecardSection(episode)}
      ${bestMomentSection(episode, isLive)}
      ${chapterSection(episode, isLive)}
      ${shortsSection(episode)}
      ${transcriptSection(transcript)}
      ${pager}
    </article>`;

  const podcastEpisode = {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    url: canonical,
    name: title,
    episodeNumber: episode.number || undefined,
    datePublished: episode.publishAt || episode.publishedAt || undefined,
    description: episode.description || metaDescription,
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
      description: episode.description || metaDescription,
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
      ? `${h1} — Episode ${episode.number} | ${SITE_NAME}`
      : `${h1} — Premieres ${publishLabel} | ${SITE_NAME}`,
    description: metaDescription,
    canonical,
    ogImage,
    jsonLd,
    depth,
    robots: isLive ? 'index, follow' : 'noindex, follow',
    body
  });
}

function buildArchivePage(episodes, movies) {
  const depth = 1; // episodes/index.html
  const canonical = siteUrl('/episodes/');
  const title = `All Episodes | ${SITE_NAME}`;
  const description = `Every ${SITE_NAME} episode: in-car film reviews recorded live in Austin, Texas. Full transcripts, chapters, and scorecards.`;

  const items = episodes.map(ep => {
    const movie = movies[ep.id];
    const isLive = isLiveEpisode(ep);
    const meta = isLive
      ? [ep.duration, formatLongDate(ep.publishedAt), movie && movie.rating ? `TMDb ${movie.rating}` : '']
        .filter(Boolean).map(escapeHtml).join(' · ')
      : `Premieres ${escapeHtml(ep.publishAt ? formatLongDate(ep.publishAt) : 'soon')}`;
    const badge = isLive ? '' : '<span class="pill pill-rating">Premieres</span>';
    const thumbnail = ep.thumbnail && !/^https?:/.test(ep.thumbnail)
      ? pageAsset(ep.thumbnail, depth)
      : pickSocialImage(ep.youtubeId, ep.thumbnail);
    return `      <li class="archive-item">
        <a href="./${escapeAttr(ep.slug)}/" aria-label="${escapeAttr(ep.shortTitle || ep.title)}">
          <img src="${escapeAttr(thumbnail)}" alt="" width="132" height="74" loading="lazy" decoding="async" />
        </a>
        <div class="archive-body">
          <div class="archive-title"><a href="./${escapeAttr(ep.slug)}/">${escapeHtml(ep.shortTitle || ep.title)}</a> ${badge}</div>
          <div class="archive-meta">${meta}</div>
          ${ep.description ? `<p class="archive-desc">${escapeHtml(truncate(ep.description, 130))}</p>` : ''}
        </div>
      </li>`;
  }).join('\n');

  const body = `
    <header class="ep-head">
      <p class="eyebrow">${escapeHtml(SITE_NAME)}</p>
      <h1 class="ep-title">All Episodes</h1>
      <div class="ep-byline">
        <span>${episodes.length} episode${episodes.length === 1 ? '' : 's'}</span>
        <span>In-car film reviews · Austin, TX</span>
      </div>
    </header>

    <section class="section">
      <ol class="archive-list">
${items || '        <li class="archive-item"><div class="archive-body"><div class="archive-title">No episodes published yet.</div></div></li>'}
      </ol>
    </section>`;

  return pageShell({
    title,
    description,
    canonical,
    ogImage: OG_IMAGE_FALLBACK,
    ogType: 'website',
    depth,
    navEpisodes: false,
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

Sitemap: ${siteUrl('/sitemap.xml')}
`;
}

// ========================================================
// 4. RUN
// ========================================================
async function run() {
  const catalog = readJson('data/episodes.json', []);
  const payloads = readPipelinePayloads();
  const episodes = mergeCatalogs(catalog, payloads);
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
    const html = await buildEpisodePage(episode, movies[episode.id], transcript, episodes);

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
  const liveCount = episodes.filter(isLiveEpisode).length;
  console.log(`[Pages] sitemap.xml (${liveCount + 2} urls, ${episodes.length - liveCount} pre-release excluded) + robots.txt`);
}

run().catch(err => {
  console.error('[Pages] Fatal:', err);
  process.exit(1);
});
