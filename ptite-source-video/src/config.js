'use strict';

const path = require('path');
const crypto = require('crypto');

/**
 * Configuration centralisée, lue uniquement côté serveur (variables d'environnement).
 * Aucun secret n'est jamais transmis au navigateur.
 */
function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides.env };
  const isProd = env.NODE_ENV === 'production';

  let sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    if (isProd) {
      throw new Error('SESSION_SECRET est obligatoire en production (chaîne aléatoire de 32 caractères ou plus).');
    }
    // En développement : secret éphémère (les sessions sont perdues au redémarrage).
    sessionSecret = crypto.randomBytes(32).toString('hex');
  }

  let baseUrl = (env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    if (isProd) throw new Error('PUBLIC_BASE_URL est obligatoire en production (ex. https://video.laptitesource.fr).');
    baseUrl = `http://localhost:${env.PORT || 3000}`;
  }
  try {
    const u = new URL(baseUrl);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
  } catch {
    throw new Error(`PUBLIC_BASE_URL invalide : ${baseUrl}`);
  }

  const embedOrigins = (env.EMBED_ALLOWED_ORIGINS || '*')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    isProd,
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    baseUrl,
    dbPath: env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'videos.db'),
    sessionSecret,
    sessionMaxAgeHours: Number(env.SESSION_MAX_AGE_HOURS) || 12,
    // Clé API Google (facultative) : permet une vérification fiable du type MIME.
    googleApiKey: env.GOOGLE_API_KEY || '',
    // Autoriser les visiteurs non connectés à créer des pages (désactivé par défaut).
    publicSubmissions: env.PUBLIC_SUBMISSIONS === 'true',
    // Publication immédiate des pages créées depuis l'accueil.
    autoPublish: env.AUTO_PUBLISH !== 'false',
    checkIntervalHours: env.CHECK_INTERVAL_HOURS === undefined ? 24 : Number(env.CHECK_INTERVAL_HOURS),
    trustProxy: env.TRUST_PROXY === undefined ? (isProd ? 1 : false) : parseTrustProxy(env.TRUST_PROXY),
    embedAllowedOrigins: embedOrigins,
    bootstrapAdmin: {
      username: env.ADMIN_USERNAME || '',
      password: env.ADMIN_PASSWORD || '',
    },
    siteName: env.SITE_NAME || "La P'tite Source Vidéo",
    ...overrides.values,
  };
}

function parseTrustProxy(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}

module.exports = { loadConfig };
