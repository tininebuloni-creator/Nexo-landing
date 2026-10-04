// Actualización de normativa fiscal/sanitaria compartida por las apps PAMPA (navegador).
//  - Feed de reglamentaciones (pampa-regulaciones-feed): se lee solo cada 24 h. Las reglas con el
//    "app" de esta aplicación que cambian un valor quedan como PROPUESTA; nunca se aplican solas.
//  - Avisos de páginas oficiales ARCA/SENASA publicados en el feed: la app guarda el hash que ya
//    vio de cada página y avisa cuando cambió, aunque haya estado días sin abrirse.
//  - Propuestas manuales con norma, vigencia y fuente oficial; todo queda en un registro auditado.
// Configuración en el <script>: data-app="agro|tambo|ganaderia|porcinos", data-feed="URL por
// defecto", data-sources="/ruta/base" (monitor del servidor: GET {base}/estado, POST {base}/verificar).
// Si la app tiene `state` + `saveState()` globales, lo que resuelve el usuario viaja en su respaldo.
(function () {
  'use strict';

  const script = document.currentScript || {};
  const dataset = script.dataset || {};
  const title = document.title || '';
  const appName = dataset.app || (/Tambo/.test(title) ? 'tambo'
    : /Porcinos/.test(title) ? 'porcinos'
      : /Ganader|Feedlot/.test(title) ? 'ganaderia' : 'agro');
  const storageKey = `pampa_fiscal_normativa_${appName}`;
  const feedKey = `pampa_normativa_feed_${appName}`;
  const sourcesBase = dataset.sources || '';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TIMEOUT_MS = 15000;

  function hasAppState() {
    return typeof state === 'object' && state !== null && typeof saveState === 'function';
  }

  function readLocal(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* almacenamiento no disponible */ }
  }

  // La fuente de verdad es la clave propia de localStorage. Si la app tiene `state` + `saveState()`,
  // se copia ahí solo ante acciones del usuario (proponer, aprobar, rechazar) para que viaje en su
  // respaldo/sincronización. La lectura automática del feed nunca llama a saveState(): podría correr
  // antes de que la app cargue sus datos y pisarlos.
  function newer(a, b) {
    return String(b.resueltoEn || b.propuestoEn || '') > String(a.resueltoEn || a.propuestoEn || '') ? b : a;
  }

  function mergeById(primary, extra, pick) {
    const byId = new Map(primary.map((item) => [item.id, item]));
    extra.forEach((item) => {
      if (!item || !item.id) return;
      byId.set(item.id, byId.has(item.id) && pick ? pick(byId.get(item.id), item) : byId.get(item.id) || item);
    });
    return [...byId.values()];
  }

  function readStore() {
    const local = readLocal(storageKey, {});
    let proposals = Array.isArray(local.proposals) ? local.proposals : [];
    let ledger = Array.isArray(local.ledger) ? local.ledger : [];
    if (hasAppState()) {
      // Lo que llegó por el respaldo/sincronización de la app (por ejemplo, desde otro equipo).
      if (Array.isArray(state.normativaFiscalPropuestas)) proposals = mergeById(proposals, state.normativaFiscalPropuestas, newer);
      if (Array.isArray(state.normativaFiscalLedger)) ledger = mergeById(ledger, state.normativaFiscalLedger);
    }
    return { proposals, ledger };
  }

  function writeStore(store, { persistApp = false } = {}) {
    writeLocal(storageKey, store);
    if (persistApp && hasAppState()) {
      state.normativaFiscalPropuestas = store.proposals;
      state.normativaFiscalLedger = store.ledger;
      saveState();
    }
    document.dispatchEvent(new CustomEvent('pampa-normativa-change', { detail: summary() }));
  }

  function readFeedState() {
    const saved = readLocal(feedKey, {});
    return {
      url: typeof saved.url === 'string' ? saved.url : (window.PAMPA_REGULATORY_FEED_URL || dataset.feed || ''),
      lastSync: saved.lastSync || null,
      lastError: saved.lastError || null,
      feedVersion: saved.feedVersion || null,
      avisos: Array.isArray(saved.avisos) ? saved.avisos : [],
      vistos: saved.vistos && typeof saved.vistos === 'object' ? saved.vistos : {},
    };
  }

  function writeFeedState(feed) {
    writeLocal(feedKey, feed);
  }

  function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `norma-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.href : '#';
    } catch {
      return '#';
    }
  }

  function today() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function getTarget() {
    return document.querySelector(dataset.target || '#mod-fiscal, #mod-arca, #arca, #fiscal');
  }

  function statusLabel(status) {
    return { PROPUESTA: 'Pendiente de aprobación', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada' }[status] || status;
  }

  function addLedger(store, accion, proposal) {
    store.ledger.push({ id: makeId(), fecha: new Date().toISOString(), accion, propuestaId: proposal.id, snapshot: { ...proposal } });
  }

  // --- Feed de reglamentaciones -------------------------------------------------------------------
  function ruleKey(regla) {
    return [regla.regimen, regla.condicion, regla.jurisdiccion || 'NACIONAL'].join('|');
  }

  // Valor que la app ya aplica: la última propuesta aprobada para ese régimen/condición, o el que
  // informe la propia app con window.PAMPA_NORMATIVA_VALOR_VIGENTE(regimen, condicion, fecha).
  function currentValue(store, regla) {
    const fecha = regla.vigencia_desde > today() ? regla.vigencia_desde : today();
    const aprobada = store.proposals
      .filter((item) => item.estado === 'APROBADA' && item.reglaClave === ruleKey(regla) && item.vigenciaDesde <= fecha && (!item.vigenciaHasta || item.vigenciaHasta >= fecha))
      .sort((a, b) => String(b.vigenciaDesde).localeCompare(String(a.vigenciaDesde)) || String(b.resueltoEn).localeCompare(String(a.resueltoEn)))[0];
    if (aprobada) return Number(aprobada.valorNuevo);
    if (typeof window.PAMPA_NORMATIVA_VALOR_VIGENTE === 'function') {
      const value = Number(window.PAMPA_NORMATIVA_VALOR_VIGENTE(regla.regimen, regla.condicion, fecha));
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function processFeedRules(reglas) {
    const store = readStore();
    let nuevas = 0;
    (Array.isArray(reglas) ? reglas : []).filter((regla) => regla && regla.app === appName).forEach((regla) => {
      const valorNuevo = Number(regla.alicuota_pct);
      if (!regla.regimen || !regla.condicion || !regla.vigencia_desde || !Number.isFinite(valorNuevo)) return;
      const actual = currentValue(store, regla);
      if (actual === valorNuevo) return;
      const repetida = store.proposals.some((item) => item.origen === 'feed' && item.reglaClave === ruleKey(regla)
        && Number(item.valorNuevo) === valorNuevo && item.vigenciaDesde === regla.vigencia_desde && item.estado !== 'APROBADA');
      if (repetida) return;
      const proposal = {
        id: makeId(),
        origen: 'feed',
        reglaClave: ruleKey(regla),
        regimen: regla.regimen,
        condicion: regla.condicion,
        jurisdiccion: regla.jurisdiccion || 'NACIONAL',
        norma: regla.fuente_normativa || regla.regimen,
        articulo: '',
        parametro: `${regla.regimen} · ${regla.condicion}`,
        valorAnterior: actual === null ? '' : String(actual),
        valorNuevo: String(valorNuevo),
        vigenciaDesde: regla.vigencia_desde,
        vigenciaHasta: regla.vigencia_hasta || '',
        fuente: regla.fuente_url || '',
        motivo: regla.tipo_fuente === 'scrapeada' ? 'Leído de la fuente oficial por el feed.' : 'Valor mantenido en el feed de reglamentaciones.',
        estado: 'PROPUESTA',
        propuestoPor: 'Feed de reglamentaciones',
        propuestoEn: new Date().toISOString(),
      };
      store.proposals.push(proposal);
      addLedger(store, 'PROPONER', proposal);
      nuevas += 1;
    });
    if (nuevas) writeStore(store);
    return nuevas;
  }

  // Avisos: compara el hash publicado con el último que esta app ya vio/revisó.
  function processAvisos(feed, avisos) {
    feed.avisos = (Array.isArray(avisos) ? avisos : [])
      .filter((aviso) => aviso && (!Array.isArray(aviso.apps) || aviso.apps.includes(appName)))
      .map((aviso) => {
        const visto = feed.vistos[aviso.id];
        if (!visto && aviso.hash) feed.vistos[aviso.id] = { hash: aviso.hash, revisadoEn: null };
        const cambio = Boolean(aviso.hash && visto && visto.hash && visto.hash !== aviso.hash) || Boolean(aviso.cambio_detectado && !visto);
        return { id: aviso.id, nombre: aviso.nombre, url: aviso.url, nota: aviso.nota, hash: aviso.hash || null, error: aviso.error || null, verificadoEl: aviso.verificado_el || null, cambio };
      });
  }

  async function syncFeed({ silent = true } = {}) {
    const feed = readFeedState();
    if (!feed.url) {
      if (!silent) alert('Cargá primero la URL del feed de reglamentaciones.');
      return { activo: false };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(feed.url, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.reglas)) throw new Error('el feed no tiene el formato esperado');
      const nuevas = processFeedRules(data.reglas);
      processAvisos(feed, data.avisos);
      Object.assign(feed, { lastSync: new Date().toISOString(), lastError: null, feedVersion: data.version || null });
      writeFeedState(feed);
      render();
      const cambios = feed.avisos.filter((aviso) => aviso.cambio).length;
      if (!silent) alert(`Feed leído. ${nuevas} propuesta(s) nueva(s); ${cambios} página(s) oficial(es) con cambios para revisar.`);
      notify();
      return { activo: true, nuevas, cambios };
    } catch (error) {
      const message = error.name === 'AbortError' ? 'tiempo de espera agotado' : error.message;
      Object.assign(feed, { lastSync: new Date().toISOString(), lastError: message });
      writeFeedState(feed);
      render();
      if (!silent) alert(`No se pudo leer el feed de reglamentaciones: ${message}`);
      return { activo: true, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  function syncIfDue() {
    const feed = readFeedState();
    if (!feed.url || !navigator.onLine) return;
    if (feed.lastSync && Date.now() - new Date(feed.lastSync).getTime() < DAY_MS) return;
    syncFeed({ silent: true });
  }

  function saveFeedUrl(value) {
    const url = String(value || '').trim();
    if (url) {
      let parsed;
      try { parsed = new URL(url); } catch { alert('La URL del feed no es válida.'); return false; }
      if (parsed.protocol !== 'https:') { alert('La URL del feed debe usar HTTPS.'); return false; }
    }
    const feed = readFeedState();
    feed.url = url;
    feed.lastSync = null;
    writeFeedState(feed);
    return true;
  }

  function markAvisoReviewed(id) {
    const feed = readFeedState();
    const aviso = feed.avisos.find((item) => item.id === id);
    if (!aviso) return;
    feed.vistos[id] = { hash: aviso.hash, revisadoEn: new Date().toISOString() };
    aviso.cambio = false;
    writeFeedState(feed);
    render();
    notify();
  }

  function summary() {
    const store = readLocalSafe();
    const feed = readFeedState();
    return {
      app: appName,
      propuestasPendientes: store.proposals.filter((item) => item.estado === 'PROPUESTA').length,
      avisosConCambios: feed.avisos.filter((aviso) => aviso.cambio).length,
      ultimaLectura: feed.lastSync,
      error: feed.lastError,
    };
  }

  function readLocalSafe() {
    try { return readStore(); } catch { return { proposals: [], ledger: [] }; }
  }

  // Aviso visible fuera del módulo fiscal: un banner discreto con el conteo pendiente.
  function notify() {
    const info = summary();
    let banner = document.getElementById('pampaNormativeBanner');
    const total = info.propuestasPendientes + info.avisosConCambios;
    if (!total) { if (banner) banner.remove(); return; }
    if (!banner) {
      banner = document.createElement('button');
      banner.id = 'pampaNormativeBanner';
      banner.type = 'button';
      banner.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;max-width:calc(100vw - 32px);padding:10px 14px;border-radius:10px;border:1px solid #f59e0b;background:#fff7e6;color:#7a4b00;font:600 13px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);cursor:pointer;text-align:left';
      banner.addEventListener('click', () => {
        const card = document.getElementById('pampaNormativeCard');
        if (card && card.offsetParent !== null) card.scrollIntoView({ behavior: 'smooth' });
        else alert('Abrí el módulo Fiscal / ARCA para revisar los cambios normativos.');
      });
      document.body.appendChild(banner);
    }
    banner.textContent = `Normativa: ${info.propuestasPendientes} cambio(s) para aprobar · ${info.avisosConCambios} página(s) oficial(es) actualizadas`;
  }

  // --- Propuestas ---------------------------------------------------------------------------------
  function render() {
    const host = document.getElementById('pampaNormativeList');
    if (host) {
      const rows = readStore().proposals.slice().reverse();
      host.innerHTML = rows.length
        ? rows.map((proposal) => `
      <tr>
        <td>${escapeHtml(proposal.norma)}${proposal.origen === 'feed' ? '<br><small>Feed de reglamentaciones</small>' : ''}</td>
        <td>${escapeHtml(proposal.parametro)}</td>
        <td>${escapeHtml(proposal.valorAnterior || '-')} → <strong>${escapeHtml(proposal.valorNuevo)}</strong></td>
        <td>${escapeHtml(proposal.vigenciaDesde)}${proposal.vigenciaHasta ? ` a ${escapeHtml(proposal.vigenciaHasta)}` : ''}</td>
        <td>${proposal.fuente ? `<a href="${escapeHtml(safeUrl(proposal.fuente))}" target="_blank" rel="noopener noreferrer">Ver fuente</a>` : '-'}</td>
        <td>${escapeHtml(statusLabel(proposal.estado))}${proposal.motivoRechazo ? `: ${escapeHtml(proposal.motivoRechazo)}` : ''}</td>
        <td>${proposal.estado === 'PROPUESTA' ? `<button type="button" class="btn" data-approve="${escapeHtml(proposal.id)}">Aprobar</button> <button type="button" class="btn" data-reject="${escapeHtml(proposal.id)}">Rechazar</button>` : escapeHtml(proposal.resueltoPor || '-')}</td>
      </tr>`).join('')
        : '<tr><td colspan="7">No hay cambios normativos propuestos.</td></tr>';
      host.querySelectorAll('[data-approve]').forEach((button) => button.addEventListener('click', () => resolveProposal(button.dataset.approve, 'APROBADA')));
      host.querySelectorAll('[data-reject]').forEach((button) => button.addEventListener('click', () => resolveProposal(button.dataset.reject, 'RECHAZADA')));
    }
    renderFeed();
  }

  function renderFeed() {
    const feed = readFeedState();
    const status = document.getElementById('pampaNormativeFeedStatus');
    if (status) {
      status.textContent = !feed.url
        ? 'Sin URL del feed: cargala para recibir las actualizaciones automáticamente.'
        : `${feed.lastSync ? `Última lectura: ${new Date(feed.lastSync).toLocaleString('es-AR')}` : 'Todavía no se leyó.'}${feed.lastError ? ` · Error: ${feed.lastError}` : ''}${feed.feedVersion ? ` · Feed publicado el ${new Date(feed.feedVersion).toLocaleDateString('es-AR')}` : ''}. Se lee sola cada 24 h.`;
    }
    const input = document.getElementById('pampaNormativeFeedUrl');
    if (input && document.activeElement !== input) input.value = feed.url;
    const host = document.getElementById('pampaNormativeAvisos');
    if (!host) return;
    host.innerHTML = feed.avisos.length
      ? feed.avisos.map((aviso) => `
      <tr>
        <td><a href="${escapeHtml(safeUrl(aviso.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(aviso.nombre)}</a><br><small>${escapeHtml(aviso.nota || '')}</small></td>
        <td>${aviso.verificadoEl ? escapeHtml(new Date(aviso.verificadoEl).toLocaleString('es-AR')) : '-'}</td>
        <td style="font-weight:600;color:${aviso.cambio ? '#dc2626' : aviso.error ? '#d97706' : '#16a34a'}">${aviso.cambio ? 'Cambió: revisar' : aviso.error ? 'Sin respuesta' : 'Sin cambios'}</td>
        <td>${aviso.cambio ? `<button type="button" class="btn" data-reviewed="${escapeHtml(aviso.id)}">Marcar revisada</button>` : ''}</td>
      </tr>`).join('')
      : '<tr><td colspan="4">Sin avisos del feed todavía.</td></tr>';
    host.querySelectorAll('[data-reviewed]').forEach((button) => button.addEventListener('click', () => markAvisoReviewed(button.dataset.reviewed)));
  }

  function resolveProposal(id, status) {
    const store = readStore();
    const proposal = store.proposals.find((item) => item.id === id);
    if (!proposal || proposal.estado !== 'PROPUESTA') return;
    if (status === 'APROBADA' && !confirm(`Al aprobar, ${proposal.parametro} pasa a ${proposal.valorNuevo} desde el ${proposal.vigenciaDesde}. Lo anterior queda en el registro. ¿Aprobar?`)) return;
    const reason = status === 'RECHAZADA' ? prompt('Motivo del rechazo:') : '';
    if (status === 'RECHAZADA' && !reason) return;
    proposal.estado = status;
    proposal.resueltoEn = new Date().toISOString();
    proposal.resueltoPor = 'Administrador local';
    proposal.motivoRechazo = reason || '';
    addLedger(store, status === 'APROBADA' ? 'APROBAR' : 'RECHAZAR', proposal);
    writeStore(store, { persistApp: true });
    render();
    notify();
  }

  function createProposal(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (key) => String(data.get(key) || '').trim();
    if (['norma', 'parametro', 'valorNuevo', 'vigenciaDesde', 'fuente'].some((key) => !text(key))) {
      alert('Completá norma, parámetro, valor nuevo, vigencia y fuente oficial.');
      return;
    }
    if (safeUrl(text('fuente')) === '#') {
      alert('Ingresá una URL oficial válida para la fuente normativa.');
      return;
    }
    const store = readStore();
    const proposal = {
      id: makeId(),
      origen: 'manual',
      norma: text('norma'),
      articulo: text('articulo'),
      parametro: text('parametro'),
      valorAnterior: text('valorAnterior'),
      valorNuevo: text('valorNuevo'),
      vigenciaDesde: text('vigenciaDesde'),
      vigenciaHasta: text('vigenciaHasta'),
      fuente: text('fuente'),
      motivo: text('motivo'),
      estado: 'PROPUESTA',
      propuestoPor: 'Usuario local',
      propuestoEn: new Date().toISOString(),
    };
    store.proposals.push(proposal);
    addLedger(store, 'PROPONER', proposal);
    writeStore(store, { persistApp: true });
    form.reset();
    render();
    notify();
  }

  function activeRules(date = today()) {
    return readStore().proposals
      .filter((item) => item.estado === 'APROBADA' && item.vigenciaDesde <= date && (!item.vigenciaHasta || item.vigenciaHasta >= date))
      .map((item) => ({
        norma: item.norma, articulo: item.articulo, parametro: item.parametro, valor: item.valorNuevo,
        regimen: item.regimen || null, condicion: item.condicion || null, jurisdiccion: item.jurisdiccion || null,
        vigenciaDesde: item.vigenciaDesde, fuente: item.fuente,
      }));
  }

  // Valor aprobado vigente de un régimen/condición del feed (null si no hay ninguno aprobado).
  function valueFor(regimen, condicion, date = today(), jurisdiccion = 'NACIONAL') {
    const rule = readStore().proposals
      .filter((item) => item.estado === 'APROBADA' && item.regimen === regimen && item.condicion === condicion && (item.jurisdiccion || 'NACIONAL') === jurisdiccion
        && item.vigenciaDesde <= date && (!item.vigenciaHasta || item.vigenciaHasta >= date))
      .sort((a, b) => String(b.vigenciaDesde).localeCompare(String(a.vigenciaDesde)) || String(b.resueltoEn).localeCompare(String(a.resueltoEn)))[0];
    return rule ? Number(rule.valorNuevo) : null;
  }

  // --- Monitor del servidor local (si la app lo tiene) --------------------------------------------
  function sourceStatusBadge(source) {
    if (source.status === 'error') return '<span class="pill warn">error al consultar</span>';
    if (source.status === 'not_checked' || !source.status) return '<span class="pill">sin verificar</span>';
    if (source.changed) return '<span class="pill warn">cambió: revisar</span>';
    return '<span class="pill ok">sin cambios</span>';
  }

  function renderSources(data) {
    const host = document.getElementById('pampaNormativeSources');
    if (!host) return;
    const sources = (data && data.sources) || [];
    host.innerHTML = sources.map((source) => `
      <tr>
        <td><a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a></td>
        <td>${escapeHtml(source.scope || '')}</td>
        <td>${sourceStatusBadge(source)}</td>
        <td>${source.fetchedAt ? new Date(source.fetchedAt).toLocaleString('es-AR') : '-'}</td>
      </tr>`).join('') || '<tr><td colspan="4">Sin datos todavía. Tocá "Verificar ahora".</td></tr>';
  }

  async function loadSourcesStatus() {
    if (!sourcesBase) return;
    try {
      const response = await fetch(`${sourcesBase}/estado`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderSources(await response.json());
    } catch (error) {
      const host = document.getElementById('pampaNormativeSources');
      if (host) host.innerHTML = `<tr><td colspan="4">No se pudo consultar el estado (${escapeHtml(error.message)}).</td></tr>`;
    }
  }

  async function verificarAhora(button) {
    button.disabled = true;
    button.textContent = 'Verificando...';
    try {
      await syncFeed({ silent: !!sourcesBase });
      if (sourcesBase) {
        const response = await fetch(`${sourcesBase}/verificar`, { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        renderSources(data);
        const info = summary();
        alert(`Verificación terminada. ${info.propuestasPendientes} propuesta(s) pendiente(s); ${(data && data.changesDetected) || 0} fuente(s) del servidor y ${info.avisosConCambios} aviso(s) del feed con cambios.`);
      }
    } catch (error) {
      alert(`No se pudo verificar contra ARCA/SENASA: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = 'Verificar ahora';
    }
  }

  function attach() {
    const target = getTarget();
    if (!target || document.getElementById('pampaNormativeCard')) return;
    const card = document.createElement('section');
    card.id = 'pampaNormativeCard';
    card.className = 'card';
    card.style.marginTop = '16px';
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">Actualización de normativa ARCA/SENASA</div>
        <button class="btn" type="button" id="pampaNormativeVerificarBtn">Verificar ahora</button>
      </div>
      <p class="text-muted">Lee el feed de reglamentaciones cada 24 h. Los cambios de alícuotas quedan como propuestas para aprobar (nunca se aplican solos) y los cambios en páginas oficiales de ARCA/SENASA aparecen para revisar.</p>
      <form id="pampaNormativeFeedForm" class="form-grid">
        <div class="form-group" style="grid-column:1/-1"><label class="form-label">URL del feed de reglamentaciones</label><input class="form-input" id="pampaNormativeFeedUrl" type="url" placeholder="https://cdn.jsdelivr.net/gh/USUARIO/pampa-regulaciones-feed@main/feed/reglamentaciones.json"></div>
        <div class="form-group" style="align-self:end"><button class="btn" type="submit">Guardar URL</button></div>
      </form>
      <p class="text-muted" id="pampaNormativeFeedStatus" style="margin-top:6px;font-size:12px;"></p>
      <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Página oficial (feed)</th><th>Último control</th><th>Estado</th><th></th></tr></thead><tbody id="pampaNormativeAvisos"></tbody></table></div>
      ${sourcesBase ? '<div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Fuente oficial (servidor local)</th><th>Alcance</th><th>Estado</th><th>Último chequeo</th></tr></thead><tbody id="pampaNormativeSources"></tbody></table></div>' : ''}
      <hr style="margin:16px 0;border-color:var(--border,#2a3145);">
      <div class="card-header"><div class="card-title">Parámetros fiscales y cambios normativos</div></div>
      <p class="text-muted">Registro auditado: cada propuesta (del feed o manual) requiere aprobación y conserva la norma, la vigencia y la fuente.</p>
      <form id="pampaNormativeForm" class="form-grid">
        <div class="form-group"><label class="form-label">Norma</label><input class="form-input" name="norma" placeholder="Ej. RG 4325" required></div>
        <div class="form-group"><label class="form-label">Artículo</label><input class="form-input" name="articulo" placeholder="Ej. Art. 10"></div>
        <div class="form-group"><label class="form-label">Parámetro</label><input class="form-input" name="parametro" placeholder="Ej. Retención SISA Estado 2" required></div>
        <div class="form-group"><label class="form-label">Valor anterior</label><input class="form-input" name="valorAnterior"></div>
        <div class="form-group"><label class="form-label">Valor propuesto</label><input class="form-input" name="valorNuevo" required></div>
        <div class="form-group"><label class="form-label">Vigencia desde</label><input class="form-input" type="date" name="vigenciaDesde" required></div>
        <div class="form-group"><label class="form-label">Vigencia hasta</label><input class="form-input" type="date" name="vigenciaHasta"></div>
        <div class="form-group"><label class="form-label">Fuente oficial</label><input class="form-input" type="url" name="fuente" placeholder="https://..." required></div>
        <div class="form-group"><label class="form-label">Motivo / impacto</label><input class="form-input" name="motivo" placeholder="Operaciones afectadas o aclaración"></div>
        <div class="form-group" style="align-self:end"><button class="btn primary" type="submit">Proponer actualización</button></div>
      </form>
      <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Norma</th><th>Parámetro</th><th>Cambio</th><th>Vigencia</th><th>Fuente</th><th>Estado</th><th>Acción</th></tr></thead><tbody id="pampaNormativeList"></tbody></table></div>`;
    target.appendChild(card);
    card.querySelector('#pampaNormativeForm').addEventListener('submit', createProposal);
    card.querySelector('#pampaNormativeFeedForm').addEventListener('submit', (event) => {
      event.preventDefault();
      if (saveFeedUrl(card.querySelector('#pampaNormativeFeedUrl').value)) syncFeed({ silent: false });
    });
    card.querySelector('#pampaNormativeVerificarBtn').addEventListener('click', (event) => verificarAhora(event.currentTarget));
    render();
    loadSourcesStatus();
  }

  function start() {
    attach();
    notify();
    syncIfDue();
    // Apps de escritorio que quedan abiertas varios días: se vuelve a mirar cada 6 h.
    setInterval(syncIfDue, 6 * 60 * 60 * 1000);
    window.addEventListener('online', syncIfDue);
  }

  window.PampaFiscalNormativa = {
    app: appName,
    attach,
    activeRules,
    valueFor,
    syncFeed,
    processFeedRules,
    summary,
    snapshot(date) {
      return { fecha: date || today(), reglas: activeRules(date), ledgerVersion: readStore().ledger.length };
    },
    listProposals() {
      return readStore().proposals;
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
