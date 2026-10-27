/* ========================================================
   CARPOOL CRITICS - MASTER INTERACTION LOGIC
   Version: 5.0.0 - Dash-Cam Brutalism
   Contract: /BRAND.md
   ======================================================== */

// ========================================================
// 1. IN-MEMORY CACHES & OFFLINE FALLBACK DATA
// ========================================================
const transcriptCache = {};
let movieCatalogCache = null;
let contactFeedbackTimer = null;
let hudClockTimer = null;
let signalRollTimer = null;
let signalGlitchTimer = null;
const bootTime = Date.now();

// Template placeholder episodes were removed; the live catalog is generated
// from the YouTube channel into data/episodes.json by scripts/fetch-youtube.js.
const fallbackTranscripts = {};
const fallbackMovies = {};

const SECTIONS = ['home', 'about', 'episodes', 'contact'];

// ========================================================
// 2. VIEW NAVIGATION & ROUTING
// ========================================================
function sectionFromLocation() {
  const key = (location.hash || '').replace(/^#/, '').trim();
  return SECTIONS.includes(key) ? key : 'home';
}

function syncDeckNav(sectionId) {
  document.querySelectorAll('.deck-btn[data-section]').forEach(btn => {
    if (btn.getAttribute('data-section') === sectionId) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });
}

function switchSection(sectionId, options = {}) {
  if (!SECTIONS.includes(sectionId)) sectionId = 'home';

  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));

  const activePanel = document.getElementById('view-' + sectionId);
  if (activePanel) {
    activePanel.classList.add('active');
  }

  syncDeckNav(sectionId);

  // The site is a single dashboard. Replace the URL fragment so a view is
  // shareable, but never let the browser jump to an anchor.
  if (options.updateHistory !== false) {
    const target = sectionId === 'home'
      ? `${location.pathname}${location.search}`
      : `${location.pathname}${location.search}#${sectionId}`;
    try {
      history.pushState({ section: sectionId }, '', target);
    } catch (err) {
      // file:// previews can reject pushState; navigation still works.
    }
  }

  if (sectionId !== 'home') {
    const scroller = activePanel && activePanel.querySelector('.subpage-scroll-container');
    if (scroller) scroller.scrollTop = 0;
  }

  // Lazy-load the episode catalog only when the Reviews view is first opened,
  // so the home cockpit keeps its fast first paint.
  if (sectionId === 'episodes') {
    initEpisodesView();
  }

  // Ground-loop accent on entering the cockpit. Initial load is handled below.
  if (sectionId === 'home') {
    triggerSignalSurge();
  }
}

// Cockpit Spotlight Illumination
function setHover(hostKey, isHovered) {
  const group = document.getElementById('group-' + hostKey);
  if (group) {
    group.classList.toggle('is-hovered', Boolean(isHovered));
  }
}

// Bind every dashboard control once. The cockpit hotspots are divs, so they
// also get Enter/Space handling instead of relying on synthetic clicks.
function initNavigation() {
  document.querySelectorAll('[data-section]').forEach(el => {
    const go = () => switchSection(el.dataset.section);
    el.addEventListener('click', go);

    if (el.tagName !== 'BUTTON') {
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          go();
        }
      });
    }
  });
}

// ========================================================
// 3. ASCII TACHOMETER GAUGE
// ========================================================
/**
 * Convert a numeric rating into the brand's ten-cell ASCII gauge.
 * 8 -> "[▓▓▓▓▓▓▓▓░░] 8.0/10"
 * Missing/invalid -> "[░░░░░░░░░░] --/--"
 */
function asciiGauge(value, max = 10, cells = 10) {
  const numeric = Number(value);
  const valid = value !== null && value !== '' && Number.isFinite(numeric);
  if (!valid) {
    return `[${'░'.repeat(cells)}] --/--`;
  }
  const clamped = Math.min(Math.max(numeric, 0), max);
  const filled = Math.round((clamped / max) * cells);
  const bar = `${'▓'.repeat(filled)}${'░'.repeat(cells - filled)}`;
  const shownMax = Number.isInteger(max) ? String(max) : max.toFixed(1);
  return `[${bar}] ${clamped.toFixed(1)}/${shownMax}`;
}

// Exposed for preview tools and console checks.
window.asciiGauge = asciiGauge;

// ========================================================
// 4. REC CLOCK (runtime counter, not wall time)
// ========================================================
function formatRuntime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function initClock() {
  const tick = () => {
    const stamp = formatRuntime(Date.now() - bootTime);
    document.querySelectorAll('[data-clock]').forEach(el => {
      el.textContent = stamp;
    });
  };
  tick();
  if (hudClockTimer) clearInterval(hudClockTimer);
  hudClockTimer = setInterval(tick, 1000);

  const yearEl = document.getElementById('status-year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
}

// ========================================================
// 5. STEPPED GROUND-LOOP SURGE
// ========================================================
// One 1px amber band rolls through the top HUD strip over 2s at 12fps.
// A 2-frame RGB split lands with it, then everything stops. No continuous
// interference, no easing, and never over the center cabin or faces.
function triggerSignalSurge() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const roll = document.getElementById('signal-interference');
  if (!roll) return;

  const huds = document.querySelectorAll('.stage-hud-tl, .stage-hud-tc, .stage-hud-tr');

  roll.classList.remove('is-surging');
  void roll.offsetWidth;
  roll.classList.add('is-surging');

  huds.forEach(el => el.classList.add('is-rgb-split'));

  if (signalGlitchTimer) clearTimeout(signalGlitchTimer);
  signalGlitchTimer = setTimeout(() => {
    huds.forEach(el => el.classList.remove('is-rgb-split'));
  }, 167);

  if (signalRollTimer) clearTimeout(signalRollTimer);
  signalRollTimer = setTimeout(() => {
    roll.classList.remove('is-surging');
  }, 2100);
}

// ========================================================
// 6. EPISODE CATALOG, PLAYLIST & CLICK-TO-LOAD VIDEO FACADE
// ========================================================
let episodeCatalogCache = null;
let episodesViewReady = false;
let activeVideoId = null;

/** data/episodes.json is generated from the YouTube channel by scripts/fetch-youtube.js */
async function getEpisodeCatalog() {
  if (episodeCatalogCache) return episodeCatalogCache;
  try {
    // GitHub Pages serves JSON with max-age=600, so a viewer who loads the SPA
    // right after a publish (or keeps a tab open) can mount a stale catalog and
    // embed a video that no longer exists. Always revalidate the catalog.
    const res = await fetch(`data/episodes.json?v=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      episodeCatalogCache = Array.isArray(data) ? data : [];
      return episodeCatalogCache;
    }
  } catch (err) {
    console.warn('Could not load data/episodes.json', err);
  }
  episodeCatalogCache = [];
  return episodeCatalogCache;
}

/** Human label computed at view time so it never goes stale in the repo. */
function relativeDate(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 0) return 'Upcoming';
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;

  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'Released Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return '1 month ago';
  return `${Math.floor(days / 30)} months ago`;
}

async function initEpisodesView() {
  if (episodesViewReady) return;
  episodesViewReady = true;

  const stack = document.getElementById('episode-playlist');
  const episodes = await getEpisodeCatalog();

  if (!episodes.length) {
    if (stack) {
      stack.innerHTML = '<div class="transcript-loading-msg">NO EPISODES PUBLISHED YET // CHECK BACK AFTER THE NEXT DISPATCH.</div>';
    }
    const titleEl = document.getElementById('current-video-title');
    if (titleEl) titleEl.innerText = 'No episodes yet';
    return;
  }

  renderEpisodePlaylist(episodes, stack);
  selectEpisode(episodes[0]);
}

function formatEpisodeNumber(ep, index) {
  const raw = Number(ep.number);
  const value = Number.isFinite(raw) && raw > 0 ? raw : index + 1;
  return String(value).padStart(2, '0');
}

function renderEpisodePlaylist(episodes, stack) {
  if (!stack) return;
  stack.innerHTML = episodes.map((ep, index) => {
    const meta = [escapeHtml(ep.duration || ''), escapeHtml(relativeDate(ep.publishedAt))]
      .filter(Boolean).join(' // ');
    const number = formatEpisodeNumber(ep, index);
    return `
      <div class="playlist-card" role="button" tabindex="0"
           data-ep="${escapeHtml(ep.id)}" data-video="${escapeHtml(ep.youtubeId)}">
        <div class="ticket-head">
          <span>ADMIT ONE // EP #${number}</span>
          <span class="ticket-head-right">HOV-3</span>
        </div>
        <div class="pl-ticket-body">
          <div>
            <div class="pl-ep-title">${escapeHtml(ep.shortTitle || ep.title)}</div>
            <div class="pl-ep-meta">${meta || 'DISPATCH'}</div>
          </div>
        </div>
        <div class="ticket-foot">
          <span>HOV-3: SHANE, ALEX, DAVE</span>
          <span class="pl-play-tag">[ ▶ PLAY ]</span>
        </div>
      </div>`;
  }).join('');

  const cards = [...stack.querySelectorAll('.playlist-card')];
  cards.forEach(card => {
    const activate = () => {
      const ep = episodes.find(e => e.id === card.getAttribute('data-ep'));
      if (ep) selectEpisode(ep, { autoplay: true });
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  });
}

function selectEpisode(ep, options = {}) {
  if (!ep || !ep.youtubeId) return;
  activeVideoId = ep.youtubeId;

  const titleEl = document.getElementById('current-video-title');
  if (titleEl) titleEl.innerText = ep.title || ep.shortTitle || '';

  const subEl = document.getElementById('current-video-sub');
  if (subEl) {
    const bits = [ep.duration, relativeDate(ep.publishedAt)].filter(Boolean);
    subEl.innerText = ep.description || bits.join(' // ');
  }

  const poster = document.getElementById('video-facade-poster');
  if (poster) {
    poster.src = ep.thumbnail || `https://i.ytimg.com/vi/${ep.youtubeId}/hqdefault.jpg`;
    poster.style.display = '';
    poster.alt = `${ep.shortTitle || 'Episode'} thumbnail`;
  }

  // Point at the pre-rendered static page so the episode is shareable and
  // crawlable (built by scripts/build-episode-pages.js).
  const permalink = document.getElementById('episode-permalink');
  if (permalink) {
    if (ep.slug) {
      permalink.href = `episodes/${encodeURIComponent(ep.slug)}/`;
      permalink.style.display = '';
    } else {
      permalink.style.display = 'none';
    }
  }

  document.querySelectorAll('.playlist-card').forEach(card => {
    card.classList.toggle('active', card.getAttribute('data-ep') === ep.id);
  });

  if (options.autoplay) mountVideoPlayer(true);

  // Only request a transcript when one is actually registered for the episode.
  if (ep.id) {
    if (ep.transcriptFile) {
      loadEpisodeTranscript(ep.id);
    } else {
      showTranscriptPlaceholder();
    }
    renderMovieProfile(ep.id);
  }
}

function showTranscriptPlaceholder() {
  const body = document.getElementById('transcript-body');
  if (body) {
    body.innerHTML = '<div class="transcript-loading-msg">TRANSCRIPT COMING SOON // NO CAPTION TRACK YET.</div>';
  }
}

/**
 * The iframe is ~1MB of third-party script, so it is only injected after an
 * explicit click. This is the single biggest Lighthouse win on this page.
 */
function mountVideoPlayer(autoplay = true) {
  const box = document.getElementById('video-facade-box');
  if (!box || !activeVideoId) return;

  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(activeVideoId)}?rel=0${autoplay ? '&autoplay=1' : ''}`;
  const existing = box.querySelector('iframe');
  if (existing) {
    existing.src = src;
    return;
  }

  box.innerHTML = `
    <iframe
      id="main-video-player"
      src="${src}"
      title="Carpool Critics Episode Player"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
    ></iframe>`;
}

function activateVideoPlayer() {
  mountVideoPlayer(true);
}

// ========================================================
// 7. ON-DEMAND TRANSCRIPT LOADER
// ========================================================
async function loadEpisodeTranscript(epId) {
  const transcriptBody = document.getElementById('transcript-body');
  if (!transcriptBody) return;

  transcriptCache['current'] = epId;

  if (transcriptCache[epId]) {
    renderTranscript(transcriptCache[epId]);
    return;
  }

  transcriptBody.innerHTML = '<div class="transcript-loading-msg">READING TRANSCRIPT // ON-DEMAND FETCH...</div>';

  try {
    const response = await fetch(`data/transcripts/${encodeURIComponent(epId)}.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    transcriptCache[epId] = data;
    renderTranscript(data);
  } catch (err) {
    console.warn('Transcript fetch fallback:', err);
    if (fallbackTranscripts[epId]) {
      transcriptCache[epId] = fallbackTranscripts[epId];
      renderTranscript(fallbackTranscripts[epId]);
    } else {
      transcriptBody.innerHTML = '<div class="transcript-loading-msg">TRANSCRIPT COMING SOON // NO CAPTION TRACK YET.</div>';
    }
  }
}

function renderTranscript(data) {
  const transcriptBody = document.getElementById('transcript-body');
  if (!transcriptBody) return;

  if (!data.dialogue || data.dialogue.length === 0) {
    transcriptBody.innerHTML = '<div class="transcript-loading-msg">NO TRANSCRIPT AVAILABLE.</div>';
    return;
  }

  const html = data.dialogue.map(entry => {
    const speakerKey = (entry.speaker || '').toLowerCase();
    return `
      <article class="transcript-entry">
        <div class="transcript-meta">
          <time class="transcript-time">${escapeHtml(entry.time || '00:00:00')}</time>
          <span class="speaker-pill speaker-${speakerKey}">◊ ${escapeHtml(entry.speaker)} // ${escapeHtml(entry.role || 'HOST')}</span>
        </div>
        <p class="transcript-text">${escapeHtml(entry.text)}</p>
      </article>
    `;
  }).join('');

  transcriptBody.innerHTML = html;
}

function toggleTranscript() {
  const body = document.getElementById('transcript-body');
  const btn = document.getElementById('btn-toggle-transcript');
  const text = document.getElementById('txt-toggle-transcript');
  const icon = document.getElementById('ico-toggle-transcript');

  if (!body) return;

  const isCollapsed = body.classList.toggle('collapsed');
  if (btn) btn.setAttribute('aria-expanded', !isCollapsed);
  if (text) text.innerText = isCollapsed ? '[ SHOW ]' : '[ HIDE ]';
  if (icon) icon.innerText = isCollapsed ? '▼' : '▲';
}

// ========================================================
// 8. TMDB MOVIE PROFILE RENDERER
// ========================================================
async function getMovieCatalog() {
  if (movieCatalogCache) return movieCatalogCache;
  try {
    const res = await fetch('data/movies.json');
    if (res.ok) {
      movieCatalogCache = await res.json();
      return movieCatalogCache;
    }
  } catch (err) {
    console.warn('Could not load data/movies.json, using fallback.', err);
  }
  movieCatalogCache = fallbackMovies;
  return movieCatalogCache;
}

function upper(value) {
  return String(value == null ? '' : value).toUpperCase();
}

async function renderMovieProfile(epId) {
  const card = document.getElementById('movie-profile-card');
  if (!card) return;

  const catalog = await getMovieCatalog();
  const movie = catalog[epId];

  // Silent fallback if no movie is linked to the episode
  if (!movie) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  const posterImg = document.getElementById('movie-poster-img');
  if (posterImg) {
    posterImg.src = movie.posterPath || '';
    posterImg.alt = `${movie.title} (${movie.year || ''}) Poster`;
  }

  const titleEl = document.getElementById('movie-title');
  if (titleEl) {
    const yearHtml = movie.year
      ? ` <span class="movie-year">(${escapeHtml(movie.year)})</span>`
      : '';
    titleEl.innerHTML = `${escapeHtml(upper(movie.title))}${yearHtml}`;
  }

  // The rating is always a tachometer, never a star badge.
  const gaugeEl = document.getElementById('movie-rating-gauge');
  if (gaugeEl) {
    gaugeEl.innerText = asciiGauge(movie.rating);
  }

  const pillsEl = document.getElementById('movie-meta-pills');
  if (pillsEl) {
    let html = '';
    if (movie.runtime) html += `<span class="meta-pill pill-runtime">${escapeHtml(upper(movie.runtime))}</span>`;
    if (movie.certification) html += `<span class="meta-pill pill-cert">${escapeHtml(upper(movie.certification))}</span>`;
    if (movie.genres && Array.isArray(movie.genres)) {
      movie.genres.forEach(g => {
        html += `<span class="meta-pill pill-genre">${escapeHtml(upper(g))}</span>`;
      });
    }
    pillsEl.innerHTML = html;
  }

  const synopsisEl = document.getElementById('movie-synopsis');
  if (synopsisEl) {
    synopsisEl.innerText = movie.overview || '';
  }

  const linkEl = document.getElementById('movie-tmdb-link');
  if (linkEl) {
    linkEl.href = movie.tmdbUrl || '#';
    linkEl.style.display = movie.tmdbUrl ? 'inline-block' : 'none';
  }
}

// ========================================================
// 9. CONTACT: PLAIN EMAIL, NO FORM, NO PUBLIC ENDPOINT
// ========================================================
// There is no form and no third-party submit endpoint, so there is nothing for
// bots to POST to. The address is assembled at runtime from data attributes so
// the raw string never sits in the served HTML for address harvesters.
function getContactAddress() {
  const link = document.getElementById('contact-email-link');
  if (!link) return '';
  const user = link.dataset.user || '';
  const domain = link.dataset.domain || '';
  return user && domain ? `${user}@${domain}` : '';
}

function initContactEmail() {
  const link = document.getElementById('contact-email-link');
  const address = getContactAddress();
  if (!link || !address) return;
  link.href = `mailto:${address}`;
  link.textContent = address;
}

function showContactFeedback(message, isError) {
  const feedback = document.getElementById('contact-feedback');
  if (!feedback) return;
  feedback.innerText = message;
  feedback.style.color = 'var(--text-ticket)';
  feedback.style.borderLeftColor = isError ? 'var(--accent-brake)' : 'var(--accent-hov)';
  feedback.style.display = 'block';
  if (contactFeedbackTimer) clearTimeout(contactFeedbackTimer);
  contactFeedbackTimer = setTimeout(() => {
    feedback.style.display = 'none';
  }, 6000);
}

function copyContactEmail() {
  const address = getContactAddress();
  if (!address) return;
  const onCopied = () => showContactFeedback('[ COPIED ] ' + address, false);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(address)
      .then(onCopied)
      .catch(() => copyContactEmailFallback(address, onCopied));
  } else {
    copyContactEmailFallback(address, onCopied);
  }
}

function copyContactEmailFallback(address, onCopied) {
  const field = document.createElement('textarea');
  field.value = address;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (err) {
    copied = false;
  }
  document.body.removeChild(field);
  if (copied) {
    onCopied();
  } else {
    showContactFeedback('[ FAIL ] SELECT THE ADDRESS MANUALLY.', true);
  }
}

// ========================================================
// 10. UTILITIES & INITIALIZATION
// ========================================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initContactEmail();
  initNavigation();

  // Deep links: carpoolcritics.com/#episodes opens the Reviews dashboard.
  const initial = sectionFromLocation();
  syncDeckNav(initial);
  if (initial !== 'home') switchSection(initial, { updateHistory: false });
  else setTimeout(triggerSignalSurge, 650);

  window.addEventListener('popstate', () => {
    const section = sectionFromLocation();
    switchSection(section, { updateHistory: false });
  });
});
