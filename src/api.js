const API_BASE = '/api';

async function jsonOrThrow(response, fallbackError) {
  if (!response.ok) {
    let detail = fallbackError;
    try {
      const body = await response.json();
      if (body?.error) detail = body.error;
    } catch (_error) {
      // body wasn't JSON; keep fallback
    }
    throw new Error(detail);
  }
  return response.json();
}

export async function getProfiles() {
  const response = await fetch(`${API_BASE}/profiles`);
  return jsonOrThrow(response, 'No se pudo cargar la lista de perfiles');
}

export async function createProfile({ name, emoji }) {
  const response = await fetch(`${API_BASE}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, emoji }),
  });
  return jsonOrThrow(response, 'No se pudo crear el perfil');
}

export async function deleteProfile(id) {
  const response = await fetch(`${API_BASE}/profiles/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    return jsonOrThrow(response, 'No se pudo borrar el perfil');
  }
}

export async function getStickers(profileId) {
  const response = await fetch(`${API_BASE}/profiles/${profileId}/stickers`);
  return jsonOrThrow(response, 'No se pudo cargar la lista de cromos');
}

export async function updateStickerQuantity(profileId, code, quantity) {
  const response = await fetch(
    `${API_BASE}/profiles/${profileId}/stickers/${encodeURIComponent(code)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    }
  );
  return jsonOrThrow(response, 'No se pudo guardar el cromo');
}
