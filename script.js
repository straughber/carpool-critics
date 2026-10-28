/* ========================================================
   CARPOOL CRITICS - MASTER INTERACTION LOGIC
   Version: 6.0.0 - Dash-Cam Brutalism
   Contract: /BRAND.md
   ======================================================== */

// ========================================================
// 1. STATE & TIMERS
// ========================================================
let contactFeedbackTimer = null;
let hudClockTimer = null;
let signalRollTimer = null;
let signalGlitchTimer = null;
const bootTime = Date.now();

// The live catalog is generated from the YouTube channel into
// data/episodes.json by scripts/fetch-youtube.js.
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
// 6. LIVE FEED: CAM DECK, CHANNEL SELECT, CLICK-TO-LOAD PLAYER
// ========================================================
// EPISODES is a broadcast, not a catalogue. Five cameras, newest first:
// CAM 01 is always the latest dispatch. When the sixth episode lands, CAM 01
// rolls over to it and the oldest drops off the feed into the archive only.
const FEED_SIZE = 5;

let episodeCatalogCache = null;
let episodesViewReady = false;
let activeVideoId = null;
let camTuneTimer = null;

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

  const feed = feedEpisodes(await getEpisodeCatalog());

  renderCamRail(feed);

  if (feed.length) {
    selectEpisode(feed[0], { camNumber: 1 });
  } else {
    renderDeadFeed();
  }

  // A deep link (#episodes) can resolve before the feed mounts. Pin the view to
  // its own heading instead of wherever the fragment scroll landed.
  const scroller = document.querySelector('#view-episodes .subpage-scroll-container');
  if (scroller) scroller.scrollTop = 0;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function episodeStamp(ep) {
  const parsed = Date.parse(ep.publishedAt || ep.publishAt || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Newest first. CAM 01 is the newest dispatch, always. */
function feedEpisodes(episodes) {
  return [...episodes]
    // A scheduled episode has a page but no public video yet. It is not live
    // television, so it does not get a camera.
    .filter(ep => ep.youtubeId && ep.status !== 'scheduled' && ep.status !== 'draft')
    .sort((a, b) => (
      (episodeStamp(b) - episodeStamp(a))
      || ((Number(b.number) || 0) - (Number(a.number) || 0))
    ))
    .slice(0, FEED_SIZE);
}

function formatEpisodeNumber(ep, index) {
  const raw = Number(ep.number);
  const value = Number.isFinite(raw) && raw > 0 ? raw : index + 1;
  return String(value).padStart(2, '0');
}

/**
 * Five slots, always. A slot with no episode is a dead camera: visible,
 * labelled NO SIGNAL, and not clickable. The console does not pretend.
 */
function renderCamRail(feed) {
  const rail = document.getElementById('cam-rail');
  if (!rail) return;

  const slots = [];
  for (let cam = 1; cam <= FEED_SIZE; cam += 1) {
    const ep = feed[cam - 1];
    if (!ep || !ep.youtubeId) {
      slots.push(`
        <button type="button" class="cam-btn is-offline" disabled>
          <span class="cam-btn-id">CAM ${pad2(cam)}</span>
          <span class="cam-btn-title">NO SIGNAL</span>
          <span class="cam-btn-state" aria-hidden="true">▒░▒▓░▒▓░▒░</span>
        </button>`);
      continue;
    }

    const number = formatEpisodeNumber(ep, cam - 1);
    slots.push(`
      <button type="button" class="cam-btn" data-ep="${escapeHtml(ep.id)}" data-cam="${cam}"
              aria-current="false"
              aria-label="CAM ${pad2(cam)}, EP ${number}: ${escapeHtml(ep.shortTitle || ep.title)}">
        <span class="cam-btn-id">CAM ${pad2(cam)} // EP ${number}</span>
        <span class="cam-btn-title">${escapeHtml(ep.shortTitle || ep.title)}</span>
        <span class="cam-btn-state">[ ● LIVE ] ${escapeHtml(ep.duration || 'CABIN')}</span>
      </button>`);
  }

  rail.innerHTML = slots.join('');

  rail.querySelectorAll('.cam-btn[data-ep]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ep = feed.find(item => item.id === btn.getAttribute('data-ep'));
      if (!ep) return;
      // Once the player is open, a channel change is a real cut and the new
      // feed plays. Before that the poster swaps and PLAY stays explicit.
      const playerMounted = Boolean(document.querySelector('#video-facade-box iframe'));
      selectEpisode(ep, {
        camNumber: Number(btn.getAttribute('data-cam')),
        autoplay: playerMounted
      });
    });
  });
}

/** No episodes at all: the console sits on a dead channel. */
function renderDeadFeed() {
  const monitor = document.getElementById('cam-monitor');
  if (monitor) monitor.classList.add('is-offline');

  setText('cam-osd-cam', '--');
  setText('cam-osd-episode', 'EP --');
  setText('cam-osd-runtime', '--:--');
  setText('cam-osd-label', 'NO DISPATCH ON FILE');
  setText('current-video-title', 'NO SIGNAL');

  const subEl = document.getElementById('current-video-sub');
  if (subEl) subEl.innerText = 'Nothing has cleared the feed yet // the archive keeps the record.';

  const permalink = document.getElementById('episode-permalink');
  if (permalink) permalink.style.display = 'none';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function selectEpisode(ep, options = {}) {
  if (!ep || !ep.youtubeId) return;
  activeVideoId = ep.youtubeId;

  const camNumber = options.camNumber || 1;
  const cam = pad2(camNumber);
  const number = formatEpisodeNumber(ep, camNumber - 1);

  const monitor = document.getElementById('cam-monitor');
  if (monitor) monitor.classList.remove('is-offline');

  setText('cam-osd-cam', cam);
  setText('cam-osd-episode', `EP ${number}`);
  setText('cam-osd-runtime', ep.duration || '--:--');
  setText('cam-osd-label', `CAM ${cam} // CABIN FEED`);
  setText('current-video-title', ep.title || ep.shortTitle || '');

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
  // crawlable (built by scripts/build-episode-pages.js). The archive owns the
  // full record; the feed only hands you off to it.
  const permalink = document.getElementById('episode-permalink');
  if (permalink) {
    if (ep.slug) {
      permalink.href = `episodes/${encodeURIComponent(ep.slug)}/`;
      permalink.style.display = '';
    } else {
      permalink.style.display = 'none';
    }
  }

  document.querySelectorAll('.cam-btn[data-ep]').forEach(btn => {
    btn.setAttribute('aria-current', btn.getAttribute('data-ep') === ep.id ? 'true' : 'false');
  });

  tuneFeed();

  if (options.autoplay) mountVideoPlayer(true);
}

/** Channel change: two stepped frames of interference, then the new feed. */
function tuneFeed() {
  const monitor = document.getElementById('cam-monitor');
  if (!monitor) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  monitor.classList.remove('is-tuning');
  void monitor.offsetWidth;
  monitor.classList.add('is-tuning');

  if (camTuneTimer) clearTimeout(camTuneTimer);
  camTuneTimer = setTimeout(() => monitor.classList.remove('is-tuning'), 160);
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
// 7. CONTACT: PLAIN EMAIL, NO FORM, NO PUBLIC ENDPOINT
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
// 8. UTILITIES & INITIALIZATION
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
