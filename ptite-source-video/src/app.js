'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');

const { ensureCsrfToken, csrfProtection, passwordVersion } = require('./lib/security');
const { errorPage } = require('./views/public');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

/**
 * Fabrique de l'application (injectable pour les tests).
 * @param {{ config, repo, availability }} deps
 */
function createApp({ config, repo, availability, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const frameAncestorsEmbed = config.embedAllowedOrigins.includes('*')
    ? ['*']
    : ["'self'", ...config.embedAllowedOrigins];

  // Seule la page /e/:slug (lecteur intégrable) peut être affichée dans une iframe d'un autre site.
  app.use((req, res, next) => {
    res.locals.allowEmbed = /^\/e\/[^/]+\/?$/.test(req.path);
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"], // uniquement les délais d'animation (style="--d:…")
        imgSrc: ["'self'", 'data:', 'https://drive.google.com', 'https://*.googleusercontent.com'],
        frameSrc: ['https://drive.google.com', 'https://docs.google.com'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: [(req, res) => (res.locals.allowEmbed ? frameAncestorsEmbed.join(' ') : "'none'")],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    frameguard: false, // remplacé par frame-ancestors (permet l'intégration de /e/:slug)
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: config.isProd ? { maxAge: 15552000 } : false,
  }));

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), {
    maxAge: config.isProd ? '7d' : 0,
    fallthrough: true,
    index: false,
  }));

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /nouveau\nDisallow: /e/\n');
  });
  app.get('/healthz', (req, res) => {
    try {
      repo.db.prepare('SELECT 1').get();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use(express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 50 }));

  app.use(cookieSession({
    name: 'pts_sess',
    keys: [config.sessionSecret],
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.sessionMaxAgeHours * 3600 * 1000,
  }));

  // Chargement de l'utilisateur connecté (session invalidée si le mot de passe a changé).
  app.use((req, res, next) => {
    req.user = null;
    const uid = req.session && req.session.uid;
    if (uid) {
      const u = repo.getUserById(uid);
      if (u && req.session.pv === passwordVersion(u.password_hash)) {
        req.user = { id: u.id, username: u.username };
      } else {
        req.session = null;
      }
    }
    next();
  });

  // Contexte commun des vues.
  app.use((req, res, next) => {
    req.ctx = (opts = {}) => {
      const needCsrf = req.user || opts.csrf;
      const flash = req.session && req.session.flash;
      if (flash && req.session) delete req.session.flash;
      return { config, user: req.user, csrf: needCsrf ? ensureCsrfToken(req) : '', flash };
    };
    req.flash = (type, message) => { req.session.flash = { type, message }; };
    next();
  });

  app.use(csrfProtection(config));

  const deps = { config, repo, availability, logger };
  app.use(publicRoutes(deps));
  app.use('/admin', adminRoutes(deps));

  app.use((req, res) => {
    res.status(404).send(String(errorPage(req.ctx(), {
      status: 404,
      title: 'Page introuvable',
      message: "Cette page n'existe pas ou n'est plus disponible.",
      hint: 'Vérifiez le lien, ou demandez-en un nouveau à la rédaction de La P\'tite Source.',
    })));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).send('Requête trop volumineuse.');
    }
    logger.error('[erreur]', err);
    const ctx = req.ctx ? req.ctx() : { config, user: null, csrf: '' };
    res.status(500).send(String(errorPage(ctx, {
      status: 500,
      title: 'Une erreur est survenue',
      message: 'Le serveur a rencontré un problème inattendu.',
      hint: 'Réessayez dans quelques instants.',
    })));
  });

  return app;
}

module.exports = { createApp };
