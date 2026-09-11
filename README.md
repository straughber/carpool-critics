# Carpool Cinema Critics

Interactive film review dispatch recorded live inside a BMW X5 overlooking the Austin, Texas skyline.

Website URL: **[https://straughber.github.io/curbside-cinema/](https://straughber.github.io/curbside-cinema/)**

---

## Repository & Folder Architecture (Scales to 100+ Episodes)

To keep initial website load times blazing fast even with 100+ episodes and hundreds of thousands of words of dialogue, transcripts are **never** bundled into the main HTML file. Instead, they are lazy-loaded on-demand as static JSON assets.

```text
curbside-cinema/
├── index.html                   # Main single-page web app (~27KB)
├── style.css                    # Performance-optimized CSS with animations & responsive rules
├── script.js                    # Interaction routing & on-demand transcript lazy loader
├── CurbsideCinema_Background.jpeg  # Background BMW X5 cockpit photo
├── Alex_CurbsideCritic.webp     # Driver seat cutout
├── Dave_CurbsideCritic.webp     # Center back seat cutout
├── Shane_CurbsideCritic.webp    # Passenger seat cutout
├── assets/                      # Vector fallbacks & image assets
│   ├── alex.svg
│   ├── dave.svg
│   └── shane.svg
└── data/                        # Scalable data architecture
    ├── episodes.json            # Master lightweight index of all episodes
    └── transcripts/             # Individual transcript files (loaded on-demand only)
        ├── ep42.json
        ├── ep41.json
        ├── ep40.json
        └── ... (ep01 to ep100+)
```

---

## How Adding Future Episodes Works

When you record a new episode:

1. **Add Transcript**:
   Create `data/transcripts/ep<number>.json` using the structured format:
   ```json
   {
     "episodeId": "ep43",
     "title": "Episode 43: Title",
     "recordedLocation": "BMW X5 Studio • Austin, TX",
     "dialogue": [
       {
         "time": "00:00:15",
         "speaker": "Shane",
         "role": "Passenger",
         "text": "..."
       }
     ]
   }
   ```
2. **Register in Catalog**:
   Add an entry into `data/episodes.json` with the episode metadata and YouTube video ID.
3. **Commit**:
   GitHub Pages builds automatically. The front page `index.html` remains featherlight, and visitors only download a transcript when they click that specific episode.

---

## Accessibility & SEO Benefits
* **Screen Reader Friendly**: Transcripts are marked up with semantic HTML (`<article>`, `<time>`, `<role="region">`, `aria-live="polite"`).
* **Search Engine Indexable**: Each static file under `data/transcripts/` is a crawlable public endpoint that search engines can index for episode quotes, guest names, and movie titles.
