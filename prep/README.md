# In-car prep app

The prep app is a `BRAND.md` surface, not a separate product: asphalt shell,
scanline plane, Archivo Black / JetBrains Mono, 0px corners, hard offset
shadows and thermal-ticket cards. It loads `../assets/css/site-bar.css` for the
wordmark, deck nav and HUD, so the top menu has one authority. Keep the tokens
in `app.css` identical to `website/style.css`.

The prep pack contains the unreleased film, question deck and run-of-show. It is
encrypted before it is published.

## Passphrase

The shared passphrase is **not in this repo** - this repo is published to GitHub
Pages, so a passphrase in its history is a passphrase the audience has. It lives
in the Mac's gitignored `tokens/prep_passphrase` (one line, the project default),
and `PREP_PASSPHRASE` overrides it for a one-off.

`scripts/encrypt-prep.js` resolves it in that order, prints which source it used,
and falls back to a generated passphrase only when neither exists.

## Publishing

`python3 tools/generate_episode_prep.py <IMDb URL> --publish-web` writes the pack,
the index and the leaderboard, then **encrypts the pack and index and deletes the
plaintext** - so a normal run never leaves a readable pack in this repo. The pack
index names the `.enc.json` file, which is what the app fetches and decrypts.

To rotate the passphrase, decrypt with the old one and re-encrypt with the new:

```bash
cd website
node scripts/encrypt-prep.js --decrypt prep/data/index.enc.json /tmp/index.json
PREP_PASSPHRASE="new phrase" node scripts/encrypt-prep.js /tmp/index.json prep/data/index.enc.json
rm /tmp/index.json
```

- Plaintext `prep/data/ep*-*.json` packs are gitignored, and `publish.sh` now
  refuses to publish while any plaintext pack other than `leaderboard.json`
  exists.
- `prep/data/index.json` is encrypted too, because its movie title and year are
  also pre-release information.
- `prep/data/leaderboard.json` stays plain because it contains no pack content.
- The browser prompts for the passphrase once per session and decrypts with
  WebCrypto (PBKDF2-SHA256, 210,000 iterations + AES-256-GCM).
- Update `prep/data/index.json` to point at the `.enc.json` file (the generator
  does this for you).

The encryption is a publication barrier, not a substitute for a private server.
