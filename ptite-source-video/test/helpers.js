'use strict';

const bcrypt = require('bcryptjs');
const request = require('supertest');
const { loadConfig } = require('../src/config');
const { openDatabase, createRepository } = require('../src/db');
const { createApp } = require('../src/app');
const { createAvailabilityService } = require('../src/services/availability');

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const DRIVE_URL = `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`;
const ADMIN = { username: 'redaction', password: 'mot-de-passe-solide' };

/**
 * Application de test : base en mémoire, vérificateur Drive simulé (aucun appel réseau réel).
 */
function makeApp({ checkResult = { status: 'available', detail: 'Vidéo accessible.', mimeType: 'video/mp4' }, env = {} } = {}) {
  const config = loadConfig({
    env: { NODE_ENV: 'test', SESSION_SECRET: 'test-secret-'.padEnd(40, 'x'), PUBLIC_BASE_URL: 'https://video.example.fr', CHECK_INTERVAL_HOURS: '0', ...env },
    values: { bulkCheckDelayMs: 0 },
  });
  const repo = createRepository(openDatabase(':memory:'));
  repo.createUser(ADMIN.username, bcrypt.hashSync(ADMIN.password, 4));
  const calls = [];
  const checker = async (id, key) => {
    calls.push({ id, key });
    const r = typeof checkResult === 'function' ? checkResult(id) : checkResult;
    return { checkedAt: new Date().toISOString(), ...r };
  };
  const availability = createAvailabilityService({ repo, checkers: { gdrive: checker }, logger: { warn() {}, error() {} } });
  const app = createApp({ config, repo, availability, logger: { warn() {}, error() {} } });
  return { app, repo, config, checkerCalls: calls };
}

function csrfFrom(text) {
  const m = String(text).match(/name="_csrf" value="([a-f0-9]+)"/);
  return m ? m[1] : null;
}

async function login(app, creds = ADMIN) {
  const agent = request.agent(app);
  const page = await agent.get('/admin/login');
  const csrf = csrfFrom(page.text);
  const res = await agent.post('/admin/login').type('form').send({ ...creds, _csrf: csrf, next: '/admin' });
  return { agent, res };
}

async function adminCsrf(agent, path = '/admin') {
  const page = await agent.get(path);
  return csrfFrom(page.text);
}

function seedVideo(repo, overrides = {}) {
  return repo.createVideo({
    provider: 'gdrive',
    sourceId: FILE_ID,
    sourceUrl: `https://drive.google.com/file/d/${FILE_ID}/view`,
    title: 'Reportage au CDI',
    description: 'Une vidéo de test.',
    published: true,
    availability: { status: 'available', detail: 'ok', checkedAt: new Date().toISOString() },
    ...overrides,
  }, overrides.slug || null);
}

module.exports = { makeApp, login, csrfFrom, adminCsrf, seedVideo, FILE_ID, DRIVE_URL, ADMIN };
