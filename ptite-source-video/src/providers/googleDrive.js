'use strict';

/**
 * Fournisseur « Google Drive ».
 *
 * - parse()      : valide un lien de partage Drive et en extrait l'identifiant (aucune requête réseau).
 * - embedUrl()   : URL du lecteur officiel Google Drive (/preview), à intégrer dans une <iframe>.
 * - createChecker(): vérification de disponibilité. Les SEULES URL contactées sont construites par
 *   le serveur à partir d'un identifiant validé, vers deux hôtes fixes (protection SSRF).
 */

const ALLOWED_INPUT_HOSTS = new Set(['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com']);
const FETCH_ALLOWLIST = new Set(['drive.google.com', 'www.googleapis.com']);

const FILE_ID_RE = /^[A-Za-z0-9_-]{20,100}$/;
const RESOURCE_KEY_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_INPUT_LENGTH = 2048;

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|3gp|3g2|mpe?g|ogv|mts|m2ts)$/i;
const NON_VIDEO_EXTENSIONS = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|txt|csv|jpe?g|png|gif|webp|heic|svg|mp3|wav|m4a|ogg|flac|zip|rar|7z)$/i;

class DriveLinkError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

const ERR = {
  empty: ['Collez un lien Google Drive.', 'Dans Drive : clic droit sur la vidéo → Partager → Copier le lien.'],
  too_long: ['Ce lien est anormalement long.', 'Copiez à nouveau le lien depuis le bouton « Copier le lien » de Google Drive.'],
  not_url: ["Ce texte n'est pas un lien valide.", 'Le lien doit commencer par https://drive.google.com/…'],
  bad_protocol: ['Seuls les liens https:// sont acceptés.', 'Copiez le lien directement depuis Google Drive.'],
  bad_host: ["Ce lien ne provient pas de Google Drive.", 'Seuls les liens drive.google.com sont pris en charge pour le moment.'],
  credentials: ['Ce lien contient des informations suspectes.', 'Copiez le lien directement depuis Google Drive.'],
  folder: ["Ce lien pointe vers un dossier, pas vers une vidéo.", 'Ouvrez le dossier, faites un clic droit sur la vidéo elle-même puis « Copier le lien ».'],
  google_doc: ["Ce lien pointe vers un document Google (Docs, Sheets, Slides…), pas vers une vidéo.", 'Utilisez le lien d’un fichier vidéo (MP4, MOV, WEBM…) déposé dans Drive.'],
  no_id: ["Impossible de trouver l'identifiant du fichier dans ce lien.", 'Le lien doit ressembler à https://drive.google.com/file/d/IDENTIFIANT/view'],
  bad_id: ["L'identifiant du fichier semble incomplet ou altéré.", 'Recopiez le lien en entier, sans le modifier.'],
};

function fail(code) {
  const [message, hint] = ERR[code];
  throw new DriveLinkError(code, message, hint);
}

/**
 * Analyse un lien de partage Google Drive.
 * @returns {{ fileId: string, resourceKey: string|null, sourceUrl: string }}
 * @throws {DriveLinkError}
 */
function parse(input) {
  if (typeof input !== 'string' || !input.trim()) fail('empty');
  const raw = input.trim();
  if (raw.length > MAX_INPUT_LENGTH) fail('too_long');

  let url;
  try {
    url = new URL(raw);
  } catch {
    // Lien collé sans protocole : « drive.google.com/file/d/… »
    if (/^(drive|docs)\.google\.com\//i.test(raw)) {
      try { url = new URL('https://' + raw); } catch { fail('not_url'); }
    } else {
      fail('not_url');
    }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail('bad_protocol');
  if (url.username || url.password) fail('credentials');
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_INPUT_HOSTS.has(host) || url.port) fail('bad_host');

  const p = url.pathname;
  let fileId = null;

  // Dossiers : /drive/folders/ID, /drive/u/0/folders/ID, /folderview?id=
  if (/\/(drive\/(u\/\d+\/)?)?folders\//.test(p) || p.startsWith('/folderview') || /\/embeddedfolderview/.test(p)) {
    fail('folder');
  }
  if (host === 'docs.google.com' && /^\/(document|spreadsheets|presentation|forms|drawings)\//.test(p)) {
    fail('google_doc');
  }

  // /file/d/ID/... (avec éventuels préfixes /a/domaine/ et /u/N/)
  const m = p.match(/^(?:\/a\/[^/]+)?(?:\/u\/\d+)?\/file(?:\/u\/\d+)?\/d\/([^/?#]+)/);
  if (m) {
    fileId = m[1];
  } else if (/^(?:\/a\/[^/]+)?(?:\/u\/\d+)?\/(open|uc|download|thumbnail)\/?$/.test(p)) {
    // /open?id=ID, /uc?id=ID&export=download, drive.usercontent.google.com/download?id=ID
    fileId = url.searchParams.get('id');
  }

  if (!fileId) fail('no_id');
  if (!FILE_ID_RE.test(fileId)) fail('bad_id');

  let resourceKey = url.searchParams.get('resourcekey');
  if (resourceKey && !RESOURCE_KEY_RE.test(resourceKey)) resourceKey = null;

  return {
    fileId,
    resourceKey: resourceKey || null,
    sourceUrl: canonicalViewUrl(fileId, resourceKey),
  };
}

function withKey(base, resourceKey) {
  return resourceKey ? `${base}?resourcekey=${encodeURIComponent(resourceKey)}` : base;
}

function canonicalViewUrl(fileId, resourceKey) {
  return withKey(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`, resourceKey);
}

/** Lecteur officiel Google Drive, conçu pour l'intégration en iframe. */
function embedUrl(video) {
  return withKey(`https://drive.google.com/file/d/${encodeURIComponent(video.source_id)}/preview`, video.source_key);
}

function openUrl(video) {
  return canonicalViewUrl(video.source_id, video.source_key);
}

/**
 * Miniature : point d'accès public non documenté officiellement, utilisé uniquement
 * comme aperçu décoratif (le site fonctionne sans).
 */
function thumbnailUrl(video) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(video.source_id)}&sz=w640`;
}

/* ------------------------------------------------------------------------- */
/* Vérification de disponibilité                                              */
/* ------------------------------------------------------------------------- */

function assertAllowedFetch(urlString) {
  const u = new URL(urlString);
  if (u.protocol !== 'https:' || !FETCH_ALLOWLIST.has(u.hostname) || u.port || u.username) {
    throw new Error(`Requête sortante refusée (hors liste blanche) : ${u.hostname}`);
  }
  return u;
}

async function readLimited(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const t = await res.text();
    return t.slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* ignore */ }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8').slice(0, maxBytes);
}

function result(status, detail, extra = {}) {
  return { status, detail, checkedAt: new Date().toISOString(), ...extra };
}

/**
 * @param {{ apiKey?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} opts
 */
function createChecker({ apiKey = '', fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  async function safeFetch(urlString, init = {}) {
    assertAllowedFetch(urlString);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(urlString, { redirect: 'manual', ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Vérification via l'API Drive v3 (clé API, fichiers partagés « tous les utilisateurs disposant du lien »). */
  async function checkWithApi(fileId, resourceKey) {
    const fields = 'id,name,mimeType,trashed,size,videoMediaMetadata(durationMillis,width,height)';
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
      `?fields=${encodeURIComponent(fields)}&supportsAllDrives=true&key=${encodeURIComponent(apiKey)}`;
    const headers = { Accept: 'application/json' };
    if (resourceKey) headers['X-Goog-Drive-Resource-Keys'] = `${fileId}/${resourceKey}`;

    const res = await safeFetch(url, { headers });
    let body = {};
    try { body = JSON.parse(await readLimited(res, 64 * 1024)); } catch { /* ignore */ }

    if (res.status === 200) {
      const mime = String(body.mimeType || '');
      const meta = { mimeType: mime || null, name: body.name || null, method: 'api' };
      if (body.trashed) return result('not_found', 'Le fichier est dans la corbeille de Google Drive.', meta);
      if (mime.startsWith('video/')) {
        const processing = !body.videoMediaMetadata;
        return result('available', processing
          ? 'Vidéo accessible. Google Drive est peut-être encore en train de la préparer pour la lecture.'
          : 'Vidéo accessible et lisible par le lecteur Google Drive.', { ...meta, processing });
      }
      if (mime === 'application/octet-stream' && VIDEO_EXTENSIONS.test(body.name || '')) {
        return result('unverified', 'Fichier accessible, mais Google ne le reconnaît pas comme vidéo. La lecture intégrée risque d’échouer.', meta);
      }
      return result('not_video', `Ce fichier n'est pas une vidéo (type : ${mime || 'inconnu'}).`, meta);
    }

    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
    if (res.status === 429 || /rateLimit|quota|dailyLimit/i.test(reason)) {
      return result('quota', 'Google limite temporairement les vérifications (quota atteint). Réessayez plus tard.', { httpStatus: res.status, method: 'api' });
    }
    if (res.status === 400 && /keyInvalid|badRequest/i.test(reason)) {
      return { fallback: true, reason: 'Clé API Google refusée' };
    }
    if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(JSON.stringify(body))) {
      return { fallback: true, reason: "L'API Google Drive n'est pas activée pour cette clé" };
    }
    if (res.status === 404 || res.status === 403) {
      // Avec une clé API, Google répond 404 aussi bien pour « privé » que pour « supprimé » :
      // on affine avec une sonde de la page publique.
      return { fallback: true, reason: null };
    }
    return result('error', `Réponse inattendue de Google (HTTP ${res.status}).`, { httpStatus: res.status, method: 'api' });
  }

  /** Sonde de la page publique du fichier (sans clé). Ne suit jamais les redirections. */
  async function checkWithPage(fileId, resourceKey) {
    const url = canonicalViewUrl(fileId, resourceKey);
    const res = await safeFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PtiteSourceVideo/1.0; +availability-check)',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    });
    const meta = { httpStatus: res.status, method: 'page' };

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      let locHost = '';
      try { locHost = new URL(loc, url).hostname; } catch { /* ignore */ }
      if (locHost === 'accounts.google.com' || /ServiceLogin|signin/i.test(loc)) {
        return result('private', 'Le fichier est privé : Google demande une connexion pour y accéder.', meta);
      }
      return result('unverified', 'Google a redirigé la demande ; impossible de confirmer l’accès.', meta);
    }
    if (res.status === 404 || res.status === 410) return result('not_found', 'Fichier introuvable : il a peut-être été supprimé ou le lien est erroné.', meta);
    if (res.status === 401 || res.status === 403) return result('private', 'Accès refusé par Google Drive : le fichier n’est pas partagé publiquement.', meta);
    if (res.status === 429) return result('quota', 'Google limite temporairement l’accès (trop de requêtes). Réessayez plus tard.', meta);
    if (res.status !== 200) return result('error', `Réponse inattendue de Google (HTTP ${res.status}).`, meta);

    const html = await readLimited(res, 768 * 1024);
    if (/accounts\.google\.com\/ServiceLogin|<title>[^<]*(Sign in|Connexion)[^<]*<\/title>/i.test(html) && !/og:title/i.test(html)) {
      return result('private', 'Le fichier est privé : Google demande une connexion.', meta);
    }
    const ogTitle = (html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i) || [])[1] || null;
    const name = ogTitle ? decodeEntities(ogTitle) : null;
    const mimeHit = (html.match(/"(video\/[a-z0-9.+-]{2,40})"/i) || [])[1] || null;

    if (name && NON_VIDEO_EXTENSIONS.test(name) && !mimeHit) {
      return result('not_video', `Ce fichier ne semble pas être une vidéo (« ${name} »).`, { ...meta, name });
    }
    if (mimeHit || (name && VIDEO_EXTENSIONS.test(name))) {
      return result('available', 'Fichier public, identifié comme vidéo.', { ...meta, name, mimeType: mimeHit });
    }
    return result('unverified', 'Fichier public, mais son type n’a pas pu être confirmé. Ajoutez une clé API Google pour une vérification fiable.', { ...meta, name });
  }

  return async function check(fileId, resourceKey = null) {
    if (!FILE_ID_RE.test(String(fileId))) return result('error', 'Identifiant invalide.');
    if (resourceKey && !RESOURCE_KEY_RE.test(resourceKey)) resourceKey = null;
    try {
      let note = null;
      if (apiKey) {
        const r = await checkWithApi(fileId, resourceKey);
        if (!r.fallback) return r;
        note = r.reason;
      }
      const r = await checkWithPage(fileId, resourceKey);
      if (note) r.detail += ` (${note} : vérification simplifiée utilisée.)`;
      return r;
    } catch (e) {
      const timeout = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
      return result('error', timeout
        ? 'Google Drive n’a pas répondu à temps. Réessayez plus tard.'
        : 'Impossible de contacter Google Drive pour le moment.', { error: String(e && e.message || e) });
    }
  };
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

module.exports = {
  key: 'gdrive',
  label: 'Google Drive',
  parse,
  embedUrl,
  openUrl,
  thumbnailUrl,
  createChecker,
  DriveLinkError,
  FETCH_ALLOWLIST,
  _internal: { assertAllowedFetch, FILE_ID_RE },
};
