'use strict';

const { getProvider } = require('../providers');

/**
 * Service de vérification : relie les fournisseurs (Drive…) à la base de données.
 * `checkers` : { [providerKey]: check(sourceId, sourceKey) }.
 */
function createAvailabilityService({ repo, checkers, logger = console }) {
  async function checkSource(providerKey, sourceId, sourceKey) {
    const check = checkers[providerKey];
    if (!check) return { status: 'unknown', detail: 'Aucune vérification disponible pour ce fournisseur.', checkedAt: new Date().toISOString() };
    return check(sourceId, sourceKey);
  }

  async function checkVideo(video) {
    getProvider(video.provider); // fournisseur connu ?
    const r = await checkSource(video.provider, video.source_id, video.source_key);
    return { result: r, video: repo.setAvailability(video.id, r) };
  }

  let timer = null;
  let running = false;

  /** Revérifie périodiquement les vidéos, une par une, en douceur (pas de rafale vers Google). */
  function startScheduler(intervalHours) {
    if (!intervalHours || intervalHours <= 0) return;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const cutoff = new Date(Date.now() - intervalHours * 3600e3).toISOString();
        const stale = repo.staleVideos(cutoff, 25);
        for (const v of stale) {
          await checkVideo(v).catch((e) => logger.warn('[vérification]', v.slug, e.message));
          await new Promise((r) => setTimeout(r, 2000));
        }
      } finally {
        running = false;
      }
    };
    timer = setInterval(tick, 15 * 60 * 1000);
    timer.unref();
    setTimeout(tick, 30 * 1000).unref();
  }

  function stopScheduler() {
    if (timer) clearInterval(timer);
  }

  return { checkSource, checkVideo, startScheduler, stopScheduler };
}

module.exports = { createAvailabilityService };
