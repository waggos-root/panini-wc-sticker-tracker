import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { teams } from './album-data.js';
import { buildStickerSeed } from './seed.js';

export const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'panini-2026.sqlite');

export function createDb(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS stickers (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      section TEXT NOT NULL,
      team TEXT,
      type TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'pack',
      team_order INTEGER,
      quantity INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      emoji TEXT NOT NULL DEFAULT '⚽',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory (
      profile_id INTEGER NOT NULL,
      sticker_code TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (profile_id, sticker_code),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (sticker_code) REFERENCES stickers(code) ON DELETE CASCADE
    );
  `);

  const existingColumns = db.prepare("PRAGMA table_info(stickers)").all();
  if (!existingColumns.some((column) => column.name === 'source')) {
    db.exec("ALTER TABLE stickers ADD COLUMN source TEXT NOT NULL DEFAULT 'pack'");
  }
  if (!existingColumns.some((column) => column.name === 'team_order')) {
    db.exec('ALTER TABLE stickers ADD COLUMN team_order INTEGER');
  }

  stripTeamPrefixFromNames(db);
  backfillTeamOrder(db);
  seedStickersIfEmpty(db);
  ensureDefaultProfile(db);

  return db;
}

// Always re-syncs team_order from the current album-data ordering, so reorders
// (e.g. switching from alphabetical to group draw order) propagate to existing
// rows on the next start. 48 UPDATE statements; negligible cost.
export function backfillTeamOrder(db) {
  const stmt = db.prepare('UPDATE stickers SET team_order = ? WHERE team = ?');
  const tx = db.transaction(() => {
    teams.forEach((team, index) => stmt.run(index, team));
  });
  tx();
}

export function stripTeamPrefixFromNames(db) {
  const stale = db.prepare(`
    SELECT COUNT(*) AS n FROM stickers
    WHERE type = 'country' AND team IS NOT NULL AND name LIKE team || ' %'
  `).get().n;
  if (stale === 0) return;

  db.exec(`
    UPDATE stickers
    SET name = SUBSTR(name, LENGTH(team) + 2)
    WHERE type = 'country' AND team IS NOT NULL AND name LIKE team || ' %'
  `);
}

export function seedStickersIfEmpty(db) {
  const row = db.prepare('SELECT COUNT(*) AS total FROM stickers').get();
  if (row.total > 0) return;

  const stickers = buildStickerSeed();
  const insert = db.prepare(`
    INSERT INTO stickers (code, name, section, team, type, source, team_order, quantity)
    VALUES (@code, @name, @section, @team, @type, @source, @team_order, 0)
  `);
  const transaction = db.transaction((rows) => {
    for (const sticker of rows) insert.run(sticker);
  });
  transaction(stickers);
}

export function ensureDefaultProfile(db) {
  const existing = db.prepare('SELECT id FROM profiles ORDER BY id LIMIT 1').get();
  if (existing) return;

  const inserted = db
    .prepare("INSERT INTO profiles (name, emoji) VALUES ('Default', '⚽')")
    .run();
  const profileId = inserted.lastInsertRowid;

  const legacy = db
    .prepare('SELECT code, quantity FROM stickers WHERE quantity > 0')
    .all();
  if (legacy.length === 0) return;

  const insert = db.prepare(
    'INSERT INTO inventory (profile_id, sticker_code, quantity) VALUES (?, ?, ?)'
  );
  const migrate = db.transaction((rows) => {
    for (const row of rows) insert.run(profileId, row.code, row.quantity);
  });
  migrate(legacy);
}
