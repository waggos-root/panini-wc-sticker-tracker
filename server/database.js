import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { buildStickerSeed } from './seed.js';

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'panini-2026.sqlite');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS stickers (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  section TEXT NOT NULL,
  team TEXT,
  type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'pack',
  quantity INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const existingColumns = db.prepare("PRAGMA table_info(stickers)").all();
if (!existingColumns.some((column) => column.name === 'source')) {
  db.exec("ALTER TABLE stickers ADD COLUMN source TEXT NOT NULL DEFAULT 'pack'");
}

export function seedDatabaseIfEmpty() {
  const row = db.prepare('SELECT COUNT(*) AS total FROM stickers').get();

  if (row.total > 0) {
    return;
  }

  const stickers = buildStickerSeed();

  const insert = db.prepare(`
    INSERT INTO stickers (
      code,
      name,
      section,
      team,
      type,
      source,
      quantity
    ) VALUES (
      @code,
      @name,
      @section,
      @team,
      @type,
      @source,
      0
    )
  `);

  const transaction = db.transaction((rows) => {
    for (const sticker of rows) {
      insert.run(sticker);
    }
  });

  transaction(stickers);

  console.log(`SQLite creado y seed ejecutado: ${stickers.length} cromos.`);
}

seedDatabaseIfEmpty();
