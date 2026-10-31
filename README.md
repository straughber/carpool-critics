# Carpool Critics

Film reviews recorded in a parked car, the moment the credits roll.

Alex, Dave, and Shane watch a movie, head out to the car, and argue about it while the car
is parked: first impressions, Rotten Tomatoes guesses, spoiler debate, and a score for
every host on a tachometer. Episodes run about 20-25 minutes and are published on YouTube.

* **Live site:** [carpoolcritics.com](https://carpoolcritics.com/)
* **YouTube:** [@CarpoolCritics](https://www.youtube.com/@CarpoolCritics)

---

## What this repository is

The source for the show's website. It is a static, no-build site: plain HTML, CSS, and
vanilla JavaScript served from GitHub Pages, with generated episode pages and JSON data
catalogs. There is no framework, bundler, or runtime dependency.

Highlights:

* **Per-episode pages** with canonical URLs, Open Graph tags, and Schema.org metadata
* **A live feed** of the five most recent episodes: one monitor, five camera slots, and the
  rest filed in a year-grouped archive
* **Click-to-load player** so no YouTube iframe loads until someone presses play
* **Transcripts on every episode page**, with speaker labels and the turns that survived the cut
* **Sealed premieres** go up as a stub with the date (or `DATE TO BE ANNOUNCED` until the
  upload is scheduled) and a 16×9 pixel mosaic of the cover:
  no title, no film, no link, and nothing pre-release in the sitemap or RSS
* **Cached catalog data** so visitors never call YouTube or TMDb for metadata
* **Scheduled episodes** get a real page before release, kept out of search until the
  video is public
* **An RSS feed** (`feed.xml`) and a brand favicon for discovery and link previews
* **Live YouTube metadata wins**: the scraped title/thumbnail cannot be pinned by an
  older pipeline package

---

## Design system

The site is **Dash-Cam Brutalism**: terminal ASCII, 80s dashboard VFDs, and thermal
ticket stubs. The contract is `BRAND.md` in the production repository (one level above
this site checkout) — read it before changing a color, corner, shadow, or font. Short
version:

* `#0A0A0C` asphalt, `#121316` dash, `#F4F0EA` ticket ink, `#8E8D8A` muted,
  `#FFB000` amber, `#008751` HOV green, `#E63946` brake red.
* **Archivo Black** for marquee titles, **JetBrains Mono** for every UI/HUD label.
* `border-radius: 0` everywhere. Shadows are hard offsets (`4px 4px 0`). No blur, no
  `backdrop-filter`, no purple/slate gradients.
* Episode and film cards are **thermal tickets**: dashed perforation, receipt header,
  `ADMIT ONE // EP #XX // HOV-3`.
* Every score is a ten-cell ASCII gauge from `asciiGauge()` in `script.js`:
  `[▓▓▓▓▓▓▓▓░░] 8.0/10`. Never a star icon.
* A 3.5% scanline plane covers the viewport; view changes are instant, not eased.

The generated episode and archive pages share the same tokens through
`assets/css/episode.css` and the templates in `scripts/build-episode-pages.js`.
The top menu — wordmark, deck nav, HUD — lives in `assets/css/site-bar.css` and is
loaded by `index.html` and by every generated page, so it never reshapes between views.

---

## Repository layout

```text
carpool-critics/
├── index.html                   # SPA shell: home cockpit, live feed, hosts, contact
├── style.css                    # Site layout styles
├── assets/css/site-bar.css      # The one top menu (shared by every page)
├── assets/css/design-system.css # GENERATED tokens + component states (DESIGN_SYSTEM.md)
├── assets/css/interference.css # GENERATED static/tear/loss states (DESIGN_SYSTEM.md 13)
├── 404.html                     # Branded NO SIGNAL state, one burst then still
├── design-system.html           # Living specimen sheet: palette, type, states (noindex)
├── script.js                    # View router, live-feed channel select, contact helpers
├── assets/                      # Cockpit plate, host cutouts, per-episode thumbnails
├── data/
│   ├── episodes.json            # GENERATED public catalog
│   ├── movies.json              # Cached TMDb metadata
│   ├── pipeline/                # GENERATED per-episode payloads
│   ├── signal/                  # GENERATED ASCII audio envelopes (<id>.bin)
│   └── transcripts/             # On-demand dialogue transcripts
├── episodes/                    # GENERATED episode and archive pages
├── scripts/                     # Data sync, page builder, publish automation
└── .github/workflows/           # Scheduled publish
```

Generated paths (`episodes/`, `data/pipeline/`, `data/transcripts/`, `sitemap.xml`,
`robots.txt`, the catalogs) are rebuilt by scripts. Do not hand-edit them.

---

## Running it locally

No install and no build step are required:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

The data scripts need Node. Transcript sync additionally needs `yt-dlp`
(`brew install yt-dlp`).

---

## Refreshing content

```bash
# Catalog from the public YouTube channel
# Set YOUTUBE_API_KEY for exact Data API metadata; without it the RSS/page
# scraper is used as the keyless fallback.
YOUTUBE_API_KEY="<key>" node scripts/fetch-youtube.js

# Captions for an episode, if it has none yet
node scripts/fetch-transcript.js ep2

# TMDb enrichment (posters, runtime, rating, synopsis)
TMDB_READ_TOKEN="<token>" node scripts/fetch-tmdb.js

# Rebuild episode pages, archive, sitemap and robots
node scripts/build-episode-pages.js
```

Episode numbering follows upload order, so the oldest upload is always `ep1`. Upload first;
the sync only sees public videos.

Put the TMDb token in the environment or a gitignored `website/.env`. The token is used at
build time only and is never shipped to the browser.

---

## Adding an episode

1. Upload the episode to YouTube and make it public.
2. `node scripts/fetch-youtube.js` to add it to the catalog.
3. Optionally `node scripts/fetch-transcript.js <id>` for a transcript.
4. Run the build and publish.

Descriptions come from YouTube, but a `descriptionOverride` field always wins, so a sync
never clobbers a correction.

---

## Publishing

`main` is production: GitHub Pages builds from it, so **publishing is pushing**.

```bash
./scripts/build-all.sh        # sync -> transcripts -> TMDb -> pages
./scripts/publish.sh          # build, gate, commit, push, verify live
./scripts/publish.sh --dry-run
```

`publish.sh` refuses to ship a half-built catalog (invalid JSON, missing episode pages,
absent sitemap), commits only when something changed, pushes, then hash-compares **every
committed `*.html` page plus `style.css` and `script.js`** against the live site, so
"pushed" is never confused with "deployed".

A daily GitHub Action runs the same publish in `--auto` mode, which commits generated
files only and refuses to run when hand-edited files are dirty. That timer is also what
promotes a scheduled episode to indexable once its video goes public.

---

## Contact

Review requests, press, and everything else go through the contact card on
[carpoolcritics.com](https://carpoolcritics.com/). There is no contact form and no
mailing list.
