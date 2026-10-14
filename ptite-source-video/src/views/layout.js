'use strict';

const { html, raw } = require('../lib/html');
const { availabilityInfo } = require('../providers');

const ASSET_VERSION = '1.0.0';

const logoMark = raw(`<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
  <defs><linearGradient id="lg-drop" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#00FF87"/><stop offset="1" stop-color="#087443"/></linearGradient></defs>
  <path d="M20 3c6.5 8.2 13 15.2 13 22.4A13 13 0 0 1 7 25.4C7 18.2 13.5 11.2 20 3z" fill="url(#lg-drop)"/>
  <path d="M17 20.5v10l8.5-5z" fill="#050807"/>
</svg>`);

/**
 * Gabarit de page commun.
 * @param {object} o { title, body, user, csrf, config, description, ogImage, canonical, bodyClass, noindex }
 */
function layout(o) {
  const { config } = o;
  const pageTitle = o.title ? `${o.title} · ${config.siteName}` : config.siteName;
  return html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${pageTitle}</title>
<meta name="description" content="${o.description || "Les vidéos du webjournal La P'tite Source."}">
<meta name="theme-color" content="#050807">
${o.noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
${o.canonical ? html`<link rel="canonical" href="${o.canonical}">` : ''}
<meta property="og:site_name" content="${config.siteName}">
<meta property="og:title" content="${o.title || config.siteName}">
${o.description ? html`<meta property="og:description" content="${o.description}">` : ''}
${o.canonical ? html`<meta property="og:url" content="${o.canonical}">` : ''}
${o.ogType ? html`<meta property="og:type" content="${o.ogType}">` : ''}
${o.ogImage ? html`<meta property="og:image" content="${o.ogImage}">` : ''}
<link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/css/style.css?v=${ASSET_VERSION}">
<script src="/static/js/app.js?v=${ASSET_VERSION}" defer></script>
</head>
<body class="${o.bodyClass || ''}">
<a class="skip-link" href="#contenu">Aller au contenu</a>
<div class="bg-glow" aria-hidden="true"></div>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="Accueil ${config.siteName}">
      ${logoMark}
      <span class="brand-text"><span class="brand-name">La P'tite Source</span><span class="brand-sub">Vidéo</span></span>
    </a>
    <nav class="main-nav" aria-label="Navigation principale">
      ${o.user
        ? html`<a href="/admin" class="nav-link">Tableau de bord</a>
               <a href="/admin/compte" class="nav-link nav-hide-sm">Mon compte</a>
               <a href="/#lien" class="nav-link nav-cta">+ Ajouter</a>
               <form method="post" action="/admin/logout" class="inline-form">
                 <input type="hidden" name="_csrf" value="${o.csrf}">
                 <button class="nav-link nav-button" type="submit">Déconnexion</button>
               </form>`
        : html`<a href="/admin/login" class="nav-link">Espace rédaction</a>`}
    </nav>
  </div>
</header>
<main id="contenu" class="site-main">
${o.flash ? flashBox(o.flash) : ''}
${o.body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <p>${logoMark} <strong>La P'tite Source</strong> — le webjournal du collège.</p>
    <p class="muted small">Les vidéos sont hébergées sur Google Drive et restent la propriété de leurs auteurs.</p>
  </div>
</footer>
</body>
</html>`;
}

function flashBox(flash) {
  return html`<div class="wrap"><div class="flash flash-${flash.type || 'info'} reveal" role="status">${flash.message}</div></div>`;
}

function statusBadge(status) {
  const info = availabilityInfo(status);
  return html`<span class="badge badge-${info.tone}" title="${info.help}"><span class="dot"></span>${info.label}</span>`;
}

function copyField(value, label = 'Copier le lien', id = '') {
  return html`<div class="copy-field">
    <input type="text" readonly value="${value}" aria-label="Lien" ${id ? html`id="${id}"` : ''} data-copy-source>
    <button type="button" class="btn btn-primary" data-copy="${value}" data-copied-label="Lien copié ✓">${label}</button>
  </div>`;
}

function icon(name) {
  const paths = {
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    external: '<path d="M14 4h6v6M20 4 10 14M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
  };
  return raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`);
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' });
}

module.exports = { layout, statusBadge, copyField, icon, formatDate, logoMark, ASSET_VERSION };
