/* ============================================================
   Carpool Critics — In-Car Prep
   Runs entirely in the browser. No build step, no server.
   ------------------------------------------------------------
   Data sources:
     data/index.enc.json      packs exported from the Mac tool
     data/*.json          one full prep pack per episode
     data/leaderboard.json  season RT standings + last recap
     Wikipedia API        movie facts for on-the-go generation
   ============================================================ */

'use strict';

const HOSTS = ['Shane', 'Alex', 'Dave'];
const STORE = 'ccprep:v1:';
const PACK_STORE = 'ccprep:pack:';
const PACK_CACHE = 'ccprep:lastPack';

const SEGMENTS = [
  { key: 'intro',      name: 'Movie Intro & IMDb Read',                    start: 0,    end: 70   },
  { key: 'rt_game',    name: 'Blind Rotten Tomatoes Game',                 start: 70,   end: 240  },
  { key: 'non_spoiler',name: 'One Non-Spoiler Reaction',                   start: 240,  end: 350  },
  { key: 'spoiler',    name: 'Spoiler Warning + Open-Ended Debate',        start: 350,  end: 1050 },
  { key: 'scorecards', name: 'Tachometer, Reason & Theatres vs Streaming', start: 1050, end: 1190 },
  { key: 'outro',      name: 'Outro, Review Request & 20s Hold',           start: 1190, end: 1230 }
];

const TARGET_SECONDS = SEGMENTS[SEGMENTS.length - 1].end;

/* ============================================================
   The phone-side deck. Same shape as the Mac tool's
   `generate_question_deck` (2026-11-10): IMDb read, the blind
   Tomatoes game first, one non-spoiler reaction, open-ended
   spoiler questions, the scorecard with its reason and a
   theatres-versus-streaming call, then the review request.
   No expectations question, no scoreboard, no humour bits.
   ============================================================ */
function genericDeck(movie) {
  const title = movie.title || 'this movie';
  const lead = (movie.cast || [])[0];
  const leadName = lead && lead.role ? String(lead.role).split('(')[0].trim() : '';

  return {
    rt_game: {
      tag: 'Blind Tomatoes',
      prompt: 'What is your score for both the Tomatometer and the Popcornmeter — and why?',
      detail: 'Lock both numbers before anyone looks them up, then give the reason in one sentence. The reason is the game, not the number.',
      critics_label: 'Tomatometer (critics)',
      audience_label: 'Popcornmeter (audience)'
    },
    non_spoiler_prompts: [
      `Without spoiling anything: what was your honest reaction walking out of ${title}?`
    ],
    spoiler_questions: [
      { tag: 'The Surprise',
        question: `What was one scene in ${title} that surprised you — and what did you not see coming?` },
      { tag: 'The Moment',
        question: `Where did ${title} win you over, or lose you — and can you take us to that scene?` },
      { tag: 'The Character',
        question: leadName
          ? `Did ${leadName} work for you as the centre of ${title} — and what did the film leave you wanting to know about them?`
          : `Which character in ${title} did you understand the least — and what did the film leave unanswered about them?` },
      { tag: 'The Point',
        question: `What do you think ${title} was actually trying to say — and did it say it?` },
      { tag: 'The Ending',
        question: `Did the ending earn what ${title} set up? Why or why not?` }
    ],
    scorecard: {
      tag: 'Tachometer',
      prompt: `After hearing everyone's perspective, what would you personally rate ${title} — and why do you rate it like that?`,
      house_prompt: 'For those watching at home: should they see this in theaters or wait for streaming?',
      score_label: '/ 10'
    },
    outro_prompt: 'If you have a movie you want the Carpool Critics to review, let us know on our socials or email us.'
  };
}

/* ============================================================
   Utilities
   ============================================================ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'movie';
}

function fmtClock(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('is-on'), 2200);
}

/* ============================================================
   localStorage helpers
   ============================================================ */
function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(STORE + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function writeStore(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch {}
}

function allStoredNotes() {
  const out = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORE)) {
      const id = key.slice(STORE.length);
      if (id === PACK_MEMORY) continue;
      try { out[id] = JSON.parse(localStorage.getItem(key)); } catch {}
    }
  }
  return out;
}
const PACK_MEMORY = 'lastPack';

/* Packs built on the phone are kept whole so they survive a reload. */
function saveLocalPack(pack) {
  try { localStorage.setItem(PACK_STORE + pack.key, JSON.stringify(pack)); } catch {}
}

function localPacks() {
  const out = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PACK_STORE)) {
      try {
        const pack = JSON.parse(localStorage.getItem(key));
        if (pack && pack.key) out.push(pack);
      } catch {}
    }
  }
  return out.sort((a, b) => String(b.generated_at || '').localeCompare(String(a.generated_at || '')));
}

/* ============================================================
   Wikipedia lookup (CORS-enabled, no API key)
   ============================================================ */
const WIKI = 'https://en.wikipedia.org/w/api.php';

async function wiki(params) {
  const qs = new URLSearchParams({ format: 'json', origin: '*', ...params });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${WIKI}?${qs}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function balancedTemplate(text, startIndex) {
  let depth = 0;
  for (let i = startIndex; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    if (pair === '{{') { depth += 1; i += 1; }
    else if (pair === '}}') {
      depth -= 1;
      i += 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return text.slice(startIndex);
}

function splitTopLevel(value, separator = '|') {
  const parts = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const two = value.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth += 1; buf += two; i += 1; continue; }
    if (two === '}}' || two === ']]') { depth -= 1; buf += two; i += 1; continue; }
    if (value[i] === separator && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += value[i];
  }
  parts.push(buf);
  return parts;
}

function stripWiki(value) {
  let out = String(value || '');
  out = out.replace(/<ref[^>]*\/>/gi, '');
  out = out.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  out = out.replace(/\{\{Plainlist\|([\s\S]*?)\}\}/gi, (_, inner) =>
    splitTopLevel(inner, '|').filter(Boolean).map((v) => `\n* ${v}`).join(''));
  out = out.replace(/\{\{ubl\|([\s\S]*?)\}\}/gi, (_, inner) =>
    splitTopLevel(inner, '|').filter(Boolean).map((v) => `\n* ${v}`).join(''));
  out = out.replace(/\{\{Film date\|([\s\S]*?)\}\}/gi, (_, inner) =>
    splitTopLevel(inner, '|').filter((v) => /^\d{4}$/.test(v.trim())).join(' '));
  out = out.replace(/\{\{Based on\|([\s\S]*?)\}\}/gi, '$1');
  out = out.replace(/\{\{[\s\S]*?\}\}/g, '');
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  out = out.replace(/\[\[([^\]]+)\]\]/g, '$1');
  out = out.replace(/'''?/g, '');
  out = out.replace(/<br\s*\/?>/gi, ', ');
  out = out.replace(/<[^>]+>/g, '');
  out = out.replace(/^=+\s*[^=\n]*\s*=+\s*$/gm, '');
  out = out.replace(/\s*\n\s*\*+\s*/g, '\n');
  return out.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

function listFrom(value) {
  const text = stripWiki(value);
  if (!text) return [];
  return text.split(/\n|\s*,\s*|\s+and\s+/)
    .map((v) => v.replace(/^\*+\s*/, '').trim())
    .filter(Boolean);
}

function parseInfobox(wikitext) {
  const start = wikitext.search(/\{\{\s*Infobox film/i);
  if (start === -1) return {};
  const block = balancedTemplate(wikitext, start);
  // Strip the outer {{ }} so the first-level "|" separators are visible again.
  const inner = block.replace(/^\{\{/, '').replace(/\}\}$/, '');
  const fields = {};
  splitTopLevel(inner, '|').slice(1).forEach((chunk) => {
    const eq = chunk.indexOf('=');
    if (eq === -1) return;
    const key = chunk.slice(0, eq).trim().toLowerCase();
    const value = chunk.slice(eq + 1).trim();
    if (key && value) fields[key] = value;
  });
  return fields;
}

function runtimeLabel(value) {
  const match = String(value || '').match(/(\d+)\s*(?:minutes?|mins?)/i);
  if (match) {
    const total = parseInt(match[1], 10);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return { label: h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`, minutes: total };
  }
  const cleaned = stripWiki(value);
  return { label: cleaned || 'Unknown', minutes: null };
}

function yearFrom(value) {
  const years = (stripWiki(value).match(/\b(19|20)\d{2}\b/g) || []);
  return years.length ? years[0] : '';
}

async function wikiSearch(query) {
  const data = await wiki({ action: 'query', list: 'search', srsearch: `${query} film`, srlimit: '8' });
  return (data?.query?.search || []).map((r) => r.title);
}

async function wikiIntro(title) {
  const data = await wiki({
    action: 'query', prop: 'extracts', exintro: '1', explaintext: '1',
    redirects: '1', titles: title
  });
  const pages = data?.query?.pages || {};
  const page = Object.values(pages)[0];
  return page?.extract || '';
}

async function wikiWikitext(title) {
  const data = await wiki({ action: 'parse', prop: 'wikitext', section: '0', page: title, redirects: '1' });
  return data?.parse?.wikitext?.['*'] || '';
}

async function wikiPremise(title) {
  try {
    const sections = await wiki({ action: 'parse', prop: 'sections', page: title, redirects: '1' });
    const list = sections?.parse?.sections || [];
    const hit = list.find((s) => /^(premise|plot|synopsis|story)$/i.test(String(s.line || '').trim()));
    if (!hit) return '';
    const body = await wiki({
      action: 'parse', prop: 'wikitext', section: String(hit.index), page: title, redirects: '1'
    });
    return stripWiki(body?.parse?.wikitext?.['*'] || '');
  } catch { return ''; }
}

function pickBestTitle(titles, wanted) {
  if (!titles.length) return '';
  const norm = (v) => String(v || '').toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();
  const target = norm(wanted);
  const exact = titles.find((t) => norm(t) === target);
  if (exact) return exact;
  const film = titles.find((t) => /\(film\)|\(\d{4} film\)/i.test(t));
  return film || titles[0];
}

async function lookupMovie(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) throw new Error('Paste an IMDb link, IMDb ID, or movie title.');

  const imdbMatch = input.match(/tt\d{6,10}/i);
  const imdbId = imdbMatch ? imdbMatch[0].toLowerCase() : '';

  let query = input;
  if (imdbId) {
    query = input.replace(/https?:\/\/[^\s]*/i, ' ').replace(imdbId, ' ').trim();
    if (!query) {
      const curatedTitle = { tt38058097: 'Club Kid' }[imdbId];
      query = curatedTitle || '';
    }
  }
  if (!query) throw new Error('Add the movie title alongside the IMDb link.');

  const titles = await wikiSearch(query);
  const pageTitle = pickBestTitle(titles, query);
  if (!pageTitle) throw new Error(`No Wikipedia page found for "${query}".`);

  const [wikitext, intro, premise] = await Promise.all([
    wikiWikitext(pageTitle),
    wikiIntro(pageTitle),
    wikiPremise(pageTitle)
  ]);

  const info = parseInfobox(wikitext);
  const runtime = runtimeLabel(info.runtime);
  const directors = listFrom(info.director);
  const starring = listFrom(info.starring);

  return {
    imdb_id: imdbId,
    imdb_url: imdbId ? `https://www.imdb.com/title/${imdbId}/` : '',
    wiki_title: pageTitle,
    title: stripWiki(info.name) || pageTitle.replace(/\s*\(film\)/i, ''),
    release_year: yearFrom(info.released) || yearFrom(intro) || '',
    content_rating: stripWiki(info.rating) || '',
    runtime: runtime.label,
    runtime_minutes: runtime.minutes,
    genres: listFrom(info.genre),
    director: directors.join(', ') || 'Unknown',
    writers: listFrom(info.writer),
    composer: listFrom(info.music).join(', '),
    distributor: listFrom(info.distributor).join(', '),
    studio: listFrom(info.studio).join(', '),
    synopsis: (intro || '').split('\n')[0] || premise.split('\n')[0] || '',
    premise,
    cast: starring.map((actor) => ({ actor, role: '' })),
    source: 'wikipedia'
  };
}

/* ============================================================
   Rendering
   ============================================================ */
let current = null;     // { key, pack }
let state = null;       // persisted { checks, fields, timer }

function newState() {
  return { checks: {}, fields: {}, timer: { elapsedMs: 0, runningSince: null } };
}

function saveState() {
  if (current && state) writeStore(current.key, state);
}

function deckFor(movie) {
  return genericDeck(movie);
}

function standingsBlock(standings) {
  if (!standings) return '';
  return `<div class="standings-row">${HOSTS.map((h) =>
    `<span class="standing">${esc(h)}: <strong>${standings[h] || 0}</strong> pts</span>`).join('')}</div>`;
}

function qItem(id, tag, text, extraClass = '', meta = '') {
  const done = state.checks[id] ? ' is-done' : '';
  const checked = state.checks[id] ? ' checked' : '';
  return `
    <label class="q ${extraClass}${done}" data-q="${esc(id)}">
      <input type="checkbox" data-check="${esc(id)}"${checked} />
      <div>
        <span class="q-tag">${esc(tag)}${meta ? `<span class="q-bit-meta">${esc(meta)}</span>` : ''}</span>
        <p class="q-text">${esc(text)}</p>
      </div>
    </label>`;
}

function field(id, placeholder, extra = '') {
  const value = state.fields[id] || '';
  return `<input type="text" data-field="${esc(id)}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${extra} />`;
}

function movieHeader(movie) {
  const pills = [
    movie.director ? `<span class="pill">Dir. <strong>${esc(movie.director)}</strong></span>` : '',
    movie.runtime ? `<span class="pill"><strong>${esc(movie.runtime)}</strong></span>` : '',
    movie.content_rating ? `<span class="pill"><strong>${esc(movie.content_rating)}</strong></span>` : '',
    movie.distributor ? `<span class="pill"><strong>${esc(movie.distributor)}</strong></span>` : '',
    movie.release_year ? `<span class="pill"><strong>${esc(movie.release_year)}</strong></span>` : ''
  ].filter(Boolean).join('');

  const cast = (movie.cast || []).slice(0, 8).map((c) =>
    `<li><strong>${esc(c.actor)}</strong>${c.role ? ' — ' + esc(c.role) : ''}</li>`).join('');

  const premise = movie.premise && movie.premise !== movie.synopsis
    ? `<details class="plot">
         <summary>Full plot — spoilers, tap to reveal</summary>
         <p>${esc(movie.premise.slice(0, 1400))}${movie.premise.length > 1400 ? '…' : ''}</p>
       </details>`
    : '';

  return `
    <div class="pills">${pills}</div>
    <div class="synopsis"><p>${esc(movie.synopsis || 'Add the synopsis here.')}</p>${premise}</div>
    ${cast ? `<ul class="cast">${cast}</ul>` : ''}`;
}

function render(pack) {
  current = pack;
  state = readStore(pack.key, null) || newState();

  const movie = pack.movie || {};
  const standings = pack.season_leaderboard || pack.fallback_standings || null;
  const deck = pack.question_deck || deckFor(movie);
  const title = movie.title || 'this movie';

  // Every prompt is read defensively: packs prepared before the 2026-11-10
  // rework carry no `rt_game` / `scorecard`, and an old pack must still open
  // rather than render "undefined" in the car.
  const rtGame = deck.rt_game || {
    prompt: 'What is your score for both the Tomatometer and the Popcornmeter — and why?',
    detail: 'Lock both numbers before anyone looks them up, then give the reason in one sentence.',
    critics_label: 'Tomatometer (critics)',
    audience_label: 'Popcornmeter (audience)'
  };
  const scorecard = deck.scorecard || {
    prompt: `After hearing everyone's perspective, what would you personally rate ${title} — and why do you rate it like that?`,
    house_prompt: 'For those watching at home: should they see this in theaters or wait for streaming?',
    score_label: '/ 10'
  };
  const outroPrompt = deck.outro_prompt ||
    'If you have a movie you want the Carpool Critics to review, let us know on our socials or email us.';

  const seg = (key, num, name, clock, body) => `
    <section class="seg" data-seg="${key}">
      <button class="seg-head" data-toggle="${key}">
        <span class="seg-num">${num}</span>
        <span class="seg-name">${esc(name)}</span>
        <span class="seg-clock">${esc(clock)}</span>
      </button>
      <div class="seg-body">${body}</div>
    </section>`;

  const guesses = `
    <div class="grid-3">
      ${HOSTS.map((h) => `
        <div class="host">
          <h4>${esc(h)}</h4>
          ${field(`${pack.key}:guess:${h}:critics`, rtGame.critics_label || 'Critics %', 'inputmode="numeric"')}
          ${field(`${pack.key}:guess:${h}:audience`, rtGame.audience_label || 'Audience %', 'inputmode="numeric"')}
          ${field(`${pack.key}:guess:${h}:why`, 'Why?')}
        </div>`).join('')}
    </div>`;

  const scores = `
    <div class="grid-3">
      ${HOSTS.map((h) => `
        <div class="host">
          <h4>${esc(h)} ${esc(scorecard.score_label || '/ 10')}</h4>
          ${field(`${pack.key}:score:${h}`, 'Score', 'inputmode="decimal"')}
          ${field(`${pack.key}:why:${h}`, 'Why?')}
          ${field(`${pack.key}:verdict:${h}`, 'Theatres / Streaming')}
        </div>`).join('')}
    </div>`;

  const html = `
    <div class="card">
      <h2 class="card-title card-title-lg">${esc(movie.title || 'Untitled')} ${movie.release_year ? `<span class="title-year">(${esc(movie.release_year)})</span>` : ''}</h2>
      ${movieHeader(movie)}
      ${standings ? standingsBlock(standings) : ''}
      <div class="actions">
        <button class="btn" id="export-btn">Export notes</button>
        ${movie.imdb_url ? `<a class="btn" href="${esc(movie.imdb_url)}" target="_blank" rel="noopener">[ IMDb ]</a>` : ''}
      </div>
    </div>

    ${seg('intro', 1, 'Movie Intro & IMDb Read', '0:00–1:10',
      `<p class="hint">Keep the IMDb read under 60 seconds. Read the synopsis above out loud, then hand off.</p>` +
      qItem(`${pack.key}:intro:read`, 'Act 1 · CarPlay card', 'Read the premise, director and runtime, then introduce the movie in one sentence each.')
    )}

    ${seg('rt_game', 2, 'Blind Rotten Tomatoes Game', '1:10–4:00',
      qItem(`${pack.key}:rt:prompt`, 'First game', rtGame.prompt, '', '') +
      (rtGame.detail ? `<p class="hint">${esc(rtGame.detail)}</p>` : '') +
      guesses +
      `<div class="callout">Lock both numbers before anyone looks them up. The reason is the game, not the number.</div>`
    )}

    ${seg('non_spoiler', 3, 'One Non-Spoiler Reaction', '4:00–5:50',
      deck.non_spoiler_prompts.map((p, i) => qItem(`${pack.key}:ns:${i}`, 'Social reaction short', p)).join('') +
      `<div class="callout">One answer each, clean and no spoilers.</div>`
    )}

    ${seg('spoiler', 4, 'Spoiler Warning + Open-Ended Debate', '5:50–17:30',
      `<div class="callout">Say the spoiler warning out loud: <strong>“Spoiler warning in three, two, one.”</strong> The editor cuts Act 3 on that line.</div>` +
      deck.spoiler_questions.map((q, i) => qItem(`${pack.key}:sp:${i}`, q.tag, q.question)).join('')
    )}

    ${seg('scorecards', 5, 'Tachometer, Reason & Theatres vs Streaming', '17:30–19:50',
      `<p class="hint">Score out of 10, say why, then make the call for the audience. Say the number clearly for the tachometer graphic.</p>` +
      qItem(`${pack.key}:score:prompt`, 'Tachometer', scorecard.prompt) +
      scores +
      `<div class="callout"><strong>For those watching at home:</strong> ${esc(scorecard.house_prompt || '')}</div>`
    )}

    ${seg('outro', 6, 'Outro, Review Request & 20s Hold', '19:50–20:30',
      qItem(`${pack.key}:outro:request`, 'Wrap', outroPrompt) +
      `<div class="callout">Then keep talking naturally for <strong>20 seconds</strong> before you stop the camera. That is the YouTube end-screen pad.</div>`
    )}
  `;

  $('#pane-packs').innerHTML = `
    <div class="actions" style="margin:0 0 12px;">
      <button class="btn" id="back-btn" style="flex:0 0 auto;">[ Back to packs ]</button>
      <button class="btn" id="collapse-btn" style="flex:0 0 auto;">Collapse all</button>
    </div>
    <div id="pack-output">${html}</div>`;

  $('#back-btn').addEventListener('click', () => backToPacks());
  $('#collapse-btn').addEventListener('click', () => {
    const segs = $$('.seg');
    const anyOpen = segs.some((s) => !s.classList.contains('is-collapsed'));
    segs.forEach((s) => s.classList.toggle('is-collapsed', anyOpen));
    $('#collapse-btn').textContent = anyOpen ? 'Expand all' : 'Collapse all';
  });

  showPane('packs');
  $('#timer-bar').hidden = false;
  wirePack();
  updateSegments();
  animateTimer();
}

function backToPacks() {
  const bar = $('#timer-bar');
  if (state && state.timer && state.timer.runningSince && !confirm('Leave this prep sheet? The timer keeps running.')) {
    return;
  }
  current = null;
  bar.hidden = true;
  loadPackList({ restore: false });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function wirePack() {
  const root = $('#pane-packs');

  $$('[data-toggle]', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.seg').classList.toggle('is-collapsed');
    });
  });

  $$('input[data-check]', root).forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.check;
      state.checks[id] = input.checked;
      input.closest('.q').classList.toggle('is-done', input.checked);
      saveState();
    });
  });

  $$('input[data-field]', root).forEach((input) => {
    input.addEventListener('input', () => {
      state.fields[input.dataset.field] = input.value;
      saveState();
    });
  });

  const exportBtn = $('#export-btn', root);
  if (exportBtn) exportBtn.addEventListener('click', () => exportNotes());
}

function exportNotes() {
  const payload = {
    episode: current?.pack?.episode_number || null,
    movie: current?.pack?.movie?.title || null,
    saved_at: new Date().toISOString(),
    notes: state
  };
  const text = JSON.stringify(payload, null, 2);

  if (navigator.share && navigator.canShare) {
    const file = new File([text], `${current?.key || 'prep'}-notes.json`, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Carpool Critics notes' }).catch(() => {});
      return;
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast('Notes copied to clipboard'))
      .catch(() => fallbackDownload(text));
    return;
  }
  fallbackDownload(text);
}

function fallbackDownload(text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${current?.key || 'prep'}-notes.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Notes downloaded');
}

/* ============================================================
   Pane switching
   ============================================================ */
function showPane(name) {
  $$('.pane').forEach((p) => p.classList.add('is-hidden'));
  const pane = $(`#pane-${name}`);
  if (pane) pane.classList.remove('is-hidden');
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (name !== 'packs') $('#timer-bar').hidden = true;
  else if (current) $('#timer-bar').hidden = false;
}

/* ============================================================
   Timer
   ============================================================ */
let timerFrame = null;

function elapsedSeconds() {
  if (!state) return 0;
  const t = state.timer || {};
  const running = t.runningSince ? (Date.now() - t.runningSince) : 0;
  return Math.floor(((t.elapsedMs || 0) + running) / 1000);
}

function animateTimer() {
  const timeEl = $('#timer-time');
  const stateEl = $('#timer-state');
  const phaseEl = $('#timer-phase');
  const fillEl = $('#timer-fill');
  const clockEl = $('#timer-clock');
  if (!timeEl) return;

  const seconds = elapsedSeconds();
  const running = !!(state?.timer?.runningSince);
  timeEl.textContent = fmtClock(seconds + (running ? 1 : 0));
  stateEl.textContent = running ? 'pause' : (seconds ? 'resume' : 'start');

  const resetEl = $('#timer-reset');
  if (resetEl) resetEl.hidden = seconds === 0 && !running;

  clockEl.classList.toggle('is-running', running && seconds < TARGET_SECONDS);
  clockEl.classList.toggle('is-over', seconds >= TARGET_SECONDS);

  const active = SEGMENTS.find((s) => seconds < s.end) || SEGMENTS[SEGMENTS.length - 1];
  phaseEl.textContent = seconds >= TARGET_SECONDS
    ? '● Over target — wrap it up'
    : `${active.name} · ends ${fmtClock(active.end)}`;

  const pct = Math.min(100, (seconds / TARGET_SECONDS) * 100);
  fillEl.style.width = pct + '%';
  fillEl.className = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';

  $$('.seg').forEach((el) => {
    el.classList.toggle('is-now', seconds < TARGET_SECONDS && el.dataset.seg === active.key);
  });
}

function updateSegments() {
  const loop = () => {
    animateTimer();
    timerFrame = setTimeout(loop, 1000);
  };
  clearTimeout(timerFrame);
  loop();
}

function startTimer() {
  const clock = $('#timer-clock');
  if (clock) clock.addEventListener('click', () => {
    if (!state) return;
    const t = state.timer || (state.timer = { elapsedMs: 0, runningSince: null });
    if (t.runningSince) {
      t.elapsedMs = (t.elapsedMs || 0) + (Date.now() - t.runningSince);
      t.runningSince = null;
    } else {
      t.runningSince = Date.now();
    }
    saveState();
    animateTimer();
  });

  // Reset is a two-tap action: an accidental tap of a full 26-minute take is
  // the one mistake this bar must not allow.
  const resetBtn = $('#timer-reset');
  if (!resetBtn) return;

  resetBtn.addEventListener('click', () => {
    if (!state) return;
    if (!resetArmed) {
      resetArmed = true;
      resetBtn.classList.add('is-armed');
      resetBtn.textContent = 'Confirm';
      resetArmTimeout = setTimeout(disarmReset, 3500);
      return;
    }
    resetClock();
  });
}

let resetArmed = false;
let resetArmTimeout = null;

function disarmReset() {
  resetArmed = false;
  if (resetArmTimeout) clearTimeout(resetArmTimeout);
  resetArmTimeout = null;
  const btn = $('#timer-reset');
  if (btn) {
    btn.classList.remove('is-armed');
    btn.textContent = 'Reset';
  }
}

function resetClock() {
  if (!state) return;
  state.timer = { elapsedMs: 0, runningSince: null };
  saveState();
  disarmReset();
  animateTimer();
  toast('Timer reset — checks and scores kept');
}

/* ============================================================
   Packs: index, load, render
   ============================================================ */
let leaderboard = { standings: {}, last_recap: null };

async function loadJson(path, fallback = null) {
  try {
    if (path.endsWith('.enc.json')) {
      const pack = await loadEncryptedJson(path);
      return pack ?? fallback;
    }
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) return fallback;
    return await res.json();
  } catch { return fallback; }
}

function b64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadEncryptedJson(path) {
  if (!globalThis.crypto?.subtle) {
    toast('This browser cannot decrypt the prep pack');
    return null;
  }
  let passphrase = sessionStorage.getItem('cc-prep-passphrase');
  if (!passphrase) {
    passphrase = window.prompt('Prep passphrase');
    if (!passphrase) return null;
    sessionStorage.setItem('cc-prep-passphrase', passphrase);
  }
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) return null;
  const envelope = await res.json();
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBytes(envelope.salt), iterations: envelope.iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(envelope.iv) },
      key,
      b64ToBytes(envelope.data)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    sessionStorage.removeItem('cc-prep-passphrase');
    toast('Wrong prep passphrase');
    return null;
  }
}

function packKeyFor(pack, file) {
  return pack.key || `ep${String(pack.episode_number ?? '').padStart(2, '0')}-${slugify(pack.movie?.title)}` || file;
}

async function loadPackList({ restore = true } = {}) {
  $('#pane-packs').innerHTML = `
    <div class="pane-head">
      <p class="pane-eyebrow">VIEW // 01</p>
      <h2 class="pane-title">◊ Prep Packs</h2>
    </div>
    <p class="hint">Prep packs generated on the Mac. Tap one to load it in the car.</p>
    <div id="pack-list" class="pack-list"><div class="skeleton">Loading packs…</div></div>`;
  showPane('packs');

  const index = await loadJson('data/index.enc.json', { packs: [] });
  const packs = (index.packs || []).filter((p) => p.enabled !== false);
  const listEl = $('#pack-list');

  if (!packs.length) {
    listEl.innerHTML = `<div class="skeleton">No packs yet. Use <strong>New Movie</strong>, or run<br><code>python3 tools/generate_episode_prep.py … --publish-web</code> on the Mac.</div>`;
  } else {
    listEl.innerHTML = packs.map((p) => `
      <button class="pack" data-pack="${esc(p.file)}">
        <span class="pack-ep">EP${String(p.episode_number).padStart(2, '0')}</span>
        <span class="pack-body">
          <span class="pack-title">${esc(p.movie_title)}${p.release_year ? ` <span class="title-year">(${esc(p.release_year)})</span>` : ''}</span>
          <span class="pack-meta">${esc(p.subtitle || [p.runtime, p.rating].filter(Boolean).join(' · ') || 'Prep pack')}</span>
        </span>
        <span class="pack-chev" aria-hidden="true">&gt;</span>
      </button>`).join('');
  }

  $$('[data-pack]', listEl).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pack = await loadJson(`data/${btn.dataset.pack}`, null);
      if (!pack) { toast('Could not load that pack'); return; }
      pack.key = pack.key || packKeyFor(pack, btn.dataset.pack.replace(/\.json$/, ''));
      pack.fallback_standings = leaderboard.standings;
      writeStore(PACK_MEMORY, pack.key);
      render(pack);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Packs generated on this phone (New Movie tab) live only in browser storage.
  const known = new Set(packs.map((p) => p.key));
  const seenTitles = new Set(
    packs.map((p) => String(p.imdb_id || p.movie_title || '').toLowerCase()).filter(Boolean)
  );
  const local = localPacks().filter((p) => {
    if (known.has(p.key)) return false;
    const sig = String(p.movie?.imdb_id || p.movie?.title || '').toLowerCase();
    return !sig || !seenTitles.has(sig);
  });
  if (local.length) {
    const header = document.createElement('p');
    header.className = 'hint';
    header.style.margin = '16px 0 8px';
    header.textContent = 'Generated on this phone';
    listEl.appendChild(header);

    local.forEach((pack) => {
      const btn = document.createElement('button');
      btn.className = 'pack';
      btn.innerHTML = `
        <span class="pack-ep is-phone">PHONE</span>
        <span class="pack-body">
          <span class="pack-title">${esc(pack.movie?.title || 'Untitled')}${pack.movie?.release_year ? ` <span class="title-year">(${esc(pack.movie.release_year)})</span>` : ''}</span>
          <span class="pack-meta">${esc([pack.movie?.runtime, pack.movie?.content_rating, 'on this phone'].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="pack-chev" aria-hidden="true">&gt;</span>`;
      btn.addEventListener('click', () => {
        pack.fallback_standings = pack.season_leaderboard || leaderboard.standings;
        writeStore(PACK_MEMORY, pack.key);
        render(pack);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      listEl.appendChild(btn);
    });
  }

  // Restore last pack after a reload, but stay on the list if there is none.
  if (!restore) return;
  const last = readStore(PACK_MEMORY, null);
  const lastEntry = packs.find((p) => (p.key || p.file.replace(/\.json$/, '')) === last);
  if (lastEntry) {
    const pack = await loadJson(`data/${lastEntry.file}`, null);
    if (pack) {
      pack.key = pack.key || lastEntry.key || lastEntry.file.replace(/\.json$/, '');
      pack.fallback_standings = leaderboard.standings;
      render(pack);
    }
    return;
  }
  const lastLocal = localPacks().find((p) => p.key === last);
  if (lastLocal) {
    lastLocal.fallback_standings = lastLocal.season_leaderboard || leaderboard.standings;
    render(lastLocal);
  }
}

/* ============================================================
   On-the-go generation
   ============================================================ */
function wireGenerator() {
  const input = $('#movie-input');
  const btn = $('#generate-btn');
  const status = $('#gen-status');
  const resultCard = $('#gen-result-card');

  const run = async () => {
    const raw = input.value.trim();
    if (!raw) { status.textContent = 'Paste a link, an ID, or a title first.'; status.classList.add('is-error'); return; }
    btn.disabled = true;
    status.classList.remove('is-error');
    status.textContent = 'Looking up the movie…';
    resultCard.hidden = true;

    try {
      const movie = await lookupMovie(raw);
      status.textContent = `Found ${movie.title}${movie.release_year ? ' (' + movie.release_year + ')' : ''} — building the sheet…`;
      const key = `${movie.imdb_id || 'title-' + slugify(movie.title)}`;
      const pack = {
        key,
        episode_number: nextEpisodeNumber(),
        movie,
        season_leaderboard: leaderboard.standings,
        question_deck: deckFor(movie),
        generated_on: 'phone'
      };
      status.textContent = 'Ready. Scroll down — the sheet is loaded.';
      writeStore(PACK_MEMORY, key);
      saveLocalPack(pack);
      render(pack);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      status.textContent = err.message || 'Lookup failed.';
      status.classList.add('is-error');
    } finally {
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
}

function nextEpisodeNumber() {
  const index = window.__packIndex || [];
  const max = index.reduce((m, p) => Math.max(m, Number(p.episode_number) || 0), 0);
  return max + 1;
}

/* ============================================================
   More tab
   ============================================================ */
function renderMore() {
  const el = $('#standings');
  const standings = leaderboard.standings || {};
  const recap = leaderboard.last_recap;

  if (!Object.keys(standings).length) {
    el.innerHTML = '<p class="hint">No standings yet. They appear after the Mac tool scores a finished episode.</p>';
    return;
  }

  el.innerHTML = HOSTS.map((h) =>
    `<span class="standing">${esc(h)}: <strong>${standings[h] || 0}</strong> pts</span>`).join('') +
    (recap ? `<div style="margin-top:10px;font-size:12px;color:var(--text-muted);">
      Last scored: <strong style="color:var(--text-ticket)">${esc(recap.movie_title || '')}</strong> —
      critics ${recap.actual_critics ?? '—'}% · audience ${recap.actual_audience ?? '—'}%</div>` : '');
}

function wireMore() {
  $('#copy-all-btn').addEventListener('click', async () => {
    const text = JSON.stringify(allStoredNotes(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast('All notes copied');
    } catch {
      const out = $('#notes-out');
      out.hidden = false;
      out.textContent = text;
      toast('Copy blocked — select the text below');
    }
  });

  $('#clear-btn').addEventListener('click', () => {
    if (!confirm('Clear every saved guess, score, checkmark and phone-generated pack on this device?')) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith(STORE) || k.startsWith(PACK_STORE))
      .forEach((k) => localStorage.removeItem(k));
    toast('Cleared');
    location.reload();
  });
}

/* ============================================================
   Boot
   ============================================================ */
async function boot() {
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => showPane(tab.dataset.tab)));
  startTimer();
  wireGenerator();
  wireMore();

  leaderboard = await loadJson('data/leaderboard.json', { standings: {}, last_recap: null });
  const index = await loadJson('data/index.enc.json', { packs: [] });
  window.__packIndex = index.packs || [];
  renderMore();

  const wanted = new URLSearchParams(location.search).get('pack');
  if (wanted) {
    const pack = await loadJson(`data/${wanted}`, null);
    if (pack) {
      pack.key = wanted.replace(/\.json$/, '');
      pack.fallback_standings = leaderboard.standings;
      writeStore(PACK_MEMORY, pack.key);
      render(pack);
      return;
    }
  }
  await loadPackList();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', boot);
