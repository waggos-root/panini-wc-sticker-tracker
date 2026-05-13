import { useEffect, useMemo, useState } from 'react';
import { getStickers, updateStickerQuantity } from './api.js';

function statusFor(quantity) {
  if (!quantity) return 'Faltante';
  if (quantity === 1) return 'Tengo';
  return 'Repetido';
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
  const [stickers, setStickers] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('Todos');
  const [syncStatus, setSyncStatus] = useState('Cargando...');

  async function loadStickers() {
    try {
      const rows = await getStickers();
      setStickers(rows);
      setSyncStatus('Sincronizado con SQLite');
    } catch (error) {
      setSyncStatus('Error conectando con SQLite/API');
    }
  }

  useEffect(() => {
    loadStickers();
  }, []);

  async function setQuantity(code, quantity) {
    const cleanQuantity = Math.max(0, quantity);
    const previous = stickers.find((sticker) => sticker.code === code)?.quantity ?? 0;

    setStickers((current) =>
      current.map((sticker) =>
        sticker.code === code ? { ...sticker, quantity: cleanQuantity } : sticker
      )
    );

    try {
      await updateStickerQuantity(code, cleanQuantity);
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

  const totalStickers = stickers.length;
  const ownedCount = stickers.filter((sticker) => sticker.quantity > 0).length;

  const repeatedCount = stickers.reduce((total, sticker) => {
    return total + Math.max(0, sticker.quantity - 1);
  }, 0);

  const missingCount = totalStickers - ownedCount;

  const visibleStickers = useMemo(() => {
    return stickers.filter((sticker) => {
      const searchable = `${sticker.code} ${sticker.name} ${sticker.team || ''}`.toLowerCase();
      const matchesSearch = searchable.includes(search.toLowerCase());
      const matchesFilter = filter === 'Todos' || statusFor(sticker.quantity) === filter;

      return matchesSearch && matchesFilter;
    });
  }, [stickers, search, filter]);

  const miscStickers = visibleStickers.filter(
    (sticker) => sticker.type === 'intro' || sticker.type === 'museum'
  );

  const countryTeams = [...new Set(stickers.filter((sticker) => sticker.team).map((sticker) => sticker.team))];

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
            <h2 className="text-2xl font-bold text-slate-800">Control de cromos</h2>

            <div className="flex w-full gap-3 md:w-auto">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar país, jugador o cromo..."
                className="w-full rounded-xl border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 md:w-80"
              />

              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="rounded-xl border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Todos</option>
                <option>Tengo</option>
                <option>Faltante</option>
                <option>Repetido</option>
              </select>
            </div>
          </div>

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
                  const teamStickers = visibleStickers.filter((sticker) => sticker.team === team);
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
        </div>
      </div>
    </div>
  );
}
