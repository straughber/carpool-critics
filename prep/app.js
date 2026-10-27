/* ============================================================
   Carpool Critics — In-Car Prep
   Runs entirely in the browser. No build step, no server.
   ------------------------------------------------------------
   Data sources:
     data/index.json      packs exported from the Mac tool
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
  { key: 'intro',   name: 'Movie Intro & IMDb Read',          start: 0,    end: 120  },
  { key: 'rt',      name: "Last Episode's RT Scoreboard",     start: 120,  end: 270  },
  { key: 'nonspoil',name: 'Non-Spoiler, RT Guesses, Rec',     start: 270,  end: 570  },
  { key: 'spoiler', name: '🚨 Spoiler Deep-Dive',              start: 570,  end: 1230 },
  { key: 'scores',  name: 'Final Tachometer Scores',          start: 1230, end: 1350 },
  { key: 'bits',    name: 'Humorous Bits for Shorts',         start: 1350, end: 1650 },
  { key: 'outro',   name: 'Outro & 20s End-Screen Hold',      start: 1650, end: 1680 }
];

/* ============================================================
   Curated decks — richer, movie-specific questions.
   Keyed by IMDb id. Falls back to a generic builder.
   ============================================================ */
const CURATED = {
  tt38058097: () => ({
    non_spoiler_prompts: [
      'One-Sentence Vibe Check: walking out of Club Kid, what was your gut reaction compared to what you expected going in?',
      "The Tone Balancing Act: this mixes gritty NYC club culture with a surprise-10-year-old family dramedy. Without spoiling plot, does that clash work or give you whiplash?"
    ],
    recommendation_prompt: {
      main: 'Who is the #1 person you would recommend Club Kid to — and who is the absolute WORST person you could accidentally watch this movie with?',
      follow_up: "Is this a 'see it in a theater with a crowd' movie or a 'stream on the couch' movie?"
    },
    spoiler_questions: [
      { tag: 'The Main Character Test',
        question: 'Firstman wrote, directed and starred as Peter, who starts as a total disaster of a human being. At what exact moment (if ever) did you start rooting for him as a dad?' },
      { tag: "Flipping the 'Surprise Kid' Trope",
        question: "We've seen 'party guy gets handed a kid' in Big Daddy and Instructions Not Included. How does Club Kid subvert it — or did the drugs and club chaos around a 10-year-old cross the line for you?" },
      { tag: 'Scene-Stealer Award',
        question: "Between Arlo, Cara Delevingne as Sophie, and Nicky — the freeloading roommate waiting on a 'six-figure philosophy job' — who stole every scene they were in?" },
      { tag: 'The Runtime Test',
        question: 'A party-promoter comedy usually runs 90 minutes; this one runs over two hours. Which subplot earned that runtime, and what would you leave on the cutting room floor?' },
      { tag: 'The Ending Payoff',
        question: 'Did the ending between Peter and Arlo feel earned, or did the movie let Peter off the hook too easily?' }
    ],
    humorous_bits_for_shorts: [
      { id: 'bit_infinite_promoter', title: 'The Infinite-Budget Club Promoter Pitch', target_duration: '60-90s',
        prompt: 'If you were a club promoter with an INFINITE budget and 24 hours to get people into your party establishment — and the goal is a night so legendary the city has to pass a new law the next morning — what is the gimmick, who is working the door, and how are you getting people inside?' },
      { id: 'bit_child_audit', title: 'The Brutal 10-Year-Old Life Audit', target_duration: '45-75s',
        prompt: 'In the movie, Peter\'s chaotic adult habits get exposed the second a 10-year-old moves in. If a brutally honest 10-year-old shadowed YOU for 48 hours right now, what is the weirdest habit or most pathetic adult routine they would roast you for first?' },
      { id: 'bit_fake_career', title: "The 'Six-Figure Philosopher' Excuse", target_duration: '45-60s',
        prompt: "Peter's roommate refuses to pay rent until he lands a 'six-figure job as a philosopher.' If you had to invent a pretentious fake career title to convince your roommates you shouldn't pay rent for a year, what is your job and what does your 'workday' look like?" },
      { id: 'bit_worst_babysitter', title: 'The Worst Movie Babysitter Draft', target_duration: '45-60s',
        prompt: 'You have to leave a 10-year-old for a three-day weekend with Peter from Club Kid OR one other terrible (non-villain) movie adult. Who is the absolute worst movie character you could hire as a babysitter?' }
    ]
  })
};

function genericDeck(movie) {
  const title = movie.title || 'this movie';
  const director = movie.director || 'the director';
  const runtime = movie.runtime || '';
  const synopsis = (movie.synopsis || '').replace(/\s+/g, ' ').slice(0, 150);
  return {
    non_spoiler_prompts: [
      `One-Sentence Vibe Check: walking out of ${title}, how did it compare to what the trailer and premise promised?`,
      `Without spoiling the plot, what is the single biggest strength and the single biggest warning sign of ${title}?`
    ],
    recommendation_prompt: {
      main: `Who would you recommend ${title} to — and who is the absolute worst person to watch this movie with?`,
      follow_up: 'Full-price ticket, $8 discount Tuesday, streaming couch, or skip?'
    },
    spoiler_questions: [
      { tag: 'The Lead Performance & Direction',
        question: `How did ${director} handle the tone of ${title}, and at what point did the main character win you over — or lose you?` },
      { tag: 'Scene-Stealer Award',
        question: 'Which supporting character or single scene stole the entire movie?' },
      { tag: "The 'Wait, What?' Logic Check",
        question: 'What was the most unbelievable moment, and where did you have to suspend the most disbelief?' },
      { tag: `Pacing & Runtime${runtime ? ' (' + runtime + ')' : ''}`,
        question: 'If you were in the editing room, which ten minutes are you cutting, and what needed more room to breathe?' },
      { tag: 'The Climax & Ending',
        question: 'Did the final act stick the landing — and how would you have rewritten the ending?' }
    ],
    humorous_bits_for_shorts: [
      { id: 'bit_infinite_budget', title: 'The Infinite-Budget Premise Flip', target_duration: '60-90s',
        prompt: `${synopsis ? 'Based on the setup — "' + synopsis + '…" — ' : ''}if you were dropped into the main character's shoes with an INFINITE budget and 24 hours to fix their problem in the most absurd way possible, what is your master plan?` },
      { id: 'bit_survival_test', title: 'The Real-Life Survival Test', target_duration: '45-75s',
        prompt: `If Shane, Alex and Dave were all dropped into the plot of ${title} today, who survives the longest and who folds in the first fifteen minutes?` },
      { id: 'bit_sequel_pitch', title: 'The Unhinged Sequel Pitch', target_duration: '45-60s',
        prompt: `A studio executive locks you in an elevator with $50 million for "${title} 2" — but it has to switch genres completely. What is the title and the opening scene?` }
    ]
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
  const curated = CURATED[movie.imdb_id];
  return curated ? curated() : genericDeck(movie);
}

function rtBlock(recap) {
  if (!recap || !recap.guesses) {
    return '<p class="hint">No previous episode predictions on file yet — run the Mac prep tool once with a finished episode.</p>';
  }
  const rows = HOSTS.map((host) => {
    const g = recap.guesses[host] || {};
    const c = g.critics != null ? `${g.critics}%` : '—';
    const a = g.audience != null ? `${g.audience}%` : '—';
    const cd = g.critics_diff != null ? `<span class="rt-diff">off by ${g.critics_diff}</span>` : '';
    const ad = g.audience_diff != null ? `<span class="rt-diff">off by ${g.audience_diff}</span>` : '';
    const cw = (recap.critics_winners || []).includes(host) ? '<span class="win">🏆 CLOSEST</span>' : '';
    const aw = (recap.audience_winners || []).includes(host) ? '<span class="win">🏆 CLOSEST</span>' : '';
    const pts = (recap.points_awarded || {})[host] || 0;
    return `<tr>
      <td>${esc(host)}</td>
      <td>${c}${cd}${cw}</td>
      <td>${a}${ad}${aw}</td>
      <td class="pts">+${pts}</td>
    </tr>`;
  }).join('');

  return `
    <div class="rt-top">
      <div>Last movie: <strong>${esc(recap.movie_title || '—')}</strong></div>
      <div class="rt-actuals">
        <span>🍅 <strong>${recap.actual_critics != null ? recap.actual_critics + '%' : '—'}</strong></span>
        <span>🍿 <strong>${recap.actual_audience != null ? recap.actual_audience + '%' : '—'}</strong></span>
      </div>
    </div>
    <table class="rt-table">
      <thead><tr><th>Host</th><th>Critics guess</th><th>Audience guess</th><th>Pts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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

function movieHeader(movie, recap, standings) {
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
  const recap = pack.previous_episode_rt_recap || pack.fallback_recap || null;
  const standings = pack.season_leaderboard || pack.fallback_standings || null;
  const deck = pack.question_deck || deckFor(movie);

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
          ${field(`${pack.key}:guess:${h}:critics`, 'Critics %', 'inputmode="numeric"')}
          ${field(`${pack.key}:guess:${h}:audience`, 'Audience %', 'inputmode="numeric"')}
        </div>`).join('')}
    </div>`;

  const scores = `
    <div class="grid-3">
      ${HOSTS.map((h) => `
        <div class="host">
          <h4>${esc(h)}</h4>
          ${field(`${pack.key}:score:${h}`, '/10', 'inputmode="decimal"')}
          ${field(`${pack.key}:verdict:${h}`, 'Full / $8 / Stream / Skip')}
        </div>`).join('')}
    </div>`;

  const html = `
    <div class="card">
      <h2 class="card-title" style="font-size:19px;">${esc(movie.title || 'Untitled')} ${movie.release_year ? `<span style="color:var(--ink-dim);font-weight:600;">(${esc(movie.release_year)})</span>` : ''}</h2>
      ${movieHeader(movie, recap, standings)}
      ${standings ? standingsBlock(standings) : ''}
      <div class="actions">
        <button class="btn" id="export-btn">Export notes</button>
        ${movie.imdb_url ? `<a class="btn" href="${esc(movie.imdb_url)}" target="_blank" rel="noopener">IMDb ↗</a>` : ''}
      </div>
    </div>

    ${seg('intro', 1, 'Movie Intro & IMDb Read', '0:00–2:00',
      `<p class="hint">Keep the IMDb read under 60 seconds. Read the synopsis above out loud, then hand off.</p>` +
      qItem(`${pack.key}:intro:read`, 'Act 1 · CarPlay card', 'Read the premise, director and runtime, then introduce the movie in one sentence each.') +
      qItem(`${pack.key}:intro:expectations`, 'Act 1 · no spoilers', 'What did each of you expect walking in, based only on the poster and the premise?')
    )}

    ${seg('rt', 2, "Last Episode's RT Scoreboard", '2:00–4:30',
      `<p class="hint">Read the scoreboard, roast the loser, award the points.</p>` +
      rtBlock(recap) +
      qItem(`${pack.key}:rt:banter`, 'Scoreboard banter', 'Did the audience and the critics actually agree with you last week — and who is already due for humble pie?')
    )}

    ${seg('nonspoil', 3, 'Non-Spoiler, Guesses & Recommendation', '4:30–9:30',
      deck.non_spoiler_prompts.map((p, i) => qItem(`${pack.key}:ns:${i}`, 'Non-spoiler take', p)).join('') +
      `<p class="hint" style="margin-top:14px;">Lock in the Rotten Tomatoes guesses before anyone looks them up.</p>` +
      guesses +
      `<div class="callout">Read the guesses back out loud — that is your clean 30-second short.</div>` +
      qItem(`${pack.key}:rec:main`, 'Audience recommendation', deck.recommendation_prompt.main) +
      qItem(`${pack.key}:rec:follow`, 'Audience recommendation', deck.recommendation_prompt.follow_up || '')
    )}

    ${seg('spoiler', 4, '🚨 Spoiler Deep-Dive', '9:30–20:30',
      `<div class="callout">Say the spoiler warning out loud: <strong>“Spoiler warning in three, two, one.”</strong> The editor cuts Act 3 on that line.</div>` +
      deck.spoiler_questions.map((q, i) => qItem(`${pack.key}:sp:${i}`, q.tag, q.question)).join('') +
      qItem(`${pack.key}:sp:wild`, 'Free square', 'Best line, biggest laugh, or the thing you will still be arguing about in the car next week.')
    )}

    ${seg('scores', 5, 'Final Tachometer Scores', '20:30–22:30',
      `<p class="hint">Score out of 10 to one decimal, plus a ticket verdict. Say the number clearly for the tachometer graphic.</p>` +
      scores
    )}

    ${seg('bits', 6, 'Humorous Bits for Shorts', '22:30–27:30',
      `<p class="hint">Pick two or three. Whoever asks reads the prompt clean and loud — that becomes the three-second hook.</p>` +
      deck.humorous_bits_for_shorts.map((b, i) =>
        qItem(`${pack.key}:bit:${b.id || i}`, `Bit ${i + 1} · ${b.title}`, b.prompt, ' q-bit', b.target_duration)).join('')
    )}

    ${seg('outro', 7, 'Outro & 20s End-Screen Hold', '27:30–28:00',
      qItem(`${pack.key}:outro:tease`, 'Wrap', 'Tease next week’s movie and ask viewers to drop their Rotten Tomatoes guesses in the comments.') +
      `<div class="callout">Then keep talking naturally for <strong>20 seconds</strong> before you stop the camera. That is the YouTube end-screen pad.</div>`
    )}
  `;

  $('#pane-packs').innerHTML = `
    <div class="actions" style="margin:0 0 12px;">
      <button class="btn" id="back-btn" style="flex:0 0 auto;">‹ Packs</button>
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

  clockEl.classList.toggle('is-running', running && seconds < 1680);
  clockEl.classList.toggle('is-over', seconds >= 1680);

  const active = SEGMENTS.find((s) => seconds < s.end) || SEGMENTS[SEGMENTS.length - 1];
  phaseEl.textContent = seconds >= 1680
    ? '⬛ Over target — wrap it up'
    : `${active.name} · ends ${fmtClock(active.end)}`;

  const pct = Math.min(100, (seconds / 1680) * 100);
  fillEl.style.width = pct + '%';
  fillEl.className = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';

  $$('.seg').forEach((el) => {
    el.classList.toggle('is-now', seconds < 1680 && el.dataset.seg === active.key);
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

function startTimer() { $('#timer-clock')?.addEventListener('click', () => {
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
}); }

/* ============================================================
   Packs: index, load, render
   ============================================================ */
let leaderboard = { standings: {}, last_recap: null };

async function loadJson(path, fallback = null) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) return fallback;
    return await res.json();
  } catch { return fallback; }
}

function packKeyFor(pack, file) {
  return pack.key || `ep${String(pack.episode_number ?? '').padStart(2, '0')}-${slugify(pack.movie?.title)}` || file;
}

async function loadPackList({ restore = true } = {}) {
  $('#pane-packs').innerHTML = `
    <p class="hint">Prep packs generated on the Mac. Tap one to load it in the car.</p>
    <div id="pack-list" class="pack-list"><div class="skeleton">Loading packs…</div></div>`;
  showPane('packs');

  const index = await loadJson('data/index.json', { packs: [] });
  const packs = (index.packs || []).filter((p) => p.enabled !== false);
  const listEl = $('#pack-list');

  if (!packs.length) {
    listEl.innerHTML = `<div class="skeleton">No packs yet. Use <strong>New Movie</strong>, or run<br><code>python3 tools/generate_episode_prep.py … --publish-web</code> on the Mac.</div>`;
  } else {
    listEl.innerHTML = packs.map((p) => `
      <button class="pack" data-pack="${esc(p.file)}">
        <span class="pack-ep">EP${String(p.episode_number).padStart(2, '0')}</span>
        <span class="pack-body">
          <span class="pack-title">${esc(p.movie_title)}${p.release_year ? ` <span style="color:var(--ink-dim)">(${esc(p.release_year)})</span>` : ''}</span>
          <span class="pack-meta">${esc(p.subtitle || [p.runtime, p.rating].filter(Boolean).join(' · ') || 'Prep pack')}</span>
        </span>
        <span class="pack-chev">›</span>
      </button>`).join('');
  }

  $$('[data-pack]', listEl).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pack = await loadJson(`data/${btn.dataset.pack}`, null);
      if (!pack) { toast('Could not load that pack'); return; }
      pack.key = pack.key || packKeyFor(pack, btn.dataset.pack.replace(/\.json$/, ''));
      pack.fallback_recap = leaderboard.last_recap;
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
        <span class="pack-ep" style="color:var(--purple);font-size:10px;letter-spacing:0.06em;">PHONE</span>
        <span class="pack-body">
          <span class="pack-title">${esc(pack.movie?.title || 'Untitled')}${pack.movie?.release_year ? ` <span style="color:var(--ink-dim)">(${esc(pack.movie.release_year)})</span>` : ''}</span>
          <span class="pack-meta">${esc([pack.movie?.runtime, pack.movie?.content_rating, 'on this phone'].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="pack-chev">›</span>`;
      btn.addEventListener('click', () => {
        pack.fallback_recap = pack.previous_episode_rt_recap || leaderboard.last_recap;
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
      pack.fallback_recap = leaderboard.last_recap;
      pack.fallback_standings = leaderboard.standings;
      render(pack);
    }
    return;
  }
  const lastLocal = localPacks().find((p) => p.key === last);
  if (lastLocal) {
    lastLocal.fallback_recap = lastLocal.previous_episode_rt_recap || leaderboard.last_recap;
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
        previous_episode_rt_recap: leaderboard.last_recap,
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
    `<span class="standing" style="margin:0 6px 8px 0;display:inline-block;">${esc(h)}: <strong>${standings[h] || 0}</strong> pts</span>`).join('') +
    (recap ? `<div style="margin-top:10px;font-size:13px;color:var(--ink-dim);">
      Last scored: <strong style="color:var(--ink)">${esc(recap.movie_title || '')}</strong> —
      🍅 ${recap.actual_critics ?? '—'}% · 🍿 ${recap.actual_audience ?? '—'}%</div>` : '');
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
  const index = await loadJson('data/index.json', { packs: [] });
  window.__packIndex = index.packs || [];
  renderMore();

  const wanted = new URLSearchParams(location.search).get('pack');
  if (wanted) {
    const pack = await loadJson(`data/${wanted}`, null);
    if (pack) {
      pack.key = wanted.replace(/\.json$/, '');
      pack.fallback_recap = leaderboard.last_recap;
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
