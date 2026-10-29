/**
 * scripts/test-shorts-filter.js
 * Offline regression test for the "episodes only" rule.
 *
 * On 2026-10-28 a Short ("Dave's Whalefall score, argued at 0 mph") was
 * catalogued as "Ep. 2" and got a page, a sitemap entry and a feed item, because
 * the guard only fired when the scrape happened to know the runtime and the
 * scrape returned none for that video. These assertions are the bug, written
 * down: a Short must be refused on the runtime it does have, on the ledger id it
 * was uploaded under, and it must never be mistaken for a full-length episode.
 *
 * No network calls: the probe is exercised only through its exported shape.
 *
 *   node scripts/test-shorts-filter.js
 */
const assert = require('assert');
const {
  SHORT_MAX_SECONDS,
  UNPROVEN,
  shortReasonFor,
  loadKnownShortVideoIds
} = require('./fetch-youtube');

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

async function run() {
  await check('the Shorts threshold is five minutes', () => {
    assert.strictEqual(SHORT_MAX_SECONDS, 300);
  });

  await check('an uploaded Short id is refused even with no runtime', async () => {
    const reason = await shortReasonFor('aaaaaaaaaaa', null, new Set(['aaaaaaaaaaa']));
    assert.ok(reason && reason !== UNPROVEN, `expected an outright rejection, got ${reason}`);
    assert.match(reason, /Shorts ledger/);
  });

  await check('the 16s Whalefall Short is refused on its runtime', async () => {
    const reason = await shortReasonFor('aaaaaaaaaaa', 16, new Set());
    assert.match(String(reason), /16s runtime/);
  });

  await check('a 21m episode is not refused', async () => {
    assert.strictEqual(await shortReasonFor('aaaaaaaaaaa', 1308, new Set()), null);
  });

  await check('a 5m00s video is an episode, a 4m59s one is not', async () => {
    assert.strictEqual(await shortReasonFor('aaaaaaaaaaa', 300, new Set()), null);
    assert.match(String(await shortReasonFor('aaaaaaaaaaa', 299, new Set())), /299s runtime/);
  });

  await check('the channel Shorts ledger is read from disk', () => {
    const ids = loadKnownShortVideoIds();
    assert.ok(ids.size > 0, 'no Short ids found — the release ledger is missing');
    assert.ok(ids.has('uvCFbGh4EV4'), 'the leaked Short uvCFbGh4EV4 is not in the known-Short set');
  });

  await check('the catalogue contains no Short', () => {
    const catalog = require('../data/episodes.json');
    const known = loadKnownShortVideoIds();
    const leaked = catalog.filter(ep => ep.youtubeId && known.has(ep.youtubeId));
    assert.deepStrictEqual(leaked.map(ep => ep.id), []);
    const shortRuntime = catalog.filter(ep => Number(ep.durationSeconds) > 0 && Number(ep.durationSeconds) < SHORT_MAX_SECONDS);
    assert.deepStrictEqual(shortRuntime.map(ep => ep.id), []);
  });

  if (failures.length) {
    console.error(`\n${failures.length} Shorts filter check(s) failed`);
    process.exit(1);
  }
  console.log('\nShorts are never episodes: all checks passed');
}

run().catch(err => {
  console.error('[ShortsFilter] Fatal:', err);
  process.exit(1);
});
