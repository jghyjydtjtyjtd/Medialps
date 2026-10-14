#!/usr/bin/env node
'use strict';

/**
 * Crée un compte administrateur ou réinitialise son mot de passe.
 * Usage : npm run create-admin            (interactif)
 *         npm run create-admin -- nom     (demande seulement le mot de passe)
 */
const readline = require('readline');
const { loadConfig } = require('../src/config');
const { openDatabase, createRepository } = require('../src/db');
const { hashPassword, validatePasswordStrength } = require('../src/lib/security');

function ask(rl, q, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(q, resolve);
    const out = rl.output;
    rl.output = { write: () => {} };
    out.write(q);
    rl.question('', (a) => { rl.output = out; out.write('\n'); resolve(a); });
  });
}

(async () => {
  const config = loadConfig({ env: { NODE_ENV: 'development', ...process.env, SESSION_SECRET: process.env.SESSION_SECRET || 'cli' , PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || 'http://localhost' } });
  const repo = createRepository(openDatabase(config.dbPath));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  let username = (process.argv[2] || '').trim();
  if (!username) username = (await ask(rl, 'Identifiant administrateur : ')).trim();
  if (!/^[A-Za-z0-9._@-]{3,100}$/.test(username)) {
    console.error('Identifiant invalide (3 à 100 caractères : lettres, chiffres, . _ @ -).');
    process.exit(1);
  }
  const pw = process.env.ADMIN_PASSWORD || await ask(rl, 'Mot de passe (10 caractères min.) : ', true);
  const weak = validatePasswordStrength(pw);
  if (weak) { console.error(weak); process.exit(1); }
  if (!process.env.ADMIN_PASSWORD) {
    const confirm = await ask(rl, 'Confirmation : ', true);
    if (confirm !== pw) { console.error('Les mots de passe ne correspondent pas.'); process.exit(1); }
  }
  rl.close();

  const hash = await hashPassword(pw);
  const existing = repo.getUserByName(username);
  if (existing) {
    repo.setUserPassword(existing.id, hash);
    console.log(`Mot de passe de « ${username} » réinitialisé (ses sessions ouvertes sont déconnectées).`);
  } else {
    repo.createUser(username, hash);
    console.log(`Compte « ${username} » créé dans ${config.dbPath}.`);
  }
  process.exit(0);
})();
