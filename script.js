/* ========================================================
   CURBSIDE CINEMA - INTERACTION LOGIC
   ======================================================== */

function switchSection(sectionId) {
  const panels = document.querySelectorAll('.view-panel');
  panels.forEach(panel => panel.classList.remove('active'));

  const activePanel = document.getElementById('view-' + sectionId);
  if (activePanel) {
    activePanel.classList.add('active');
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

function loadYouTubeVideo(youtubeId, title) {
  const player = document.getElementById('main-video-player');
  const titleEl = document.getElementById('current-video-title');
  
  if (player && youtubeId) {
    player.src = "https://www.youtube-nocookie.com/embed/" + youtubeId + "?autoplay=1";
  }
  if (titleEl && title) {
    titleEl.innerText = title;
  }

  const cards = document.querySelectorAll('.playlist-card');
  cards.forEach(card => card.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

function handleFormSubmission(e) {
  e.preventDefault();
  const alert = document.getElementById('form-feedback');
  alert.style.display = 'block';
  e.target.reset();
  setTimeout(() => {
    alert.style.display = 'none';
  }, 4500);
}
