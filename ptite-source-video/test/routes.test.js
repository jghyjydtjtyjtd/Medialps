'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const { makeApp, login, csrfFrom, adminCsrf, seedVideo, FILE_ID, DRIVE_URL, ADMIN } = require('./helpers');

function decodeQrPng(buf) {
  const png = PNG.sync.read(buf);
  const r = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return r && r.data;
}

/* ------------------------------------------------------------------ Public */

test('accueil : champ de saisie et bouton', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /name="lien"/);
  assert.match(res.text, /Transformer mon lien/);
});

test('page vidéo publiée : lecteur Drive officiel, titre, partage, QR', async () => {
  const { app, repo } = makeApp();
  const v = seedVideo(repo, { slug: 'aB12xY' });
  const res = await request(app).get('/v/aB12xY');
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`src="https://drive.google.com/file/d/${FILE_ID}/preview"`));
  assert.match(res.text, /Reportage au CDI/);
  assert.match(res.text, /data-share/);
  assert.match(res.text, /https:\/\/video\.example\.fr\/v\/aB12xY/);
  assert.match(res.text, /\/v\/aB12xY\/qr\.svg/);
  assert.equal(v.published, 1);
});

test('identifiant court insensible à la casse', async () => {
  const { app, repo } = makeApp();
  seedVideo(repo, { slug: 'aB12xY' });
  assert.equal((await request(app).get('/v/ab12xy')).status, 200);
});

test('page inexistante → 404 claire', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/v/inexistant');
  assert.equal(res.status, 404);
  assert.match(res.text, /Vidéo introuvable/);
});

test('page non publiée → 404 pour le public, aperçu pour la rédaction', async () => {
  const { app, repo } = makeApp();
  seedVideo(repo, { slug: 'brouillon', published: false });
  const pub = await request(app).get('/v/brouillon');
  assert.equal(pub.status, 404);
  assert.doesNotMatch(pub.text, /Reportage au CDI/);
  assert.equal((await request(app).get('/v/brouillon/qr.png')).status, 404);
  assert.equal((await request(app).get('/e/brouillon')).status, 404);

  const { agent } = await login(app);
  const adm = await agent.get('/v/brouillon');
  assert.equal(adm.status, 200);
  assert.match(adm.text, /Brouillon/);
  assert.match(adm.text, /noindex/);
});

test('vidéo inaccessible : message clair, pas de lecteur', async () => {
  const { app, repo } = makeApp();
  seedVideo(repo, { slug: 'privee', availability: { status: 'private', detail: 'privé' } });
  seedVideo(repo, { slug: 'supprimee', availability: { status: 'not_found', detail: 'introuvable' } });
  seedVideo(repo, { slug: 'pdf', availability: { status: 'not_video', detail: 'pdf' } });
  const priv = await request(app).get('/v/privee');
  assert.equal(priv.status, 200);
  assert.match(priv.text, /pas accessible publiquement/);
  assert.doesNotMatch(priv.text, /\/preview"/);
  assert.match((await request(app).get('/v/supprimee')).text, /introuvable/);
  assert.match((await request(app).get('/v/pdf')).text, /pas une vidéo/);
  assert.match((await request(app).get('/e/privee')).text, /Vidéo indisponible/);
});

test('XSS : le titre et la description sont échappés', async () => {
  const { app, repo } = makeApp();
  seedVideo(repo, { slug: 'xss', title: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)> https://exemple.fr/"onmouseover=x' });
  const res = await request(app).get('/v/xss');
  assert.doesNotMatch(res.text, /<script>alert/);
  assert.doesNotMatch(res.text, /<img src=x/);
  assert.match(res.text, /&lt;script&gt;/);
});

test('ancien identifiant → redirection 301 vers le nouveau (page et QR)', async () => {
  const { app, repo } = makeApp();
  const v = seedVideo(repo, { slug: 'ancien' });
  repo.changeSlug(v.id, 'nouveau-nom');
  const res = await request(app).get('/v/ancien');
  assert.equal(res.status, 301);
  assert.equal(res.headers.location, '/v/nouveau-nom');
  const qr = await request(app).get('/v/ancien/qr.png?taille=300');
  assert.equal(qr.status, 301);
  assert.equal(qr.headers.location, '/v/nouveau-nom/qr.png?taille=300');
});

test('QR code PNG : image valide qui encode l’URL courte', async () => {
  const { app, repo } = makeApp();
  seedVideo(repo, { slug: 'qrtest' });
  const res = await request(app).get('/v/qrtest/qr.png?taille=400').buffer(true).parse((r, cb) => {
    const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.deepEqual([...res.body.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(decodeQrPng(res.body), 'https://video.example.fr/v/qrtest');
});

test('QR code SVG et téléchargement', async () => {
  const { app, repo } = makeApp();
  seedVideo(repo, { slug: 'qrsvg' });
  const res = await request(app).get('/v/qrsvg/qr.svg?telecharger=1').buffer(true).parse((r, cb) => {
    let t = ''; r.setEncoding('utf8'); r.on('data', (c) => { t += c; }); r.on('end', () => cb(null, t));
  });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /image\/svg\+xml/);
  assert.match(res.headers['content-disposition'], /attachment; filename="?qr-ptite-source-qrsvg\.svg"?/);
  assert.match(res.body, /^<svg/);
});

test('QR code : taille bornée', async () => {
  const { qrPng } = require('../src/lib/qr');
  const big = PNG.sync.read(await qrPng('https://x.fr', 999999));
  const small = PNG.sync.read(await qrPng('https://x.fr', 1));
  assert.equal(big.width, 2048);
  assert.equal(small.width, 128);
});

test('intégration : seule /e/:slug est intégrable (frame-ancestors)', async () => {
  const { app, repo } = makeApp();
  seedVideo(repo, { slug: 'integre' });
  const e = await request(app).get('/e/integre');
  assert.equal(e.status, 200);
  assert.match(e.headers['content-security-policy'], /frame-ancestors \*/);
  const v = await request(app).get('/v/integre');
  assert.match(v.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(v.headers['content-security-policy'], /frame-src https:\/\/drive\.google\.com/);
});

test('intégration : origines restreintes configurables', async () => {
  const { app, repo } = makeApp({ env: { EMBED_ALLOWED_ORIGINS: 'https://laptitesource.fr' } });
  seedVideo(repo, { slug: 'integre' });
  const e = await request(app).get('/e/integre');
  assert.match(e.headers['content-security-policy'], /frame-ancestors 'self' https:\/\/laptitesource\.fr/);
});

/* --------------------------------------------------------- Création publique */

test('création réservée : visiteur non connecté redirigé vers la connexion', async () => {
  const { app, checkerCalls } = makeApp();
  const res = await request(app).get('/nouveau').query({ lien: DRIVE_URL });
  assert.equal(res.status, 303);
  assert.match(res.headers.location, /^\/admin\/login\?next=%2Fnouveau%3Flien%3D/);
  assert.equal(checkerCalls.length, 0, 'aucune requête vers Google sans autorisation');
});

test('lien mal formé : message et solution, sans requête vers Google', async () => {
  const { app, checkerCalls } = makeApp();
  const { agent } = await login(app);
  const res = await agent.get('/nouveau').query({ lien: 'https://evil.com/file/d/xyz' });
  assert.equal(res.status, 400);
  assert.match(res.text, /ne provient pas de Google Drive/);
  const folder = await agent.get('/nouveau').query({ lien: `https://drive.google.com/drive/folders/${FILE_ID}` });
  assert.match(folder.text, /dossier/);
  assert.equal(checkerCalls.length, 0);
});

test('parcours complet : lien → vérification → création → URL courte + QR', async () => {
  const { app, repo, checkerCalls } = makeApp();
  const { agent } = await login(app);
  const step1 = await agent.get('/nouveau').query({ lien: DRIVE_URL });
  assert.equal(step1.status, 200);
  assert.match(step1.text, /Disponible/);
  assert.match(step1.text, /\/preview"/);
  const csrf = csrfFrom(step1.text);
  const step2 = await agent.post('/nouveau').type('form').send({
    _csrf: csrf, lien: `https://drive.google.com/file/d/${FILE_ID}/view`, title: 'Ma vidéo', description: 'Desc', published: '1',
  });
  assert.equal(step2.status, 303);
  assert.equal(step2.headers.location, '/nouveau/resultat');
  assert.equal(checkerCalls.length, 1, 'la vérification est mise en cache entre les deux étapes');
  const result = await agent.get('/nouveau/resultat');
  assert.equal(result.status, 200);
  const slug = result.text.match(/https:\/\/video\.example\.fr\/v\/([A-Za-z0-9]{6})/)[1];
  assert.match(result.text, /Copier le lien/);
  const v = repo.resolveSlug(slug).video;
  assert.equal(v.title, 'Ma vidéo');
  assert.equal(v.source_id, FILE_ID);
  assert.equal(v.published, 1);
  assert.equal(v.availability, 'available');
  assert.ok(v.last_checked_at);
  assert.equal((await request(app).get(`/v/${slug}`)).status, 200);
});

test('création : titre obligatoire, identifiant déjà pris', async () => {
  const { app, repo } = makeApp();
  seedVideo(repo, { slug: 'pris' });
  const { agent } = await login(app);
  const csrf = csrfFrom((await agent.get('/nouveau').query({ lien: DRIVE_URL })).text);
  const r1 = await agent.post('/nouveau').type('form').send({ _csrf: csrf, lien: DRIVE_URL, title: '  ' });
  assert.equal(r1.status, 422);
  assert.match(r1.text, /Le titre est obligatoire/);
  const r2 = await agent.post('/nouveau').type('form').send({ _csrf: csrf, lien: DRIVE_URL, title: 'X', slug: 'PRIS' });
  assert.equal(r2.status, 422);
  assert.match(r2.text, /déjà utilisé/);
});

test('création d’une vidéo privée : brouillon forcé pour la rédaction, refus en public', async () => {
  const priv = { status: 'private', detail: 'Le fichier est privé.' };
  const a = makeApp({ checkResult: priv });
  const { agent } = await login(a.app);
  const csrf = csrfFrom((await agent.get('/nouveau').query({ lien: DRIVE_URL })).text);
  await agent.post('/nouveau').type('form').send({ _csrf: csrf, lien: DRIVE_URL, title: 'Privée', published: '1' });
  const v = a.repo.list()[0];
  assert.equal(v.published, 0);
  assert.equal(v.availability, 'private');

  const b = makeApp({ checkResult: priv, env: { PUBLIC_SUBMISSIONS: 'true' } });
  const anon = request.agent(b.app);
  const page = await anon.get('/nouveau').query({ lien: DRIVE_URL });
  assert.equal(page.status, 200);
  assert.match(page.text, /Partager → Accès général/);
  assert.equal(csrfFrom(page.text), null, 'pas de formulaire de création');
});

test('contributions publiques activées : création sans compte, champs avancés ignorés', async () => {
  const { app, repo } = makeApp({ env: { PUBLIC_SUBMISSIONS: 'true' } });
  const anon = request.agent(app);
  const page = await anon.get('/nouveau').query({ lien: DRIVE_URL });
  assert.doesNotMatch(page.text, /name="slug"/);
  const res = await anon.post('/nouveau').type('form').send({ _csrf: csrfFrom(page.text), lien: DRIVE_URL, title: 'Élève', slug: 'monslug' });
  assert.equal(res.status, 303);
  const v = repo.list()[0];
  assert.notEqual(v.slug, 'monslug');
  assert.equal(v.published, 1);
});

/* ---------------------------------------------------------- Administration */

test('autorisations : toutes les pages admin exigent une connexion', async () => {
  const { app, repo } = makeApp();
  const v = seedVideo(repo);
  for (const path of ['/admin', `/admin/videos/${v.id}`, `/admin/videos/${v.id}/supprimer`, `/admin/videos/${v.id}/qr.png`, '/admin/compte']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 303, path);
    assert.match(res.headers.location, /^\/admin\/login\?next=/, path);
  }
});

test('autorisations : actions POST refusées sans session (même avec un jeton)', async () => {
  const { app, repo } = makeApp();
  const v = seedVideo(repo);
  const anon = request.agent(app);
  const csrf = csrfFrom((await anon.get('/admin/login')).text);
  for (const path of [`/admin/videos/${v.id}`, `/admin/videos/${v.id}/publication`, `/admin/videos/${v.id}/supprimer`, `/admin/videos/${v.id}/identifiant`, '/admin/verifier-tout']) {
    const res = await anon.post(path).type('form').send({ _csrf: csrf, published: '0', title: 'pirate', slug: 'pirate' });
    assert.equal(res.status, 401, path);
  }
  assert.ok(repo.getById(v.id), 'vidéo non supprimée');
  assert.equal(repo.getById(v.id).title, 'Reportage au CDI');
});

test('CSRF : requête sans jeton valide refusée', async () => {
  const { app, repo } = makeApp();
  const v = seedVideo(repo);
  const { agent } = await login(app);
  const res = await agent.post(`/admin/videos/${v.id}/supprimer`).type('form').send({ _csrf: 'faux' });
  assert.equal(res.status, 403);
  assert.ok(repo.getById(v.id));
  const noToken = await request(app).post('/admin/login').type('form').send({ username: ADMIN.username, password: ADMIN.password });
  assert.equal(noToken.status, 403);
});

test('connexion : mauvais mot de passe refusé, bon mot de passe accepté', async () => {
  const { app } = makeApp();
  const bad = await login(app, { username: ADMIN.username, password: 'mauvais' });
  assert.equal(bad.res.status, 401);
  assert.match(bad.res.text, /incorrect/);
  const unknown = await login(app, { username: 'inconnu', password: 'x' });
  assert.equal(unknown.res.status, 401);
  const ok = await login(app);
  assert.equal(ok.res.status, 303);
  assert.equal((await ok.agent.get('/admin')).status, 200);
});

test('connexion : pas de redirection ouverte', async () => {
  const { app } = makeApp();
  for (const next of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)']) {
    const agent = request.agent(app);
    const csrf = csrfFrom((await agent.get('/admin/login')).text);
    const res = await agent.post('/admin/login').type('form').send({ ...ADMIN, _csrf: csrf, next });
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, '/admin', next);
  }
  const agent = request.agent(app);
  const csrf = csrfFrom((await agent.get('/admin/login')).text);
  const res = await agent.post('/admin/login').type('form').send({ ...ADMIN, _csrf: csrf, next: '/nouveau?lien=abc' });
  assert.equal(res.headers.location, '/nouveau?lien=abc');
});

test('connexion : limitation des tentatives', async () => {
  const { app } = makeApp();
  const agent = request.agent(app);
  const csrf = csrfFrom((await agent.get('/admin/login')).text);
  let last;
  for (let i = 0; i < 11; i++) last = await agent.post('/admin/login').type('form').send({ username: 'x', password: 'y', _csrf: csrf });
  assert.equal(last.status, 429);
});

test('déconnexion : la session est détruite', async () => {
  const { app } = makeApp();
  const { agent } = await login(app);
  const csrf = await adminCsrf(agent);
  await agent.post('/admin/logout').type('form').send({ _csrf: csrf });
  assert.equal((await agent.get('/admin')).status, 303);
});

test('tableau de bord : recherche et filtres', async () => {
  const { app, repo } = makeApp();
  seedVideo(repo, { title: 'Semaine de la presse' });
  seedVideo(repo, { title: 'Cross du collège', published: false, availability: { status: 'not_found' } });
  const { agent } = await login(app);
  const all = await agent.get('/admin');
  assert.match(all.text, /Semaine de la presse/);
  assert.match(all.text, /Cross du collège/);
  const q = await agent.get('/admin').query({ q: 'presse' });
  assert.match(q.text, /Semaine de la presse/);
  assert.doesNotMatch(q.text, /Cross du collège/);
  const draft = await agent.get('/admin').query({ statut: 'draft' });
  assert.doesNotMatch(draft.text, /Semaine de la presse/);
  const prob = await agent.get('/admin').query({ dispo: 'problem' });
  assert.match(prob.text, /Cross du collège/);
  assert.doesNotMatch(prob.text, /Semaine de la presse/);
});

test('édition : titre, description, publication, identifiant, QR', async () => {
  const { app, repo } = makeApp();
  const v = seedVideo(repo, { slug: 'depart' });
  const { agent } = await login(app);
  const csrf = await adminCsrf(agent, `/admin/videos/${v.id}`);

  let r = await agent.post(`/admin/videos/${v.id}`).type('form').send({ _csrf: csrf, title: 'Nouveau titre', description: 'Nouvelle desc', lien: v.source_url });
  assert.equal(r.status, 303);
  assert.equal(repo.getById(v.id).title, 'Nouveau titre');

  r = await agent.post(`/admin/videos/${v.id}/publication`).type('form').send({ _csrf: csrf, published: '0' });
  assert.equal(repo.getById(v.id).published, 0);
  assert.equal((await request(app).get('/v/depart')).status, 404);
  await agent.post(`/admin/videos/${v.id}/publication`).type('form').send({ _csrf: csrf, published: '1' });
  assert.equal((await request(app).get('/v/depart')).status, 200);

  const other = seedVideo(repo, { slug: 'occupe' });
  r = await agent.post(`/admin/videos/${v.id}/identifiant`).type('form').send({ _csrf: csrf, slug: 'occupe' });
  assert.equal(r.status, 422);
  assert.match(r.text, /déjà utilisé/);
  r = await agent.post(`/admin/videos/${v.id}/identifiant`).type('form').send({ _csrf: csrf, slug: 'admin' });
  assert.equal(r.status, 422);
  r = await agent.post(`/admin/videos/${v.id}/identifiant`).type('form').send({ _csrf: csrf, slug: 'arrivee' });
  assert.equal(r.status, 303);
  assert.equal(repo.getById(v.id).slug, 'arrivee');
  assert.ok(other);

  const qr = await agent.get(`/admin/videos/${v.id}/qr.png`).buffer(true).parse((res, cb) => {
    const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c)));
  });
  assert.equal(decodeQrPng(qr.body), 'https://video.example.fr/v/arrivee', 'le QR suit le nouvel identifiant');
});

test('édition : remplacement du lien Drive → nouvelle vérification', async () => {
  const NEW_ID = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa987654';
  const { app, repo, checkerCalls } = makeApp({ checkResult: (id) => (id === NEW_ID ? { status: 'not_video', detail: 'PDF' } : { status: 'available', detail: 'ok' }) });
  const v = seedVideo(repo);
  const { agent } = await login(app);
  const csrf = await adminCsrf(agent, `/admin/videos/${v.id}`);
  const bad = await agent.post(`/admin/videos/${v.id}`).type('form').send({ _csrf: csrf, title: 'T', lien: 'https://exemple.com/x' });
  assert.equal(bad.status, 422);
  await agent.post(`/admin/videos/${v.id}`).type('form').send({ _csrf: csrf, title: 'T', lien: `https://drive.google.com/file/d/${NEW_ID}/view?usp=sharing` });
  const u = repo.getById(v.id);
  assert.equal(u.source_id, NEW_ID);
  assert.equal(u.availability, 'not_video');
  assert.equal(checkerCalls.at(-1).id, NEW_ID);
});

test('vérification manuelle et globale', async () => {
  let status = 'available';
  const { app, repo } = makeApp({ checkResult: () => ({ status, detail: status }) });
  const v = seedVideo(repo);
  seedVideo(repo);
  const { agent } = await login(app);
  const csrf = await adminCsrf(agent);
  status = 'not_found';
  await agent.post(`/admin/videos/${v.id}/verifier`).type('form').send({ _csrf: csrf });
  assert.equal(repo.getById(v.id).availability, 'not_found');
  status = 'quota';
  const r = await agent.post('/admin/verifier-tout').type('form').send({ _csrf: csrf });
  assert.equal(r.status, 303);
  assert.ok(repo.list().every((x) => x.availability === 'quota'));
});

test('suppression : page retirée de l’application, aucun appel à Google Drive', async () => {
  const { app, repo, checkerCalls } = makeApp();
  const v = seedVideo(repo, { slug: 'asupprimer' });
  const { agent } = await login(app);
  const confirm = await agent.get(`/admin/videos/${v.id}/supprimer`);
  assert.match(confirm.text, /ne sera pas supprimé/);
  const before = checkerCalls.length;
  const r = await agent.post(`/admin/videos/${v.id}/supprimer`).type('form').send({ _csrf: csrfFrom(confirm.text) });
  assert.equal(r.status, 303);
  assert.equal(repo.getById(v.id), null);
  assert.equal(checkerCalls.length, before);
  assert.equal((await request(app).get('/v/asupprimer')).status, 404);
});

test('compte : changement de mot de passe et invalidation des autres sessions', async () => {
  const { app } = makeApp();
  const s1 = await login(app);
  const s2 = await login(app);
  const csrf = await adminCsrf(s1.agent, '/admin/compte');
  const r = await s1.agent.post('/admin/compte').type('form').send({ _csrf: csrf, current: ADMIN.password, password: 'nouveau-mdp-123', confirm: 'nouveau-mdp-123' });
  assert.equal(r.status, 303);
  assert.equal((await s1.agent.get('/admin')).status, 200, 'session courante conservée');
  assert.equal((await s2.agent.get('/admin')).status, 303, 'autre session déconnectée');
  const relog = await login(app, { username: ADMIN.username, password: 'nouveau-mdp-123' });
  assert.equal(relog.res.status, 303);
});

test('en-têtes de sécurité', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(res.headers['content-security-policy'], /script-src 'self'/);
  const login = await request(app).get('/admin/login');
  assert.match(login.headers['set-cookie'][0], /HttpOnly/i);
  assert.match(login.headers['set-cookie'][0], /SameSite=Lax/i);
});
