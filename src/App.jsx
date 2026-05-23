import { useEffect, useMemo, useState } from 'react';
import {
  backupDatabase,
  createProfile,
  deleteProfile,
  getProfiles,
  getStickers,
  updateProfile,
  updateStickerQuantity,
} from './api.js';
import * as idb from './idb.js';
import { teamGradient } from './teamColors.js';
import { TEAM_INFO } from './teamFlags.js';

const ACTIVE_PROFILE_KEY = 'panini.activeProfile';
const LEGACY_PENDING_KEY = 'panini.pending';
const SYNC_TAG = 'panini-sync';

async function migrateLegacyPendingFromLocalStorage() {
  const raw = window.localStorage.getItem(LEGACY_PENDING_KEY);
  if (!raw) return;
  try {
    const legacy = JSON.parse(raw);
    if (Array.isArray(legacy)) {
      for (const mutation of legacy) {
        if (mutation?.profileId != null && mutation?.code) {
          await idb.putPending({
            profileId: mutation.profileId,
            code: mutation.code,
            quantity: mutation.quantity ?? 0,
          });
        }
      }
    }
  } catch (_error) {
    // legacy payload corrupt; drop it
  }
  window.localStorage.removeItem(LEGACY_PENDING_KEY);
}

async function requestBackgroundSync() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.sync.register(SYNC_TAG);
  } catch (_error) {
    // Background Sync not granted / unavailable — page-side flush still runs.
  }
}

const VIEWS = [
  { id: 'album', label: 'Álbum' },
  { id: 'missing', label: 'Faltantes' },
  { id: 'repeated', label: 'Repetidos' },
  { id: 'completed', label: 'Completos' },
  { id: 'report', label: 'Reporte' },
];

const TEAM_STICKER_COUNT = 20;

const VALID_VIEWS = VIEWS.map((option) => option.id);
const VALID_SORTS = ['album', 'desc', 'asc'];

function readViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('view');
  return VALID_VIEWS.includes(value) ? value : 'album';
}

function readSortFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get('sort');
  return VALID_SORTS.includes(value) ? value : 'album';
}

function stickerClass(quantity) {
  if (!quantity) return 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100';
  if (quantity === 1) return 'border-green-500 bg-green-100 text-green-900';
  return 'border-yellow-500 bg-yellow-100 text-yellow-900';
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function spareChipClass(spares) {
  if (spares <= 1) return 'bg-yellow-300 text-yellow-900';
  if (spares <= 2) return 'bg-amber-400 text-amber-950';
  if (spares <= 3) return 'bg-orange-300 text-orange-900';
  if (spares <= 4) return 'bg-orange-400 text-orange-950';
  if (spares <= 5) return 'bg-orange-500 text-white';
  if (spares <= 6) return 'bg-orange-600 text-white';
  if (spares <= 7) return 'bg-red-500 text-white';
  if (spares <= 8) return 'bg-red-600 text-white';
  if (spares <= 9) return 'bg-red-700 text-white';
  return 'bg-red-800 text-white';
}

const SOURCE_BADGES = {
  coca_cola: { label: 'Coca-Cola', className: 'bg-red-600 text-white' },
  other_exclusive: { label: 'Exclusivo', className: 'bg-purple-600 text-white' },
};

function stickerNumber(code) {
  return String(parseInt(code.match(/\d+/)[0], 10));
}

function groupForReport(stickers) {
  const fwc = [];
  const byTeam = new Map();
  for (const sticker of stickers) {
    const num = stickerNumber(sticker.code);
    if (sticker.type === 'country' && sticker.team) {
      if (!byTeam.has(sticker.team)) byTeam.set(sticker.team, []);
      byTeam.get(sticker.team).push(num);
    } else {
      fwc.push(num);
    }
  }
  return { fwc, byTeam };
}

function formatReportSection(stickers) {
  const { fwc, byTeam } = groupForReport(stickers);
  const lines = [];
  if (fwc.length > 0) lines.push(`FWC 📜: ${fwc.join(', ')}`);
  for (const [team, nums] of byTeam) {
    const info = TEAM_INFO[team];
    const label = info ? `${info.code} ${info.flag}` : team;
    lines.push(`${label}: ${nums.join(', ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : '(ninguno)';
}

function buildReport(stickers) {
  const missing = stickers.filter((sticker) => sticker.quantity === 0);
  const spares = stickers
    .filter((sticker) => sticker.quantity >= 2)
    .flatMap((sticker) => Array(sticker.quantity - 1).fill(sticker));
  return [
    'FALTANTES',
    formatReportSection(missing),
    '',
    'REPETIDOS',
    formatReportSection(spares),
  ].join('\n');
}

export default function App() {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [stickers, setStickers] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState(readViewFromUrl);
  const [teamSort, setTeamSort] = useState(readSortFromUrl);
  const [compactList, setCompactList] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Cargando...');
  const [pending, setPending] = useState([]);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);

  async function refreshPendingFromDb() {
    const rows = await idb.getAllPending();
    setPending(rows);
  }
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileEmoji, setNewProfileEmoji] = useState('⚽');
  const [showEditForm, setShowEditForm] = useState(false);
  const [editProfileName, setEditProfileName] = useState('');
  const [editProfileEmoji, setEditProfileEmoji] = useState('⚽');
  const [reportCopied, setReportCopied] = useState(false);

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId);

  useEffect(() => {
    async function loadProfiles() {
      let serverProfiles = [];
      let loadError = null;
      let usedCache = false;
      try {
        serverProfiles = await getProfiles();
        await idb.setCachedProfiles(serverProfiles);
      } catch (error) {
        loadError = error;
        serverProfiles = await idb.getCachedProfiles();
        usedCache = serverProfiles.length > 0;
      }
      const pendingProfiles = (await idb.getAllPendingProfiles()).map((entry) => ({
        id: entry.tempId,
        name: entry.name,
        emoji: entry.emoji,
        created_at: new Date(entry.ts).toISOString(),
        pending: true,
      }));
      const combined = [...serverProfiles, ...pendingProfiles];
      setProfiles(combined);
      const stored = Number.parseInt(window.localStorage.getItem(ACTIVE_PROFILE_KEY) ?? '', 10);
      const initial = combined.find((profile) => profile.id === stored)?.id ?? combined[0]?.id ?? null;
      setActiveProfileId(initial);
      if (loadError && combined.length === 0) {
        setSyncStatus('Error cargando perfiles');
      } else if (loadError && usedCache) {
        setSyncStatus('Sin conexión: perfiles desde caché');
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
    if (teamSort === 'album') {
      params.delete('sort');
    } else {
      params.set('sort', teamSort);
    }
    const query = params.toString();
    const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [view, teamSort]);

  useEffect(() => {
    function onPopState() {
      setView(readViewFromUrl());
      setTeamSort(readSortFromUrl());
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    function onOnline() { setIsOnline(true); }
    function onOffline() { setIsOnline(false); }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    (async () => {
      await migrateLegacyPendingFromLocalStorage();
      await refreshPendingFromDb();
    })();
  }, []);

  useEffect(() => {
    if (activeProfileId == null) return;
    idb.setActiveProfileId(activeProfileId).catch(() => {});
  }, [activeProfileId]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    async function onMessage(event) {
      if (event.data?.type !== 'panini-synced') return;
      await refreshPendingFromDb();
      if (event.data.profileId === activeProfileId) {
        try {
          const rows = await getStickers(activeProfileId);
          setStickers(rows);
          setSyncStatus('Sincronizado en segundo plano');
        } catch (_error) {
          // ignore
        }
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [activeProfileId]);

  const pendingForActive = useMemo(
    () => pending.filter((mutation) => mutation.profileId === activeProfileId),
    [pending, activeProfileId]
  );

  const pendingProfileCount = useMemo(
    () => profiles.filter((profile) => profile.pending).length,
    [profiles]
  );

  useEffect(() => {
    if (!isOnline || syncing || activeProfileId == null) return;
    if (pendingForActive.length === 0 && pendingProfileCount === 0) return;

    let cancelled = false;

    async function sync() {
      setSyncing(true);
      setSyncStatus('Respaldando base de datos...');
      try {
        await backupDatabase();
      } catch (error) {
        if (!cancelled) {
          setSyncStatus(`Error al respaldar: ${error.message}`);
          setSyncing(false);
        }
        return;
      }
      if (cancelled) { setSyncing(false); return; }

      // Step 1: materialize any pending (temp) profiles. Each that succeeds
      // gets remapped: queued mutations and (if applicable) the active id
      // switch from the temp id to the real server-assigned id.
      let currentActiveId = activeProfileId;
      const idRemap = new Map();
      const stillPendingProfiles = [];
      const localPendingProfiles = await idb.getAllPendingProfiles();

      if (localPendingProfiles.length > 0) {
        setSyncStatus(`Creando ${localPendingProfiles.length} perfil(es)...`);
        for (const profile of localPendingProfiles) {
          if (cancelled) break;
          try {
            const created = await createProfile({ name: profile.name, emoji: profile.emoji });
            idRemap.set(profile.tempId, created.id);
            await idb.deletePendingProfile(profile.tempId);
            await idb.remapPendingProfileId(profile.tempId, created.id);
          } catch (_error) {
            stillPendingProfiles.push(profile);
          }
        }
      }

      if (idRemap.size > 0) {
        if (idRemap.has(currentActiveId)) {
          currentActiveId = idRemap.get(currentActiveId);
          setActiveProfileId(currentActiveId);
          await idb.setActiveProfileId(currentActiveId);
        }
        let refreshed = [];
        try {
          refreshed = await getProfiles();
        } catch (_error) { /* keep going with whatever we have */ }
        if (!cancelled) {
          setProfiles([
            ...refreshed,
            ...stillPendingProfiles.map((p) => ({
              id: p.tempId,
              name: p.name,
              emoji: p.emoji,
              created_at: new Date(p.ts).toISOString(),
              pending: true,
            })),
          ]);
        }
        await refreshPendingFromDb();
      }
      if (cancelled) { setSyncing(false); return; }

      // Step 2: drain pending mutations for the (possibly remapped) active id.
      const allPending = await idb.getAllPending();
      const forActive = allPending.filter((mutation) => mutation.profileId === currentActiveId);

      if (forActive.length === 0) {
        if (!cancelled) {
          setSyncStatus(stillPendingProfiles.length ? `${stillPendingProfiles.length} perfil(es) no creados` : 'Sincronizado');
          setSyncing(false);
        }
        return;
      }

      setSyncStatus(`Sincronizando ${forActive.length} cambios...`);
      const failed = [];
      for (const mutation of forActive) {
        if (cancelled) break;
        try {
          await updateStickerQuantity(mutation.profileId, mutation.code, mutation.quantity);
          await idb.deletePending(mutation.profileId, mutation.code);
        } catch (_error) {
          failed.push(mutation);
        }
      }
      if (cancelled) { setSyncing(false); return; }

      setPending((current) => {
        const others = current.filter((mutation) => mutation.profileId !== currentActiveId);
        return [...others, ...failed];
      });

      try {
        const rows = await getStickers(currentActiveId);
        if (!cancelled) setStickers(rows);
      } catch (_error) { /* best-effort */ }

      if (!cancelled) {
        setSyncStatus(failed.length ? `${failed.length} cambios no sincronizados` : 'Sincronizado');
        setSyncing(false);
      }
    }

    sync();
    return () => { cancelled = true; };
  }, [isOnline, activeProfileId, pendingForActive.length, pendingProfileCount]);

  useEffect(() => {
    if (activeProfileId == null) return;
    window.localStorage.setItem(ACTIVE_PROFILE_KEY, String(activeProfileId));

    let cancelled = false;

    async function load() {
      if (activeProfileId < 0) {
        let catalog = stickers;
        if (catalog.length === 0) {
          const serverProfile = profiles.find((profile) => !profile.pending);
          if (serverProfile) {
            const cached = await idb.getCachedStickers(serverProfile.id);
            if (cached && cached.length > 0) catalog = cached;
          }
        }
        if (cancelled) return;
        if (catalog.length === 0) {
          setSyncStatus('Perfil pendiente: sin catálogo en caché');
          return;
        }
        const overlay = new Map();
        for (const mutation of pending) {
          if (mutation.profileId === activeProfileId) overlay.set(mutation.code, mutation.quantity);
        }
        setStickers(
          catalog.map((sticker) => ({
            ...sticker,
            quantity: overlay.has(sticker.code) ? overlay.get(sticker.code) : 0,
            updated_at: overlay.has(sticker.code) ? new Date().toISOString() : null,
          }))
        );
        setSyncStatus('Perfil pendiente: se creará al reconectar');
        return;
      }

      try {
        const rows = await getStickers(activeProfileId);
        if (cancelled) return;
        setStickers(rows);
        await idb.setCachedStickers(activeProfileId, rows);
        setSyncStatus('Sincronizado con SQLite');
      } catch (_error) {
        const cached = await idb.getCachedStickers(activeProfileId);
        if (cancelled) return;
        if (cached && cached.length > 0) {
          setStickers(cached);
          setSyncStatus('Sin conexión: cromos desde caché');
        } else {
          setSyncStatus('Error conectando con SQLite/API');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [activeProfileId]);

  async function enqueueMutation(profileId, code, quantity) {
    await idb.putPending({ profileId, code, quantity });
    setPending((current) => {
      const filtered = current.filter(
        (mutation) => !(mutation.profileId === profileId && mutation.code === code)
      );
      return [
        ...filtered,
        { profileId, code, quantity, ts: Date.now(), key: `${profileId}:${code}` },
      ];
    });
    requestBackgroundSync();
  }

  async function setQuantity(code, quantity) {
    if (activeProfileId == null) return;
    const cleanQuantity = Math.max(0, quantity);

    setStickers((current) =>
      current.map((sticker) =>
        sticker.code === code ? { ...sticker, quantity: cleanQuantity } : sticker
      )
    );

    if (!isOnline) {
      await enqueueMutation(activeProfileId, code, cleanQuantity);
      return;
    }

    try {
      await updateStickerQuantity(activeProfileId, code, cleanQuantity);
      setSyncStatus('Sincronizado con SQLite');
    } catch (_error) {
      await enqueueMutation(activeProfileId, code, cleanQuantity);
      setSyncStatus('Cambio guardado localmente. Se sincronizará al reconectar.');
    }
  }

  function exportCsv() {
    if (viewStickers.length === 0) return;
    const isRepeated = view === 'repeated';
    const header = isRepeated
      ? ['codigo', 'nombre', 'equipo', 'cantidad', 'extras']
      : ['codigo', 'nombre', 'equipo'];
    const lines = [header.map(csvEscape).join(',')];
    for (const sticker of viewStickers) {
      const row = isRepeated
        ? [sticker.code, sticker.name, sticker.team || '', sticker.quantity, sticker.quantity - 1]
        : [sticker.code, sticker.name, sticker.team || ''];
      lines.push(row.map(csvEscape).join(','));
    }
    const csv = `\ufeff${lines.join('\n')}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const slug = (activeProfile?.name || 'perfil').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `panini-${isRepeated ? 'repetidos' : 'faltantes'}-${slug}-${date}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function clearCreateForm() {
    setShowCreateForm(false);
    setNewProfileName('');
    setNewProfileEmoji('⚽');
  }

  async function createTempProfile(name, emoji) {
    const tempId = -Date.now();
    await idb.putPendingProfile({ tempId, name, emoji });
    setProfiles((current) => [
      ...current,
      { id: tempId, name, emoji, created_at: new Date().toISOString(), pending: true },
    ]);
    setActiveProfileId(tempId);
    clearCreateForm();
    setSyncStatus('Perfil creado offline. Se materializará al reconectar.');
    requestBackgroundSync();
  }

  async function handleCreateProfile(event) {
    event.preventDefault();
    const name = newProfileName.trim();
    const emoji = newProfileEmoji.trim() || '⚽';
    if (!name) return;

    if (!isOnline) {
      await createTempProfile(name, emoji);
      return;
    }

    try {
      const created = await createProfile({ name, emoji });
      setProfiles((current) => [...current, created]);
      setActiveProfileId(created.id);
      clearCreateForm();
      setSyncStatus('Perfil creado');
    } catch (error) {
      // Distinguish "name already taken" (409) from network failures. Server
      // errors should be surfaced; network errors should still let the user
      // proceed offline.
      if (/existe/i.test(error.message)) {
        setSyncStatus(error.message);
        return;
      }
      await createTempProfile(name, emoji);
    }
  }

  function openEditForm() {
    if (!activeProfile) return;
    setEditProfileName(activeProfile.name);
    setEditProfileEmoji(activeProfile.emoji);
    setShowEditForm(true);
    setShowCreateForm(false);
  }

  async function handleEditProfile(event) {
    event.preventDefault();
    if (!activeProfile) return;
    const name = editProfileName.trim();
    const emoji = editProfileEmoji.trim() || '⚽';
    if (!name) return;

    if (activeProfile.pending) {
      // Temp profile lives only in IDB — overwrite the entry and the state row.
      await idb.putPendingProfile({ tempId: activeProfile.id, name, emoji });
      setProfiles((current) =>
        current.map((profile) => (profile.id === activeProfile.id ? { ...profile, name, emoji } : profile))
      );
      setShowEditForm(false);
      setSyncStatus('Perfil pendiente actualizado');
      return;
    }

    if (!isOnline) {
      setSyncStatus('Renombrar un perfil del servidor solo está disponible con conexión');
      return;
    }

    try {
      const updated = await updateProfile(activeProfile.id, { name, emoji });
      setProfiles((current) =>
        current.map((profile) => (profile.id === activeProfile.id ? { ...profile, ...updated } : profile))
      );
      setShowEditForm(false);
      setSyncStatus('Perfil actualizado');
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

    // Temp/pending profile lives only locally — drop the IDB entry and any
    // queued mutations; nothing to call on the server.
    if (activeProfile.pending) {
      await idb.deletePendingProfile(activeProfile.id);
      await idb.clearPendingForProfile(activeProfile.id);
      const remaining = profiles.filter((profile) => profile.id !== activeProfile.id);
      setProfiles(remaining);
      setActiveProfileId(remaining[0]?.id ?? null);
      setPending((current) => current.filter((mutation) => mutation.profileId !== activeProfile.id));
      setSyncStatus('Perfil pendiente descartado');
      return;
    }

    try {
      await deleteProfile(activeProfile.id);
      const remaining = profiles.filter((profile) => profile.id !== activeProfile.id);
      setProfiles(remaining);
      setActiveProfileId(remaining[0]?.id ?? null);
      await idb.clearPendingForProfile(activeProfile.id);
      setPending((current) => current.filter((mutation) => mutation.profileId !== activeProfile.id));
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

  const countryTeams = useMemo(
    () => [...new Set(stickers.filter((sticker) => sticker.team).map((sticker) => sticker.team))],
    [stickers]
  );

  const completedTeams = useMemo(() => {
    const owned = new Map(countryTeams.map((team) => [team, 0]));
    for (const sticker of stickers) {
      if (sticker.team && sticker.quantity > 0) {
        owned.set(sticker.team, owned.get(sticker.team) + 1);
      }
    }
    return countryTeams.filter((team) => owned.get(team) === TEAM_STICKER_COUNT);
  }, [countryTeams, stickers]);

  const reportText = useMemo(() => buildReport(stickers), [stickers]);

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(reportText);
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    } catch (_error) {
      setReportCopied(false);
    }
  }

  const sortedCountryTeams = useMemo(() => {
    if (teamSort === 'album') return countryTeams;
    const owned = new Map(countryTeams.map((team) => [team, 0]));
    for (const sticker of stickers) {
      if (sticker.team && sticker.quantity > 0) {
        owned.set(sticker.team, owned.get(sticker.team) + 1);
      }
    }
    const albumIndex = new Map(countryTeams.map((team, index) => [team, index]));
    const direction = teamSort === 'desc' ? -1 : 1;
    return [...countryTeams].sort((a, b) => {
      const diff = (owned.get(a) - owned.get(b)) * direction;
      return diff !== 0 ? diff : albumIndex.get(a) - albumIndex.get(b);
    });
  }, [countryTeams, stickers, teamSort]);

  function renderStickerRow(sticker) {
    const badge = SOURCE_BADGES[sticker.source];
    const isRepeated = view === 'repeated';

    return (
      <li
        key={sticker.code}
        className={`flex items-center rounded-xl border border-slate-200 bg-white ${
          compactList ? 'gap-2 px-2 py-1' : 'gap-3 px-3 py-2'
        }`}
      >
        <span
          className={`shrink-0 rounded bg-slate-100 text-center font-mono font-bold text-slate-700 ${
            compactList ? 'w-14 px-1.5 py-0.5 text-[11px]' : 'w-20 px-2 py-1 text-xs'
          }`}
        >
          {sticker.code}
        </span>
        <div className="min-w-0 flex-1">
          {compactList ? (
            <div className="truncate text-xs text-slate-800">
              <span className="font-medium">{sticker.name}</span>
              {sticker.team && <span className="text-slate-500"> · {sticker.team}</span>}
            </div>
          ) : (
            <>
              <div className="truncate text-sm font-medium text-slate-800">{sticker.name}</div>
              {sticker.team && (
                <div className="truncate text-xs text-slate-500">{sticker.team}</div>
              )}
            </>
          )}
        </div>
        {badge && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${badge.className}`}>
            {badge.label}
          </span>
        )}
        {isRepeated && (
          <span
            className={`shrink-0 rounded-lg font-bold ${spareChipClass(sticker.quantity - 1)} ${
              compactList ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'
            }`}
            title={`Tienes ${sticker.quantity} (${sticker.quantity - 1} de sobra)`}
          >
            +{sticker.quantity - 1}
          </span>
        )}
        {!compactList && (
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
        )}
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
        {(!isOnline || pendingForActive.length > 0) && (
          <div
            className={`rounded-2xl px-4 py-3 text-sm font-medium shadow ${
              !isOnline
                ? 'bg-amber-100 text-amber-900'
                : 'bg-blue-100 text-blue-900'
            }`}
          >
            {!isOnline
              ? `Sin conexión. ${pendingForActive.length} cambio${pendingForActive.length === 1 ? '' : 's'} guardado${pendingForActive.length === 1 ? '' : 's'} localmente.`
              : syncing
              ? `Sincronizando ${pendingForActive.length} cambio${pendingForActive.length === 1 ? '' : 's'}...`
              : `${pendingForActive.length} cambio${pendingForActive.length === 1 ? '' : 's'} pendiente${pendingForActive.length === 1 ? '' : 's'} de sincronizar.`}
          </div>
        )}
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
                  {profile.emoji} {profile.name}{profile.pending ? ' (pendiente)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={() => { setShowCreateForm((value) => !value); setShowEditForm(false); }}
              className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold hover:bg-blue-100"
              title="Nuevo perfil"
            >
              + Nuevo
            </button>
            <button
              onClick={openEditForm}
              disabled={!activeProfile}
              className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold hover:bg-yellow-100 disabled:cursor-not-allowed disabled:opacity-40"
              title="Renombrar perfil activo"
            >
              ✎ Editar
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

          {showEditForm && activeProfile && (
            <form
              onSubmit={handleEditProfile}
              className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-yellow-50 p-4"
            >
              <input
                type="text"
                value={editProfileEmoji}
                onChange={(event) => setEditProfileEmoji(event.target.value)}
                placeholder="⚽"
                maxLength={4}
                className="w-16 rounded-xl border border-slate-300 px-3 py-2 text-center text-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
              />
              <input
                type="text"
                value={editProfileName}
                onChange={(event) => setEditProfileName(event.target.value)}
                placeholder="Nombre del perfil"
                autoFocus
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
              />
              <button
                type="submit"
                className="rounded-xl bg-yellow-500 px-4 py-2 text-sm font-bold text-white hover:bg-yellow-600"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setShowEditForm(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancelar
              </button>
            </form>
          )}

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

          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <button
              type="button"
              onClick={() => setView('album')}
              className="rounded-2xl bg-green-100 p-4 text-left transition hover:bg-green-200 focus:outline-none focus:ring-2 focus:ring-green-500"
              title="Ver el álbum"
            >
              <p className="text-sm font-medium text-green-700">Cromos obtenidos</p>
              <h2 className="text-3xl font-bold text-green-900">{ownedCount}</h2>
            </button>

            <button
              type="button"
              onClick={() => setView('missing')}
              className="rounded-2xl bg-red-100 p-4 text-left transition hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
              title="Ver cromos faltantes"
            >
              <p className="text-sm font-medium text-red-700">Faltantes</p>
              <h2 className="text-3xl font-bold text-red-900">{missingCount}</h2>
            </button>

            <button
              type="button"
              onClick={() => setView('repeated')}
              className="rounded-2xl bg-yellow-100 p-4 text-left transition hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-500"
              title="Ver cromos repetidos"
            >
              <p className="text-sm font-medium text-yellow-700">Repetidos extra</p>
              <h2 className="text-3xl font-bold text-yellow-900">{repeatedCount}</h2>
            </button>

            <div className="rounded-2xl bg-blue-100 p-4">
              <p className="text-sm font-medium text-blue-700">Total base</p>
              <h2 className="text-3xl font-bold text-blue-900">{totalStickers}</h2>
            </div>

            <button
              type="button"
              onClick={() => setView('completed')}
              className="rounded-2xl bg-purple-100 p-4 text-left transition hover:bg-purple-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
              title="Ver selecciones completas"
            >
              <p className="text-sm font-medium text-purple-700">Selecciones completas</p>
              <h2 className="text-3xl font-bold text-purple-900">
                {completedTeams.length}
                <span className="text-base font-medium text-purple-700">/{countryTeams.length || 48}</span>
              </h2>
            </button>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-lg">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <h2 className="text-2xl font-bold text-slate-800">Control de cromos</h2>
              <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
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
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-xl font-bold text-slate-800">
                    Selecciones nacionales
                  </h3>
                  <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
                    <button
                      onClick={() => setTeamSort('album')}
                      className={`rounded-lg px-3 py-1 font-medium transition ${
                        teamSort === 'album'
                          ? 'bg-white text-slate-900 shadow'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Orden del álbum
                    </button>
                    <button
                      onClick={() => setTeamSort('desc')}
                      className={`rounded-lg px-3 py-1 font-medium transition ${
                        teamSort === 'desc'
                          ? 'bg-white text-slate-900 shadow'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      title="Más cromos obtenidos primero"
                    >
                      Más cromos
                    </button>
                    <button
                      onClick={() => setTeamSort('asc')}
                      className={`rounded-lg px-3 py-1 font-medium transition ${
                        teamSort === 'asc'
                          ? 'bg-white text-slate-900 shadow'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      title="Menos cromos obtenidos primero"
                    >
                      Menos cromos
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {sortedCountryTeams.map((team) => {
                    const teamStickers = viewStickers.filter((sticker) => sticker.team === team);
                    if (teamStickers.length === 0) return null;

                    const ownedTeam = stickers.filter(
                      (sticker) => sticker.team === team && sticker.quantity > 0
                    ).length;

                    const background = teamGradient(team);

                    return (
                      <div
                        key={team}
                        style={background ? { background } : undefined}
                        className="rounded-2xl border border-slate-200 p-4"
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <h4 className="rounded-full bg-white/70 px-2 py-1 text-sm font-semibold text-slate-800 backdrop-blur-sm">
                            {ownedTeam === TEAM_STICKER_COUNT ? '🏆 ' : ''}
                            {TEAM_INFO[team]?.flag && `${TEAM_INFO[team].flag} `}
                            {team}
                          </h4>
                          <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-semibold text-slate-700 backdrop-blur-sm">
                            {ownedTeam}/{TEAM_STICKER_COUNT}
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
          ) : view === 'report' ? (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Lista compacta de faltantes y repetidos, agrupada por selección.
                </p>
                <button
                  type="button"
                  onClick={copyReport}
                  className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-blue-100"
                >
                  {reportCopied ? '¡Copiado!' : 'Copiar'}
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-800">
                {reportText}
              </pre>
            </div>
          ) : view === 'completed' ? (
            <div>
              <p className="mb-3 text-sm text-slate-600">
                {completedTeams.length} selecci{completedTeams.length === 1 ? 'ón' : 'ones'} completa{completedTeams.length === 1 ? '' : 's'}.
              </p>
              {completedTeams.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  Todavía no has completado ninguna selección. ¡Sigue así!
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {completedTeams.map((team) => {
                    const background = teamGradient(team);
                    return (
                      <div
                        key={team}
                        style={background ? { background } : undefined}
                        className="flex items-center justify-between rounded-2xl border border-slate-200 p-4"
                      >
                        <h4 className="rounded-full bg-white/70 px-3 py-1 text-base font-semibold text-slate-800 backdrop-blur-sm">
                          🏆 {TEAM_INFO[team]?.flag && `${TEAM_INFO[team].flag} `}{team}
                        </h4>
                        <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-semibold text-slate-700 backdrop-blur-sm">
                          {TEAM_STICKER_COUNT}/{TEAM_STICKER_COUNT}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  {view === 'missing'
                    ? `${viewStickers.length} cromo${viewStickers.length === 1 ? '' : 's'} faltante${viewStickers.length === 1 ? '' : 's'}.`
                    : `${viewStickers.length} cromo${viewStickers.length === 1 ? '' : 's'} repetido${viewStickers.length === 1 ? '' : 's'}.`}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    title="Oculta los botones y compacta las filas para compartir"
                  >
                    <input
                      type="checkbox"
                      checked={compactList}
                      onChange={(event) => setCompactList(event.target.checked)}
                      className="h-4 w-4 cursor-pointer"
                    />
                    Compacto
                  </label>
                  <button
                    type="button"
                    onClick={exportCsv}
                    disabled={viewStickers.length === 0}
                    className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Descargar la lista visible como CSV"
                  >
                    Exportar CSV
                  </button>
                </div>
              </div>
              {viewStickers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  {view === 'missing'
                    ? 'Ya no te faltan cromos. ¡Felicidades!'
                    : 'No tienes cromos repetidos.'}
                </div>
              ) : (
                <ul
                  className={`grid grid-cols-1 ${
                    compactList
                      ? 'gap-1 md:grid-cols-3 xl:grid-cols-4'
                      : 'gap-2 md:grid-cols-2 xl:grid-cols-3'
                  }`}
                >
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
