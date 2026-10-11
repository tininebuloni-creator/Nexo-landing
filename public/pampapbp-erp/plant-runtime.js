/* Pampa PBP - runtime de planta
 * Conecta el index.html con el backend: estado de red, telemetría del molino,
 * trazabilidad, cierre/eliminación de lotes y mapa de lotes agropecuarios.
 * Se carga con defer, así que corre después del script inline y puede usar sus
 * helpers globales ($, api, toast, escapeHTML, num, batches, renderBatches, sourceLots).
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const fmt = (n, d = 0) => (typeof num === 'function' ? num(n, d) : Number(n).toFixed(d));
  const esc = v => (typeof escapeHTML === 'function' ? escapeHTML(v) : String(v));
  const notify = msg => (typeof toast === 'function' ? toast(msg) : console.log(msg));
  const request = async (path, options = {}) => {
    if (typeof api === 'function') return api(path, options);
    const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo completar la operación');
    return data;
  };
  const flagBadge = flag => (flag === 'CRITICO' ? 'red' : flag === 'ALERTA' ? 'amber' : 'green');
  const flagColor = flag => (flag === 'CRITICO' ? 'var(--red)' : flag === 'ALERTA' ? 'var(--orange)' : 'var(--ok)');

  /* ---------- Estado de red ---------- */
  const networkState = el('networkState');
  let networkLabel = 'Conectando', networkOk = false;
  const pendingCount = () => (window.PampaOffline ? window.PampaOffline.status().pending : 0);
  function paintNetwork() {
    if (!networkState) return;
    const pending = pendingCount();
    networkState.textContent = pending ? `${networkLabel} · ${pending} sin sincronizar` : networkLabel;
    networkState.title = pending ? 'Hay cambios guardados en este equipo que se enviarán al servidor al volver la conexión' : '';
    networkState.classList.toggle('online', networkOk && !pending);
    networkState.classList.toggle('pending', !!pending);
    networkState.classList.toggle('offline', !networkOk && !pending);
  }
  function setNetwork(state, label) { networkOk = state === 'online'; networkLabel = label; paintNetwork(); }
  async function checkNetwork() {
    if (!navigator.onLine) return setNetwork('offline', 'Sin conexión');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      // El service worker contesta 503 + offline cuando no llega al servidor
      if (!res.ok || data.offline) throw new Error('offline');
      setNetwork('online', data.database === 'memory' ? 'En línea · modo prueba' : 'En línea');
      if (pendingCount()) window.PampaOffline.flush().catch(() => {});
    } catch {
      setNetwork('offline', navigator.onLine ? 'Servidor no disponible' : 'Sin conexión');
    }
  }
  window.addEventListener('online', checkNetwork);
  window.addEventListener('offline', checkNetwork);
  document.addEventListener('pbp:offline-status', paintNetwork);
  document.addEventListener('pbp:synced', event => {
    notify(`Sincronizado: ${event.detail.sent} cambio${event.detail.sent === 1 ? '' : 's'} enviados al servidor`);
    if (typeof loadBackend === 'function') loadBackend();
    checkNetwork();
  });
  document.addEventListener('pbp:sync-error', event => notify(`No se pudo sincronizar un cambio: ${event.detail.error || 'rechazado por el servidor'}`));
  checkNetwork();
  setInterval(checkNetwork, 20000);

  /* ---------- Service worker (app y mapas disponibles sin señal) ---------- */
  // En la prueba web el servidor corre en el navegador y no hay modo sin conexión que precargar
  if ('serviceWorker' in navigator && window.isSecureContext && !window.PBP_WEB_TRIAL) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  /* ---------- Telemetría del molino ---------- */
  const EQUIPMENT = 'MOLINO_MARTILLOS', PARAMETER = 'AMPERAJE', FULL_SCALE_AMPS = 35;
  let telemetryLog = [];
  function showReading(log) {
    const value = Number(log.valueNumeric) || 0;
    const valueEl = el('telemetryValue'), gauge = el('telemetryGauge'), status = el('telemetryStatus');
    if (valueEl) valueEl.textContent = fmt(value, 1);
    if (gauge) { gauge.style.width = `${Math.min(value / FULL_SCALE_AMPS * 100, 100)}%`; gauge.style.background = flagColor(log.statusFlag); }
    if (status) { status.textContent = log.statusFlag || 'OK'; status.className = `badge ${flagBadge(log.statusFlag)}`; }
  }
  function renderTelemetryRows() {
    const body = el('telemetryRows');
    if (!body) return;
    body.innerHTML = telemetryLog.length
      ? telemetryLog.slice(0, 8).map(log => `<tr><td>${new Date(log.loggedAt).toLocaleTimeString('es-AR')}</td><td>${fmt(+log.valueNumeric, 1)} A</td><td><span class="badge ${flagBadge(log.statusFlag)}">${esc(log.statusFlag)}</span></td></tr>`).join('')
      : '<tr><td colspan="3">Sin lecturas registradas</td></tr>';
  }
  // Cualquier señal del PLC avisa a los demás módulos (Calidad toma la del acondicionador);
  // el indicador y el registro de esta tarjeta son del molino
  function announce(log) {
    window.pbpLastTelemetry = log;
    document.dispatchEvent(new CustomEvent('pbp:telemetry', { detail: log }));
  }
  function addTelemetry(log) {
    if (!log) return;
    announce(log);
    if (log.equipmentName !== EQUIPMENT || log.parameterMeasured !== PARAMETER) return;
    if (telemetryLog.some(x => x.id === log.id && x.loggedAt === log.loggedAt)) return;
    telemetryLog.unshift(log);
    telemetryLog = telemetryLog.slice(0, 50);
    showReading(log);
    renderTelemetryRows();
  }
  async function loadTelemetry() {
    try {
      const rows = await request('/api/telemetry/recent?limit=20');
      if (rows[0]) announce(rows[0]);
      telemetryLog = rows.filter(x => x.equipmentName === EQUIPMENT && x.parameterMeasured === PARAMETER);
      if (telemetryLog[0]) showReading(telemetryLog[0]);
      renderTelemetryRows();
    } catch { /* el estado de red ya informa la caída */ }
  }
  // Sin señal no se reintenta cada 3 s (lo haría EventSource): se espera con intervalos crecientes
  let telemetrySource = null, streamRetry = null, streamDelay = 5000;
  function connectTelemetryStream() {
    if (!('EventSource' in window) || telemetrySource || window.PBP_WEB_TRIAL) return;
    clearTimeout(streamRetry);
    telemetrySource = new EventSource('/api/telemetry/stream');
    telemetrySource.addEventListener('telemetry', event => { try { addTelemetry(JSON.parse(event.data)); } catch {} });
    telemetrySource.addEventListener('open', () => { streamDelay = 5000; loadTelemetry(); });
    telemetrySource.addEventListener('error', () => {
      telemetrySource.close();
      telemetrySource = null;
      streamRetry = setTimeout(connectTelemetryStream, navigator.onLine ? streamDelay : 60000);
      streamDelay = Math.min(streamDelay * 2, 60000);
    });
  }
  window.addEventListener('online', () => { streamDelay = 5000; if (!telemetrySource) connectTelemetryStream(); });
  const sendBtn = el('telemetrySend');
  if (sendBtn) sendBtn.addEventListener('click', async () => {
    const value = Number(el('telemetryInput')?.value);
    if (!Number.isFinite(value)) return notify('Ingrese una lectura válida');
    const [equipmentName, parameterMeasured] = (el('telemetryParam')?.value || `${EQUIPMENT}|${PARAMETER}`).split('|');
    sendBtn.disabled = true;
    try {
      const result = await request('/api/telemetry', { method: 'POST', body: JSON.stringify({ equipmentName, parameterMeasured, valueNumeric: value }) });
      addTelemetry(result.log);
      notify(`Lectura registrada · ${result.processedFlag}${result.log?.batchId ? ` · lote ${result.log.batchId}` : ''}`);
    } catch (error) { notify(error.message); } finally { sendBtn.disabled = false; }
  });
  const TEST_VALUES = { 'MOLINO_MARTILLOS|AMPERAJE': 31.5, 'ACONDICIONADOR|TEMPERATURA': 83, 'ACONDICIONADOR|RETENCION': 35 };
  el('telemetryParam')?.addEventListener('change', e => { const i = el('telemetryInput'); if (i) i.value = TEST_VALUES[e.target.value] ?? i.value; });
  loadTelemetry();
  connectTelemetryStream();

  /* ---------- Trazabilidad ---------- */
  async function searchTrace(id) {
    const wrap = el('traceTableWrap'), body = el('traceRows'), input = el('traceOrderId');
    const orderId = (id ?? input?.value ?? '').trim();
    if (!orderId) return notify('Ingrese el identificador del lote');
    if (input) input.value = orderId;
    try {
      const rows = await request(`/api/reports/trazabilidad/${encodeURIComponent(orderId)}`);
      body.innerHTML = rows.map(r => `<tr><td><b>${esc(r.ingredient)}</b></td><td>${esc(r.supplierLot)}</td><td>${fmt(r.theoreticalKg, 2)} kg</td><td>${fmt(r.realKg, 2)} kg</td><td>${r.deviationPct > 0 ? '+' : ''}${fmt(r.deviationPct, 2)}%</td><td><span class="badge ${flagBadge(r.statusFlag)}">${esc(r.statusFlag)}</span></td></tr>`).join('');
      wrap.hidden = false;
    } catch (error) {
      wrap.hidden = true;
      notify(error.message);
    }
  }
  el('traceSearch')?.addEventListener('click', () => searchTrace());
  el('traceOrderId')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchTrace(); } });

  /* ---------- Acciones sobre lotes de producción ---------- */
  const closeDialog = el('closeBatchDialog');
  const findBatch = id => (typeof batches !== 'undefined' ? batches.find(b => b.id === id) : null);
  function openClose(batch) {
    el('closeBatchId').value = batch.id;
    el('closeBatchSummary').textContent = `${batch.id} · ${batch.phase} · ${fmt(+batch.volume)} TM`;
    el('closeTheoreticalWeight').value = fmt(+batch.volume * 1000, 2);
    el('closeRealWeight').value = '';
    closeDialog.showModal();
    setTimeout(() => el('closeRealWeight').focus(), 50);
  }
  el('closeBatchDialogX')?.addEventListener('click', () => closeDialog.close());
  el('cancelCloseBatch')?.addEventListener('click', () => closeDialog.close());
  el('closeBatchForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter; if (submit) submit.disabled = true;
    const id = el('closeBatchId').value;
    try {
      const result = await request(`/api/manufacturing-orders/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({ realTotalWeight: Number(el('closeRealWeight').value) }) });
      const batch = findBatch(id); if (batch) batch.status = 'Terminado';
      if (typeof renderBatches === 'function') renderBatches();
      closeDialog.close();
      const invNote = result.offline ? ' · el inventario se actualiza al sincronizar' : result.inventoryMovements ? ` · ${result.inventoryMovements} movimientos de inventario` : '';
      notify(`${result.offline ? 'Cierre guardado sin conexión' : 'Lote cerrado'} · desvío ${result.deviationPct > 0 ? '+' : ''}${fmt(result.deviationPct, 2)}% (${result.statusFlag})${invNote}${result.qualityControl ? ` · control de calidad del PLC: ${fmt(result.qualityControl.conditionerTemp ?? 0, 1)} °C` : ''}${result.inventoryWarnings?.length ? ` · ⚠ ${result.inventoryWarnings[0]}` : ''}`);
      if (!result.offline && typeof loadBackend === 'function') loadBackend();
    } catch (error) { notify(error.message); } finally { if (submit) submit.disabled = false; }
  });
  el('batchRows')?.addEventListener('click', async event => {
    const button = event.target.closest('button[data-batch-action]');
    if (!button) return;
    const id = button.dataset.batchId, batch = findBatch(id);
    if (!batch) return;
    if (button.dataset.batchAction === 'close') return openClose(batch);
    if (button.dataset.batchAction === 'trace') {
      await searchTrace(id);
      el('traceTableWrap')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (button.dataset.batchAction === 'delete') {
      if (!confirm(`¿Eliminar el lote ${id}?`)) return;
      button.disabled = true;
      try {
        await request(`/api/batches/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const index = batches.findIndex(b => b.id === id); if (index >= 0) batches.splice(index, 1);
        renderBatches();
        notify('Lote eliminado');
      } catch (error) { notify(error.message); button.disabled = false; }
    }
  });

  /* ---------- Mapa de lotes ---------- */
  let map = null, layer = null, markers = new Map(), pendingLots = typeof sourceLots !== 'undefined' ? sourceLots : [];
  // URLs fijas: son las mismas que guarda la descarga offline, así la caché pega siempre.
  const TILE_LAYERS = {
    'Satélite': 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    'Relieve': 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'
  };
  const TILES_CACHE_NAME = 'pampa-pbp-tiles-v1'; // el mismo que usa sw.js
  const cropColor = crop => ({ 'Maíz': '#f59e0b', 'Soja': '#10b981', 'Sorgo': '#f97316', 'Trigo': '#eab308' }[crop] || '#3b82f6');
  function ensureMap() {
    if (map || typeof L === 'undefined') return map;
    const container = el('lotsMap');
    if (!container || !container.offsetWidth) return null;
    map = L.map(container, { zoomControl: true, attributionControl: true }).setView([-34.0, -61.0], 7);
    const satellite = L.tileLayer(TILE_LAYERS['Satélite'], { maxZoom: 19, attribution: 'Tiles &copy; Esri' }).addTo(map);
    const relief = L.tileLayer(TILE_LAYERS['Relieve'], { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
    L.control.layers({ 'Satélite': satellite, 'Relieve': relief }).addTo(map);
    layer = L.layerGroup().addTo(map);
    drawLots(pendingLots);
    return map;
  }
  function drawLots(lots) {
    pendingLots = Array.isArray(lots) ? lots : [];
    if (!map) return;
    layer.clearLayers(); markers.clear();
    pendingLots.forEach(lot => {
      const lat = Number(lot.latitude), lng = Number(lot.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const color = cropColor(lot.crop);
      const marker = L.circleMarker([lat, lng], { radius: 9, color, weight: 2, fillColor: color, fillOpacity: lot.status === 'Inactivo' ? .2 : .55 })
        .bindPopup(`<b>${esc(lot.id)} · ${esc(lot.name)}</b><br>${esc(lot.producer)}<br>${esc(lot.locality)}<br>${fmt(+lot.hectares, 1)} ha · ${esc(lot.crop)}<br>Lote proveedor: ${esc(lot.supplierLot)}`)
        .addTo(layer);
      markers.set(lot.id, marker);
    });
    fitAll();
  }
  function fitAll() {
    if (!map || !markers.size) return;
    const bounds = L.latLngBounds([...markers.values()].map(m => m.getLatLng()));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
  }
  window.refreshLotsMap = () => {
    if (!ensureMap()) return;
    map.invalidateSize();
    fitAll();
  };
  document.addEventListener('plantabase:lots', event => drawLots(event.detail));
  el('fitLotsMap')?.addEventListener('click', () => window.refreshLotsMap());
  el('lotRows')?.addEventListener('click', event => {
    const row = event.target.closest('.lot-row');
    if (!row || !ensureMap()) return;
    const marker = markers.get(row.dataset.lotId);
    if (!marker) return;
    map.setView(marker.getLatLng(), 14);
    marker.openPopup();
    el('lotsMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  if (location.hash === '#lots') setTimeout(window.refreshLotsMap, 80);

  /* ---------- Descarga de mapas para uso offline ---------- */
  // Igual que en PampaAgro: se guardan las imágenes de la zona de cada lote (satélite y relieve)
  // en la caché estable de mapas; el service worker las sirve cuando no hay señal.
  const lonToTileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
  const latToTileY = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
  function tilesForBox(minLat, maxLat, minLng, maxLng, zooms, into) {
    zooms.forEach(z => {
      for (let x = lonToTileX(minLng, z); x <= lonToTileX(maxLng, z); x++)
        for (let y = latToTileY(maxLat, z); y <= latToTileY(minLat, z); y++) into.add(`${z}/${x}/${y}`);
    });
  }
  const MAX_TILES = 4000, LOT_RADIUS_DEG = 0.025; // mínimo ≈ 2,5 km alrededor de cada lote
  // En cada zoom se cubre al menos una pantalla completa centrada en el lote (≈ 3 × 2 imágenes)
  const lotRadius = z => Math.max(LOT_RADIUS_DEG, 1.6 * 360 / 2 ** z);
  const downloadButton = el('downloadOfflineMaps');
  const downloadLabel = downloadButton ? downloadButton.textContent : '';
  async function downloadOfflineMaps() {
    if (!navigator.onLine) return notify('Se necesita conexión para descargar los mapas (hágalo antes de salir a campo).');
    if (!('caches' in window)) return notify('Este navegador no permite guardar mapas offline (requiere localhost o HTTPS).');
    const points = pendingLots.map(l => [Number(l.latitude), Number(l.longitude)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    if (!points.length) return notify('No hay lotes con coordenadas para descargar.');
    const tiles = new Set();
    const lats = points.map(p => p[0]), lngs = points.map(p => p[1]);
    // Vista general de toda la zona (zoom bajo) + detalle alrededor de cada lote
    [6, 7, 8, 9, 10, 11].forEach(z => { const r = Math.max(.1, 1.6 * 360 / 2 ** z); tilesForBox(Math.min(...lats) - r, Math.max(...lats) + r, Math.min(...lngs) - r, Math.max(...lngs) + r, [z], tiles); });
    points.forEach(([lat, lng]) => [12, 13, 14, 15, 16].forEach(z => { const r = lotRadius(z); tilesForBox(lat - r, lat + r, lng - r, lng + r, [z], tiles); }));
    const urls = [];
    [...tiles].forEach(t => { const [z, x, y] = t.split('/'); Object.values(TILE_LAYERS).forEach(tpl => urls.push(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y))); });
    const list = urls.slice(0, MAX_TILES);
    const cache = await caches.open(TILES_CACHE_NAME);
    downloadButton.disabled = true;
    let ok = 0, fail = 0, skipped = 0;
    const CONCURRENCY = 6;
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      await Promise.all(list.slice(i, i + CONCURRENCY).map(async url => {
        try {
          if (await cache.match(url)) { skipped++; return; }
          let response;
          try { response = await fetch(url, { mode: 'cors' }); } catch { response = await fetch(url, { mode: 'no-cors' }); }
          if (!response.ok && response.type !== 'opaque') throw new Error(String(response.status));
          await cache.put(url, response);
          ok++;
        } catch { fail++; }
      }));
      downloadButton.textContent = `Descargando… ${Math.min(i + CONCURRENCY, list.length)}/${list.length}`;
    }
    downloadButton.disabled = false;
    downloadButton.textContent = downloadLabel;
    const extra = urls.length > list.length ? ` Se limitó a ${MAX_TILES} imágenes.` : '';
    notify(`Mapas offline listos: ${ok + skipped} imágenes guardadas${skipped ? ` (${skipped} ya estaban)` : ''}${fail ? `, ${fail} fallaron` : ''}.${extra}`);
  }
  downloadButton?.addEventListener('click', () => downloadOfflineMaps().catch(error => { downloadButton.disabled = false; downloadButton.textContent = downloadLabel; notify(error.message); }));

  /* ---------- Ubicación actual para el alta de lotes ---------- */
  const geoButton = el('useMyLocation'), geoStatus = el('geoStatus');
  const geoErrors = {
    1: 'Permiso de ubicación denegado. Habilítelo en el navegador.',
    2: 'No se pudo determinar la ubicación.',
    3: 'La ubicación tardó demasiado. Intente de nuevo.'
  };
  if (geoButton) geoButton.addEventListener('click', () => {
    if (!('geolocation' in navigator)) { geoStatus.textContent = 'Este navegador no permite obtener la ubicación.'; return; }
    if (!window.isSecureContext) { geoStatus.textContent = 'La ubicación requiere abrir la app por localhost o HTTPS.'; return; }
    geoButton.disabled = true;
    geoStatus.textContent = 'Obteniendo ubicación…';
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude, accuracy } = position.coords;
      el('lotLatitude').value = latitude.toFixed(6);
      el('lotLongitude').value = longitude.toFixed(6);
      geoStatus.textContent = `Coordenadas cargadas · precisión ±${fmt(accuracy)} m`;
      geoButton.disabled = false;
    }, error => {
      geoStatus.textContent = geoErrors[error.code] || error.message;
      geoButton.disabled = false;
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  // Limpiar el aviso cada vez que se abre el diálogo
  document.querySelectorAll('.open-lot').forEach(button => button.addEventListener('click', () => { if (geoStatus) geoStatus.textContent = ''; }));
})();
