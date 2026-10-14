/* La P'tite Source Vidéo — interactions côté navigateur (aucun secret ici). */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  /* ---------- Lecteur : fondu une fois l'iframe chargée ---------- */
  document.querySelectorAll('[data-player]').forEach(function (frame) {
    var iframe = frame.querySelector('iframe');
    if (!iframe) return;
    var done = function () { frame.classList.add('is-loaded'); };
    iframe.addEventListener('load', done);
    // Filet de sécurité : l'événement a pu se produire avant l'exécution de ce script.
    setTimeout(done, 3500);
  });

  /* ---------- Copier dans le presse-papiers ---------- */
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function flashButton(btn, ok) {
    if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
    btn.classList.toggle('is-copied', ok);
    btn.textContent = ok ? (btn.dataset.copiedLabel || 'Copié ✓') : 'Copie impossible : sélectionnez le texte';
    clearTimeout(btn._t);
    btn._t = setTimeout(function () {
      btn.innerHTML = btn.dataset.label;
      btn.classList.remove('is-copied');
    }, 2000);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (btn) {
      copyText(btn.getAttribute('data-copy')).then(function (ok) { flashButton(btn, ok); });
      return;
    }

    /* ---------- Partager (API Web Share si disponible, sinon copie) ---------- */
    var share = e.target.closest('[data-share]');
    if (share) {
      var url = share.getAttribute('data-share-url');
      var title = share.getAttribute('data-share-title') || document.title;
      if (navigator.share) {
        navigator.share({ title: title, text: title + " — La P'tite Source", url: url }).catch(function () {});
      } else {
        share.dataset.copiedLabel = 'Lien copié, prêt à partager ✓';
        copyText(url).then(function (ok) { flashButton(share, ok); });
      }
      return;
    }

    /* ---------- Afficher / masquer un panneau ---------- */
    var toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      var panel = document.querySelector(toggle.getAttribute('data-toggle'));
      if (!panel) return;
      var open = panel.hasAttribute('hidden');
      document.querySelectorAll('[data-toggle]').forEach(function (other) {
        if (other === toggle) return;
        var p = document.querySelector(other.getAttribute('data-toggle'));
        if (p && open) { p.setAttribute('hidden', ''); other.setAttribute('aria-expanded', 'false'); }
      });
      if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', String(open));
      return;
    }

    /* ---------- Régénérer le QR code (administration) ---------- */
    var regen = e.target.closest('[data-regen-qr]');
    if (regen) {
      var img = document.querySelector('[data-qr-img]');
      if (img) {
        var base = img.getAttribute('src').split('?')[0];
        img.style.opacity = '0.3';
        img.onload = function () { img.style.opacity = '1'; };
        img.setAttribute('src', base + '?r=' + Date.now());
      }
    }
  });

  /* ---------- Sélection automatique des champs « code » ---------- */
  document.querySelectorAll('[data-select-on-focus], [data-copy-source]').forEach(function (el) {
    el.addEventListener('focus', function () { el.select(); });
  });

  /* ---------- État de chargement des formulaires ---------- */
  document.querySelectorAll('form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var btn = e.submitter || form.querySelector('[type="submit"]');
      if (!btn || !btn.hasAttribute('data-loading-label')) return;
      if (form.dataset.submitting === '1') { e.preventDefault(); return; }
      form.dataset.submitting = '1';
      btn.classList.add('is-loading');
      btn.textContent = btn.getAttribute('data-loading-label');
      // Si l'utilisateur revient en arrière, on réactive le formulaire.
      window.addEventListener('pageshow', function () {
        form.dataset.submitting = '';
        btn.classList.remove('is-loading');
      }, { once: true });
    });
  });

  /* ---------- Filtres : envoi automatique ---------- */
  document.querySelectorAll('[data-autosubmit]').forEach(function (sel) {
    sel.addEventListener('change', function () { sel.form && sel.form.submit(); });
  });

  /* ---------- Miniatures Drive indisponibles ---------- */
  document.querySelectorAll('img[data-thumb]').forEach(function (img) {
    var broken = function () { img.classList.add('is-broken'); };
    if (img.complete && img.naturalWidth === 0) broken();
    img.addEventListener('error', broken);
  });
})();
