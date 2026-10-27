/**
 * scripts/fetch-transcript.js
 * Build-time script to build data/transcripts/ep<N>.json from YouTube captions.
 * Usage: node scripts/fetch-transcript.js <videoId|episodeId>
 *
 * Requires the yt-dlp binary on PATH (brew install yt-dlp).
 *
 * The channel uploads its own speaker-tagged caption track ("Original Carpool
 * Dialogue") in the form [SHANE] ... so diarization is free: we merge
 * consecutive cues from the same speaker into readable turns.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const episodesPath = path.join(ROOT, 'data/episodes.json');
const transcriptsDir = path.join(ROOT, 'data/transcripts');

// The site's on-camera seating (matches index.html host hotspots).
const SPEAKERS = {
  ALEX: { name: 'Alex', role: 'Driver' },
  SHANE: { name: 'Shane', role: 'Passenger' },
  DAVE: { name: 'Dave', role: 'Center Back' }
};

// ========================================================
// 1. HELPERS
// ========================================================
function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function resolveEpisode(arg) {
  let episodes = [];
  try {
    episodes = JSON.parse(fs.readFileSync(episodesPath, 'utf8'));
  } catch {
    episodes = [];
  }
  if (!arg) {
    console.error('Usage: node scripts/fetch-transcript.js <videoId|episodeId>');
    process.exit(1);
  }
  const byEpisode = episodes.find(ep => ep.id === arg);
  if (byEpisode) return byEpisode;
  const byVideo = episodes.find(ep => ep.youtubeId === arg);
  if (byVideo) return byVideo;
  return { id: null, youtubeId: arg, title: null };
}

/** Download the best English caption track as json3. */
function downloadCaptions(videoId) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-subs-'));
  const output = path.join(tmpDir, 'subs');

  execFileSync('yt-dlp', [
    '--skip-download',
    '--write-subs',
    '--sub-langs', 'en.*',
    '--sub-format', 'json3',
    '-o', output,
    `https://www.youtube.com/watch?v=${videoId}`
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const files = fs.readdirSync(tmpDir).filter(file => file.endsWith('.json3'));
  if (!files.length) throw new Error('No captions were returned by yt-dlp.');
  return path.join(tmpDir, files[0]);
}

// ========================================================
// 2. GROUP CAPTION CUES INTO SPEAKER TURNS
// ========================================================
function buildDialogue(json3) {
  const turns = [];
  let current = null;

  for (const event of json3.events || []) {
    if (!event.segs) continue;
    const text = event.segs.map(seg => seg.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const match = text.match(/^\[([A-Za-z .'-]+)\]\s*(.*)$/);
    const key = match ? match[1].trim().toUpperCase() : null;
    const body = match ? match[2].trim() : text;
    if (!body) continue;

    const speaker = SPEAKERS[key] || { name: key ? capitalize(key.toLowerCase()) : 'Host', role: 'Host' };
    const startMs = event.tStartMs || 0;

    // Continue the current turn when the same host keeps talking.
    if (current && current.speaker === speaker.name) {
      if (!current.text.endsWith(body)) current.text = `${current.text} ${body}`;
      continue;
    }

    current = {
      time: formatTime(startMs / 1000),
      speaker: speaker.name,
      role: speaker.role,
      text: body
    };
    turns.push(current);
  }

  // Tidy: collapse whitespace and capitalise the opening of each turn.
  return turns.map(turn => ({
    time: turn.time,
    speaker: turn.speaker,
    role: turn.role,
    text: capitalize(turn.text.replace(/\s+/g, ' ').trim())
  }));
}

// ========================================================
// 3. RUN
// ========================================================
function run() {
  const episode = resolveEpisode(process.argv[2]);
  if (!episode.youtubeId) {
    console.error('Could not resolve a YouTube video id from that argument.');
    process.exit(1);
  }

  console.log(`[Transcript] Downloading captions for ${episode.youtubeId}...`);
  const json3Path = downloadCaptions(episode.youtubeId);
  const json3 = JSON.parse(fs.readFileSync(json3Path, 'utf8'));

  const dialogue = buildDialogue(json3);
  if (!dialogue.length) {
    console.error('[Transcript] Captions parsed to zero dialogue turns.');
    process.exit(1);
  }

  const episodeId = episode.id || `ep${episode.number || 1}`;
  const payload = {
    episodeId,
    title: episode.title || '',
    youtubeId: episode.youtubeId,
    source: 'youtube-captions',
    speakers: Object.values(SPEAKERS).map(s => `${s.name} (${s.role})`),
    dialogue
  };

  fs.mkdirSync(transcriptsDir, { recursive: true });
  const outPath = path.join(transcriptsDir, `${episodeId}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const speakers = dialogue.reduce((acc, turn) => {
    acc[turn.speaker] = (acc[turn.speaker] || 0) + 1;
    return acc;
  }, {});

  console.log(`[Transcript] Wrote ${dialogue.length} turns to data/transcripts/${episodeId}.json`);
  console.log(`[Transcript] Speakers: ${JSON.stringify(speakers)}`);
  console.log(`[Transcript] Coverage: ${dialogue[0].time} -> ${dialogue[dialogue.length - 1].time}`);
}

run();
