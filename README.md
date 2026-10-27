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
* **Click-to-load player** so no YouTube iframe loads until someone presses play
* **On-demand transcripts** with speaker labels, loaded only when opened
* **Cached catalog data** so visitors never call YouTube or TMDb for metadata
* **Scheduled episodes** get a real page before release, kept out of search until the
  video is public

---

## Repository layout

```text
carpool-critics/
├── index.html                   # SPA shell: home cockpit, reviews, about, contact
├── style.css                    # Site styles
├── script.js                    # View router, transcript loader, movie profiles
├── assets/                      # Cockpit plate, host cutouts, per-episode thumbnails
├── data/
│   ├── episodes.json            # GENERATED public catalog
│   ├── movies.json              # Cached TMDb metadata
│   ├── pipeline/                # GENERATED per-episode payloads
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
# Catalog from the public YouTube channel (no API key)
node scripts/fetch-youtube.js

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
absent sitemap), commits only when something changed, pushes, then checks the live site so
"pushed" is never confused with "deployed".

A daily GitHub Action runs the same publish in `--auto` mode, which commits generated
files only and refuses to run when hand-edited files are dirty. That timer is also what
promotes a scheduled episode to indexable once its video goes public.

---

## Contact

Review requests, press, and everything else go through the contact card on
[carpoolcritics.com](https://carpoolcritics.com/). There is no contact form and no
mailing list.
