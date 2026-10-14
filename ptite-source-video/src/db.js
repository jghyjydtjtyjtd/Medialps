'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { randomSlug, validateCustomSlug } = require('./lib/slug');

const MIGRATIONS = [
  // v1
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_login_at TEXT
  );

  CREATE TABLE videos (
    id                  INTEGER PRIMARY KEY,                -- identifiant interne
    provider            TEXT NOT NULL DEFAULT 'gdrive',      -- fournisseur (extensible)
    source_id           TEXT NOT NULL,                       -- identifiant Google Drive du fichier
    source_key          TEXT,                                -- resourcekey Drive éventuelle
    source_url          TEXT NOT NULL,                       -- URL source normalisée
    slug                TEXT NOT NULL UNIQUE COLLATE NOCASE, -- identifiant court (/v/slug)
    title               TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    published           INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
    availability        TEXT NOT NULL DEFAULT 'unknown',     -- état de disponibilité
    availability_detail TEXT,
    mime_type           TEXT,
    last_checked_at     TEXT,                                -- date de dernière vérification
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX idx_videos_created ON videos(created_at DESC);
  CREATE INDEX idx_videos_source ON videos(provider, source_id);

  -- Anciens identifiants courts : continuent de rediriger après un changement (QR codes déjà imprimés).
  CREATE TABLE slug_aliases (
    slug       TEXT PRIMARY KEY COLLATE NOCASE,
    video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
];

class SlugConflictError extends Error {
  constructor(message = 'Cet identifiant court est déjà utilisé.') {
    super(message);
    this.code = 'slug_conflict';
  }
}
class SlugInvalidError extends Error {
  constructor(message) {
    super(message);
    this.code = 'slug_invalid';
  }
}

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

const now = () => new Date().toISOString();

function createRepository(db) {
  const st = {
    videoBySlug: db.prepare('SELECT * FROM videos WHERE slug = ?'),
    aliasBySlug: db.prepare('SELECT video_id FROM slug_aliases WHERE slug = ?'),
    videoById: db.prepare('SELECT * FROM videos WHERE id = ?'),
    insertVideo: db.prepare(`
      INSERT INTO videos (provider, source_id, source_key, source_url, slug, title, description, published,
                          availability, availability_detail, mime_type, last_checked_at, created_by)
      VALUES (@provider, @source_id, @source_key, @source_url, @slug, @title, @description, @published,
              @availability, @availability_detail, @mime_type, @last_checked_at, @created_by)`),
    deleteVideo: db.prepare('DELETE FROM videos WHERE id = ?'),
    insertAlias: db.prepare('INSERT INTO slug_aliases (slug, video_id) VALUES (?, ?)'),
    deleteAlias: db.prepare('DELETE FROM slug_aliases WHERE slug = ?'),
    aliasesFor: db.prepare('SELECT slug FROM slug_aliases WHERE video_id = ? ORDER BY created_at DESC'),
    setSlug: db.prepare('UPDATE videos SET slug = ?, updated_at = ? WHERE id = ?'),
    setAvailability: db.prepare(`
      UPDATE videos SET availability = @status, availability_detail = @detail,
             mime_type = COALESCE(@mimeType, mime_type), last_checked_at = @checkedAt WHERE id = @id`),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
    updateUserPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    touchLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    staleVideos: db.prepare(`SELECT * FROM videos WHERE last_checked_at IS NULL OR last_checked_at < ? ORDER BY last_checked_at ASC LIMIT ?`),
    stats: db.prepare(`SELECT COUNT(*) AS total, SUM(published) AS published,
           SUM(CASE WHEN availability IN ('private','not_found','not_video') THEN 1 ELSE 0 END) AS broken FROM videos`),
  };

  function slugTaken(slug, exceptVideoId = null) {
    const v = st.videoBySlug.get(slug);
    if (v && v.id !== exceptVideoId) return true;
    const a = st.aliasBySlug.get(slug);
    if (a && a.video_id !== exceptVideoId) return true;
    return false;
  }

  const createTx = db.transaction((data, customSlug) => {
    const row = {
      provider: data.provider || 'gdrive',
      source_id: data.sourceId,
      source_key: data.sourceKey || null,
      source_url: data.sourceUrl,
      title: data.title,
      description: data.description || '',
      published: data.published ? 1 : 0,
      availability: data.availability?.status || 'unknown',
      availability_detail: data.availability?.detail || null,
      mime_type: data.availability?.mimeType || null,
      last_checked_at: data.availability?.checkedAt || null,
      created_by: data.createdBy || null,
    };
    if (customSlug) {
      const err = validateCustomSlug(customSlug);
      if (err) throw new SlugInvalidError(err);
      if (slugTaken(customSlug)) throw new SlugConflictError();
      row.slug = customSlug;
      return st.insertVideo.run(row).lastInsertRowid;
    }
    // Génération aléatoire avec nouvel essai en cas de collision (contrainte UNIQUE en dernier recours).
    for (let attempt = 0; attempt < 20; attempt++) {
      const len = attempt < 10 ? 6 : 8;
      const slug = (data._slugGenerator || randomSlug)(len);
      if (validateCustomSlug(slug) || slugTaken(slug)) continue;
      try {
        row.slug = slug;
        return st.insertVideo.run(row).lastInsertRowid;
      } catch (e) {
        if (String(e.code).startsWith('SQLITE_CONSTRAINT')) continue;
        throw e;
      }
    }
    throw new Error("Impossible de générer un identifiant court unique.");
  });

  return {
    db,

    createVideo(data, customSlug = null) {
      const id = createTx(data, customSlug);
      return st.videoById.get(id);
    },

    getById(id) {
      return st.videoById.get(id) || null;
    },

    /** Résout un identifiant court (y compris un ancien identifiant). */
    resolveSlug(slug) {
      if (typeof slug !== 'string' || slug.length > 64) return null;
      const v = st.videoBySlug.get(slug);
      if (v) return { video: v, isAlias: false };
      const a = st.aliasBySlug.get(slug);
      if (a) return { video: st.videoById.get(a.video_id), isAlias: true };
      return null;
    },

    list({ q = '', status = 'all', availability = 'all', limit = 200, offset = 0 } = {}) {
      const where = [];
      const params = {};
      if (q) {
        where.push(`(title LIKE @q ESCAPE '\\' OR description LIKE @q ESCAPE '\\' OR slug LIKE @q ESCAPE '\\' OR source_id LIKE @q ESCAPE '\\')`);
        params.q = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      }
      if (status === 'published') where.push('published = 1');
      if (status === 'draft') where.push('published = 0');
      if (availability === 'problem') where.push(`availability IN ('private','not_found','not_video','quota','error')`);
      else if (availability !== 'all') {
        where.push('availability = @availability');
        params.availability = availability;
      }
      const sql = `SELECT * FROM videos ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`;
      return db.prepare(sql).all({ ...params, limit, offset });
    },

    stats() {
      const s = st.stats.get();
      return { total: s.total || 0, published: s.published || 0, broken: s.broken || 0 };
    },

    updateVideo(id, fields) {
      const allowed = ['title', 'description', 'published', 'provider', 'source_id', 'source_key', 'source_url',
        'availability', 'availability_detail', 'mime_type', 'last_checked_at'];
      const sets = [];
      const params = { id, updated_at: now() };
      for (const k of allowed) {
        if (fields[k] !== undefined) {
          sets.push(`${k} = @${k}`);
          params[k] = k === 'published' ? (fields[k] ? 1 : 0) : fields[k];
        }
      }
      if (!sets.length) return st.videoById.get(id);
      db.prepare(`UPDATE videos SET ${sets.join(', ')}, updated_at = @updated_at WHERE id = @id`).run(params);
      return st.videoById.get(id);
    },

    /** Change l'identifiant court ; l'ancien reste valable (redirection 301). */
    changeSlug: db.transaction((id, newSlug) => {
      const video = st.videoById.get(id);
      if (!video) throw new Error('Vidéo introuvable');
      if (video.slug === newSlug) return video;
      const err = validateCustomSlug(newSlug);
      if (err) throw new SlugInvalidError(err);
      if (slugTaken(newSlug, id)) throw new SlugConflictError();
      // Si le nouvel identifiant était un ancien alias de cette même vidéo, on le récupère.
      st.deleteAlias.run(newSlug);
      if (video.slug.toLowerCase() !== newSlug.toLowerCase()) st.insertAlias.run(video.slug, id);
      st.setSlug.run(newSlug, now(), id);
      return st.videoById.get(id);
    }),

    aliasesFor(id) {
      return st.aliasesFor.all(id).map((r) => r.slug);
    },

    slugTaken,

    setAvailability(id, r) {
      st.setAvailability.run({
        id,
        status: r.status,
        detail: r.detail || null,
        mimeType: r.mimeType || null,
        checkedAt: r.checkedAt || now(),
      });
      return st.videoById.get(id);
    },

    staleVideos(olderThanIso, limit = 50) {
      return st.staleVideos.all(olderThanIso, limit);
    },

    /** Supprime la page de l'application uniquement (jamais le fichier Google Drive). */
    deleteVideo(id) {
      return st.deleteVideo.run(id).changes > 0;
    },

    // --- utilisateurs -----------------------------------------------------
    getUserByName: (u) => st.userByName.get(u) || null,
    getUserById: (id) => st.userById.get(id) || null,
    createUser: (u, hash) => st.insertUser.run(u, hash).lastInsertRowid,
    setUserPassword: (id, hash) => st.updateUserPassword.run(hash, id),
    touchLogin: (id) => st.touchLogin.run(now(), id),
    countUsers: () => st.countUsers.get().n,
  };
}

module.exports = { openDatabase, createRepository, SlugConflictError, SlugInvalidError };
