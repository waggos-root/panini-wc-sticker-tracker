import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';

const distDir = path.join(process.cwd(), 'dist');

export function createApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.get('/api/profiles', (_request, response) => {
    const profiles = db
      .prepare('SELECT id, name, emoji, created_at FROM profiles ORDER BY id')
      .all();
    response.json(profiles);
  });

  app.post('/api/profiles', (request, response) => {
    const name = String(request.body.name ?? '').trim();
    const emoji = String(request.body.emoji ?? '⚽').trim() || '⚽';

    if (!name) {
      response.status(400).json({ error: 'El nombre es obligatorio' });
      return;
    }

    try {
      const result = db
        .prepare('INSERT INTO profiles (name, emoji) VALUES (?, ?)')
        .run(name, emoji);
      const profile = db
        .prepare('SELECT id, name, emoji, created_at FROM profiles WHERE id = ?')
        .get(result.lastInsertRowid);
      response.status(201).json(profile);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        response.status(409).json({ error: 'Ya existe un perfil con ese nombre' });
        return;
      }
      throw error;
    }
  });

  app.delete('/api/profiles/:id', (request, response) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isInteger(id)) {
      response.status(400).json({ error: 'ID inválido' });
      return;
    }

    const total = db.prepare('SELECT COUNT(*) AS total FROM profiles').get().total;
    if (total <= 1) {
      response.status(409).json({ error: 'No puedes borrar el último perfil' });
      return;
    }

    const result = db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    if (result.changes === 0) {
      response.status(404).json({ error: 'Perfil no encontrado' });
      return;
    }

    response.status(204).end();
  });

  app.get('/api/profiles/:id/stickers', (request, response) => {
    const profileId = Number.parseInt(request.params.id, 10);
    if (!Number.isInteger(profileId)) {
      response.status(400).json({ error: 'ID de perfil inválido' });
      return;
    }

    const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId);
    if (!profile) {
      response.status(404).json({ error: 'Perfil no encontrado' });
      return;
    }

    const stickers = db
      .prepare(`
        SELECT
          s.code,
          s.name,
          s.section,
          s.team,
          s.type,
          s.source,
          COALESCE(i.quantity, 0) AS quantity,
          i.updated_at
        FROM stickers s
        LEFT JOIN inventory i
          ON i.sticker_code = s.code AND i.profile_id = ?
        ORDER BY
          CASE
            WHEN s.type = 'intro' THEN 1
            WHEN s.type = 'museum' THEN 2
            ELSE 3
          END,
          s.team_order,
          LENGTH(s.code),
          s.code
      `)
      .all(profileId);

    response.json(stickers);
  });

  app.put('/api/profiles/:id/stickers/:code', (request, response) => {
    const profileId = Number.parseInt(request.params.id, 10);
    const { code } = request.params;
    const quantity = Math.max(0, Number.parseInt(request.body.quantity ?? 0, 10));

    if (!Number.isInteger(profileId)) {
      response.status(400).json({ error: 'ID de perfil inválido' });
      return;
    }

    const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId);
    if (!profile) {
      response.status(404).json({ error: 'Perfil no encontrado' });
      return;
    }

    const sticker = db.prepare('SELECT code FROM stickers WHERE code = ?').get(code);
    if (!sticker) {
      response.status(404).json({ error: 'Cromo no encontrado' });
      return;
    }

    db.prepare(`
      INSERT INTO inventory (profile_id, sticker_code, quantity, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(profile_id, sticker_code)
      DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP
    `).run(profileId, code, quantity);

    const row = db
      .prepare(`
        SELECT
          s.code,
          s.name,
          s.section,
          s.team,
          s.type,
          s.source,
          COALESCE(i.quantity, 0) AS quantity,
          i.updated_at
        FROM stickers s
        LEFT JOIN inventory i
          ON i.sticker_code = s.code AND i.profile_id = ?
        WHERE s.code = ?
      `)
      .get(profileId, code);

    response.json(row);
  });

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.use((request, response, next) => {
      if (request.path.startsWith('/api')) return next();
      response.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}
