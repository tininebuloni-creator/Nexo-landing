(function (global) {
  const DEFAULT_DB = 'pampa-offline';
  const DEFAULT_VERSION = 1;
  const DEFAULT_SYNC_PATH = '/api/sync';

  function createOfflineStore(options) {
    const config = { dbName: DEFAULT_DB, version: DEFAULT_VERSION, syncPath: DEFAULT_SYNC_PATH, ...(options || {}) };
    let database;
    let syncing = false;
    const listeners = new Set();

    function emit(event) {
      listeners.forEach((listener) => { try { listener(event); } catch {} });
    }

    function open() {
      if (database) return Promise.resolve(database);
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(config.dbName, config.version);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        };
        request.onsuccess = () => { database = request.result; resolve(database); };
        request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento offline.'));
      });
    }

    function transaction(storeName, mode, operation) {
      return open().then((db) => new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }));
    }

    function get(storeName, key) { return transaction(storeName, 'readonly', (store) => store.get(key)); }
    function put(storeName, value) { return transaction(storeName, 'readwrite', (store) => store.put(value)); }
    function getAll(storeName) { return transaction(storeName, 'readonly', (store) => store.getAll()); }

    async function save(key, value) {
      await put('records', { key, value, updatedAt: new Date().toISOString() });
      emit({ type: 'saved', key });
      return value;
    }

    async function load(key, fallback) {
      const record = await get('records', key);
      return record ? record.value : fallback;
    }

    async function enqueue(operation) {
      const item = { id: operation.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: new Date().toISOString(), ...operation };
      await put('outbox', item);
      emit({ type: 'queued', item });
      if (navigator.onLine) sync().catch(() => {});
      return item;
    }

    async function pending() { return getAll('outbox'); }

    async function sync() {
      if (syncing || !navigator.onLine) return { ok: false, offline: true, synced: 0 };
      const items = await pending();
      if (!items.length) return { ok: true, synced: 0 };
      syncing = true;
      emit({ type: 'syncing', count: items.length });
      try {
        const response = await fetch(config.syncUrl || config.syncPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: config.app || 'pampa', operations: items }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw new Error(result.error || `Sincronización HTTP ${response.status}`);
        const confirmed = new Set(result.confirmedIds || result.borrarDeIndexedDB || items.map((item) => item.id));
        for (const item of items) if (confirmed.has(item.id)) await transaction('outbox', 'readwrite', (store) => store.delete(item.id));
        const summary = { ok: true, synced: confirmed.size, result };
        emit({ type: 'synced', ...summary });
        return summary;
      } catch (error) {
        emit({ type: 'sync-error', error });
        return { ok: false, synced: 0, error: error.message };
      } finally { syncing = false; }
    }

    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    window.addEventListener('online', () => sync().catch(() => {}));
    return { open, save, load, enqueue, pending, sync, subscribe, config };
  }

  global.PampaOfflineCore = { createOfflineStore };
}(window));
