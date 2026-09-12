/* ========================================================
   CARPOOL CINEMA CRITICS - MASTER INTERACTION LOGIC
   Version: 4.0.0 (MCP Optimized & Cleaned)
   ======================================================== */

// ========================================================
// 1. IN-MEMORY CACHES & OFFLINE FALLBACK DATA
// ========================================================
const transcriptCache = {};
let movieCatalogCache = null;
let formFeedbackTimer = null;

const fallbackTranscripts = {
  ep42: {
    dialogue: [
      { time: "00:00:12", speaker: "Shane", role: "Passenger", text: "Engine's idling, parking brake is on, and the Austin skyline is glowing right out the back window. We literally walked out of the midnight screening ten minutes ago. Alex, take the wheel on this one—what was your immediate reaction to that opening sequence?" },
      { time: "00:00:35", speaker: "Alex", role: "Driver", text: "The camera blocking in the first twelve minutes was masterclass level. Shooting through rainy windshields with practical sodium-vapor streetlights created an overwhelming sense of dread before a single line of dialogue was spoken. It sets the tone for the entire mystery." },
      { time: "00:01:02", speaker: "Dave", role: "Center Back", text: "From the back seat here, I gotta point out the practical creature effects in the subway tunnel. Notice how they didn't use motion blur to hide rubber seams? They used silhouette and strobe lighting the way Ridley Scott did in Alien. That was genuine craftsmanship." },
      { time: "00:01:28", speaker: "Shane", role: "Passenger", text: "And the sound design! Sitting here in the car with the theater acoustics still ringing in my ears, the rumble of the engine in the chase scene was recorded with real binaural mics. Let's break down where the second act stumbled before getting into the twist ending." },
      { time: "00:01:52", speaker: "Alex", role: "Driver", text: "Agreed. The subplot with the detective's estranged sister felt like studio interference designed to pad runtime, but the finale completely redeemed it. Let's give our final hubcap ratings." }
    ]
  },
  ep41: {
    dialogue: [
      { time: "00:00:08", speaker: "Shane", role: "Passenger", text: "Welcome back inside the X5. Episode 41 is all about the summer blockbuster cycle and why so many two-hundred-million-dollar tentpoles look identical." },
      { time: "00:00:26", speaker: "Alex", role: "Driver", text: "When every sequence relies on pre-visualization software and grey color grading, the emotional stakes vanish. We just watched four consecutive explosions with zero geographic continuity." },
      { time: "00:00:48", speaker: "Dave", role: "Center Back", text: "That's why Mad Max: Fury Road or Top Gun: Maverick stood out so fiercely. When you put real stunt drivers on real tarmac, the human brain registers the physical danger." }
    ]
  },
  ep40: {
    dialogue: [
      { time: "00:00:10", speaker: "Shane", role: "Passenger", text: "Late-night horror dispatch. Tonight we're debating why 80s animatronics still look terrifying while 2026 CGI monsters often look like video game cutscenes." },
      { time: "00:00:30", speaker: "Dave", role: "Center Back", text: "It comes down to tactile light interaction. Foam latex and silicone physically absorb and reflect photons from practical lamps. CGI shaders are calculating approximations, and your eye knows the difference." },
      { time: "00:00:55", speaker: "Alex", role: "Driver", text: "And the actors behave differently when there's an actual seven-foot mechanical puppet in the room with them versus a tennis ball on a green broomstick." }
    ]
  }
};

const fallbackMovies = {
  ep42: {
    id: 348,
    title: "Alien",
    year: "1979",
    rating: "8.1",
    runtime: "1h 57m",
    certification: "R",
    genres: ["Horror", "Science Fiction"],
    overview: "During its return to the earth, commercial spaceship Nostromo intercepts a distress signal from a distant planet. When a three-member team of the crew investigates the source of the signal, they uncover a horrific extraterrestrial lifeform.",
    posterPath: "https://image.tmdb.org/t/p/w300/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg",
    tmdbUrl: "https://www.themoviedb.org/movie/348-alien"
  },
  ep41: {
    id: 361743,
    title: "Top Gun: Maverick",
    year: "2022",
    rating: "8.2",
    runtime: "2h 11m",
    certification: "PG-13",
    genres: ["Action", "Drama"],
    overview: "After more than thirty years of service as one of the Navy's top aviators, Pete 'Maverick' Mitchell is where he belongs, pushing the envelope as a courageous test pilot and dodging the advancement in rank that would ground him.",
    posterPath: "https://image.tmdb.org/t/p/w300/62HCnUTziyWcpDaBO2i1DX17ljH.jpg",
    tmdbUrl: "https://www.themoviedb.org/movie/361743-top-gun-maverick"
  },
  ep40: {
    id: 1091,
    title: "The Thing",
    year: "1982",
    rating: "8.0",
    runtime: "1h 49m",
    certification: "R",
    genres: ["Horror", "Mystery", "Science Fiction"],
    overview: "A team of American scientists investigating an outbreak at a Norwegian research base in Antarctica discover that a parasitic alien organism capable of imitating its victims is on the loose.",
    posterPath: "https://image.tmdb.org/t/p/w300/tzGY49kseSE9QAKxRjJIPAgL8Wd.jpg",
    tmdbUrl: "https://www.themoviedb.org/movie/1091-the-thing"
  }
};

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

  // Ensure default episode data is loaded when navigating to episodes
  if (sectionId === 'episodes') {
    if (!transcriptCache['current']) {
      loadEpisodeTranscript('ep42');
    }
    renderMovieProfile('ep42');
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
// 3. EPISODE PLAYER & PLAYLIST HANDLER
// ========================================================
function loadYouTubeVideo(youtubeId, title, epId) {
  const player = document.getElementById('main-video-player');
  const titleEl = document.getElementById('current-video-title');
  
  if (player && youtubeId) {
    player.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1`;
  }
  if (titleEl && title) {
    titleEl.innerText = title;
  }

  // Synchronize active playlist card styling without deprecated window.event
  const cards = document.querySelectorAll('.playlist-card');
  cards.forEach(card => {
    if (epId && card.getAttribute('data-ep') === epId) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });

  // Load transcript and movie profile asynchronously
  if (epId) {
    loadEpisodeTranscript(epId);
    renderMovieProfile(epId);
  }
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
  loadEpisodeTranscript('ep42');
  renderMovieProfile('ep42');
});
