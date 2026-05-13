import { useEffect, useMemo, useState } from 'react';
import {
  createProfile,
  deleteProfile,
  getProfiles,
  getStickers,
  updateStickerQuantity,
} from './api.js';

const ACTIVE_PROFILE_KEY = 'panini.activeProfile';

const VIEWS = [
  { id: 'album', label: 'Álbum' },
  { id: 'missing', label: 'Faltantes' },
  { id: 'repeated', label: 'Repetidos' },
];

const VALID_VIEWS = VIEWS.map((option) => option.id);

function readViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('view');
  return VALID_VIEWS.includes(value) ? value : 'album';
}

function stickerClass(quantity) {
  if (!quantity) return 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100';
  if (quantity === 1) return 'border-green-500 bg-green-100 text-green-900';
  return 'border-yellow-500 bg-yellow-100 text-yellow-900';
}

const SOURCE_BADGES = {
  coca_cola: { label: 'Coca-Cola', className: 'bg-red-600 text-white' },
  other_exclusive: { label: 'Exclusivo', className: 'bg-purple-600 text-white' },
};

export default function App() {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [stickers, setStickers] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState(readViewFromUrl);
  const [syncStatus, setSyncStatus] = useState('Cargando...');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileEmoji, setNewProfileEmoji] = useState('⚽');

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);

  useEffect(() => {
    async function loadProfiles() {
      try {
        const rows = await getProfiles();
        setProfiles(rows);
        const stored = Number.parseInt(window.localStorage.getItem(ACTIVE_PROFILE_KEY) ?? '', 10);
        const initial = rows.find((profile) => profile.id === stored)?.id ?? rows[0]?.id ?? null;
        setActiveProfileId(initial);
      } catch (error) {
        setSyncStatus('Error cargando perfiles');
      }
    }
    loadProfiles();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (view === 'album') {
      params.delete('view');
    } else {
      params.set('view', view);
    }
    const query = params.toString();
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [view]);

  useEffect(() => {
    function onPopState() {
      setView(readViewFromUrl());
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (activeProfileId == null) return;
    window.localStorage.setItem(ACTIVE_PROFILE_KEY, String(activeProfileId));

    async function loadStickers() {
      try {
        const rows = await getStickers(activeProfileId);
        setStickers(rows);
        setSyncStatus('Sincronizado con SQLite');
      } catch (error) {
        setSyncStatus('Error conectando con SQLite/API');
      }
    }
    loadStickers();
  }, [activeProfileId]);

  async function setQuantity(code, quantity) {
    if (activeProfileId == null) return;
    const cleanQuantity = Math.max(0, quantity);
    const previous = stickers.find((sticker) => sticker.code === code)?.quantity ?? 0;

    setStickers((current) =>
      current.map((sticker) =>
        sticker.code === code ? { ...sticker, quantity: cleanQuantity } : sticker
      )
    );

    try {
      await updateStickerQuantity(activeProfileId, code, cleanQuantity);
      setSyncStatus('Sincronizado con SQLite');
    } catch (error) {
      setStickers((current) =>
        current.map((sticker) =>
          sticker.code === code ? { ...sticker, quantity: previous } : sticker
        )
      );
      setSyncStatus('Error guardando en SQLite');
    }
  }

  async function handleCreateProfile(event) {
    event.preventDefault();
    const name = newProfileName.trim();
    const emoji = newProfileEmoji.trim() || '⚽';
    if (!name) return;

    try {
      const created = await createProfile({ name, emoji });
      setProfiles((current) => [...current, created]);
      setActiveProfileId(created.id);
      setShowCreateForm(false);
      setNewProfileName('');
      setNewProfileEmoji('⚽');
      setSyncStatus('Perfil creado');
    } catch (error) {
      setSyncStatus(error.message);
    }
  }

  async function handleDeleteProfile() {
    if (!activeProfile || profiles.length <= 1) return;
    const confirmed = window.confirm(
      `¿Borrar el perfil "${activeProfile.name}" y todas sus cantidades?`
    );
    if (!confirmed) return;

    try {
      await deleteProfile(activeProfile.id);
      const remaining = profiles.filter((profile) => profile.id !== activeProfile.id);
      setProfiles(remaining);
      setActiveProfileId(remaining[0]?.id ?? null);
      setSyncStatus('Perfil borrado');
    } catch (error) {
      setSyncStatus(error.message);
    }
  }

  const totalStickers = stickers.length;
  const ownedCount = stickers.filter((sticker) => sticker.quantity > 0).length;
  const repeatedCount = stickers.reduce(
    (total, sticker) => total + Math.max(0, sticker.quantity - 1),
    0
  );
  const missingCount = totalStickers - ownedCount;

  const viewStickers = useMemo(() => {
    const q = search.toLowerCase();
    return stickers.filter((sticker) => {
      if (view === 'missing' && sticker.quantity !== 0) return false;
      if (view === 'repeated' && sticker.quantity < 2) return false;
      if (!q) return true;
      return `${sticker.code} ${sticker.name} ${sticker.team || ''}`.toLowerCase().includes(q);
    });
  }, [stickers, search, view]);

  const miscStickers = viewStickers.filter(
    (sticker) => sticker.type === 'intro' || sticker.type === 'museum'
  );

  const countryTeams = [
    ...new Set(stickers.filter((sticker) => sticker.team).map((sticker) => sticker.team)),
  ];

  function renderStickerRow(sticker) {
    const badge = SOURCE_BADGES[sticker.source];
    const isRepeated = view === 'repeated';

    return (
      <li
        key={sticker.code}
        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
      >
        <span className="w-20 shrink-0 rounded bg-slate-100 px-2 py-1 text-center font-mono text-xs font-bold text-slate-700">
          {sticker.code}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-800">{sticker.name}</div>
          {sticker.team && (
            <div className="truncate text-xs text-slate-500">{sticker.team}</div>
          )}
        </div>
        {badge && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${badge.className}`}>
            {badge.label}
          </span>
        )}
        {isRepeated && (
          <span className="shrink-0 rounded-lg bg-yellow-100 px-2 py-1 text-xs font-bold text-yellow-900">
            ×{sticker.quantity}
            <span className="ml-1 font-normal opacity-70">+{sticker.quantity - 1}</span>
          </span>
        )}
        <div className="flex shrink-0 gap-1">
          {isRepeated && (
            <button
              onClick={() => setQuantity(sticker.code, sticker.quantity - 1)}
              className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-bold hover:bg-red-100"
              title="Quitar uno"
            >
              −
            </button>
          )}
          <button
            onClick={() => setQuantity(sticker.code, sticker.quantity + 1)}
            className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-bold hover:bg-green-100"
            title={isRepeated ? 'Sumar uno' : 'Marcar como obtenido'}
          >
            +
          </button>
        </div>
      </li>
    );
  }

  function renderSticker(sticker) {
    const badge = SOURCE_BADGES[sticker.source];

    return (
      <div key={sticker.code} className="rounded-xl border border-slate-200 bg-white p-2">
        <button
          onClick={() => setQuantity(sticker.code, sticker.quantity + 1)}
          className={`w-full min-h-16 rounded-lg border p-2 text-left transition ${stickerClass(sticker.quantity)}`}
          title="Clic: sumar uno. Usa - para corregir."
        >
          <div className="flex items-start justify-between gap-1">
            <span className="block text-xs font-bold">{sticker.code}</span>
            {badge && (
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none ${badge.className}`}>
                {badge.label}
              </span>
            )}
          </div>
          <span className="block text-[11px] leading-tight opacity-80">{sticker.name}</span>
          <span className="mt-1 inline-block text-[11px] font-semibold">
            Cantidad: {sticker.quantity}
          </span>
        </button>

        <div className="mt-2 grid grid-cols-3 gap-1">
          <button
            onClick={() => setQuantity(sticker.code, sticker.quantity - 1)}
            className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-bold hover:bg-red-100"
          >
            -
          </button>
          <button
            onClick={() => setQuantity(sticker.code, 0)}
            className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-xs hover:bg-slate-200"
          >
            0
          </button>
          <button
            onClick={() => setQuantity(sticker.code, 1)}
            className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-xs hover:bg-green-100"
          >
            1
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-lg">
          <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-slate-200 pb-4">
            <span className="text-sm font-medium text-slate-500">Perfil:</span>
            <select
              value={activeProfileId ?? ''}
              onChange={(event) => setActiveProfileId(Number.parseInt(event.target.value, 10))}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.emoji} {profile.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowCreateForm((value) => !value)}
              className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold hover:bg-blue-100"
              title="Nuevo perfil"
            >
              + Nuevo
            </button>
            <button
              onClick={handleDeleteProfile}
              disabled={profiles.length <= 1}
              className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
              title="Borrar perfil activo"
            >
              × Borrar
            </button>
          </div>

          {showCreateForm && (
            <form
              onSubmit={handleCreateProfile}
              className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 p-4"
            >
              <input
                type="text"
                value={newProfileEmoji}
                onChange={(event) => setNewProfileEmoji(event.target.value)}
                placeholder="⚽"
                maxLength={4}
                className="w-16 rounded-xl border border-slate-300 px-3 py-2 text-center text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={newProfileName}
                onChange={(event) => setNewProfileName(event.target.value)}
                placeholder="Nombre del perfil"
                autoFocus
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancelar
              </button>
            </form>
          )}

          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="mb-2 text-4xl font-bold text-slate-800">
                Álbum Panini Mundial 2026
              </h1>
              <p className="text-slate-600">
                Clic una vez: lo tienes. Clic dos o más veces: repetido. Usa -, 0 y 1 para corregir.
              </p>
            </div>

            <span className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
              {syncStatus}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-2xl bg-green-100 p-4">
              <p className="text-sm font-medium text-green-700">Cromos obtenidos</p>
              <h2 className="text-3xl font-bold text-green-900">{ownedCount}</h2>
            </div>

            <div className="rounded-2xl bg-red-100 p-4">
              <p className="text-sm font-medium text-red-700">Faltantes</p>
              <h2 className="text-3xl font-bold text-red-900">{missingCount}</h2>
            </div>

            <div className="rounded-2xl bg-yellow-100 p-4">
              <p className="text-sm font-medium text-yellow-700">Repetidos extra</p>
              <h2 className="text-3xl font-bold text-yellow-900">{repeatedCount}</h2>
            </div>

            <div className="rounded-2xl bg-blue-100 p-4">
              <p className="text-sm font-medium text-blue-700">Total base</p>
              <h2 className="text-3xl font-bold text-blue-900">{totalStickers}</h2>
            </div>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-lg">
          <div className="mb-6 flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-slate-800">Control de cromos</h2>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                {VIEWS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setView(option.id)}
                    className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
                      view === option.id
                        ? 'bg-white text-slate-900 shadow'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar país, jugador o cromo..."
              className="w-full rounded-xl border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 md:w-80"
            />
          </div>

          {view === 'album' ? (
            <div className="space-y-8">
              <section>
                <h3 className="mb-3 text-xl font-bold text-slate-800">
                  Cromos iniciales / misceláneos
                </h3>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  {miscStickers.map(renderSticker)}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-xl font-bold text-slate-800">
                  Selecciones nacionales
                </h3>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {countryTeams.map((team) => {
                    const teamStickers = viewStickers.filter((sticker) => sticker.team === team);
                    if (teamStickers.length === 0) return null;

                    const ownedTeam = stickers.filter(
                      (sticker) => sticker.team === team && sticker.quantity > 0
                    ).length;

                    return (
                      <div key={team} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <h4 className="font-semibold text-slate-800">{team}</h4>
                          <span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700">
                            {ownedTeam}/20
                          </span>
                        </div>

                        <div className="grid grid-cols-4 gap-2">
                          {teamStickers.map(renderSticker)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : (
            <div>
              <p className="mb-3 text-sm text-slate-600">
                {view === 'missing'
                  ? `${viewStickers.length} cromo${viewStickers.length === 1 ? '' : 's'} faltante${viewStickers.length === 1 ? '' : 's'}.`
                  : `${viewStickers.length} cromo${viewStickers.length === 1 ? '' : 's'} repetido${viewStickers.length === 1 ? '' : 's'}.`}
              </p>
              {viewStickers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  {view === 'missing'
                    ? 'Ya no te faltan cromos. ¡Felicidades!'
                    : 'No tienes cromos repetidos.'}
                </div>
              ) : (
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {viewStickers.map(renderStickerRow)}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
