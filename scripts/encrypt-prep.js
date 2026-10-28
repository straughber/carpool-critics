#!/usr/bin/env node
/**
 * scripts/encrypt-prep.js
 *
 * Encrypt a prep pack so the unlisted in-car app does not publish the movie,
 * questions and run-of-show as plain JSON. The browser decrypts it with the
 * shared passphrase using WebCrypto (PBKDF2-SHA256 + AES-256-GCM).
 *
 *   PREP_PASSPHRASE="..." node scripts/encrypt-prep.js prep/data/ep02-club-kid.json prep/data/ep02-club-kid.enc.json
 *
 * If PREP_PASSPHRASE is absent, a random passphrase is generated and printed
 * once. Store it with the hosts; it is never committed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('Usage: PREP_PASSPHRASE="..." node scripts/encrypt-prep.js <in.json> <out.enc.json>');
  process.exit(2);
}

const passphrase = process.env.PREP_PASSPHRASE || crypto.randomBytes(9).toString('base64url');
const plaintext = fs.readFileSync(input);
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const iterations = 210000;
const key = crypto.pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
const envelope = {
  version: 1,
  algorithm: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  data: Buffer.concat([ciphertext, tag]).toString('base64')
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  status: 'encrypted',
  input,
  output,
  passphrase_generated: !process.env.PREP_PASSPHRASE,
  passphrase: process.env.PREP_PASSPHRASE ? undefined : passphrase
}, null, 2));
