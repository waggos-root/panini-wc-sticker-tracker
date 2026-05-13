const API_BASE = '/api';

export async function getStickers() {
  const response = await fetch(`${API_BASE}/stickers`);
  if (!response.ok) {
    throw new Error('No se pudo cargar la lista de cromos');
  }

  return response.json();
}

export async function updateStickerQuantity(code, quantity) {
  const response = await fetch(`${API_BASE}/stickers/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity }),
  });

  if (!response.ok) {
    throw new Error('No se pudo guardar el cromo');
  }

  return response.json();
}
