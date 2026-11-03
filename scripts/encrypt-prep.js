#!/usr/bin/env node
/**
 * scripts/encrypt-prep.js
 *
 * Encrypt a prep pack so the unlisted in-car app does not publish the movie,
 * questions and run-of-show as plain JSON. The browser decrypts it with the
 * shared passphrase using WebCrypto (PBKDF2-SHA256 + AES-256-GCM).
 *
 *   node scripts/encrypt-prep.js prep/data/ep02-club-kid.json prep/data/ep02-club-kid.enc.json
 *   PREP_PASSPHRASE="other" node scripts/encrypt-prep.js in.json out.enc.json
 *   node scripts/encrypt-prep.js --decrypt prep/data/index.enc.json /tmp/index.json
 *
 * The passphrase is resolved in this order, and the source is printed:
 *   1. PREP_PASSPHRASE environment variable
 *   2. ../../tokens/prep_passphrase  (gitignored, outside this repo)
 *   3. a random passphrase, generated and printed once
 *
 * The passphrase is never committed here: this repo is published to GitHub
 * Pages, so a passphrase in its history is a passphrase the audience has.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PASSPHRASE_FILE = path.resolve(__dirname, '..', '..', 'tokens', 'prep_passphrase');
const ITERATIONS = 210000;

function resolvePassphrase() {
  const fromEnv = process.env.PREP_PASSPHRASE;
  if (fromEnv) return { passphrase: fromEnv, source: 'PREP_PASSPHRASE' };
  try {
    const fromFile = fs.readFileSync(PASSPHRASE_FILE, 'utf8').trim();
    if (fromFile) return { passphrase: fromFile, source: path.relative(process.cwd(), PASSPHRASE_FILE) };
  } catch {
    /* no file: fall through to a generated passphrase */
  }
  return { passphrase: crypto.randomBytes(9).toString('base64url'), source: 'generated' };
}

function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(passphrase, salt, ITERATIONS, 32, 'sha256');
}

const argv = process.argv.slice(2);
const decrypt = argv[0] === '--decrypt';
const [input, output] = decrypt ? argv.slice(1) : argv;

if (!input || !output) {
  console.error('Usage: node scripts/encrypt-prep.js [--decrypt] <in.json> <out.json>');
  console.error('       PREP_PASSPHRASE="..." overrides ../../tokens/prep_passphrase');
  process.exit(2);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const { passphrase, source } = resolvePassphrase();

if (decrypt) {
  const envelope = JSON.parse(fs.readFileSync(input, 'utf8'));
  const key = deriveKey(passphrase, Buffer.from(envelope.salt, 'base64'));
  const payload = Buffer.from(envelope.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(payload.subarray(payload.length - 16));
  try {
    const plain = Buffer.concat([decipher.update(payload.subarray(0, payload.length - 16)), decipher.final()]);
    fs.writeFileSync(output, plain);
  } catch {
    console.error(JSON.stringify({ status: 'error', reason: 'wrong_passphrase', input, passphrase_source: source }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: 'decrypted', input, output, passphrase_source: source }, null, 2));
  process.exit(0);
}

const plaintext = fs.readFileSync(input);
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = deriveKey(passphrase, salt);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
const envelope = {
  version: 1,
  algorithm: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations: ITERATIONS,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  data: Buffer.concat([ciphertext, tag]).toString('base64')
};
fs.writeFileSync(output, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  status: 'encrypted',
  input,
  output,
  passphrase_source: source,
  passphrase_generated: source === 'generated',
  passphrase: source === 'generated' ? passphrase : undefined
}, null, 2));
