'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

async function hashPassword(pw) {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}

// Hachage factice pour garder un temps de réponse constant quand l'utilisateur n'existe pas.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

async function verifyPassword(pw, hash) {
  return bcrypt.compare(String(pw || ''), hash || DUMMY_HASH);
}

function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (pw.length > 200) return 'Mot de passe trop long.';
  return null;
}

function ensureCsrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}

function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Vérifie le jeton CSRF des requêtes modifiant l'état (et l'en-tête Origin s'il est présent). */
function csrfProtection(config) {
  const expectedOrigin = new URL(config.baseUrl).origin;
  return function verifyCsrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && origin !== 'null' && origin !== expectedOrigin && config.isProd) {
      return res.status(403).send(errorText('Origine de la requête refusée.'));
    }
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (!tokensEqual(sent, req.session && req.session.csrf)) {
      return res.status(403).send(errorText('Jeton de sécurité invalide ou expiré. Rechargez la page et recommencez.'));
    }
    return next();
  };
}

function errorText(msg) {
  return `<!doctype html><meta charset="utf-8"><title>Erreur</title><body style="font-family:system-ui;background:#050807;color:#F0F7F2;padding:2rem"><p>${msg}</p><p><a style="color:#19C878" href="javascript:history.back()">Retour</a></p></body>`;
}

/**
 * Valide une destination de redirection après connexion : chemin interne uniquement
 * (bloque « //evil.com », « /\\evil.com », « https://… » : protection contre les redirections ouvertes).
 */
function safeNextPath(next, fallback = '/admin') {
  if (typeof next !== 'string' || !next) return fallback;
  if (next.length > 2048) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/[\r\n\t\0]/.test(next)) return fallback;
  try {
    const u = new URL(next, 'http://internal.invalid');
    if (u.host !== 'internal.invalid') return fallback;
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}

/** Empreinte courte du hachage : change quand le mot de passe change (invalide les sessions). */
function passwordVersion(hash) {
  return crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 16);
}

module.exports = {
  passwordVersion,
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  ensureCsrfToken,
  csrfProtection,
  safeNextPath,
  tokensEqual,
};
