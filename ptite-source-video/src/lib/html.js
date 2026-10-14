'use strict';

/**
 * Mini moteur de gabarits : `html` échappe automatiquement toute valeur interpolée.
 * Seul le contenu explicitement marqué avec raw() (déjà produit par `html`) est inséré tel quel.
 * C'est la protection principale contre les injections HTML/XSS.
 */

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

function escapeHtml(v) {
  return String(v).replace(/[&<>"'`]/g, (c) => ESC[c]);
}

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
}

function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

const raw = (s) => new SafeHtml(String(s));

/** Texte multiligne → paragraphes, liens http(s) rendus cliquables de façon sûre. */
function richText(text) {
  if (!text) return raw('');
  const paragraphs = String(text).trim().split(/\n{2,}/);
  return raw(paragraphs.map((p) => {
    const parts = p.split(/(https?:\/\/[^\s<>"']+)/g).map((chunk, i) => {
      if (i % 2 === 1) {
        let href;
        try { href = new URL(chunk).href; } catch { return escapeHtml(chunk); }
        return `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${escapeHtml(chunk)}</a>`;
      }
      return escapeHtml(chunk).replace(/\n/g, '<br>');
    });
    return `<p>${parts.join('')}</p>`;
  }).join(''));
}

module.exports = { html, raw, escapeHtml, richText, SafeHtml };
