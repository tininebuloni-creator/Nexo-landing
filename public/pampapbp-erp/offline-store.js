/* Pampa PBP - capa de datos offline-first
 * - Las lecturas de la API se guardan en el equipo; sin señal se responde con la última copia.
 * - Las altas, cambios y bajas sin señal quedan en una cola local y se envían solas al volver
 *   la conexión, en el mismo orden en que se hicieron.
 * - Mientras haya operaciones en cola, la copia local de /api/bootstrap ya las muestra aplicadas.
 * Se carga antes del script principal: window.PampaOffline.request reemplaza a fetch en api().
 */
(() => {
  'use strict';
  const PREFIX = 'pbp:';
  const QUEUE_KEY = PREFIX + 'queue', FAILED_KEY = PREFIX + 'failed', SYNC_KEY = PREFIX + 'lastSync';
  const NETWORK_TIMEOUT_MS = 8000;

  const read = (key, fallback) => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const cacheKey = path => PREFIX + 'cache:' + path.split('?')[0] + (path.includes('?') ? '?' + path.split('?')[1] : '');

  class OfflineError extends Error {}

  // Colecciones de /api/bootstrap que se pueden crear, modificar o borrar por ruta
  const COLLECTIONS = {
    batches: 'batches', lots: 'lots', recipes: 'recipes', equipment: 'equipment',
    transactions: 'transactions', costs: 'costs', employees: 'employees', trainings: 'trainings', exchanges: 'exchanges',
    'tender-blocks': 'tenderBlocks', 'tender-milestones': 'tenderMilestones',
    'bank-accounts': 'bankAccounts', 'fin-movements': 'finMovements', cheques: 'cheques', credits: 'credits',
    'swap-contracts': 'swapContracts', 'swap-movements': 'swapMovements',
    'installations': 'installations', 'inventory-items': 'inventoryItems', 'inventory-movements': 'inventoryMovements',
    'quality-controls': 'qualityBatchControls', 'homogeneity-tests': 'homogeneityTests', 'lab-analyses': 'labAnalyses', 'quality-audits': 'qualityAudits',
    'waste-containers': 'wasteContainers', 'waste-washes': 'wasteWashes', 'waste-deliveries': 'wasteDeliveries', 'waste-other': 'wasteOther'
  };

  function parseRoute(path) {
    const clean = path.split('?')[0];
    const parts = clean.replace(/^\/api\//, '').split('/').map(decodeURIComponent);
    return { clean, parts };
  }

  // Aplica una operación pendiente a una copia de bootstrap (para mostrarla sin señal)
  function applyOperation(data, op, pending = true) {
    const { parts } = parseRoute(op.path);
    const body = op.body || {};
    const [resource, id, action] = parts;
    if (resource === 'settings' && op.method === 'PUT') {
      data.settings = { ...(data.settings || {}), [id]: body.value };
      return data;
    }
    if (resource === 'manufacturing-orders' && action === 'close') {
      const batch = (data.batches || []).find(b => b.id === id);
      if (batch) batch.status = 'Terminado';
      return data;
    }
    const key = COLLECTIONS[resource];
    if (!key) return data;
    const list = Array.isArray(data[key]) ? data[key] : (data[key] = []);
    if (op.method === 'POST' && !id) {
      if (!list.some(item => item.id === body.id)) list.unshift(pending ? { ...body, _pending: true } : { ...body });
    } else if (op.method === 'PUT' && id) {
      const item = list.find(x => x.id === id);
      if (item) Object.assign(item, body, pending ? { _pending: true } : {});
    } else if (op.method === 'DELETE' && id) {
      data[key] = list.filter(x => x.id !== id);
    }
    return data;
  }

  function withQueue(data) {
    const copy = JSON.parse(JSON.stringify(data || {}));
    return read(QUEUE_KEY, []).reduce((acc, op) => applyOperation(acc, op, true), copy);
  }

  // Respuesta inmediata para una escritura que quedó en cola
  function optimisticResult(op) {
    const { parts } = parseRoute(op.path);
    const [resource, id, action] = parts;
    const body = op.body || {};
    if (resource === 'manufacturing-orders' && action === 'close') {
      const batch = (read(cacheKey('/api/bootstrap'), {}).batches || []).find(b => b.id === id);
      const theoretical = batch ? Number(batch.volume) * 1000 : 0, real = Number(body.realTotalWeight);
      const deviationPct = theoretical > 0 ? Number(((real - theoretical) / theoretical * 100).toFixed(2)) : 0;
      const abs = Math.abs(deviationPct);
      return { offline: true, status: 'Terminado', deviationPct, statusFlag: abs >= 5 ? 'CRITICO' : abs >= 2 ? 'ALERTA' : 'OK' };
    }
    if (resource === 'telemetry') {
      const value = Number(body.valueNumeric);
      const eq = String(body.equipmentName || '').toUpperCase(), param = String(body.parameterMeasured || '').toUpperCase();
      const t = { tempMin: 82, tempMax: 85, retentionMin: 30, retentionMax: 45, ...((read(cacheKey('/api/bootstrap'), {}).settings || {}).qualityTargets || {}) };
      const range = eq === 'ACONDICIONADOR' ? (param === 'TEMPERATURA' ? [t.tempMin, t.tempMax] : param === 'RETENCION' ? [t.retentionMin, t.retentionMax] : null) : null;
      const flag = eq === 'MOLINO_MARTILLOS' && param === 'AMPERAJE' ? (value >= 30 ? 'CRITICO' : value >= 26 ? 'ALERTA' : 'OK') : range ? (value < range[0] ? 'CRITICO' : value > range[1] ? 'ALERTA' : 'OK') : 'OK';
      return { offline: true, status: 'EN COLA', processedFlag: flag, log: { ...body, id: 'local-' + op.id, statusFlag: flag, loggedAt: new Date().toISOString() } };
    }
    if (resource === 'settings') return { offline: true, key: id, value: body.value };
    if (op.method === 'DELETE') return { offline: true, ok: true };
    if (op.method === 'PUT') {
      const key = COLLECTIONS[resource];
      const current = key ? (withQueue(read(cacheKey('/api/bootstrap'), {}))[key] || []).find(x => x.id === id) : null;
      return { ...(current || {}), ...body, offline: true };
    }
    return { ...body, offline: true, _pending: true };
  }

  async function networkFetch(path, options) {
    if (navigator.onLine === false) throw new OfflineError('Sin conexión');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(path, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    } catch {
      throw new OfflineError('Sin conexión con el servidor');
    } finally { clearTimeout(timer); }
    const payload = await response.json().catch(() => ({ error: 'Respuesta inválida del servidor' }));
    // El service worker responde 503 + offline:true cuando no hay red
    if (response.status === 503 && payload && payload.offline) throw new OfflineError('Sin conexión con el servidor');
    return { response, payload };
  }

  /* ---------- Cola de sincronización ---------- */
  let flushing = null, online = navigator.onLine !== false;

  function status() {
    return { online, pending: read(QUEUE_KEY, []).length, failed: read(FAILED_KEY, []), lastSync: read(SYNC_KEY, null) };
  }
  function emitStatus() { document.dispatchEvent(new CustomEvent('pbp:offline-status', { detail: status() })); }
  function setOnline(value) { if (online !== value) { online = value; emitStatus(); } }

  function enqueue(path, options) {
    const queue = read(QUEUE_KEY, []);
    const op = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, createdAt: new Date().toISOString() };
    queue.push(op);
    if (!write(QUEUE_KEY, queue)) throw new Error('No hay espacio en el equipo para guardar la operación sin conexión');
    emitStatus();
    return op;
  }

  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      let sent = 0;
      for (;;) {
        const queue = read(QUEUE_KEY, []);
        if (!queue.length) break;
        const op = queue[0];
        let result;
        try {
          result = await networkFetch(op.path, { method: op.method, body: op.body ? JSON.stringify(op.body) : undefined });
        } catch (error) {
          if (error instanceof OfflineError) { setOnline(false); break; }
          throw error;
        }
        setOnline(true);
        const { response, payload } = result;
        if (response.status >= 500) break; // el servidor falló: se reintenta más tarde
        // 409 = ya existía (por ejemplo, se envió antes y se perdió la respuesta): se da por hecha
        if (!response.ok && response.status !== 409) {
          const failed = read(FAILED_KEY, []);
          failed.push({ ...op, error: payload.error || `Error ${response.status}`, failedAt: new Date().toISOString() });
          write(FAILED_KEY, failed.slice(-50));
          document.dispatchEvent(new CustomEvent('pbp:sync-error', { detail: { op, error: payload.error } }));
        }
        write(QUEUE_KEY, read(QUEUE_KEY, []).filter(x => x.id !== op.id));
        sent++;
      }
      if (sent) {
        write(SYNC_KEY, new Date().toISOString());
        document.dispatchEvent(new CustomEvent('pbp:synced', { detail: { sent } }));
      }
      emitStatus();
      return sent;
    })().finally(() => { flushing = null; });
    return flushing;
  }

  /* ---------- API pública ---------- */
  async function request(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const isBootstrap = path === '/api/bootstrap', isExport = path === '/api/export';
      if (isBootstrap || isExport) await flush().catch(() => {});
      try {
        const { response, payload } = await networkFetch(path, options);
        setOnline(true);
        if (!response.ok) throw Object.assign(new Error(payload.error || 'No se pudo completar la operación'), { status: response.status });
        if (isBootstrap) write(cacheKey(path), payload);
        else if (!isExport) write(cacheKey(path), payload);
        return isBootstrap ? withQueue(payload) : payload;
      } catch (error) {
        if (!(error instanceof OfflineError)) throw error;
        setOnline(false);
        const cached = read(cacheKey(isExport ? '/api/bootstrap' : path), null);
        if (cached === null) throw new Error('Sin conexión y sin datos guardados en este equipo');
        if (isBootstrap) return { ...withQueue(cached), _offline: true };
        if (isExport) return { exportedAt: new Date().toISOString(), offline: true, ...withQueue(cached) };
        return cached;
      }
    }
    // Escrituras: si ya hay cola, se respeta el orden encolando también esta
    if (read(QUEUE_KEY, []).length) {
      await flush().catch(() => {});
      if (read(QUEUE_KEY, []).length) return optimisticResult(enqueue(path, { ...options, method }));
    }
    try {
      const { response, payload } = await networkFetch(path, { ...options, method });
      setOnline(true);
      if (!response.ok) throw Object.assign(new Error(payload.error || 'No se pudo completar la operación'), { status: response.status });
      // Mantener la copia local al día para poder mostrarla sin señal
      const cached = read(cacheKey('/api/bootstrap'), null);
      if (cached) write(cacheKey('/api/bootstrap'), applyOperation(cached, { path, method, body: path.includes('/close') ? null : (method === 'POST' ? payload : options.body ? JSON.parse(options.body) : null) }, false));
      return payload;
    } catch (error) {
      if (!(error instanceof OfflineError)) throw error;
      setOnline(false);
      return optimisticResult(enqueue(path, { ...options, method }));
    }
  }

  function discardFailed() { write(FAILED_KEY, []); emitStatus(); }

  window.addEventListener('online', () => { setOnline(true); flush().catch(() => {}); });
  window.addEventListener('offline', () => setOnline(false));
  setInterval(() => { if (read(QUEUE_KEY, []).length) flush().catch(() => {}); }, 30000);

  window.PampaOffline = { request, flush, status, discardFailed, OfflineError };
})();
