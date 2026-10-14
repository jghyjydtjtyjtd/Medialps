'use strict';

const { html, raw, richText } = require('../lib/html');
const { availabilityInfo, BLOCKING_STATES, getProvider } = require('../providers');
const { layout, statusBadge, copyField, icon, formatDate } = require('./layout');

const publicUrl = (config, slug) => `${config.baseUrl}/v/${encodeURIComponent(slug)}`;
const embedPageUrl = (config, slug) => `${config.baseUrl}/e/${encodeURIComponent(slug)}`;

function embedSnippet(config, video) {
  return `<iframe src="${embedPageUrl(config, video.slug)}" title="${video.title.replace(/"/g, '&quot;')}" ` +
    `width="640" height="360" style="aspect-ratio:16/9;width:100%;height:auto;border:0;border-radius:12px" ` +
    `allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
}

/* ------------------------------------------------------------------ */
/* Lecteur                                                             */
/* ------------------------------------------------------------------ */

function player(video, { compact = false } = {}) {
  const provider = getProvider(video.provider);
  return html`<div class="player-shell ${compact ? 'player-compact' : ''}">
    <div class="player-frame" data-player>
      <div class="player-loading" aria-hidden="true"><span class="spinner"></span><span>Chargement du lecteur…</span></div>
      <iframe src="${provider.embedUrl(video)}" title="Lecteur vidéo : ${video.title}"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin" data-player-iframe></iframe>
    </div>
  </div>`;
}

function playerHelp(video) {
  const provider = getProvider(video.provider);
  return html`<details class="player-help">
    <summary>La vidéo ne se lance pas ?</summary>
    <ul>
      <li><strong>« Lecture impossible / traitement en cours »</strong> : Google Drive prépare encore la vidéo après son dépôt. Patientez quelques minutes (parfois plus pour les longues vidéos) puis rechargez la page.</li>
      <li><strong>« Vous avez besoin d’une autorisation » ou écran de connexion</strong> : le fichier n’est pas partagé publiquement. La rédaction doit choisir « Tous les utilisateurs disposant du lien » dans le partage Drive.</li>
      <li><strong>Réseau du collège</strong> : certains réseaux filtrent Google Drive. Essayez depuis un autre réseau.</li>
      <li><strong>Trop de vues</strong> : Google peut limiter temporairement les fichiers très consultés. Réessayez plus tard.</li>
    </ul>
    <p><a class="link" href="${provider.openUrl(video)}" target="_blank" rel="noopener noreferrer">${icon('external')} Ouvrir directement dans Google Drive</a></p>
  </details>`;
}

function blockedPanel(video, { forAdmin = false } = {}) {
  const info = availabilityInfo(video.availability);
  const titles = {
    private: 'Cette vidéo n’est pas accessible publiquement',
    not_found: 'Cette vidéo est introuvable',
    not_video: 'Ce fichier n’est pas une vidéo',
  };
  return html`<div class="player-shell">
    <div class="player-frame player-blocked" role="alert">
      <div class="blocked-inner">
        <div class="blocked-icon">!</div>
        <h2>${titles[video.availability] || 'Lecture impossible'}</h2>
        <p>${forAdmin ? info.help : publicHelp(video.availability)}</p>
        ${forAdmin && video.availability_detail ? html`<p class="muted small">Détail : ${video.availability_detail}</p>` : ''}
      </div>
    </div>
  </div>`;
}

function publicHelp(status) {
  switch (status) {
    case 'private': return "Son propriétaire ne l'a pas encore partagée. Revenez un peu plus tard ou prévenez la rédaction de La P'tite Source.";
    case 'not_found': return "Elle a peut-être été retirée. Prévenez la rédaction de La P'tite Source si le problème persiste.";
    case 'not_video': return "Le lien enregistré ne correspond pas à une vidéo. Prévenez la rédaction de La P'tite Source.";
    default: return 'Réessayez plus tard.';
  }
}

function shareTools(config, video, { showEmbed = true, qrBase } = {}) {
  const url = publicUrl(config, video.slug);
  const qr = qrBase || `/v/${encodeURIComponent(video.slug)}`;
  return html`<div class="share-tools">
    <div class="action-row">
      <button type="button" class="btn btn-primary" data-share data-share-url="${url}" data-share-title="${video.title}">${icon('share')} Partager</button>
      <button type="button" class="btn btn-ghost" data-toggle="#qr-panel" aria-expanded="false" aria-controls="qr-panel">${icon('qr')} QR code</button>
      ${showEmbed ? html`<button type="button" class="btn btn-ghost" data-toggle="#embed-panel" aria-expanded="false" aria-controls="embed-panel">${icon('code')} Intégrer</button>` : ''}
    </div>
    <div class="share-url">${copyField(url)}</div>
    <div id="qr-panel" class="panel qr-panel" hidden>
      <img src="${qr}/qr.svg" alt="QR code menant à ${url}" width="220" height="220" class="qr-img">
      <div>
        <p>Scannez ce code avec un téléphone pour ouvrir la vidéo.</p>
        <div class="action-row">
          <a class="btn btn-ghost btn-sm" href="${qr}/qr.png?taille=1024&telecharger=1">${icon('download')} PNG (impression)</a>
          <a class="btn btn-ghost btn-sm" href="${qr}/qr.svg?telecharger=1">${icon('download')} SVG (vectoriel)</a>
        </div>
      </div>
    </div>
    ${showEmbed ? html`<div id="embed-panel" class="panel" hidden>
      <p>Code à coller dans un article de La P'tite Source (bloc HTML) :</p>
      <textarea readonly rows="4" class="code" data-select-on-focus>${embedSnippet(config, video)}</textarea>
      <button type="button" class="btn btn-ghost btn-sm" data-copy="${embedSnippet(config, video)}" data-copied-label="Code copié ✓">${icon('copy')} Copier le code</button>
    </div>` : ''}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

function homePage(ctx, { value = '', error = null, canCreate = false } = {}) {
  const body = html`
  <section class="hero">
    <div class="wrap hero-inner">
      <p class="eyebrow reveal">Webjournal du collège</p>
      <h1 class="hero-title reveal" style="--d:80ms">Vos vidéos Drive,<br><span class="grad-text">prêtes à partager.</span></h1>
      <p class="hero-lead reveal" style="--d:160ms">Collez le lien de partage d’une vidéo Google Drive : nous créons une vraie page vidéo avec un lien court et un QR code pour La P'tite Source.</p>

      <form class="transform-form reveal ${error ? 'has-error' : ''}" style="--d:240ms" method="get" action="/nouveau" data-loading-form novalidate>
        <label for="lien" class="sr-only">Lien de partage Google Drive</label>
        <div class="input-glow">
          <svg class="input-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
          <input id="lien" name="lien" type="url" inputmode="url" autocomplete="off" spellcheck="false" required
            placeholder="https://drive.google.com/file/d/…/view?usp=sharing" value="${value}"
            aria-describedby="lien-aide${error ? ' lien-erreur' : ''}" ${error ? raw('aria-invalid="true"') : ''}>
          <button class="btn btn-primary btn-lg" type="submit" data-loading-label="Vérification…">Transformer mon lien</button>
        </div>
        ${error ? html`<div id="lien-erreur" class="form-error" role="alert"><strong>${error.message}</strong>${error.hint ? html`<span>${error.hint}</span>` : ''}</div>` : ''}
        <p id="lien-aide" class="input-hint">${canCreate
          ? 'Le fichier doit être partagé en « Tous les utilisateurs disposant du lien ».'
          : html`La création de pages est réservée à la rédaction : vous serez invité·e à vous <a class="link" href="/admin/login">connecter</a>.`}</p>
      </form>
    </div>
  </section>

  <section class="wrap steps">
    ${[
      ['1', 'Partagez sur Drive', 'Clic droit sur la vidéo → Partager → « Tous les utilisateurs disposant du lien ».'],
      ['2', 'Collez le lien', 'Nous vérifions que le fichier est accessible et qu’il s’agit bien d’une vidéo.'],
      ['3', 'Diffusez', 'Copiez le lien court, téléchargez le QR code ou intégrez le lecteur dans un article.'],
    ].map(([n, t, d], i) => html`<article class="card step-card reveal" style="--d:${320 + i * 80}ms">
      <span class="step-num">${n}</span><h2>${t}</h2><p>${d}</p></article>`)}
  </section>

  <section class="wrap honest reveal" style="--d:560ms">
    <h2>Bon à savoir</h2>
    <p>Les vidéos restent stockées sur <strong>Google Drive</strong> et sont lues avec le lecteur officiel de Google. Créer une page ne rend <strong>jamais</strong> un fichier public : c’est à son propriétaire de le partager. Juste après un dépôt, Drive peut avoir besoin de quelques minutes pour préparer la vidéo, et il peut limiter les fichiers très consultés.</p>
  </section>`;
  return layout({ ...ctx, title: null, body, bodyClass: 'page-home' });
}

/** Étape 2 : résultat de la vérification + formulaire titre/description. */
function newVideoPage(ctx, { parsed, check, values = {}, errors = {}, isAdmin }) {
  const info = availabilityInfo(check.status);
  const blocking = BLOCKING_STATES.has(check.status);
  const fakeVideo = { provider: 'gdrive', source_id: parsed.fileId, source_key: parsed.resourceKey, title: values.title || 'Aperçu', availability: check.status };
  const canCreate = !blocking || isAdmin;

  const body = html`<div class="wrap narrow">
    <a href="/?lien=${encodeURIComponent(values.lien || '')}" class="back-link">← Changer de lien</a>
    <h1 class="page-title reveal">Créer la page vidéo</h1>

    <div class="check-result check-${info.tone} reveal" style="--d:60ms" role="status">
      <div class="check-head">${statusBadge(check.status)}<span class="muted small mono">Fichier ${parsed.fileId.slice(0, 10)}…</span></div>
      <p>${check.detail}</p>
      ${check.status !== 'available' ? html`<p class="check-help"><strong>Que faire ?</strong> ${info.help}</p>` : ''}
    </div>

    ${blocking ? blockedPanel(fakeVideo, { forAdmin: true }) : html`
      <section class="reveal" style="--d:120ms">
        <h2 class="section-title">Aperçu du lecteur</h2>
        ${player(fakeVideo, { compact: true })}
        <p class="muted small">Si l’aperçu affiche une erreur Google, la page publique affichera la même chose : corrigez le partage dans Drive avant de diffuser le lien.</p>
      </section>`}

    ${canCreate ? html`<form method="post" action="/nouveau" class="card form-card reveal" style="--d:180ms" data-loading-form>
      <input type="hidden" name="_csrf" value="${ctx.csrf}">
      <input type="hidden" name="lien" value="${values.lien}">
      ${blocking ? html`<p class="form-warning">Cette vidéo n’est pas lisible pour l’instant : la page sera créée en <strong>brouillon</strong>. Publiez-la une fois le problème corrigé dans Drive.</p>` : ''}
      ${field('title', 'Titre', values.title, errors.title, { required: true, maxlength: 150, placeholder: 'Ex. : Reportage au CDI — la semaine de la presse' })}
      ${textarea('description', 'Description', values.description, errors.description, { maxlength: 5000, placeholder: 'Quelques lignes pour présenter la vidéo (facultatif).' })}
      ${isAdmin ? html`
        ${field('slug', 'Identifiant court (facultatif)', values.slug, errors.slug, { maxlength: 40, placeholder: 'Laisser vide pour un identifiant aléatoire', prefix: `${ctx.config.baseUrl.replace(/^https?:\/\//, '')}/v/`, help: '3 à 40 caractères : lettres, chiffres, - et _.' })}
        ${blocking ? '' : html`<label class="switch"><input type="checkbox" name="published" value="1" ${values.published !== '0' ? raw('checked') : ''}><span class="switch-ui"></span><span>Publier immédiatement</span></label>`}
      ` : ''}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-lg" data-loading-label="Création…">Créer la page vidéo</button>
      </div>
    </form>` : html`<div class="card"><p>Cette vidéo ne peut pas être transformée pour l’instant. Corrigez le problème dans Google Drive puis <a class="link" href="/nouveau?lien=${encodeURIComponent(values.lien || '')}">relancez la vérification</a>.</p></div>`}
  </div>`;
  return layout({ ...ctx, title: 'Créer la page vidéo', body, noindex: true });
}

function createdPage(ctx, { video }) {
  const url = publicUrl(ctx.config, video.slug);
  const body = html`<div class="wrap narrow">
    <div class="success-hero reveal">
      <div class="success-check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>
      <h1 class="page-title">Votre page vidéo est prête&nbsp;!</h1>
      <p class="muted">${video.published ? 'Elle est publiée : toute personne disposant du lien peut la voir.' : 'Elle est enregistrée en brouillon : publiez-la depuis le tableau de bord pour la rendre visible.'}</p>
    </div>
    <div class="card result-card reveal" style="--d:100ms">
      <h2 class="result-title">${video.title}</h2>
      ${copyField(url, 'Copier le lien', 'result-url')}
      <div class="result-grid">
        <img src="${video.published ? `/v/${encodeURIComponent(video.slug)}` : `/admin/videos/${video.id}`}/qr.svg" alt="QR code vers ${url}" width="200" height="200" class="qr-img">
        <div class="result-actions">
          <a class="btn btn-primary" href="/v/${encodeURIComponent(video.slug)}">${icon('play')} Voir la page</a>
          <a class="btn btn-ghost" href="${video.published ? `/v/${encodeURIComponent(video.slug)}` : `/admin/videos/${video.id}`}/qr.png?taille=1024&telecharger=1">${icon('download')} Télécharger le QR code</a>
          ${ctx.user ? html`<a class="btn btn-ghost" href="/admin/videos/${video.id}">${icon('edit')} Modifier</a>` : ''}
          <a class="btn btn-ghost" href="/">Transformer un autre lien</a>
        </div>
      </div>
    </div>
  </div>`;
  return layout({ ...ctx, title: 'Page créée', body, noindex: true });
}

function videoPage(ctx, { video, preview = false }) {
  const url = publicUrl(ctx.config, video.slug);
  const blocking = BLOCKING_STATES.has(video.availability);
  const provider = getProvider(video.provider);
  const body = html`
  ${preview ? html`<div class="preview-banner"><div class="wrap">
      <strong>${video.published ? 'Aperçu rédaction' : 'Brouillon'}</strong> — ${video.published ? 'vous voyez la page publique.' : 'cette page n’est visible que par la rédaction.'}
      <a class="link" href="/admin/videos/${video.id}">Modifier</a></div></div>` : ''}
  <div class="wrap video-wrap">
    <div class="video-stage reveal">
      ${blocking ? blockedPanel(video, { forAdmin: preview }) : player(video)}
    </div>
    <div class="video-body">
      <div class="video-main reveal" style="--d:80ms">
        <h1 class="video-title">${video.title}</h1>
        <p class="video-meta muted">Publiée le ${formatDate(video.created_at)} · La P'tite Source${preview ? html` · ${statusBadge(video.availability)}` : ''}</p>
        ${video.published || preview ? shareTools(ctx.config, video, { qrBase: video.published ? null : `/admin/videos/${video.id}` }) : ''}
        ${video.description ? html`<div class="card description">${richText(video.description)}</div>` : ''}
        ${blocking ? '' : playerHelp(video)}
      </div>
    </div>
  </div>`;
  return layout({
    ...ctx,
    title: video.title,
    description: (video.description || '').slice(0, 200) || `Vidéo de La P'tite Source : ${video.title}`,
    canonical: url,
    ogType: 'video.other',
    ogImage: provider.thumbnailUrl(video),
    noindex: !video.published,
    body,
    bodyClass: 'page-video',
  });
}

function embedPage(ctx, { video }) {
  const blocking = BLOCKING_STATES.has(video.availability);
  const provider = getProvider(video.provider);
  return html`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${video.title}</title>
<meta name="robots" content="noindex"><link rel="stylesheet" href="/static/css/style.css"></head>
<body class="embed-body">
${blocking
    ? html`<div class="embed-blocked"><p><strong>Vidéo indisponible</strong></p><p>${publicHelp(video.availability)}</p></div>`
    : html`<iframe class="embed-iframe" src="${provider.embedUrl(video)}" title="${video.title}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>`}
<a class="embed-brand" href="${publicUrl(ctx.config, video.slug)}" target="_blank" rel="noopener">La P'tite Source ↗</a>
</body></html>`;
}

function errorPage(ctx, { status = 404, title, message, hint }) {
  const body = html`<div class="wrap narrow error-page">
    <div class="error-code reveal">${String(status)}</div>
    <h1 class="page-title reveal" style="--d:60ms">${title}</h1>
    <p class="reveal" style="--d:120ms">${message}</p>
    ${hint ? html`<p class="muted reveal" style="--d:160ms">${hint}</p>` : ''}
    <p class="reveal" style="--d:200ms"><a class="btn btn-primary" href="/">Retour à l’accueil</a></p>
  </div>`;
  return layout({ ...ctx, title, body, noindex: true });
}

/* ------------------------------------------------------------------ */
/* Champs de formulaire                                                */
/* ------------------------------------------------------------------ */

function field(name, label, value, error, o = {}) {
  const id = `f-${name}`;
  return html`<div class="field ${error ? 'field-error' : ''}">
    <label for="${id}">${label}${o.required ? html` <span class="req" aria-hidden="true">*</span>` : ''}</label>
    <div class="${o.prefix ? 'input-prefix' : ''}">
      ${o.prefix ? html`<span class="prefix">${o.prefix}</span>` : ''}
      <input id="${id}" name="${name}" type="${o.type || 'text'}" value="${value || ''}"
        ${o.required ? raw('required') : ''} ${o.maxlength ? html`maxlength="${o.maxlength}"` : ''}
        ${o.placeholder ? html`placeholder="${o.placeholder}"` : ''} ${o.autocomplete ? html`autocomplete="${o.autocomplete}"` : ''}
        ${error ? raw('aria-invalid="true"') : ''} ${o.autofocus ? raw('autofocus') : ''}>
    </div>
    ${error ? html`<p class="field-msg" role="alert">${error}</p>` : o.help ? html`<p class="field-help">${o.help}</p>` : ''}
  </div>`;
}

function textarea(name, label, value, error, o = {}) {
  const id = `f-${name}`;
  return html`<div class="field ${error ? 'field-error' : ''}">
    <label for="${id}">${label}</label>
    <textarea id="${id}" name="${name}" rows="${o.rows || 5}" ${o.maxlength ? html`maxlength="${o.maxlength}"` : ''}
      ${o.placeholder ? html`placeholder="${o.placeholder}"` : ''}>${value || ''}</textarea>
    ${error ? html`<p class="field-msg" role="alert">${error}</p>` : ''}
  </div>`;
}

module.exports = {
  homePage, newVideoPage, createdPage, videoPage, embedPage, errorPage,
  player, playerHelp, blockedPanel, shareTools, field, textarea, publicUrl, embedSnippet, embedPageUrl,
};
