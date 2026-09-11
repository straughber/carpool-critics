# Carpool Cinema Critics

Interactive film review dispatch recorded live inside a BMW X5 overlooking the Austin, Texas skyline.

Website URL: **[https://straughber.github.io/curbside-cinema/](https://straughber.github.io/curbside-cinema/)**

---

## Scalable Repository & Media Architecture

The repository is organized into dedicated directories for media, data, and presentation logic to maximize initial load performance, streamline asset management, and improve SEO indexing across search engines.

```text
curbside-cinema/
├── index.html                   # Lightweight single-page app (~30KB) with Schema.org JSON-LD
├── style.css                    # Performance-optimized CSS with animations & responsive rules
├── script.js                    # Interaction routing & on-demand transcript lazy loader
├── assets/                      # Media & visual assets categorized for SEO
│   └── images/
│       ├── cockpit/             # Vehicle interior & background imagery
│       │   └── CurbsideCinema_Background.jpeg
│       ├── hosts/               # Transparent host cutouts & vector fallbacks
│       │   ├── Alex_CurbsideCritic.webp
│       │   ├── Dave_CurbsideCritic.webp
│       │   ├── Shane_CurbsideCritic.webp
│       │   ├── alex.svg
│       │   ├── dave.svg
│       │   └── shane.svg
│       └── episodes/            # Future episode thumbnails & posters (ep01 to ep100+)
└── data/                        # Structured data architecture
    ├── episodes.json            # Master lightweight index of all episodes
    └── transcripts/             # Individual transcript files (loaded on-demand only)
        ├── ep42.json
        ├── ep41.json
        ├── ep40.json
        └── ...
```

---

## Media Organization & SEO Guidelines

1. **Cockpit Environment (`assets/images/cockpit/`)**:
   * Houses background plates. The site checks `assets/images/cockpit/CurbsideCinema_Background.jpeg` with automatic root-directory fallback.
2. **Host Cutouts (`assets/images/hosts/`)**:
   * Houses host cutouts. Named descriptively: `Alex_CurbsideCritic.webp`, `Dave_CurbsideCritic.webp`, `Shane_CurbsideCritic.webp`.
   * Each host image tag features descriptive, keyword-rich `alt` text for search engine accessibility.
3. **Episode Thumbnails (`assets/images/episodes/`)**:
   * Reserved for episode posters (`ep42-thumb.webp`, etc.) to power OpenGraph social previews and Google Video/Image search indexing.
4. **On-Demand Transcripts (`data/transcripts/`)**:
   * Each episode's dialogue lives in a dedicated static JSON file, keeping initial page load under 30KB while making full text search-engine crawlable.
