import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { db } from './database.js';

const app = express();
const port = process.env.PORT || 3001;
const distDir = path.join(process.cwd(), 'dist');

app.use(cors());
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/stickers', (_request, response) => {
  const stickers = db
    .prepare(`
      SELECT
        code,
        name,
        section,
        team,
        type,
        source,
        quantity,
        updated_at
      FROM stickers
      ORDER BY
        CASE
          WHEN type = 'intro' THEN 1
          WHEN type = 'museum' THEN 2
          ELSE 3
        END,
        team,
        LENGTH(code),
        code
    `)
    .all();

  response.json(stickers);
});

app.put('/api/stickers/:code', (request, response) => {
  const { code } = request.params;
  const quantity = Math.max(0, Number.parseInt(request.body.quantity ?? 0, 10));

  const result = db
    .prepare(`
      UPDATE stickers
      SET
        quantity = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE code = ?
    `)
    .run(quantity, code);

  if (result.changes === 0) {
    response.status(404).json({ error: 'Cromo no encontrado' });
    return;
  }

  const sticker = db
    .prepare(`
      SELECT code, name, section, team, type, source, quantity, updated_at
      FROM stickers
      WHERE code = ?
    `)
    .get(code);

  response.json(sticker);
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((request, response, next) => {
    if (request.path.startsWith('/api')) return next();
    response.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`API SQLite escuchando en http://localhost:${port}`);
});
