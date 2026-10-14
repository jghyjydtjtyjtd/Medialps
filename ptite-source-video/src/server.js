'use strict';

const { loadConfig } = require('./config');
const { openDatabase, createRepository } = require('./db');
const { createApp } = require('./app');
const { createAvailabilityService } = require('./services/availability');
const { providers } = require('./providers');
const { hashPassword, validatePasswordStrength } = require('./lib/security');

async function main() {
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  const repo = createRepository(db);

  // Premier démarrage : création du compte administrateur depuis les variables d'environnement.
  if (repo.countUsers() === 0) {
    const { username, password } = config.bootstrapAdmin;
    if (username && password) {
      const weak = validatePasswordStrength(password);
      if (weak) throw new Error(`ADMIN_PASSWORD : ${weak}`);
      repo.createUser(username, await hashPassword(password));
      console.log(`[init] Compte administrateur « ${username} » créé. Vous pouvez retirer ADMIN_PASSWORD des variables d'environnement.`);
    } else {
      console.warn('[init] Aucun administrateur. Lancez « npm run create-admin » ou définissez ADMIN_USERNAME et ADMIN_PASSWORD.');
    }
  }

  const checkers = {};
  for (const [key, p] of Object.entries(providers)) checkers[key] = p.createChecker({ apiKey: config.googleApiKey });
  const availability = createAvailabilityService({ repo, checkers });
  availability.startScheduler(config.checkIntervalHours);

  const app = createApp({ config, repo, availability });
  const server = app.listen(config.port, config.host, () => {
    console.log(`[http] ${config.siteName} en écoute sur ${config.host}:${config.port} — URL publique : ${config.baseUrl}`);
    console.log(`[drive] Vérification ${config.googleApiKey ? 'via l’API Google Drive (clé configurée)' : 'simplifiée (sans clé API)'}.`);
  });

  const shutdown = () => {
    console.log('[http] Arrêt…');
    availability.stopScheduler();
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
