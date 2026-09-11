/* ========================================================
   CARPOOL CINEMA CRITICS - INTERACTION & LAZY LOAD LOGIC
   ======================================================== */

// Global transcript cache to minimize network requests
const transcriptCache = {};

// Fallback transcript data for offline / direct file preview
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

function switchSection(sectionId) {
  const panels = document.querySelectorAll('.view-panel');
  panels.forEach(panel => panel.classList.remove('active'));

  const activePanel = document.getElementById('view-' + sectionId);
  if (activePanel) {
    activePanel.classList.add('active');
  }

  // Fade out and hide top title box when navigating away from home
  const header = document.querySelector('.title-header');
  if (header) {
    if (sectionId === 'home') {
      header.classList.remove('header-hidden');
    } else {
      header.classList.add('header-hidden');
    }
  }

  // Ensure initial transcript is loaded when opening episodes
  if (sectionId === 'episodes' && !transcriptCache['current']) {
    loadEpisodeTranscript('ep42');
  }
}

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

function loadYouTubeVideo(youtubeId, title, epId) {
  const player = document.getElementById('main-video-player');
  const titleEl = document.getElementById('current-video-title');
  
  if (player && youtubeId) {
    player.src = "https://www.youtube-nocookie.com/embed/" + youtubeId + "?autoplay=1";
  }
  if (titleEl && title) {
    titleEl.innerText = title;
  }

  // Load the respective transcript on-demand
  if (epId) {
    loadEpisodeTranscript(epId);
  }

  const cards = document.querySelectorAll('.playlist-card');
  cards.forEach(card => card.classList.remove('active'));
  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add('active');
  }
}

// On-demand lazy loader for transcripts
function loadEpisodeTranscript(epId) {
  const transcriptBody = document.getElementById('transcript-body');
  if (!transcriptBody) return;

  transcriptCache['current'] = epId;

  // Check in-memory cache first
  if (transcriptCache[epId]) {
    renderTranscript(transcriptCache[epId]);
    return;
  }

  // Show loading indicator
  transcriptBody.innerHTML = '<div class="transcript-loading-msg">Fetching episode transcript on-demand...</div>';

  // Fetch static JSON file on-demand
  fetch('data/transcripts/' + epId + '.json')
    .then(response => {
      if (!response.ok) throw new Error('Network error');
      return response.json();
    })
    .then(data => {
      transcriptCache[epId] = data;
      renderTranscript(data);
    })
    .catch(err => {
      console.warn('Transcript fetch fallback:', err);
      if (fallbackTranscripts[epId]) {
        transcriptCache[epId] = fallbackTranscripts[epId];
        renderTranscript(fallbackTranscripts[epId]);
      } else {
        transcriptBody.innerHTML = '<div class="transcript-loading-msg">Transcript coming soon for this episode.</div>';
      }
    });
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
          <time class="transcript-time">${entry.time || '00:00:00'}</time>
          <span class="speaker-pill speaker-${speakerKey}">${entry.speaker} (${entry.role || 'Host'})</span>
        </div>
        <p class="transcript-text">${entry.text}</p>
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

// Web3Forms AJAX Form Submission Handler
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
          alert.style.color = '#48cae4';
          alert.style.display = 'block';
        }
        form.reset();
      } else {
        if (alert) {
          alert.innerText = 'Error: ' + (data.message || 'Could not send message.');
          alert.style.color = '#e63946';
          alert.style.display = 'block';
        }
      }
    })
    .catch(err => {
      console.error('Submission error:', err);
      if (alert) {
        alert.innerText = 'Network error. Please try again later.';
        alert.style.color = '#e63946';
        alert.style.display = 'block';
      }
    })
    .finally(() => {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Transmit Dispatch';
      }
      setTimeout(() => {
        if (alert) alert.style.display = 'none';
      }, 6000);
    });
}

// Pre-load default episode transcript on initial visit
document.addEventListener('DOMContentLoaded', () => {
  loadEpisodeTranscript('ep42');
});
