'use strict';

const { html, raw } = require('../lib/html');
const { availabilityInfo, AVAILABILITY, BLOCKING_STATES, getProvider } = require('../providers');
const { layout, statusBadge, copyField, icon, formatDate } = require('./layout');
const { field, textarea, publicUrl, embedSnippet, player } = require('./public');

function loginPage(ctx, { error, username = '', next = '' }) {
  const body = html`<div class="wrap auth-wrap">
    <form method="post" action="/admin/login" class="card auth-card reveal" data-loading-form>
      <h1 class="page-title">Espace rédaction</h1>
      <p class="muted">Connectez-vous pour créer et gérer les pages vidéo.</p>
      ${error ? html`<div class="form-error" role="alert"><strong>${error}</strong></div>` : ''}
      <input type="hidden" name="_csrf" value="${ctx.csrf}">
      <input type="hidden" name="next" value="${next}">
      ${field('username', 'Identifiant', username, null, { required: true, autocomplete: 'username', autofocus: !username })}
      ${field('password', 'Mot de passe', '', null, { required: true, type: 'password', autocomplete: 'current-password', autofocus: !!username })}
      <div class="form-actions"><button class="btn btn-primary btn-lg btn-block" type="submit" data-loading-label="Connexion…">Se connecter</button></div>
    </form>
  </div>`;
  return layout({ ...ctx, title: 'Connexion', body, noindex: true });
}

function dashboardPage(ctx, { videos, stats, filters }) {
  const sel = (name, value, options) => html`<select name="${name}" data-autosubmit aria-label="${name === 'statut' ? 'Statut de publication' : 'Disponibilité'}">
    ${options.map(([v, l]) => html`<option value="${v}" ${value === v ? raw('selected') : ''}>${l}</option>`)}</select>`;

  const body = html`<div class="wrap">
    <div class="dash-head reveal">
      <div>
        <h1 class="page-title">Tableau de bord</h1>
        <p class="muted">Bonjour ${ctx.user.username} 👋</p>
      </div>
      <div class="action-row">
        <form method="post" action="/admin/verifier-tout" class="inline-form">
          <input type="hidden" name="_csrf" value="${ctx.csrf}">
          <button class="btn btn-ghost" type="submit" data-loading-label="Vérification…">${icon('refresh')} Tout vérifier</button>
        </form>
        <a class="btn btn-primary" href="/#lien">+ Ajouter une vidéo</a>
      </div>
    </div>

    <div class="stats reveal" style="--d:60ms">
      <div class="stat card"><span class="stat-n">${stats.total}</span><span class="stat-l">vidéos</span></div>
      <div class="stat card"><span class="stat-n">${stats.published}</span><span class="stat-l">publiées</span></div>
      <div class="stat card ${stats.broken ? 'stat-bad' : ''}"><span class="stat-n">${stats.broken}</span><span class="stat-l">à corriger</span></div>
    </div>

    <form class="filters card reveal" style="--d:120ms" method="get" action="/admin" role="search">
      <input type="search" name="q" value="${filters.q}" placeholder="Rechercher un titre, une description, un identifiant…" aria-label="Rechercher">
      ${sel('statut', filters.status, [['all', 'Toutes'], ['published', 'Publiées'], ['draft', 'Brouillons']])}
      ${sel('dispo', filters.availability, [['all', 'Toute disponibilité'], ['problem', '⚠ Problèmes'], ...Object.entries(AVAILABILITY).map(([k, v]) => [k, v.label])])}
      <button class="btn btn-ghost" type="submit">Filtrer</button>
      ${filters.q || filters.status !== 'all' || filters.availability !== 'all' ? html`<a class="link small" href="/admin">Réinitialiser</a>` : ''}
    </form>

    ${videos.length === 0
      ? html`<div class="empty card reveal">
          <p><strong>${stats.total ? 'Aucune vidéo ne correspond à ces filtres.' : 'Aucune vidéo pour le moment.'}</strong></p>
          ${stats.total ? '' : html`<p class="muted">Ajoutez votre première vidéo à partir d’un lien Google Drive.</p><p><a class="btn btn-primary" href="/#lien">+ Ajouter une vidéo</a></p>`}
        </div>`
      : html`<ul class="video-grid">${videos.map((v, i) => videoCard(ctx, v, i))}</ul>`}
  </div>`;
  return layout({ ...ctx, title: 'Tableau de bord', body, noindex: true, bodyClass: 'page-admin' });
}

function videoCard(ctx, v, i) {
  const url = publicUrl(ctx.config, v.slug);
  const provider = getProvider(v.provider);
  return html`<li class="card video-card reveal" style="--d:${Math.min(i, 12) * 40 + 160}ms">
    <a class="thumb" href="/admin/videos/${v.id}" tabindex="-1" aria-hidden="true">
      <img src="${provider.thumbnailUrl(v)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-thumb>
      <span class="thumb-fallback">${icon('play')}</span>
      <span class="pub-pill ${v.published ? 'pub-on' : 'pub-off'}">${v.published ? 'Publiée' : 'Brouillon'}</span>
    </a>
    <div class="video-card-body">
      <h2><a href="/admin/videos/${v.id}">${v.title}</a></h2>
      <p class="mono small muted">/v/${v.slug}</p>
      <div class="card-meta">${statusBadge(v.availability)}<span class="muted small" title="Dernière vérification">${v.last_checked_at ? 'vérifiée ' + formatDate(v.last_checked_at) : 'jamais vérifiée'}</span></div>
      <div class="card-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-copy="${url}" data-copied-label="Copié ✓">${icon('copy')} Lien</button>
        <a class="btn btn-ghost btn-sm" href="/v/${encodeURIComponent(v.slug)}">${icon('eye')} ${v.published ? 'Voir' : 'Aperçu'}</a>
        <a class="btn btn-ghost btn-sm" href="/admin/videos/${v.id}">${icon('edit')} Gérer</a>
      </div>
    </div>
  </li>`;
}

function editPage(ctx, { video, aliases, values, errors = {} }) {
  const url = publicUrl(ctx.config, video.slug);
  const info = availabilityInfo(video.availability);
  const blocking = BLOCKING_STATES.has(video.availability);
  const csrf = html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
  const qrBase = `/admin/videos/${video.id}`;

  const body = html`<div class="wrap">
    <a href="/admin" class="back-link">← Tableau de bord</a>
    <div class="dash-head reveal">
      <div>
        <h1 class="page-title">${video.title}</h1>
        <p class="muted small">Créée le ${formatDate(video.created_at)} · modifiée le ${formatDate(video.updated_at)}</p>
      </div>
      <div class="action-row">
        <a class="btn btn-ghost" href="/v/${encodeURIComponent(video.slug)}" target="_blank" rel="noopener">${icon('eye')} Prévisualiser</a>
        <form method="post" action="/admin/videos/${video.id}/publication" class="inline-form">
          ${csrf}<input type="hidden" name="published" value="${video.published ? '0' : '1'}">
          <button class="btn ${video.published ? 'btn-ghost' : 'btn-primary'}" type="submit">${video.published ? 'Dépublier' : 'Publier'}</button>
        </form>
      </div>
    </div>

    <div class="edit-grid">
      <div class="edit-main">
        <section class="card reveal" style="--d:60ms">
          <h2 class="section-title">Aperçu</h2>
          ${blocking ? html`<div class="check-result check-bad"><p>${info.help}</p></div>` : player(video, { compact: true })}
        </section>

        <form method="post" action="/admin/videos/${video.id}" class="card form-card reveal" style="--d:100ms">
          ${csrf}
          <h2 class="section-title">Informations</h2>
          ${field('title', 'Titre', values.title, errors.title, { required: true, maxlength: 150 })}
          ${textarea('description', 'Description', values.description, errors.description, { maxlength: 5000, rows: 6 })}
          ${field('lien', 'Lien Google Drive', values.lien, errors.lien, { help: 'Remplacez-le si le fichier a changé. Le fichier Drive n’est jamais modifié par l’application.' })}
          <div class="form-actions"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
        </form>

        <form method="post" action="/admin/videos/${video.id}/identifiant" class="card form-card reveal" style="--d:140ms">
          ${csrf}
          <h2 class="section-title">Identifiant court</h2>
          ${field('slug', 'Identifiant', values.slug, errors.slug, { required: true, maxlength: 40, prefix: `${ctx.config.baseUrl.replace(/^https?:\/\//, '')}/v/`, help: '3 à 40 caractères : lettres, chiffres, - et _. L’ancien lien continuera de fonctionner (redirection).' })}
          ${aliases.length ? html`<p class="muted small">Anciens identifiants redirigés : ${aliases.map((a, i) => html`${i ? ', ' : ''}<code>${a}</code>`)}</p>` : ''}
          <div class="form-actions"><button class="btn btn-ghost" type="submit">Changer l’identifiant</button></div>
        </form>
      </div>

      <aside class="edit-side">
        <section class="card reveal" style="--d:80ms">
          <h2 class="section-title">Lien public</h2>
          <p><span class="pub-pill inline ${video.published ? 'pub-on' : 'pub-off'}">${video.published ? 'Publiée' : 'Brouillon (non visible)'}</span></p>
          ${copyField(url)}
          <div class="qr-box">
            <img src="${qrBase}/qr.svg?r=${Date.now()}" alt="QR code vers ${url}" width="200" height="200" class="qr-img" data-qr-img>
            <div class="action-row">
              <button type="button" class="btn btn-ghost btn-sm" data-regen-qr>${icon('refresh')} Régénérer</button>
              <a class="btn btn-ghost btn-sm" href="${qrBase}/qr.png?taille=1024&telecharger=1">${icon('download')} PNG</a>
              <a class="btn btn-ghost btn-sm" href="${qrBase}/qr.svg?telecharger=1">${icon('download')} SVG</a>
            </div>
            <p class="muted small">Le QR code encode toujours l’identifiant court actuel.</p>
          </div>
          <details class="embed-details">
            <summary>${icon('code')} Code d’intégration</summary>
            <textarea readonly rows="5" class="code" data-select-on-focus>${embedSnippet(ctx.config, video)}</textarea>
            <button type="button" class="btn btn-ghost btn-sm" data-copy="${embedSnippet(ctx.config, video)}" data-copied-label="Code copié ✓">${icon('copy')} Copier le code</button>
          </details>
        </section>

        <section class="card reveal" style="--d:120ms">
          <h2 class="section-title">Disponibilité</h2>
          <p>${statusBadge(video.availability)}</p>
          ${video.availability_detail ? html`<p class="small">${video.availability_detail}</p>` : ''}
          ${video.availability !== 'available' ? html`<p class="small check-help"><strong>Que faire ?</strong> ${info.help}</p>` : ''}
          <dl class="kv small">
            <dt>Dernière vérification</dt><dd>${formatDate(video.last_checked_at)}</dd>
            <dt>Type</dt><dd class="mono">${video.mime_type || '—'}</dd>
            <dt>ID Drive</dt><dd class="mono break">${video.source_id}</dd>
          </dl>
          <div class="action-row">
            <form method="post" action="/admin/videos/${video.id}/verifier" class="inline-form">
              ${csrf}<button class="btn btn-ghost btn-sm" type="submit" data-loading-label="Vérification…">${icon('refresh')} Vérifier maintenant</button>
            </form>
            <a class="btn btn-ghost btn-sm" href="${getProvider(video.provider).openUrl(video)}" target="_blank" rel="noopener noreferrer">${icon('external')} Ouvrir dans Drive</a>
          </div>
        </section>

        <section class="card danger-zone reveal" style="--d:160ms">
          <h2 class="section-title">Supprimer la page</h2>
          <p class="small muted">Supprime uniquement la page de l’application. Le fichier sur Google Drive n’est pas touché.</p>
          <a class="btn btn-danger btn-sm" href="/admin/videos/${video.id}/supprimer">${icon('trash')} Supprimer…</a>
        </section>
      </aside>
    </div>
  </div>`;
  return layout({ ...ctx, title: `Gérer : ${video.title}`, body, noindex: true, bodyClass: 'page-admin' });
}

function deleteConfirmPage(ctx, { video }) {
  const body = html`<div class="wrap narrow">
    <form method="post" action="/admin/videos/${video.id}/supprimer" class="card form-card reveal">
      <input type="hidden" name="_csrf" value="${ctx.csrf}">
      <h1 class="page-title">Supprimer « ${video.title} » ?</h1>
      <p>La page <code>/v/${video.slug}</code> et ses anciens identifiants cesseront de fonctionner, ainsi que le QR code correspondant.</p>
      <p class="check-result check-ok"><strong>Le fichier original sur Google Drive ne sera pas supprimé.</strong> L’application n’a d’ailleurs aucun droit d’écriture sur Drive.</p>
      <div class="form-actions">
        <a class="btn btn-ghost" href="/admin/videos/${video.id}">Annuler</a>
        <button class="btn btn-danger" type="submit">Supprimer définitivement la page</button>
      </div>
    </form>
  </div>`;
  return layout({ ...ctx, title: 'Supprimer la page', body, noindex: true });
}

function accountPage(ctx, { errors = {} }) {
  const body = html`<div class="wrap narrow">
    <a href="/admin" class="back-link">← Tableau de bord</a>
    <form method="post" action="/admin/compte" class="card form-card reveal">
      <input type="hidden" name="_csrf" value="${ctx.csrf}">
      <h1 class="page-title">Changer de mot de passe</h1>
      ${field('current', 'Mot de passe actuel', '', errors.current, { type: 'password', required: true, autocomplete: 'current-password' })}
      ${field('password', 'Nouveau mot de passe', '', errors.password, { type: 'password', required: true, autocomplete: 'new-password', help: '10 caractères minimum.' })}
      ${field('confirm', 'Confirmation', '', errors.confirm, { type: 'password', required: true, autocomplete: 'new-password' })}
      <div class="form-actions"><button class="btn btn-primary" type="submit">Mettre à jour</button></div>
    </form>
  </div>`;
  return layout({ ...ctx, title: 'Mon compte', body, noindex: true });
}

module.exports = { loginPage, dashboardPage, editPage, deleteConfirmPage, accountPage };
