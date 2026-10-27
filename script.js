/* ========================================================
   CARPOOL CRITICS - MASTER INTERACTION LOGIC
   Version: 4.2.0 (MCP Optimized & Cleaned)
   ======================================================== */

// ========================================================
// 1. IN-MEMORY CACHES & OFFLINE FALLBACK DATA
// ========================================================
const transcriptCache = {};
let movieCatalogCache = null;
let formFeedbackTimer = null;

// Template placeholder episodes were removed; the live catalog is generated
// from the YouTube channel into data/episodes.json by scripts/fetch-youtube.js.
const fallbackTranscripts = {};
const fallbackMovies = {};

// ========================================================
// 2. VIEW NAVIGATION & ROUTING
// ========================================================
function switchSection(sectionId) {
  const panels = document.querySelectorAll('.view-panel');
  panels.forEach(panel => panel.classList.remove('active'));

  const activePanel = document.getElementById('view-' + sectionId);
  if (activePanel) {
    activePanel.classList.add('active');
  }

  // Fade out and hide title header when navigating away from home
  const header = document.querySelector('.title-header');
  if (header) {
    if (sectionId === 'home') {
      header.classList.remove('header-hidden');
    } else {
      header.classList.add('header-hidden');
    }
  }

  // Lazy-load the episode catalog only when the Reviews view is first opened,
  // so the home cockpit keeps its fast first paint.
  if (sectionId === 'episodes') {
    initEpisodesView();
  }
}

// Cockpit Spotlight Illumination
function setHover(hostKey, isHovered) {
  const group = document.getElementById('group-' + hostKey);
  if (group) {
    if (isHovered) {
      group.classList.add('is-hovered');
    } else {
      group.classList.remove('is-hovered');
    }
  }
}

// ========================================================
// 3. EPISODE CATALOG, PLAYLIST & CLICK-TO-LOAD VIDEO FACADE
// ========================================================
let episodeCatalogCache = null;
let episodesViewReady = false;
let activeVideoId = null;

/** data/episodes.json is generated from the YouTube channel by scripts/fetch-youtube.js */
async function getEpisodeCatalog() {
  if (episodeCatalogCache) return episodeCatalogCache;
  try {
    const res = await fetch('data/episodes.json');
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
      stack.innerHTML = '<div class="transcript-loading-msg">No episodes published yet. Check back after the next dispatch.</div>';
    }
    const titleEl = document.getElementById('current-video-title');
    if (titleEl) titleEl.innerText = 'No episodes yet';
    return;
  }

  renderEpisodePlaylist(episodes, stack);
  selectEpisode(episodes[0]);
}

function renderEpisodePlaylist(episodes, stack) {
  if (!stack) return;
  stack.innerHTML = episodes.map(ep => {
    const meta = [escapeHtml(ep.duration || ''), escapeHtml(relativeDate(ep.publishedAt))]
      .filter(Boolean).join(' • ');
    return `
      <div class="playlist-card" role="button" tabindex="0"
           data-ep="${escapeHtml(ep.id)}" data-video="${escapeHtml(ep.youtubeId)}"
           aria-label="${escapeHtml(ep.shortTitle || ep.title)}">
        <div>
          <div class="pl-ep-title">${escapeHtml(ep.shortTitle || ep.title)}</div>
          <div class="pl-ep-meta">${meta}</div>
        </div>
        <span class="pl-play-tag">▶ PLAY</span>
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
    subEl.innerText = ep.description || bits.join(' • ');
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
    body.innerHTML = '<div class="transcript-loading-msg">Transcript coming soon for this episode.</div>';
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
// 4. ON-DEMAND TRANSCRIPT LOADER
// ========================================================
async function loadEpisodeTranscript(epId) {
  const transcriptBody = document.getElementById('transcript-body');
  if (!transcriptBody) return;

  transcriptCache['current'] = epId;

  if (transcriptCache[epId]) {
    renderTranscript(transcriptCache[epId]);
    return;
  }

  transcriptBody.innerHTML = '<div class="transcript-loading-msg">Fetching episode transcript on-demand...</div>';

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
      transcriptBody.innerHTML = '<div class="transcript-loading-msg">Transcript coming soon for this episode.</div>';
    }
  }
}

function renderTranscript(data) {
  const transcriptBody = document.getElementById('transcript-body');
  if (!transcriptBody) return;

  if (!data.dialogue || data.dialogue.length === 0) {
    transcriptBody.innerHTML = '<div class="transcript-loading-msg">No transcript available.</div>';
    return;
  }

  const html = data.dialogue.map(entry => {
    const speakerKey = (entry.speaker || '').toLowerCase();
    return `
      <article class="transcript-entry">
        <div class="transcript-meta">
          <time class="transcript-time">${escapeHtml(entry.time || '00:00:00')}</time>
          <span class="speaker-pill speaker-${speakerKey}">${escapeHtml(entry.speaker)} (${escapeHtml(entry.role || 'Host')})</span>
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
  if (text) text.innerText = isCollapsed ? 'Show Transcript' : 'Hide Transcript';
  if (icon) icon.innerText = isCollapsed ? '▼' : '▲';
}

// ========================================================
// 5. TMDB MOVIE PROFILE RENDERER
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

  card.style.display = 'flex';

  const posterImg = document.getElementById('movie-poster-img');
  if (posterImg) {
    posterImg.src = movie.posterPath || '';
    posterImg.alt = `${movie.title} (${movie.year || ''}) Poster`;
  }

  const titleEl = document.getElementById('movie-title');
  if (titleEl) {
    titleEl.innerHTML = `${escapeHtml(movie.title)} <span class="movie-year">(${escapeHtml(movie.year || '')})</span>`;
  }

  const ratingScore = document.getElementById('movie-rating-score');
  if (ratingScore) {
    ratingScore.innerText = movie.rating || 'N/A';
  }

  const pillsEl = document.getElementById('movie-meta-pills');
  if (pillsEl) {
    let html = '';
    if (movie.runtime) html += `<span class="meta-pill pill-runtime">${escapeHtml(movie.runtime)}</span>`;
    if (movie.certification) html += `<span class="meta-pill pill-cert">${escapeHtml(movie.certification)}</span>`;
    if (movie.genres && Array.isArray(movie.genres)) {
      movie.genres.forEach(g => {
        html += `<span class="meta-pill pill-genre">${escapeHtml(g)}</span>`;
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
    linkEl.style.display = movie.tmdbUrl ? 'inline-flex' : 'none';
  }
}

// ========================================================
// 6. CONTACT FORM AJAX HANDLER (WEB3FORMS)
// ========================================================
function handleFormSubmission(e) {
  e.preventDefault();
  const form = e.target;
  const alert = document.getElementById('form-feedback');
  const submitBtn = form.querySelector('.btn-send-dispatch');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Transmitting...';
  }

  const formData = new FormData(form);

  fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    body: formData
  })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        if (alert) {
          alert.innerText = '✓ Dispatch transmitted successfully! We received your message.';
          alert.style.color = 'var(--bmw-blue)';
          alert.style.display = 'block';
        }
        form.reset();
      } else {
        if (alert) {
          alert.innerText = 'Error: ' + (data.message || 'Could not send message.');
          alert.style.color = 'var(--bmw-red)';
          alert.style.display = 'block';
        }
      }
    })
    .catch(err => {
      console.error('Submission error:', err);
      if (alert) {
        alert.innerText = 'Network error. Please try again later.';
        alert.style.color = 'var(--bmw-red)';
        alert.style.display = 'block';
      }
    })
    .finally(() => {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Send';
      }
      if (formFeedbackTimer) clearTimeout(formFeedbackTimer);
      formFeedbackTimer = setTimeout(() => {
        if (alert) alert.style.display = 'none';
      }, 6000);
    });
}

// ========================================================
// 7. UTILITIES & INITIALIZATION
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
  // The home cockpit needs no catalog data. Episodes load on first visit to Reviews.
  if (document.getElementById('view-episodes')?.classList.contains('active')) {
    initEpisodesView();
  }
});
