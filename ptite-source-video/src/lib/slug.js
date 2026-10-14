'use strict';

const crypto = require('crypto');

// Alphabet sans caractères ambigus (0/O, 1/l/I) pour faciliter la lecture et la saisie.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const RESERVED = new Set([
  'admin', 'api', 'v', 'e', 'embed', 'static', 'assets', 'css', 'js', 'img', 'login', 'logout',
  'nouveau', 'creer', 'qr', 'health', 'healthz', 'robots', 'favicon', 'sitemap', 'new', 'edit',
]);

const CUSTOM_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,38}[A-Za-z0-9]$/;

function randomSlug(length = 6) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/**
 * Valide un identifiant court choisi par l'administrateur.
 * @returns {string|null} message d'erreur, ou null si valide.
 */
function validateCustomSlug(slug) {
  if (typeof slug !== 'string' || !slug) return "L'identifiant court est obligatoire.";
  if (!CUSTOM_SLUG_RE.test(slug)) {
    return "L'identifiant court doit faire 3 à 40 caractères : lettres, chiffres, tirets ou soulignés (sans tiret au début ni à la fin).";
  }
  if (RESERVED.has(slug.toLowerCase())) return 'Cet identifiant est réservé par l’application.';
  return null;
}

module.exports = { randomSlug, validateCustomSlug, ALPHABET, RESERVED };
