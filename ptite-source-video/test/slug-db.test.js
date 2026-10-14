'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomSlug, validateCustomSlug, ALPHABET } = require('../src/lib/slug');
const { openDatabase, createRepository, SlugConflictError, SlugInvalidError } = require('../src/db');
const { FILE_ID } = require('./helpers');

const base = (o = {}) => ({ sourceId: FILE_ID, sourceUrl: `https://drive.google.com/file/d/${FILE_ID}/view`, title: 'T', ...o });

test('identifiant aléatoire : longueur et alphabet sans caractères ambigus', () => {
  for (let i = 0; i < 500; i++) {
    const s = randomSlug(6);
    assert.equal(s.length, 6);
    for (const c of s) assert.ok(ALPHABET.includes(c));
    assert.doesNotMatch(s, /[0O1lI]/);
  }
});

test('identifiants courts uniques sur 2 000 créations', () => {
  const repo = createRepository(openDatabase(':memory:'));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = repo.createVideo(base());
    assert.ok(!seen.has(v.slug.toLowerCase()), 'doublon ' + v.slug);
    seen.add(v.slug.toLowerCase());
  }
});

test('collision forcée : un nouvel identifiant est tiré', () => {
  const repo = createRepository(openDatabase(':memory:'));
  repo.createVideo(base(), 'aaaaaa');
  const seq = ['aaaaaa', 'AAAAAA', 'bbbbbb'];
  const v = repo.createVideo(base({ _slugGenerator: () => seq.shift() }));
  assert.equal(v.slug, 'bbbbbb');
});

test('identifiant personnalisé : validation', () => {
  assert.equal(validateCustomSlug('reportage-cdi'), null);
  assert.equal(validateCustomSlug('aB12xY'), null);
  assert.ok(validateCustomSlug('ab'));
  assert.ok(validateCustomSlug('-abc'));
  assert.ok(validateCustomSlug('abc-'));
  assert.ok(validateCustomSlug('a b c'));
  assert.ok(validateCustomSlug('é-té'));
  assert.ok(validateCustomSlug('../etc'));
  assert.ok(validateCustomSlug('admin'));
  assert.ok(validateCustomSlug('ADMIN'));
  assert.ok(validateCustomSlug('x'.repeat(41)));
});

test('identifiant personnalisé déjà utilisé (insensible à la casse) → refus', () => {
  const repo = createRepository(openDatabase(':memory:'));
  repo.createVideo(base(), 'reportage');
  assert.throws(() => repo.createVideo(base(), 'Reportage'), SlugConflictError);
  assert.throws(() => repo.createVideo(base(), 'a'), SlugInvalidError);
});

test('changement d’identifiant : l’ancien devient un alias, conflits détectés', () => {
  const repo = createRepository(openDatabase(':memory:'));
  const a = repo.createVideo(base(), 'premier');
  const b = repo.createVideo(base(), 'second');
  repo.changeSlug(a.id, 'nouveau-nom');
  assert.equal(repo.resolveSlug('nouveau-nom').video.id, a.id);
  const old = repo.resolveSlug('premier');
  assert.equal(old.video.id, a.id);
  assert.equal(old.isAlias, true);
  // Le slug d'une autre vidéo, ou un alias appartenant à une autre vidéo, est refusé.
  assert.throws(() => repo.changeSlug(b.id, 'nouveau-nom'), SlugConflictError);
  assert.throws(() => repo.changeSlug(b.id, 'premier'), SlugConflictError);
  // Une vidéo peut récupérer son propre ancien identifiant.
  repo.changeSlug(a.id, 'premier');
  assert.equal(repo.resolveSlug('premier').isAlias, false);
  assert.deepEqual(repo.aliasesFor(a.id), ['nouveau-nom']);
  // Une création ne peut pas réutiliser un alias.
  assert.throws(() => repo.createVideo(base(), 'nouveau-nom'), SlugConflictError);
});

test('suppression : la page et ses alias disparaissent', () => {
  const repo = createRepository(openDatabase(':memory:'));
  const a = repo.createVideo(base(), 'abc');
  repo.changeSlug(a.id, 'def');
  assert.equal(repo.deleteVideo(a.id), true);
  assert.equal(repo.resolveSlug('abc'), null);
  assert.equal(repo.resolveSlug('def'), null);
});

test('recherche et filtres', () => {
  const repo = createRepository(openDatabase(':memory:'));
  repo.createVideo(base({ title: 'Semaine de la presse', published: true, availability: { status: 'available' } }));
  repo.createVideo(base({ title: 'Cross du collège', published: false, availability: { status: 'private' } }));
  repo.createVideo(base({ title: '100% sport', description: 'Tournoi', published: true }));
  assert.equal(repo.list({ q: 'presse' }).length, 1);
  assert.equal(repo.list({ q: 'tournoi' }).length, 1);
  assert.equal(repo.list({ q: '%' }).length, 1, 'le % est échappé');
  assert.equal(repo.list({ status: 'draft' }).length, 1);
  assert.equal(repo.list({ status: 'published' }).length, 2);
  assert.equal(repo.list({ availability: 'problem' }).length, 1);
  assert.equal(repo.list({ availability: 'unknown' }).length, 1);
  assert.deepEqual(repo.stats(), { total: 3, published: 2, broken: 1 });
});

test('persistance : les données survivent à la réouverture de la base', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pts-'));
  const file = path.join(dir, 'sub', 'videos.db');
  let db = openDatabase(file);
  const v = createRepository(db).createVideo(base(), 'persiste');
  db.close();
  db = openDatabase(file);
  const again = createRepository(db).resolveSlug('persiste');
  assert.equal(again.video.id, v.id);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
