import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { backfillTeamOrder, createDb, stripTeamPrefixFromNames } from './database.js';

function startServer() {
  const db = createDb(':memory:');
  const app = createApp(db);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        db,
        stop: () =>
          new Promise((done) => {
            server.close(() => {
              db.close();
              done();
            });
          }),
      });
    });
  });
}

async function api(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe('catalog seed', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server.stop());

  test('seeds exactly 980 stickers with unique codes', () => {
    const rows = server.db.prepare('SELECT code FROM stickers').all();
    assert.equal(rows.length, 980);
    assert.equal(new Set(rows.map((row) => row.code)).size, 980);
  });

  test('seeds the catalog into 9 intro / 11 museum / 960 country', () => {
    const counts = server.db
      .prepare('SELECT type, COUNT(*) AS n FROM stickers GROUP BY type')
      .all()
      .reduce((acc, row) => ({ ...acc, [row.type]: row.n }), {});
    assert.deepEqual(counts, { intro: 9, museum: 11, country: 960 });
  });

  test('all stickers default to source=pack', () => {
    const distinct = server.db.prepare('SELECT DISTINCT source FROM stickers').all();
    assert.deepEqual(distinct, [{ source: 'pack' }]);
  });

  test('country sticker names do not carry the team prefix', () => {
    const sample = server.db
      .prepare("SELECT code, name, team FROM stickers WHERE type = 'country' AND team = 'Argentina' ORDER BY LENGTH(code), code")
      .all();
    assert.equal(sample[0].name, 'Team Logo');
    assert.equal(sample[1].name, 'Player 1');
    assert.equal(sample[12].name, 'Team Photo');
    assert.ok(sample.every((row) => !row.name.startsWith(row.team)));
  });
});

describe('backup endpoint', () => {
  test('POST /api/backup returns 400 for in-memory DB', async () => {
    const db = createDb(':memory:');
    const app = createApp(db);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve({ s, port: s.address().port }));
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/backup`, { method: 'POST' });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.match(body.error, /memoria/i);
    } finally {
      await new Promise((r) => server.s.close(r));
      db.close();
    }
  });

  test('POST /api/backup writes a timestamped .bak alongside the DB file', async () => {
    const tmpPath = path.join(os.tmpdir(), `panini-test-${Date.now()}.sqlite`);
    const db = createDb(tmpPath);
    const app = createApp(db);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve({ s, port: s.address().port }));
    });
    let backupPath;
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/backup`, { method: 'POST' });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.ok(body.path.startsWith(tmpPath));
      assert.ok(body.path.endsWith('.bak'));
      assert.ok(fs.existsSync(body.path));
      assert.ok(fs.statSync(body.path).size > 0);
      backupPath = body.path;
    } finally {
      await new Promise((r) => server.s.close(r));
      db.close();
      for (const file of [tmpPath, `${tmpPath}-shm`, `${tmpPath}-wal`, backupPath]) {
        if (file && fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
  });
});

describe('legacy migrations', () => {
  test('backfillTeamOrder populates team_order from album-data order', () => {
    const db = createDb(':memory:');
    db.exec("UPDATE stickers SET team_order = NULL WHERE type = 'country'");

    backfillTeamOrder(db);

    // Group A positions 1–4
    assert.equal(db.prepare("SELECT team_order FROM stickers WHERE code = 'MEX1'").get().team_order, 0);
    assert.equal(db.prepare("SELECT team_order FROM stickers WHERE code = 'RSA1'").get().team_order, 1);
    assert.equal(db.prepare("SELECT team_order FROM stickers WHERE code = 'KOR1'").get().team_order, 2);
    assert.equal(db.prepare("SELECT team_order FROM stickers WHERE code = 'CZE1'").get().team_order, 3);
    // Group B position 1
    assert.equal(db.prepare("SELECT team_order FROM stickers WHERE code = 'CAN1'").get().team_order, 4);
    db.close();
  });

  test('backfillTeamOrder overwrites stale values (re-sync after album reorder)', () => {
    const db = createDb(':memory:');
    db.exec("UPDATE stickers SET team_order = 999 WHERE type = 'country'");

    backfillTeamOrder(db);

    const mexico = db.prepare("SELECT team_order FROM stickers WHERE code = 'MEX1'").get();
    assert.equal(mexico.team_order, 0);
    db.close();
  });

  test('stripTeamPrefixFromNames renames pre-existing "<team> Player N" rows', () => {
    const db = createDb(':memory:');
    db.prepare(`
      UPDATE stickers
      SET name = team || ' ' || name
      WHERE type = 'country' AND team IS NOT NULL
    `).run();

    assert.equal(
      db.prepare("SELECT name FROM stickers WHERE code = 'ARG2'").get().name,
      'Argentina Player 1'
    );

    stripTeamPrefixFromNames(db);

    assert.equal(
      db.prepare("SELECT name FROM stickers WHERE code = 'ARG2'").get().name,
      'Player 1'
    );
    db.close();
  });
});

describe('default profile', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server.stop());

  test('GET /api/profiles returns Default after fresh init', async () => {
    const { status, body } = await api(server.baseUrl, '/api/profiles');
    assert.equal(status, 200);
    assert.equal(body.length, 1);
    assert.match(body[0].name, /^Default$/);
    assert.equal(body[0].emoji, '⚽');
  });

  test('GET /api/profiles/:id/stickers returns 980 rows with quantity 0', async () => {
    const { status, body } = await api(server.baseUrl, '/api/profiles/1/stickers');
    assert.equal(status, 200);
    assert.equal(body.length, 980);
    assert.ok(body.every((sticker) => sticker.quantity === 0));
    assert.ok(body.every((sticker) => sticker.updated_at === null));
  });

  test('sticker ordering puts intro first, then museum, then country sorted numerically', async () => {
    const { body } = await api(server.baseUrl, '/api/profiles/1/stickers');
    const firstIntro = body.findIndex((row) => row.type === 'intro');
    const firstMuseum = body.findIndex((row) => row.type === 'museum');
    const firstCountry = body.findIndex((row) => row.type === 'country');
    assert.ok(firstIntro < firstMuseum && firstMuseum < firstCountry);

    const argCodes = body.filter((row) => row.team === 'Argentina').map((row) => row.code);
    assert.deepEqual(argCodes.slice(0, 3), ['ARG1', 'ARG2', 'ARG3']);
    assert.equal(argCodes[9], 'ARG10');
  });

  test('country teams come out in group-draw order (Group A first)', async () => {
    const { body } = await api(server.baseUrl, '/api/profiles/1/stickers');
    const teamsInOrder = [...new Set(body.filter((row) => row.team).map((row) => row.team))];
    // Group A
    assert.deepEqual(teamsInOrder.slice(0, 4), ['Mexico', 'South Africa', 'South Korea', 'Czechia']);
    // Group B
    assert.deepEqual(teamsInOrder.slice(4, 8), ['Canada', 'Bosnia and Herzegovina', 'Qatar', 'Switzerland']);
    // Group L (last)
    assert.deepEqual(teamsInOrder.slice(-4), ['England', 'Croatia', 'Ghana', 'Panama']);
  });
});

describe('profile CRUD', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server.stop());

  test('POST creates a profile', async () => {
    const { status, body } = await api(server.baseUrl, '/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: 'Mario', emoji: '🧒' }),
    });
    assert.equal(status, 201);
    assert.equal(body.name, 'Mario');
    assert.equal(body.emoji, '🧒');
  });

  test('POST rejects empty name with 400', async () => {
    const { status, body } = await api(server.baseUrl, '/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(status, 400);
    assert.match(body.error, /nombre/i);
  });

  test('POST rejects duplicate name with 409', async () => {
    const { status, body } = await api(server.baseUrl, '/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: 'Default' }),
    });
    assert.equal(status, 409);
    assert.match(body.error, /existe/i);
  });

  test('DELETE removes a non-last profile', async () => {
    await api(server.baseUrl, '/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: 'Temp' }),
    });
    const before = await api(server.baseUrl, '/api/profiles');
    const target = before.body.find((profile) => profile.name === 'Temp');

    const { status } = await api(server.baseUrl, `/api/profiles/${target.id}`, {
      method: 'DELETE',
    });
    assert.equal(status, 204);

    const after = await api(server.baseUrl, '/api/profiles');
    assert.ok(!after.body.some((profile) => profile.id === target.id));
  });

  test('DELETE refuses to remove the last profile', async () => {
    const all = await api(server.baseUrl, '/api/profiles');
    for (const profile of all.body.slice(1)) {
      await api(server.baseUrl, `/api/profiles/${profile.id}`, { method: 'DELETE' });
    }
    const remaining = await api(server.baseUrl, '/api/profiles');
    assert.equal(remaining.body.length, 1);

    const { status, body } = await api(server.baseUrl, `/api/profiles/${remaining.body[0].id}`, {
      method: 'DELETE',
    });
    assert.equal(status, 409);
    assert.match(body.error, /último/i);
  });
});

describe('inventory writes', () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server.stop());

  test('PUT upserts quantity and reflects in subsequent GET', async () => {
    const put = await api(server.baseUrl, '/api/profiles/1/stickers/ARG1', {
      method: 'PUT',
      body: JSON.stringify({ quantity: 3 }),
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.quantity, 3);

    const list = await api(server.baseUrl, '/api/profiles/1/stickers');
    const arg1 = list.body.find((row) => row.code === 'ARG1');
    assert.equal(arg1.quantity, 3);
  });

  test('PUT clamps negative quantities to 0', async () => {
    const { body } = await api(server.baseUrl, '/api/profiles/1/stickers/ARG2', {
      method: 'PUT',
      body: JSON.stringify({ quantity: -5 }),
    });
    assert.equal(body.quantity, 0);
  });

  test('PUT on unknown sticker returns 404', async () => {
    const { status } = await api(server.baseUrl, '/api/profiles/1/stickers/NOPE99', {
      method: 'PUT',
      body: JSON.stringify({ quantity: 1 }),
    });
    assert.equal(status, 404);
  });

  test('PUT on unknown profile returns 404', async () => {
    const { status } = await api(server.baseUrl, '/api/profiles/999/stickers/ARG1', {
      method: 'PUT',
      body: JSON.stringify({ quantity: 1 }),
    });
    assert.equal(status, 404);
  });

  test('quantities are isolated per profile', async () => {
    const created = await api(server.baseUrl, '/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: 'Isolated', emoji: '🧪' }),
    });
    const otherId = created.body.id;

    await api(server.baseUrl, '/api/profiles/1/stickers/MEX1', {
      method: 'PUT',
      body: JSON.stringify({ quantity: 7 }),
    });

    const defaultList = await api(server.baseUrl, '/api/profiles/1/stickers');
    const otherList = await api(server.baseUrl, `/api/profiles/${otherId}/stickers`);

    assert.equal(defaultList.body.find((row) => row.code === 'MEX1').quantity, 7);
    assert.equal(otherList.body.find((row) => row.code === 'MEX1').quantity, 0);
  });

  test('deleting a profile cascades inventory rows', async () => {
    const created = await api(server.baseUrl, '/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: 'Doomed', emoji: '💀' }),
    });
    const id = created.body.id;

    await api(server.baseUrl, `/api/profiles/${id}/stickers/BRA1`, {
      method: 'PUT',
      body: JSON.stringify({ quantity: 2 }),
    });

    const before = server.db
      .prepare('SELECT COUNT(*) AS n FROM inventory WHERE profile_id = ?')
      .get(id).n;
    assert.equal(before, 1);

    await api(server.baseUrl, `/api/profiles/${id}`, { method: 'DELETE' });

    const after = server.db
      .prepare('SELECT COUNT(*) AS n FROM inventory WHERE profile_id = ?')
      .get(id).n;
    assert.equal(after, 0);
  });
});
