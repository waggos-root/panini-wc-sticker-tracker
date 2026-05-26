import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPendingOverlay } from './overlay.js';

function baseSticker(code, quantity = 0, overrides = {}) {
  return {
    code,
    name: `Sticker ${code}`,
    section: 'group_a',
    team: 'Argentina',
    type: 'country',
    source: 'pack',
    quantity,
    updated_at: null,
    ...overrides,
  };
}

describe('applyPendingOverlay', () => {
  test('returns the original list unchanged when the queue is empty', () => {
    const stickers = [baseSticker('ARG1'), baseSticker('ARG2')];
    const { stickers: result, overlayCount } = applyPendingOverlay(stickers, [], 1);
    assert.equal(overlayCount, 0);
    assert.equal(result, stickers);
  });

  test('returns the original list unchanged when no queue entries match the profile', () => {
    const stickers = [baseSticker('ARG1', 0)];
    const queue = [{ profileId: 2, code: 'ARG1', quantity: 5 }];
    const { stickers: result, overlayCount } = applyPendingOverlay(stickers, queue, 1);
    assert.equal(overlayCount, 0);
    assert.equal(result, stickers);
  });

  test('overlays quantity from a queued mutation for the matching profile', () => {
    const stickers = [baseSticker('ARG1', 0), baseSticker('ARG2', 1)];
    const queue = [{ profileId: 1, code: 'ARG1', quantity: 3 }];
    const { stickers: result, overlayCount } = applyPendingOverlay(stickers, queue, 1);
    assert.equal(overlayCount, 1);
    assert.equal(result[0].quantity, 3);
    assert.equal(typeof result[0].updated_at, 'string');
    assert.equal(result[1].quantity, 1);
    assert.equal(result[1].updated_at, null);
  });

  test('ignores mutations for other profiles even when sticker codes match', () => {
    const stickers = [baseSticker('ARG1', 0)];
    const queue = [
      { profileId: 2, code: 'ARG1', quantity: 99 },
      { profileId: 1, code: 'ARG1', quantity: 7 },
    ];
    const { stickers: result, overlayCount } = applyPendingOverlay(stickers, queue, 1);
    assert.equal(overlayCount, 1);
    assert.equal(result[0].quantity, 7);
  });

  test('overlays a quantity of zero (the data-loss regression case)', () => {
    // If a user clears a sticker offline, the queued value is 0. A naive
    // `overlay.get(code) || sticker.quantity` would silently fall through and
    // show the stale server quantity instead, which is the exact class of bug
    // this helper exists to prevent.
    const stickers = [baseSticker('ARG1', 3)];
    const queue = [{ profileId: 1, code: 'ARG1', quantity: 0 }];
    const { stickers: result, overlayCount } = applyPendingOverlay(stickers, queue, 1);
    assert.equal(overlayCount, 1);
    assert.equal(result[0].quantity, 0);
  });

  test('last queue entry per code wins when the same code appears twice', () => {
    // putPending dedupes on (profileId, code), so the live queue shouldn't
    // have collisions — but the contract should still be deterministic if a
    // legacy migration ever produced one. Map.set keeps the latest insertion.
    const stickers = [baseSticker('ARG1', 0)];
    const queue = [
      { profileId: 1, code: 'ARG1', quantity: 2 },
      { profileId: 1, code: 'ARG1', quantity: 5 },
    ];
    const { stickers: result } = applyPendingOverlay(stickers, queue, 1);
    assert.equal(result[0].quantity, 5);
  });

  test('preserves non-quantity fields on overlaid stickers', () => {
    const stickers = [
      baseSticker('ARG1', 0, { name: 'Lionel', team: 'Argentina', source: 'coca_cola' }),
    ];
    const queue = [{ profileId: 1, code: 'ARG1', quantity: 4 }];
    const { stickers: result } = applyPendingOverlay(stickers, queue, 1);
    assert.equal(result[0].name, 'Lionel');
    assert.equal(result[0].team, 'Argentina');
    assert.equal(result[0].source, 'coca_cola');
    assert.equal(result[0].quantity, 4);
  });

  test('skips queue entries whose code is not present in the sticker list', () => {
    const stickers = [baseSticker('ARG1', 0)];
    const queue = [{ profileId: 1, code: 'GHOST', quantity: 5 }];
    const { stickers: result } = applyPendingOverlay(stickers, queue, 1);
    assert.equal(result.length, 1);
    assert.equal(result[0].code, 'ARG1');
    assert.equal(result[0].quantity, 0);
  });

  test('does not mutate the input arrays or sticker objects', () => {
    const stickers = [baseSticker('ARG1', 0)];
    const queue = [{ profileId: 1, code: 'ARG1', quantity: 9 }];
    const stickersBefore = JSON.parse(JSON.stringify(stickers));
    const queueBefore = JSON.parse(JSON.stringify(queue));
    applyPendingOverlay(stickers, queue, 1);
    assert.deepEqual(stickers, stickersBefore);
    assert.deepEqual(queue, queueBefore);
  });
});
