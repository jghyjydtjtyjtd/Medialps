'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const drive = require('../src/providers/googleDrive');

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

/** Faux fetch : enregistre les URL demandées et rejoue des réponses prédéfinies. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const host = new URL(url).hostname;
    const handler = routes[host];
    if (!handler) throw new Error('hôte inattendu ' + host);
    const r = typeof handler === 'function' ? handler(url, init) : handler;
    if (r instanceof Error) throw r;
    return new Response(r.body ?? '', { status: r.status, headers: r.headers || {} });
  };
  fn.calls = calls;
  return fn;
}

const json = (status, obj) => ({ status, body: JSON.stringify(obj), headers: { 'content-type': 'application/json' } });

test('API : vidéo accessible', async () => {
  const f = fakeFetch({ 'www.googleapis.com': json(200, { id: ID, name: 'reportage.mp4', mimeType: 'video/mp4', videoMediaMetadata: { durationMillis: '1000' } }) });
  const r = await drive.createChecker({ apiKey: 'K', fetchImpl: f })(ID);
  assert.equal(r.status, 'available');
  assert.equal(r.mimeType, 'video/mp4');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.redirect, 'manual');
});

test('API : vidéo encore en traitement', async () => {
  const f = fakeFetch({ 'www.googleapis.com': json(200, { id: ID, name: 'a.mov', mimeType: 'video/quicktime' }) });
  const r = await drive.createChecker({ apiKey: 'K', fetchImpl: f })(ID);
  assert.equal(r.status, 'available');
  assert.equal(r.processing, true);
});

test('API : fichier qui n’est pas une vidéo', async () => {
  const f = fakeFetch({ 'www.googleapis.com': json(200, { id: ID, name: 'expose.pdf', mimeType: 'application/pdf' }) });
  const r = await drive.createChecker({ apiKey: 'K', fetchImpl: f })(ID);
  assert.equal(r.status, 'not_video');
});

test('API : fichier dans la corbeille', async () => {
  const f = fakeFetch({ 'www.googleapis.com': json(200, { id: ID, name: 'a.mp4', mimeType: 'video/mp4', trashed: true }) });
  const r = await drive.createChecker({ apiKey: 'K', fetchImpl: f })(ID);
  assert.equal(r.status, 'not_found');
});

test('API : resourcekey transmise par en-tête', async () => {
  const f = fakeFetch({ 'www.googleapis.com': json(200, { mimeType: 'video/mp4', videoMediaMetadata: {} }) });
  await drive.createChecker({ apiKey: 'K', fetchImpl: f })(ID, '0-abc');
  assert.equal(f.calls[0].init.headers['X-Goog-Drive-Resource-Keys'], `${ID}/0-abc`);
});

test('API 404 puis page → redirection connexion = fichier privé', async () => {
  const f = fakeFetch({
    'www.googleapis.com': json(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } }),
    'drive.google.com': { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin?continue=x' } },
  });
  const r = await drive.createChecker({ apiKey: 'K', fetchImpl: f })(ID);
  assert.equal(r.status, 'private');
  assert.equal(f.calls.length, 2);
});

test('API 404 puis page 404 = fichier introuvable', async () => {
  const f = fakeFetch({
    'www.googleapis.com': json(404, { error: { code: 404 } }),
    'drive.google.com': { status: 404 },
  });
  const r = await drive.createChecker({ apiKey: 'K', fetchImpl: f })(ID);
  assert.equal(r.status, 'not_found');
});

test('API : quota dépassé', async () => {
  const f = fakeFetch({ 'www.googleapis.com': json(403, { error: { code: 403, errors: [{ reason: 'userRateLimitExceeded' }] } }) });
  const r = await drive.createChecker({ apiKey: 'K', fetchImpl: f })(ID);
  assert.equal(r.status, 'quota');
});

test('API : clé invalide → repli sur la vérification simplifiée', async () => {
  const f = fakeFetch({
    'www.googleapis.com': json(400, { error: { code: 400, errors: [{ reason: 'keyInvalid' }] } }),
    'drive.google.com': { status: 200, body: '<meta property="og:title" content="film.mp4">' },
  });
  const r = await drive.createChecker({ apiKey: 'K', fetchImpl: f })(ID);
  assert.equal(r.status, 'available');
  assert.match(r.detail, /Clé API Google refusée/);
});

test('Sans clé : page publique avec type vidéo', async () => {
  const f = fakeFetch({ 'drive.google.com': { status: 200, body: '<html><meta property="og:title" content="Interview du principal.mp4"></html>' } });
  const r = await drive.createChecker({ fetchImpl: f })(ID);
  assert.equal(r.status, 'available');
  assert.equal(r.name, 'Interview du principal.mp4');
});

test('Sans clé : page publique d’un PDF', async () => {
  const f = fakeFetch({ 'drive.google.com': { status: 200, body: '<meta property="og:title" content="cours.pdf">' } });
  const r = await drive.createChecker({ fetchImpl: f })(ID);
  assert.equal(r.status, 'not_video');
});

test('Sans clé : type non identifiable → non confirmé', async () => {
  const f = fakeFetch({ 'drive.google.com': { status: 200, body: '<meta property="og:title" content="sans extension">' } });
  const r = await drive.createChecker({ fetchImpl: f })(ID);
  assert.equal(r.status, 'unverified');
});

test('Sans clé : 403 = accès refusé, 429 = quota', async () => {
  let r = await drive.createChecker({ fetchImpl: fakeFetch({ 'drive.google.com': { status: 403 } }) })(ID);
  assert.equal(r.status, 'private');
  r = await drive.createChecker({ fetchImpl: fakeFetch({ 'drive.google.com': { status: 429 } }) })(ID);
  assert.equal(r.status, 'quota');
});

test('Erreur réseau / délai dépassé → état « error », sans exception', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const r = await drive.createChecker({ fetchImpl: fakeFetch({ 'drive.google.com': abort }) })(ID);
  assert.equal(r.status, 'error');
  assert.match(r.detail, /à temps/);
});

test('Délai : la requête est réellement interrompue', async () => {
  const slow = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const t0 = Date.now();
  const r = await drive.createChecker({ fetchImpl: slow, timeoutMs: 50 })(ID);
  assert.equal(r.status, 'error');
  assert.ok(Date.now() - t0 < 1000);
});

test('SSRF : seuls drive.google.com et www.googleapis.com peuvent être contactés', () => {
  const { assertAllowedFetch } = drive._internal;
  assert.doesNotThrow(() => assertAllowedFetch(`https://drive.google.com/file/d/${ID}/view`));
  assert.doesNotThrow(() => assertAllowedFetch(`https://www.googleapis.com/drive/v3/files/${ID}`));
  for (const bad of ['http://drive.google.com/x', 'https://169.254.169.254/latest/meta-data', 'https://localhost/', 'https://drive.google.com:8443/', 'https://evil.com/', 'https://u@drive.google.com/']) {
    assert.throws(() => assertAllowedFetch(bad), /refusée/, bad);
  }
});

test('SSRF : un identifiant invalide ne déclenche aucune requête', async () => {
  const f = fakeFetch({});
  const r = await drive.createChecker({ fetchImpl: f })('../../169.254.169.254');
  assert.equal(r.status, 'error');
  assert.equal(f.calls.length, 0);
});

test('SSRF : les URL contactées sont construites par le serveur à partir de l’ID', async () => {
  const f = fakeFetch({ 'drive.google.com': { status: 404 } });
  const parsed = drive.parse(`https://drive.google.com/open?id=${ID}&next=http://169.254.169.254/`);
  await drive.createChecker({ fetchImpl: f })(parsed.fileId, parsed.resourceKey);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `https://drive.google.com/file/d/${ID}/view`);
});
