// packages/core-sync/browser.js
// Cliente unificado de sincronización Local-First para uso vanilla (<script>).
// Contrato vivo: POST {serverUrl}/sync/push  body: { deviceId, operations: [{ id, action, table, data }] }
// Local-First: si no hay serverUrl configurada, NO se intenta salir a la red; los datos quedan solo locales.
(function attachCoreSyncBrowser(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PampaCoreSync = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  const CONFIG_PREFIX = 'pampaCoreSyncConfig:';
  const DEVICE_PREFIX = 'pampaCoreSyncDevice:';
  const DEXIE_DB_NAME = 'PampaAgroDB';
  let dexieDb = null;

  function configKey(appId) { return `${CONFIG_PREFIX}${appId}`; }
  function deviceKey(appId) { return `${DEVICE_PREFIX}${appId}`; }

  function readConfig(appId) {
    try { return JSON.parse(localStorage.getItem(configKey(appId)) || '{}'); } catch (e) { return {}; }
  }

  function writeConfig(appId, config) {
    localStorage.setItem(configKey(appId), JSON.stringify(config || {}));
  }

  function getServerUrl(appId) {
    const configUrl = (readConfig(appId).serverUrl || '').trim();
    if (configUrl) return configUrl;
    try {
      const legacy = JSON.parse(localStorage.getItem('pampa_sync_config') || '{}');
      if (legacy.usaServidorPropio && legacy.ipServidor) return String(legacy.ipServidor).trim();
    } catch (e) {}
    return '';
  }

  function setServerUrl(appId, url) {
    writeConfig(appId, Object.assign({}, readConfig(appId), { serverUrl: (url || '').trim() }));
  }

  function isConfigured(appId) {
    return Boolean(getServerUrl(appId));
  }

  function getDeviceId(appId) {
    let id = localStorage.getItem(deviceKey(appId));
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(deviceKey(appId), id);
    }
    return id;
  }

  // Forma unificada de operación: { id, action: INSERT|UPDATE|DELETE, table, data, createdAt }
  function buildOperation(action, table, data, id) {
    return {
      id: id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      action,
      table,
      data,
      createdAt: new Date().toISOString()
    };
  }

  function getDexieDb() {
    if (dexieDb) return dexieDb;
    if (typeof Dexie === 'undefined') return null;
    dexieDb = new Dexie(DEXIE_DB_NAME);
    dexieDb.version(1).stores({ operaciones: 'id, action, table, pendiente_sincro' });
    return dexieDb;
  }

  async function addPendingOperation(appId, action, table, data, id) {
    const operation = buildOperation(action || 'UPSERT', table || 'operaciones', data || {}, id);
    const db = getDexieDb();
    if (!db) return operation;
    const row = Object.assign({}, operation, {
      appId: appId || 'pampa',
      pendiente_sincro: 1,
      data: operation.data
    });
    try { await db.operaciones.add(row); }
    catch (error) { await db.operaciones.put(row); }
    updateStatusIndicator({ pending: await countPendingOperations(appId) });
    return operation;
  }

  async function getPendingOperations(appId) {
    const db = getDexieDb();
    if (!db) return [];
    const rows = await db.operaciones.where('pendiente_sincro').equals(1).toArray();
    return rows
      .filter((row) => !appId || !row.appId || row.appId === appId)
      .map((row) => ({ id: row.id, action: row.action, table: row.table, data: row.data, createdAt: row.createdAt }));
  }

  async function countPendingOperations(appId) {
    if (!isConfigured(appId || 'pampa')) return 0;
    const db = getDexieDb();
    if (!db) return 0;
    const rows = await db.operaciones.where('pendiente_sincro').equals(1).toArray();
    return rows.filter((row) => !appId || !row.appId || row.appId === appId).length;
  }

  async function markAcceptedOperations(appId, acceptedIds) {
    const db = getDexieDb();
    if (!db) return;
    const accepted = new Set((acceptedIds || []).map(String));
    if (!accepted.size) return;
    const rows = await db.operaciones.where('pendiente_sincro').equals(1).toArray();
    await db.transaction('rw', db.operaciones, async () => {
      for (const row of rows) {
        if ((!appId || !row.appId || row.appId === appId) && accepted.has(String(row.id))) {
          await db.operaciones.put(Object.assign({}, row, { pendiente_sincro: 0, syncedAt: new Date().toISOString() }));
        }
      }
    });
  }

  function createStatusIndicator(options) {
    options = options || {};
    const id = options.id || 'pampaCoreSyncStatus';
    let el = document.getElementById(id);
    if (el) return el;

    const mountEl = options.mountEl || (options.mountSelector ? document.querySelector(options.mountSelector) : null);
    el = document.createElement('span');
    el.id = id;
    if (mountEl) {
      el.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;border:1px solid transparent;';
      mountEl.appendChild(el);
    } else {
      el.style.cssText = 'position:fixed;right:12px;top:12px;z-index:9999;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.18);border:1px solid transparent;';
      document.body.appendChild(el);
    }
    return el;
  }

  function updateStatusIndicator(state) {
    if (typeof document === 'undefined') return;
    const el = createStatusIndicator(state);
    const pending = Number(state && state.pending || 0);
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    const ok = pending === 0 && online;
    el.style.background = ok ? '#d4edda' : '#fff3cd';
    el.style.color = ok ? '#155724' : '#856404';
    el.style.borderColor = ok ? '#c3e6cb' : '#ffeeba';
    const label = ok ? 'En línea' : (online ? `🔒 Seguro en Local (${pending})` : '🔒 Seguro en Local');
    el.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;display:inline-block;background:${online ? '#28a745' : '#dc3545'}"></span><span>${label}</span>`;
  }

  async function readDefaultPendingRows() {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return [];
    const databases = await indexedDB.databases().catch(() => []);
    const rows = [];
    for (const item of databases) {
      if (!item || !item.name) continue;
      const db = await new Promise((resolve) => {
        const req = indexedDB.open(item.name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) continue;
      for (const storeName of Array.from(db.objectStoreNames)) {
        await new Promise((resolve) => {
          const tx = db.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).getAll();
          req.onsuccess = () => {
            (req.result || []).forEach((row) => {
              if (row && row.pendiente_sincro === true) {
                rows.push({ dbName: item.name, storeName, row, operation: buildOperation(row.action || row.accion || 'UPSERT', row.table || row.module || storeName, row.data || row.datos || row, String(row.id || row.syncKey || row.createdAt)) });
              }
            });
            resolve();
          };
          req.onerror = () => resolve();
        });
      }
      db.close();
    }
    return rows;
  }

  async function markDefaultAcceptedRows(entries, acceptedIds) {
    const accepted = new Set((acceptedIds || []).map(String));
    const grouped = new Map();
    entries.forEach((entry) => {
      if (!accepted.has(String(entry.operation.id))) return;
      const key = `${entry.dbName}\n${entry.storeName}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(entry);
    });
    for (const [key, group] of grouped.entries()) {
      const [dbName, storeName] = key.split('\n');
      const db = await new Promise((resolve) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) continue;
      await new Promise((resolve) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        group.forEach((entry) => store.put(Object.assign({}, entry.row, { pendiente_sincro: false, syncedAt: new Date().toISOString() })));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    }
  }

  async function pushOperations(appId, operations) {
    const serverUrl = getServerUrl(appId);
    if (!serverUrl) {
      return { ok: false, local: true, acceptedIds: [], message: 'Sin servidor propio configurado: los datos permanecen locales.' };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { ok: false, offline: true, acceptedIds: [], message: 'Sin conexión: se reintentará al reconectar.' };
    }

    const cleanBaseUrl = serverUrl.replace(/\/+$/, '');
    const deviceId = getDeviceId(appId);

    try {
      const response = await fetch(`${cleanBaseUrl}/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, operations: Array.isArray(operations) ? operations : [] })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || `Servidor propio respondió HTTP ${response.status}`);
      }
      const acceptedIds = Array.isArray(result.acceptedIds)
        ? result.acceptedIds
        : (Array.isArray(result.borrarDeIndexedDB) ? result.borrarDeIndexedDB : []);
      return { ok: true, acceptedIds, rawResponse: result };
    } catch (error) {
      return { ok: false, acceptedIds: [], error: error.message || 'No se pudo conectar con el servidor propio.' };
    }
  }

  function activarSincronizacionAutomatica(options) {
    options = options || {};
    const appId = options.appId || 'pampa';
    const intervalMs = options.intervalMs || 5 * 60 * 1000;
    const displayIntervalMs = options.displayIntervalMs || 10 * 1000;
    const indicatorOpts = { id: options.id, mountEl: options.mountEl, mountSelector: options.mountSelector };
    let syncing = false;

    async function countPending() {
      const customRows = typeof options.getPendingOperations === 'function' ? await options.getPendingOperations() : null;
      if (customRows) return customRows.length;
      const dexieCount = await countPendingOperations(appId);
      if (dexieCount) return dexieCount;
      return (await readDefaultPendingRows()).length;
    }

    async function refreshDisplay() {
      try { updateStatusIndicator(Object.assign({ pending: await countPending() }, indicatorOpts)); }
      catch (e) { /* el indicador no es crítico para el funcionamiento offline */ }
    }

    async function procesarSincroPendiente() {
      if (syncing) return;
      if (!isConfigured(appId)) {
        await refreshDisplay();
        console.log('[core-sync] Modo local puro: no hay servidor propio configurado.');
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) { await refreshDisplay(); return; }
      syncing = true;
      try {
        const customRows = typeof options.getPendingOperations === 'function' ? await options.getPendingOperations() : null;
        const dexieRows = customRows ? [] : await getPendingOperations(appId);
        const defaultEntries = customRows || dexieRows.length ? [] : await readDefaultPendingRows();
        const operations = customRows || dexieRows || defaultEntries.map((entry) => entry.operation);
        updateStatusIndicator(Object.assign({ pending: operations.length }, indicatorOpts));
        if (!operations.length) return;
        const result = await pushOperations(appId, operations);
        if (!result.ok) throw new Error(result.error || result.message || 'Sincronización no confirmada.');
        if (typeof options.markAccepted === 'function') await options.markAccepted(result.acceptedIds || []);
        else if (dexieRows.length) await markAcceptedOperations(appId, result.acceptedIds || []);
        else await markDefaultAcceptedRows(defaultEntries, result.acceptedIds || []);
        await refreshDisplay();
        console.log('[core-sync] Sincronización automática OK:', result.acceptedIds || []);
      } catch (error) {
        console.warn('[core-sync] Autoconexión pendiente:', error.message);
      } finally {
        syncing = false;
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', procesarSincroPendiente);
      window.addEventListener('offline', refreshDisplay);
      window.setInterval(() => { if (navigator.onLine) procesarSincroPendiente(); }, intervalMs);
      window.setInterval(refreshDisplay, displayIntervalMs);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { procesarSincroPendiente(); refreshDisplay(); }, { once: true });
      else { procesarSincroPendiente(); refreshDisplay(); }
    }
    return { procesarSincroPendiente, refreshDisplay };
  }

  return {
    getServerUrl,
    setServerUrl,
    isConfigured,
    getDeviceId,
    buildOperation,
    addPendingOperation,
    getPendingOperations,
    countPendingOperations,
    markAcceptedOperations,
    pushOperations,
    activarSincronizacionAutomatica,
    updateStatusIndicator
  };
}));
