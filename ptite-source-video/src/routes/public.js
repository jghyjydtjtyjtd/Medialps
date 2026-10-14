'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');

const { getProvider, BLOCKING_STATES } = require('../providers');
const { DriveLinkError } = require('../providers/googleDrive');
const { SlugConflictError, SlugInvalidError } = require('../db');
const { qrPng, qrSvg } = require('../lib/qr');
const views = require('../views/public');

const drive = getProvider('gdrive');
const send = (res, page, status = 200) => res.status(status).type('html').send(String(page));

function validateMeta(body) {
  const errors = {};
  const title = String(body.title || '').trim().replace(/\s+/g, ' ');
  const description = String(body.description || '').replace(/\r\n/g, '\n').trim();
  if (!title) errors.title = 'Le titre est obligatoire.';
  else if (title.length > 150) errors.title = '150 caractères maximum.';
  if (description.length > 5000) errors.description = '5 000 caractères maximum.';
  return { title, description, errors };
}

module.exports = function publicRoutes({ config, repo, availability }) {
  const router = express.Router();

  const canCreate = (req) => !!req.user || config.publicSubmissions;

  // Limite le nombre de vérifications Google déclenchées par une même adresse IP.
  const checkLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: (req) => (req.user ? 120 : 20),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => send(res, views.errorPage(req.ctx(), {
      status: 429, title: 'Trop de demandes', message: 'Vous avez vérifié beaucoup de liens en peu de temps.', hint: 'Patientez quelques minutes puis réessayez.',
    }), 429),
  });

  function requireCreator(req, res, next) {
    if (canCreate(req)) return next();
    const nextUrl = req.originalUrl.startsWith('/nouveau') && req.method === 'GET' ? req.originalUrl : '/nouveau';
    return res.redirect(303, `/admin/login?next=${encodeURIComponent(nextUrl)}`);
  }

  /** Vérification avec petit cache de session (évite de solliciter Google deux fois de suite). */
  async function checkWithCache(req, parsed) {
    const c = req.session.lastCheck;
    if (c && c.fileId === parsed.fileId && Date.now() - Date.parse(c.checkedAt) < 10 * 60 * 1000) return c;
    const r = await availability.checkSource('gdrive', parsed.fileId, parsed.resourceKey);
    const slim = { fileId: parsed.fileId, status: r.status, detail: r.detail, mimeType: r.mimeType || null, name: r.name || null, checkedAt: r.checkedAt };
    req.session.lastCheck = slim;
    return slim;
  }

  router.get('/', (req, res) => {
    const value = typeof req.query.lien === 'string' ? req.query.lien.slice(0, 2048) : '';
    send(res, views.homePage(req.ctx(), { value, canCreate: canCreate(req) }));
  });

  // Étape 1 : validation + vérification du lien.
  router.get('/nouveau', requireCreator, checkLimiter, async (req, res) => {
    const lien = typeof req.query.lien === 'string' ? req.query.lien : '';
    if (!lien.trim()) return res.redirect(303, '/');
    let parsed;
    try {
      parsed = drive.parse(lien);
    } catch (e) {
      if (e instanceof DriveLinkError) {
        return send(res, views.homePage(req.ctx(), { value: lien.slice(0, 2048), error: e, canCreate: true }), 400);
      }
      throw e;
    }
    const check = await checkWithCache(req, parsed);
    const suggestedTitle = check.name ? check.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').slice(0, 150) : '';
    send(res, views.newVideoPage(req.ctx({ csrf: true }), {
      parsed, check, isAdmin: !!req.user,
      values: { lien: parsed.sourceUrl, title: suggestedTitle, description: '', slug: '' },
    }));
  });

  // Étape 2 : création de la page.
  router.post('/nouveau', requireCreator, checkLimiter, async (req, res) => {
    const isAdmin = !!req.user;
    let parsed;
    try {
      parsed = drive.parse(String(req.body.lien || ''));
    } catch (e) {
      if (e instanceof DriveLinkError) return send(res, views.homePage(req.ctx(), { value: String(req.body.lien || '').slice(0, 2048), error: e, canCreate: true }), 400);
      throw e;
    }
    const check = await checkWithCache(req, parsed);
    const blocking = BLOCKING_STATES.has(check.status);
    const { title, description, errors } = validateMeta(req.body);
    const slug = isAdmin ? String(req.body.slug || '').trim() : '';
    const values = { lien: parsed.sourceUrl, title, description, slug, published: req.body.published ? '1' : '0' };

    if (blocking && !isAdmin) {
      return send(res, views.newVideoPage(req.ctx({ csrf: true }), { parsed, check, values, errors, isAdmin }), 422);
    }
    const rerender = (status = 422) => send(res, views.newVideoPage(req.ctx({ csrf: true }), { parsed, check, values, errors, isAdmin }), status);
    if (Object.keys(errors).length) return rerender();

    const published = blocking ? false : (isAdmin ? !!req.body.published : config.autoPublish);
    let video;
    try {
      video = repo.createVideo({
        provider: 'gdrive',
        sourceId: parsed.fileId,
        sourceKey: parsed.resourceKey,
        sourceUrl: parsed.sourceUrl,
        title,
        description,
        published,
        availability: check,
        createdBy: req.user ? req.user.id : null,
      }, slug || null);
    } catch (e) {
      if (e instanceof SlugConflictError || e instanceof SlugInvalidError) {
        errors.slug = e.message;
        return rerender();
      }
      throw e;
    }
    delete req.session.lastCheck;
    req.session.justCreated = video.id;
    res.redirect(303, '/nouveau/resultat');
  });

  router.get('/nouveau/resultat', (req, res, next) => {
    const id = req.session && req.session.justCreated;
    const video = id ? repo.getById(id) : null;
    if (!video) return next();
    send(res, views.createdPage(req.ctx(), { video }));
  });

  // Résolution d'un identifiant court : 301 si ancien identifiant, 404 si non publié (sauf rédaction).
  function resolve(req, suffix = '') {
    const r = repo.resolveSlug(req.params.slug);
    if (!r || !r.video) return { notFound: true };
    if (r.isAlias) {
      const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      return { redirect: `/v/${encodeURIComponent(r.video.slug)}${suffix}${qs}` };
    }
    if (!r.video.published && !req.user) return { notFound: true };
    return { video: r.video };
  }

  const notFoundVideo = (req, res) => send(res, views.errorPage(req.ctx(), {
    status: 404,
    title: 'Vidéo introuvable',
    message: "Cette vidéo n'existe pas, a été retirée, ou n'est pas encore publiée.",
    hint: "Vérifiez le lien ou le QR code, ou contactez la rédaction de La P'tite Source.",
  }), 404);

  router.get('/v/:slug', (req, res) => {
    const r = resolve(req);
    if (r.notFound) return notFoundVideo(req, res);
    if (r.redirect) return res.redirect(301, r.redirect);
    const preview = !!req.user;
    res.set('Cache-Control', preview || !r.video.published ? 'private, no-store' : 'public, max-age=60');
    send(res, views.videoPage(req.ctx(), { video: r.video, preview }));
  });

  async function sendQr(req, res, format) {
    const r = resolve(req, `/qr.${format}`);
    if (r.notFound || (r.video && !r.video.published)) return notFoundVideo(req, res);
    if (r.redirect) return res.redirect(301, r.redirect);
    return writeQr(res, views.publicUrl(config, r.video.slug), r.video.slug, format, req.query);
  }

  router.get('/v/:slug/qr.png', (req, res) => sendQr(req, res, 'png'));
  router.get('/v/:slug/qr.svg', (req, res) => sendQr(req, res, 'svg'));

  // Lecteur intégrable dans un article de La P'tite Source.
  router.get('/e/:slug', (req, res) => {
    const r = repo.resolveSlug(req.params.slug);
    if (!r || !r.video || !r.video.published) return res.status(404).type('text/plain').send('Vidéo indisponible.');
    if (r.isAlias) return res.redirect(301, `/e/${encodeURIComponent(r.video.slug)}`);
    res.set('Cache-Control', 'public, max-age=60');
    send(res, views.embedPage(req.ctx(), { video: r.video }));
  });

  return router;
};

async function writeQr(res, url, slug, format, query = {}) {
  const download = query.telecharger === '1';
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  if (download) res.attachment(`qr-ptite-source-${slug}.${format}`);
  if (format === 'png') {
    const buf = await qrPng(url, query.taille);
    return res.type('image/png').send(buf);
  }
  const svg = await qrSvg(url);
  return res.type('image/svg+xml').send(svg);
}

module.exports.writeQr = writeQr;
module.exports.validateMeta = validateMeta;
