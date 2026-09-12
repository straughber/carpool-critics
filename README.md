# Carpool Critics

An interactive film review dispatch recorded live inside a BMW X5 overlooking the Austin, Texas night skyline. Hosts Alex (Driver), Dave (Back Seat), and Shane (Passenger) debrief hot takes, cinematic pacing, creature effects, and coming-of-age films the moment the credits roll.

* **Live Site**: [https://straughber.github.io/carpool-cinema-critics/](https://straughber.github.io/carpool-cinema-critics/)
* **Format**: Interactive Single-Page Web App (SPA) with On-Demand Transcripts and TMDb Movie Profiles

---

## Scalable Repository Architecture

The project decouples presentation markup, dynamic media catalogs, and build-time metadata to maintain sub-second load times on static hosting (GitHub Pages) while ensuring full search engine crawlability for 100+ episodes.

```text
carpool-cinema-critics/
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
│   ├── episodes.json            # Master lightweight episode directory
│   ├── movies.json              # Pre-cached TMDb movie metadata (ratings, runtime, posters)
│   └── transcripts/             # On-demand dialogue transcripts (loaded only on click)
│       ├── ep42.json
│       ├── ep41.json
│       ├── ep40.json
│       └── ...
└── scripts/                     # Automation & build scripts
    └── fetch-tmdb.js            # Build-time TMDb API fetcher (zero client key exposure)
```

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

1. **Add Transcript**:
   Create `data/transcripts/ep<id>.json` with structured dialogue timestamps:
   ```json
   {
     "episodeId": "ep43",
     "title": "Episode 43: Title",
     "dialogue": [
       { "time": "00:00:15", "speaker": "Shane", "role": "Passenger", "text": "..." }
     ]
   }
   ```

2. **Register in Catalog**:
   Add the episode to `data/episodes.json` with `id`, `youtubeId`, and `movieQuery` (e.g., `"movieQuery": "Dune"`).

3. **Fetch TMDb Metadata (Build Step)**:
   Run the build script using your TMDb API credentials:
   ```bash
   TMDB_READ_TOKEN="<your_token>" node scripts/fetch-tmdb.js
   ```
   This automatically updates `data/movies.json` with the official poster, MPAA rating, runtime, and synopsis.

4. **Commit & Deploy**:
   Push to `main`. GitHub Pages automatically deploys the updated static site.
