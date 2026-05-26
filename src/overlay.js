// Apply the IndexedDB pending mutation queue on top of a sticker list, so the
// UI shows the user's offline edits even when we just fetched (or cached) a
// pre-sync server snapshot. Pure function — same inputs, same outputs (modulo
// the updated_at timestamp).
//
// Contract:
//   - `stickers`: array of sticker rows (server snapshot or cached snapshot).
//   - `queue`:    array of pending mutations: { profileId, code, quantity, ... }.
//   - `profileId`: only mutations matching this id are applied.
// Returns { stickers, overlayCount } — overlayCount is the number of queue
// entries that matched the profile (used to drive the "N pendientes" status
// label), not the number of stickers actually rewritten.
export function applyPendingOverlay(stickers, queue, profileId) {
  const overlay = new Map();
  for (const mutation of queue) {
    if (mutation.profileId === profileId) overlay.set(mutation.code, mutation.quantity);
  }
  if (overlay.size === 0) return { stickers, overlayCount: 0 };
  const timestamp = new Date().toISOString();
  const merged = stickers.map((sticker) =>
    overlay.has(sticker.code)
      ? { ...sticker, quantity: overlay.get(sticker.code), updated_at: timestamp }
      : sticker
  );
  return { stickers: merged, overlayCount: overlay.size };
}
