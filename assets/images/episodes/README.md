# Episode Media & Thumbnails

Store episode-specific visual assets here as the library scales to 100+ episodes:

```text
assets/images/episodes/
├── ep42-thumb.webp
├── ep41-thumb.webp
├── ep40-thumb.webp
└── ...
```

### Future Scaling & SEO:
- When adding episode thumbnails, link them in `data/episodes.json` under `"thumbnail": "assets/images/episodes/ep42-thumb.webp"`.
- This enables dynamic episode cards, rich social sharing previews (OpenGraph / Twitter cards), and Google Video/Image search indexing.
