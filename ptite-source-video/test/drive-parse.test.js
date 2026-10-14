'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const drive = require('../src/providers/googleDrive');

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

test('extraction : formats de liens Drive reconnus', () => {
  const ok = [
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/file/d/${ID}/view?usp=drive_link`,
    `https://drive.google.com/file/d/${ID}/view`,
    `https://drive.google.com/file/d/${ID}`,
    `https://drive.google.com/file/d/${ID}/`,
    `https://drive.google.com/file/d/${ID}/preview`,
    `https://drive.google.com/file/d/${ID}/edit?usp=sharing`,
    `https://drive.google.com/file/u/0/d/${ID}/view`,
    `https://drive.google.com/u/1/file/d/${ID}/view`,
    `https://drive.google.com/a/college.fr/file/d/${ID}/view`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?id=${ID}&export=download`,
    `https://drive.google.com/uc?export=download&id=${ID}`,
    `https://drive.usercontent.google.com/download?id=${ID}&export=download`,
    `https://docs.google.com/file/d/${ID}/edit`,
    `http://drive.google.com/file/d/${ID}/view`,
    `drive.google.com/file/d/${ID}/view?usp=sharing`,
    `   https://drive.google.com/file/d/${ID}/view?usp=sharing   `,
    `https://drive.google.com/file/d/${ID}/view#t=10`,
  ];
  for (const url of ok) {
    const r = drive.parse(url);
    assert.equal(r.fileId, ID, url);
    assert.equal(r.sourceUrl, `https://drive.google.com/file/d/${ID}/view`, url);
  }
});

test('extraction : la resourcekey est conservée', () => {
  const r = drive.parse(`https://drive.google.com/file/d/${ID}/view?usp=sharing&resourcekey=0-AbC_d-12`);
  assert.equal(r.resourceKey, '0-AbC_d-12');
  assert.equal(r.sourceUrl, `https://drive.google.com/file/d/${ID}/view?resourcekey=0-AbC_d-12`);
  assert.equal(drive.embedUrl({ source_id: ID, source_key: r.resourceKey }), `https://drive.google.com/file/d/${ID}/preview?resourcekey=0-AbC_d-12`);
});

test('extraction : une resourcekey malformée est ignorée', () => {
  const r = drive.parse(`https://drive.google.com/file/d/${ID}/view?resourcekey=<script>`);
  assert.equal(r.resourceKey, null);
});

function expectCode(url, code) {
  assert.throws(() => drive.parse(url), (e) => {
    assert.ok(e instanceof drive.DriveLinkError, `${url} → ${e}`);
    assert.equal(e.code, code, url);
    assert.ok(e.message && e.hint, 'message et solution fournis');
    return true;
  });
}

test('liens incorrects : vide / non-URL / trop long', () => {
  expectCode('', 'empty');
  expectCode('   ', 'empty');
  expectCode(undefined, 'empty');
  expectCode('bonjour', 'not_url');
  expectCode('https://drive.google.com/file/d/' + 'a'.repeat(3000), 'too_long');
});

test('liens incorrects : protocole et hôte', () => {
  expectCode(`javascript:alert(1)//drive.google.com/file/d/${ID}`, 'bad_protocol');
  expectCode(`ftp://drive.google.com/file/d/${ID}/view`, 'bad_protocol');
  expectCode(`https://evil.com/file/d/${ID}/view`, 'bad_host');
  expectCode(`https://drive.google.com.evil.com/file/d/${ID}/view`, 'bad_host');
  expectCode(`https://evildrive.google.com/file/d/${ID}/view`, 'bad_host');
  expectCode(`https://drive.google.com:8080/file/d/${ID}/view`, 'bad_host');
  expectCode(`https://user:pass@drive.google.com/file/d/${ID}/view`, 'credentials');
  expectCode(`https://www.youtube.com/watch?v=dQw4w9WgXcQ`, 'bad_host');
});

test('liens incorrects : dossiers et documents Google', () => {
  expectCode(`https://drive.google.com/drive/folders/${ID}?usp=sharing`, 'folder');
  expectCode(`https://drive.google.com/drive/u/0/folders/${ID}`, 'folder');
  expectCode(`https://docs.google.com/document/d/${ID}/edit`, 'google_doc');
  expectCode(`https://docs.google.com/spreadsheets/d/${ID}/edit`, 'google_doc');
  expectCode(`https://docs.google.com/presentation/d/${ID}/edit`, 'google_doc');
});

test('liens incorrects : identifiant absent ou altéré', () => {
  expectCode('https://drive.google.com/', 'no_id');
  expectCode('https://drive.google.com/drive/my-drive', 'no_id');
  expectCode('https://drive.google.com/open', 'no_id');
  expectCode('https://drive.google.com/file/d/abc/view', 'bad_id');
  expectCode(`https://drive.google.com/file/d/${ID.slice(0, 10)}%3Cscript%3E/view`, 'bad_id');
  expectCode(`https://drive.google.com/open?id=../../etc/passwd`, 'bad_id');
});

test("URL du lecteur : utilise l'intégration officielle /preview", () => {
  assert.equal(drive.embedUrl({ source_id: ID }), `https://drive.google.com/file/d/${ID}/preview`);
});
