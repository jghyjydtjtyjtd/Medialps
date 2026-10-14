'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');

const { getProvider, AVAILABILITY } = require('../providers');
const { DriveLinkError } = require('../providers/googleDrive');
const { SlugConflictError, SlugInvalidError } = require('../db');
const { verifyPassword, hashPassword, validatePasswordStrength, safeNextPath, ensureCsrfToken, passwordVersion } = require('../lib/security');
const views = require('../views/admin');
const { errorPage, publicUrl } = require('../views/public');
const { writeQr, validateMeta } = require('./public');

const drive = getProvider('gdrive');
const send = (res, page, status = 200) => res.status(status).type('html').send(String(page));

module.exports = function adminRoutes({ config, repo, availability, logger }) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => send(res, views.loginPage(req.ctx({ csrf: true }), {
      error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
      next: safeNextPath(req.body && req.body.next, ''),
    }), 429),
  });

  /* ---------------- Authentification ---------------- */

  router.get('/login', (req, res) => {
    const next = safeNextPath(req.query.next, '/admin');
    if (req.user) return res.redirect(303, next);
    send(res, views.loginPage(req.ctx({ csrf: true }), { next }));
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const username = String(req.body.username || '').trim().slice(0, 100);
    const password = String(req.body.password || '').slice(0, 200);
    const next = safeNextPath(req.body.next, '/admin');
    const user = username ? repo.getUserByName(username) : null;
    const ok = await verifyPassword(password, user && user.password_hash);
    if (!user || !ok) {
      // Échec : statut 401 pour que le limiteur le comptabilise.
      return send(res, views.loginPage(req.ctx({ csrf: true }), { error: 'Identifiant ou mot de passe incorrect.', username, next }), 401);
    }
    repo.touchLogin(user.id);
    // Nouvelle session (nouveau jeton CSRF) : protège contre la fixation de session.
    req.session = { uid: user.id, pv: passwordVersion(user.password_hash) };
    ensureCsrfToken(req);
    res.redirect(303, next);
  });

  router.post('/logout', (req, res) => {
    req.session = null;
    res.redirect(303, '/');
  });

  // Tout ce qui suit exige une connexion.
  router.use((req, res, next) => {
    if (req.user) return next();
    if (req.method === 'GET') return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    return res.status(401).type('text/plain').send('Authentification requise.');
  });

  const loadVideo = (req, res, next) => {
    const id = Number(req.params.id);
    const video = Number.isInteger(id) && id > 0 ? repo.getById(id) : null;
    if (!video) {
      return send(res, errorPage(req.ctx(), { status: 404, title: 'Vidéo introuvable', message: 'Cette page vidéo n’existe pas ou a été supprimée.' }), 404);
    }
    req.video = video;
    next();
  };

  const editValues = (v) => ({ title: v.title, description: v.description, lien: v.source_url, slug: v.slug });

  /* ---------------- Tableau de bord ---------------- */

  router.get('/', (req, res) => {
    const pick = (v, allowed, def) => (typeof v === 'string' && allowed.includes(v) ? v : def);
    const filters = {
      q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '',
      status: pick(req.query.statut, ['all', 'published', 'draft'], 'all'),
      availability: pick(req.query.dispo, ['all', 'problem', ...Object.keys(AVAILABILITY)], 'all'),
    };
    const videos = repo.list({ q: filters.q, status: filters.status, availability: filters.availability });
    send(res, views.dashboardPage(req.ctx(), { videos, stats: repo.stats(), filters }));
  });

  router.get('/videos/nouvelle', (req, res) => res.redirect(303, '/nouveau'));

  router.post('/verifier-tout', async (req, res) => {
    const list = repo.list({ limit: 100 });
    let n = 0;
    for (const v of list) {
      await availability.checkVideo(v).catch((e) => logger.warn('[vérification]', v.slug, e.message));
      n++;
      if (n < list.length) await new Promise((r) => setTimeout(r, config.bulkCheckDelayMs ?? 400));
    }
    req.flash('success', `${n} vidéo(s) vérifiée(s).`);
    res.redirect(303, '/admin');
  });

  /* ---------------- Gestion d'une vidéo ---------------- */

  router.get('/videos/:id', loadVideo, (req, res) => {
    send(res, views.editPage(req.ctx(), { video: req.video, aliases: repo.aliasesFor(req.video.id), values: editValues(req.video) }));
  });

  router.post('/videos/:id', loadVideo, async (req, res) => {
    const video = req.video;
    const { title, description, errors } = validateMeta(req.body);
    const lien = String(req.body.lien || '').trim();
    const update = { title, description };
    let parsed = null;
    if (lien && lien !== video.source_url) {
      try {
        parsed = drive.parse(lien);
      } catch (e) {
        if (!(e instanceof DriveLinkError)) throw e;
        errors.lien = `${e.message} ${e.hint || ''}`.trim();
      }
    }
    if (Object.keys(errors).length) {
      return send(res, views.editPage(req.ctx(), {
        video, aliases: repo.aliasesFor(video.id), errors,
        values: { ...editValues(video), title, description, lien },
      }), 422);
    }
    if (parsed && (parsed.fileId !== video.source_id || parsed.resourceKey !== video.source_key)) {
      Object.assign(update, {
        source_id: parsed.fileId, source_key: parsed.resourceKey, source_url: parsed.sourceUrl,
        availability: 'unknown', availability_detail: null, mime_type: null, last_checked_at: null,
      });
    }
    const updated = repo.updateVideo(video.id, update);
    if (update.source_id) {
      const { result } = await availability.checkVideo(updated);
      req.flash(result.status === 'available' ? 'success' : 'warning', `Lien Drive remplacé. ${result.detail}`);
    } else {
      req.flash('success', 'Modifications enregistrées.');
    }
    res.redirect(303, `/admin/videos/${video.id}`);
  });

  router.post('/videos/:id/identifiant', loadVideo, (req, res) => {
    const slug = String(req.body.slug || '').trim();
    try {
      repo.changeSlug(req.video.id, slug);
    } catch (e) {
      if (e instanceof SlugConflictError || e instanceof SlugInvalidError) {
        return send(res, views.editPage(req.ctx(), {
          video: req.video, aliases: repo.aliasesFor(req.video.id),
          values: { ...editValues(req.video), slug }, errors: { slug: e.message },
        }), 422);
      }
      throw e;
    }
    req.flash('success', `Identifiant court mis à jour : ${publicUrl(config, slug)} — le QR code a été régénéré.`);
    res.redirect(303, `/admin/videos/${req.video.id}`);
  });

  router.post('/videos/:id/publication', loadVideo, (req, res) => {
    const published = req.body.published === '1';
    repo.updateVideo(req.video.id, { published });
    req.flash(published ? 'success' : 'info', published ? 'Page publiée : elle est visible avec son lien.' : 'Page dépubliée : le lien affiche désormais « vidéo introuvable ».');
    res.redirect(303, `/admin/videos/${req.video.id}`);
  });

  router.post('/videos/:id/verifier', loadVideo, async (req, res) => {
    const { result } = await availability.checkVideo(req.video);
    req.flash(result.status === 'available' ? 'success' : 'warning', result.detail);
    res.redirect(303, `/admin/videos/${req.video.id}`);
  });

  router.get('/videos/:id/supprimer', loadVideo, (req, res) => {
    send(res, views.deleteConfirmPage(req.ctx(), { video: req.video }));
  });

  // Supprime la page de l'application uniquement : aucun appel n'est fait à Google Drive.
  router.post('/videos/:id/supprimer', loadVideo, (req, res) => {
    repo.deleteVideo(req.video.id);
    req.flash('info', `La page « ${req.video.title} » a été supprimée. Le fichier Google Drive est intact.`);
    res.redirect(303, '/admin');
  });

  router.get('/videos/:id/qr.png', loadVideo, (req, res) => writeQr(res, publicUrl(config, req.video.slug), req.video.slug, 'png', req.query));
  router.get('/videos/:id/qr.svg', loadVideo, (req, res) => writeQr(res, publicUrl(config, req.video.slug), req.video.slug, 'svg', req.query));

  /* ---------------- Compte ---------------- */

  router.get('/compte', (req, res) => send(res, views.accountPage(req.ctx(), {})));

  router.post('/compte', async (req, res) => {
    const user = repo.getUserById(req.user.id);
    const errors = {};
    if (!(await verifyPassword(req.body.current, user.password_hash))) errors.current = 'Mot de passe actuel incorrect.';
    const strength = validatePasswordStrength(req.body.password);
    if (strength) errors.password = strength;
    else if (req.body.password !== req.body.confirm) errors.confirm = 'Les deux mots de passe ne correspondent pas.';
    if (Object.keys(errors).length) return send(res, views.accountPage(req.ctx(), { errors }), 422);
    const hash = await hashPassword(req.body.password);
    repo.setUserPassword(user.id, hash);
    req.session.pv = passwordVersion(hash); // les autres sessions sont invalidées
    req.flash('success', 'Mot de passe mis à jour.');
    res.redirect(303, '/admin');
  });

  return router;
};
