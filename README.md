# Carpool Critics

An interactive film review dispatch recorded inside a car after watching a movie. Hosts Alex (Driver), Dave (Back Seat), and Shane (Passenger) debrief hot takes, cinematic pacing, creature effects, and coming-of-age films the moment the credits roll.

* **Live Site**: [https://straughber.github.io/carpool-critics/](https://straughber.github.io/carpool-critics/)
* **Format**: Interactive Single-Page Web App (SPA) with On-Demand Transcripts and TMDb Movie Profiles

---

## Scalable Repository Architecture

The project decouples presentation markup, dynamic media catalogs, and build-time metadata to maintain sub-second load times on static hosting (GitHub Pages) while ensuring full search engine crawlability for 100+ episodes.

```text
carpool-critics/
├── index.html                   # High-performance SPA shell (~15KB) with Schema.org JSON-LD
├── style.css                    # Production stylesheet with modular MCP section banners
├── script.js                    # Interaction router, transcript loader & movie profile renderer
├── assets/                      # Media assets organized for SEO & caching
│   └── images/
│       ├── cockpit/             # High-res interior background plate
│       │   └── CurbsideCinema_Background.jpeg
│       └── hosts/               # Transparent host cutouts & SVG vector fallbacks
│           ├── Alex_CurbsideCritic.webp (alex.svg fallback)
│           ├── Dave_CurbsideCritic.webp (dave.svg fallback)
│           └── Shane_CurbsideCritic.webp (shane.svg fallback)
├── data/                        # Decoupled static data catalogs
│   ├── episodes.json            # GENERATED from the YouTube channel (do not hand-edit)
│   ├── movies.json              # Pre-cached TMDb movie metadata (ratings, runtime, posters)
│   └── transcripts/             # On-demand dialogue transcripts (loaded only on click)
│       ├── ep1.json
│       └── ...
└── scripts/                     # Automation & build scripts
    ├── fetch-youtube.js         # Build-time channel sync -> data/episodes.json
    ├── fetch-transcript.js      # Build-time caption -> data/transcripts/ep<N>.json
    └── fetch-tmdb.js            # Build-time TMDb API fetcher (zero client key exposure)
```

---

## Episode Catalog Sync (YouTube)

`data/episodes.json` is **generated**, never hand-maintained. It is produced from the live
channel by `scripts/fetch-youtube.js`, which uses no API key and no quota:

```bash
node scripts/fetch-youtube.js      # refresh data/episodes.json from the channel
```

How it works:

1. **Channel RSS feed** (`youtube.com/feeds/videos.xml`) — cheapest source, but YouTube
   serves it inconsistently for new/small channels.
2. **Channel `/videos` page scrape** — fallback whenever RSS is empty or unavailable.
   Note: this sees the first page of uploads (~30 videos); a full archive beyond that
   needs the Data API with an API key.
3. **Per-video watch page** — authoritative duration, publish date, full description,
   and parsed `CHAPTERS` block.

The script is **idempotent and non-destructive**: on re-run it preserves hand-authored
fields (`movieQuery`, `movieYear`, `number`, `id`, `transcriptFile`) by matching on
`youtubeId`, and it auto-wires a transcript as soon as `data/transcripts/ep<N>.json`
exists.

Because episode numbering follows upload order, the oldest upload is always `ep1`.

### Why this is fast

* Visitors never call YouTube for metadata — the catalog is a static, cached JSON file.
* The episode catalog is fetched **only when the Reviews view is first opened**, so the
  home cockpit keeps its fast first paint.
* The YouTube `<iframe>` (~1MB of third-party JS) is injected **only after a click**
  via a click-to-load facade. The poster is a plain `i.ytimg.com` thumbnail, which needs
  no API call.
* Relative dates ("7m ago", "Released Yesterday") are computed in the browser from
  `publishedAt`, so they never go stale in the repo.

---

## Technical Highlights & Four Core Pillars

### 1. Error-Free & Clean Code
* **Strict Semantic HTML5**: Accessible tags (`<article>`, `<header>`, `<footer>`, `<time>`, `<main>`, `<nav>`) throughout.
* **Modern JavaScript**: Clean `async/await` fetch logic with fallback caching, eliminating deprecated `window.event` and preventing memory leaks.
* **Form Accessibility**: Explicit `<label for="...">` matching input IDs and ARIA live regions for Web3Forms feedback alerts.

### 2. Lightning-Fast Load Times (<1s Initial Paint)
* **CSS Decoupling**: Consolidates styles into `style.css` with a minimal inline critical CSS snippet, reducing `index.html` payload by over 60%.
* **Non-Blocking Script Execution**: `script.js` uses `defer` to unblock HTML parsing and first contentful paint (FCP).
* **On-Demand Data Loading**: Transcripts and movie catalogs load only when requested, ensuring the initial bundle stays under 25KB.

### 3. SEO & Rich Social Metadata
* **Structured Data**: Embedded Schema.org `PodcastSeries` JSON-LD for rich snippet indexing on Google Search.
* **Social Graph Tags**: Complete Open Graph (`og:*`) and Twitter Card (`summary_large_image`) tags with absolute CDN asset paths.
* **Keyword-Rich Headings**: Logical hierarchy (`H1` Brand -> `H2` Section Views -> `H3` Video & Host Titles -> `H4` Component Headers).

### 4. GitHub MCP & LLM Friendliness
* **Standardized Code Banners**: Code blocks utilize uniform `/* ======================================================== */` banners for rapid AST parsing by Model Context Protocol tools.
* **Single-Responsibility Files**: Dynamic catalogs (`data/movies.json`, `data/episodes.json`) are separated from markup, preventing context window bloat during LLM-assisted maintenance.

---

## How to Add New Episodes & Movie Profiles

When publishing a new episode:

1. **Sync the catalog (required)**:
   ```bash
   node scripts/fetch-youtube.js
   ```
   This rebuilds `data/episodes.json` from the channel. Upload the video first — the
   script only sees public uploads. The new episode appears in the playlist
   automatically; **no HTML or JSON editing needed**.

2. **Add Transcript (optional but recommended)**:
   ```bash
   node scripts/fetch-transcript.js ep2
   ```
   This pulls the channel's own caption track (requires `brew install yt-dlp`) and writes
   `data/transcripts/ep2.json`. Because the uploader tags every cue — `[SHANE] ...`,
   `[ALEX] ...`, `[DAVE] ...` — no diarization is needed: consecutive cues from the same
   host are merged into readable turns with a timestamp and a speaker pill.
   Re-run `node scripts/fetch-youtube.js` afterwards and `transcriptFile` is wired
   automatically. Until then the player shows "Transcript coming soon".

   To hand-write a transcript instead, create `data/transcripts/ep<N>.json`:
   ```json
   {
     "episodeId": "ep2",
     "title": "Episode 2: Title",
     "dialogue": [
       { "time": "00:00:15", "speaker": "Shane", "role": "Passenger", "text": "..." }
     ]
   }
   ```

   **Note on descriptions**: `description` is pulled from YouTube, but a
   `descriptionOverride` field always wins so a sync never clobbers a correction.
   To re-pull from YouTube, delete `descriptionOverride` from that episode.

3. **Fetch TMDb Metadata (build step)**:
   Run the build script using your TMDb API credentials:
   ```bash
   TMDB_READ_TOKEN="<your_token>" node scripts/fetch-tmdb.js
   ```
   This automatically updates `data/movies.json` with the official poster, MPAA rating, runtime, and synopsis.
   The script reads `movieQuery` / `movieYear` from each entry in `data/episodes.json`.

4. **Commit & Deploy**:
   Push to `main`. GitHub Pages automatically deploys the updated static site.
