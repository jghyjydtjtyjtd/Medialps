'use strict';

/**
 * Registre des fournisseurs vidéo.
 *
 * Chaque fournisseur expose la même interface :
 *   key, label, parse(url) -> { fileId, resourceKey, sourceUrl },
 *   embedUrl(video), openUrl(video), thumbnailUrl(video), createChecker(opts) -> check(id, key)
 *
 * Pour ajouter plus tard un hébergeur plus adapté (PeerTube, Vimeo, Bunny Stream, fichier MP4 sur
 * un stockage objet…), il suffit de créer un module avec cette interface et de l'ajouter ici :
 * la base de données (colonnes provider/source_id/source_key), les routes et les vues n'ont pas à changer.
 */
const googleDrive = require('./googleDrive');

const providers = {
  [googleDrive.key]: googleDrive,
};

function getProvider(key) {
  const p = providers[key];
  if (!p) throw new Error(`Fournisseur vidéo inconnu : ${key}`);
  return p;
}

/** Libellés et conseils associés aux états de disponibilité. */
const AVAILABILITY = {
  available: {
    label: 'Disponible',
    tone: 'ok',
    help: 'La vidéo est accessible publiquement.',
  },
  unverified: {
    label: 'Non confirmée',
    tone: 'warn',
    help: "Le fichier semble public, mais son type n'a pas pu être confirmé. Vérifiez la lecture sur la page.",
  },
  unknown: {
    label: 'Jamais vérifiée',
    tone: 'muted',
    help: "Aucune vérification n'a encore été faite.",
  },
  private: {
    label: 'Privée',
    tone: 'bad',
    help: 'Dans Google Drive : Partager → Accès général → « Tous les utilisateurs disposant du lien » (Lecteur).',
  },
  not_found: {
    label: 'Introuvable',
    tone: 'bad',
    help: 'Le fichier a été supprimé, mis à la corbeille, ou le lien est erroné. Remplacez le lien Drive de cette page.',
  },
  not_video: {
    label: 'Pas une vidéo',
    tone: 'bad',
    help: 'Le fichier Drive n’est pas une vidéo. Utilisez le lien d’un fichier MP4, MOV, WEBM…',
  },
  quota: {
    label: 'Limitée par Google',
    tone: 'warn',
    help: 'Google Drive limite temporairement l’accès (quota). Réessayez plus tard ; pour un usage intensif, prévoyez un hébergeur vidéo dédié.',
  },
  error: {
    label: 'Vérification impossible',
    tone: 'warn',
    help: 'Google Drive n’a pas pu être contacté. Réessayez plus tard.',
  },
};

/** États pour lesquels la lecture est certainement impossible : on n'affiche pas le lecteur. */
const BLOCKING_STATES = new Set(['private', 'not_found', 'not_video']);

function availabilityInfo(status) {
  return AVAILABILITY[status] || AVAILABILITY.unknown;
}

module.exports = { providers, getProvider, AVAILABILITY, BLOCKING_STATES, availabilityInfo };
