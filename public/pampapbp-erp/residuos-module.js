/* Pampa PBP - Residuos
 * Basado en el módulo de residuos agroquímicos de PampaAgro (panel, envases, triple lavado, entregas
 * a CAT, otros residuos, trazabilidad y marco legal), adaptado a una planta de alimento balanceado.
 * Usa helpers del script principal (api, toast, escapeHTML, num) y window.pbpData.
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = v => escapeHTML(v ?? '');
  const todayISO = () => new Date().toLocaleDateString('sv-SE');
  const fmtDate = iso => (iso ? iso.split('-').reverse().join('/') : '—');
  const daysSince = iso => Math.round((new Date(todayISO() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
  const uid = prefix => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const savedMessage = (result, ok) => toast(result && result.offline ? 'Guardado sin conexión: se sincroniza al volver la señal' : ok);
  const pendingTag = item => (item && item._pending ? '<span class="pending-tag">sin sincronizar</span>' : '');
  const options = (list, selected) => list.map(o => (Array.isArray(o) ? o : [o, o])).map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');

  // Listas desplegables (las mismas que valida el servidor)
  const CATEGORIES = ['Premezcla vitamínico-mineral', 'Aditivo o aminoácido', 'Medicamento veterinario (premix medicado)', 'Raticida o insecticida', 'Producto de limpieza o desinfectante', 'Aceite o lubricante', 'Otro'];
  const HAZARDOUS_CATEGORIES = ['Medicamento veterinario (premix medicado)', 'Raticida o insecticida', 'Aceite o lubricante'];
  const CONTAINER_TYPES = ['Bolsa de papel multicapa (25 kg)', 'Bolsa plástica', 'Big bag', 'Bidón plástico (5 L)', 'Bidón plástico (10 L)', 'Bidón plástico (20 L)', 'Tambor (200 L)', 'Balde plástico', 'Caja de cartón', 'Otro'];
  // Envases rígidos que contuvieron líquidos o pastas: llevan triple lavado
  const NEEDS_WASH = ['Bidón plástico (5 L)', 'Bidón plástico (10 L)', 'Bidón plástico (20 L)', 'Tambor (200 L)', 'Balde plástico'];
  const CONTAINER_STATUS = ['Pendiente triple lavado', 'Lavado, pendiente entrega', 'Pendiente de entrega', 'Entregado'];
  const STATUS_BADGE = { 'Pendiente triple lavado': 'amber', 'Lavado, pendiente entrega': 'blue', 'Pendiente de entrega': 'blue', 'Entregado': 'green' };
  const WASH_METHODS = ['Manual (3 enjuagues)', 'Mecánico (a presión)'];
  const RINSE = ['Tanque de efluentes de lavado', 'Bidón para operador habilitado', 'Otro'];
  const DELIVERY_TYPES = ['CAT CampoLimpio', 'Operador de residuos peligrosos', 'Reciclador habilitado', 'Recolección municipal'];
  const WASTE_TYPES = {
    'Polvo de aspiración y filtros de mangas': 'De proceso', 'Finos y barrido de planta': 'De proceso', 'Producto fuera de especificación': 'De proceso', 'Lote de arrastre (flushing)': 'De proceso', 'Materia prima rechazada': 'De proceso',
    'Aceite usado (Y8)': 'Peligroso', 'Filtros y trapos con hidrocarburos': 'Peligroso', 'Residuos de laboratorio': 'Peligroso',
    'Cenizas de caldera': 'No peligroso', 'Pallets y maderas': 'No peligroso', 'Chatarra y metales': 'No peligroso', 'Bolsas y big bags sin contaminar': 'No peligroso', 'Residuos asimilables a urbanos': 'No peligroso', 'Otro': 'No peligroso'
  };
  const CLASS_COLOR = { 'Peligroso': 'var(--red)', 'De proceso': 'var(--accent)', 'No peligroso': 'var(--ok)' };
  const CLASS_BADGE = { 'Peligroso': 'red', 'De proceso': 'amber', 'No peligroso': 'green' };
  const DISPOSITIONS = ['Devolución al proveedor', 'Reproceso en planta', 'Alimentación animal (subproducto)', 'Compostaje', 'Reciclado', 'Operador habilitado', 'Relleno sanitario o recolección municipal', 'Almacenamiento transitorio'];
  const DEFAULT_DISPOSITION = { 'Peligroso': 'Almacenamiento transitorio', 'De proceso': 'Reproceso en planta', 'No peligroso': 'Relleno sanitario o recolección municipal' };
  const UNITS = ['kg', 'TM', 'L', 'unidades', 'bolsas'];
  const PALETTE = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#06b6d4', '#ef4444', '#64748b'];

  const COLLECTIONS = { wasteContainers: '/api/waste-containers', wasteWashes: '/api/waste-washes', wasteDeliveries: '/api/waste-deliveries', wasteOther: '/api/waste-other' };
  const state = { batches: [], employees: [] };
  Object.keys(COLLECTIONS).forEach(k => { state[k] = []; });
  function load(data) {
    if (!data) return;
    for (const k of [...Object.keys(COLLECTIONS), 'batches', 'employees']) { if (!Array.isArray(data[k])) data[k] = []; state[k] = data[k]; }
    render();
  }
  async function saveRecord(key, draft, isNew) {
    const path = COLLECTIONS[key];
    const result = isNew ? await api(path, { method: 'POST', body: JSON.stringify(draft) }) : await api(`${path}/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: JSON.stringify(draft) });
    const saved = { ...draft, ...result, _pending: !!result.offline }; delete saved.offline;
    const list = state[key], i = list.findIndex(x => x.id === draft.id);
    if (i >= 0) list[i] = saved; else list.push(saved);
    return result;
  }
  async function removeRecord(key, id) {
    const result = await api(`${COLLECTIONS[key]}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const list = state[key], i = list.findIndex(x => x.id === id);
    if (i >= 0) list.splice(i, 1);
    return result;
  }
  const containerLabel = c => (c ? `${c.product} · ${num(c.quantity)} ${c.containerType.toLowerCase()} (${fmtDate(c.date)})` : '—');
  const byDate = (a, z) => z.date.localeCompare(a.date);
  const isHazardousContainer = c => HAZARDOUS_CATEGORIES.includes(c.category);
  // Cantidades en kg para comparar (TM × 1000; litros ≈ kg); unidades y bolsas se informan aparte
  const toKg = r => (r.unit === 'TM' ? r.quantity * 1000 : r.unit === 'kg' || r.unit === 'L' ? r.quantity : 0);

  /* ---------- secciones ---------- */
  function showSection(name) {
    document.querySelectorAll('#wasteNav .pill').forEach(b => b.classList.toggle('active', b.dataset.ws === name));
    document.querySelectorAll('.ws-section').forEach(s => s.classList.toggle('active', s.dataset.wsSection === name));
    try { localStorage.setItem('pbp:residuos-section', name); } catch {}
  }
  el('wasteNav').addEventListener('click', e => { const b = e.target.closest('.pill'); if (b) showSection(b.dataset.ws); });
  try { showSection(localStorage.getItem('pbp:residuos-section') || 'panel'); } catch {}

  /* ---------- render ---------- */
  function renderPanel() {
    const cs = state.wasteContainers, sum = list => list.reduce((s, c) => s + (Number(c.quantity) || 0), 0);
    const pending = cs.filter(c => c.status === 'Pendiente triple lavado'), ready = cs.filter(c => ['Lavado, pendiente entrega', 'Pendiente de entrega'].includes(c.status)), delivered = cs.filter(c => c.status === 'Entregado');
    el('wsKpiGenerated').textContent = num(sum(cs));
    el('wsKpiGeneratedFoot').textContent = `${cs.length} registros · ${num(sum(cs.filter(isHazardousContainer)))} con contenido peligroso`;
    el('wsKpiPending').textContent = num(sum(pending));
    el('wsKpiReady').textContent = num(sum(ready));
    el('wsKpiDelivered').textContent = num(sum(delivered));
    const noCert = state.wasteDeliveries.filter(d => !d.certificate);
    el('wsKpiDeliveredFoot').textContent = `${state.wasteDeliveries.length} entrega${state.wasteDeliveries.length === 1 ? '' : 's'}${noCert.length ? ` · ${noCert.length} sin certificado` : ' · todas certificadas'}`;
    el('wsKpiDeliveredFoot').className = `metric-foot ${noCert.length ? 'warning' : 'positive'}`;
    const stored = state.wasteOther.filter(r => r.disposition === 'Almacenamiento transitorio');
    const old = stored.filter(r => daysSince(r.date) > 60);
    const msgs = [];
    if (pending.length) msgs.push(`<b>${num(sum(pending))} envases esperan triple lavado</b> (${pending.map(c => esc(c.product)).join(', ')}).`);
    if (ready.length) msgs.push(`${num(sum(ready))} envases listos para entregar en un CAT u operador.`);
    if (stored.length) msgs.push(`${stored.length} residuo${stored.length === 1 ? '' : 's'} en almacenamiento transitorio${old.length ? `, <b>${old.length} con más de 60 días</b>: coordinar el retiro con un operador habilitado` : ''}.`);
    if (noCert.length) msgs.push(`Faltan ${noCert.length} certificado${noCert.length === 1 ? '' : 's'} de disposición final.`);
    const status = el('wsStatus');
    status.style.setProperty('--status-color', old.length || pending.length ? 'var(--orange)' : noCert.length ? 'var(--blue)' : 'var(--ok)');
    status.innerHTML = msgs.length ? msgs.join(' ') : '<b>Todo al día.</b> Sin envases pendientes ni residuos acumulados.';
    const month = todayISO().slice(0, 7), monthRows = state.wasteOther.filter(r => r.date.slice(0, 7) === month);
    el('wsClasses').innerHTML = ['Peligroso', 'De proceso', 'No peligroso'].map(cls => {
      const rows = monthRows.filter(r => WASTE_TYPES[r.type] === cls), kg = rows.reduce((s, r) => s + toKg(r), 0), units = rows.filter(r => !toKg(r)).reduce((s, r) => s + r.quantity, 0);
      return `<div class="tenure-box" style="--tenure-color:${CLASS_COLOR[cls]}"><span>${cls}</span><b>${num(kg)} kg</b><small>${rows.length} registro${rows.length === 1 ? '' : 's'} este mes${units ? ` · ${num(units)} unidades/bolsas` : ''}</small></div>`;
    }).join('');
    const year = new Date(); year.setFullYear(year.getFullYear() - 1); const since = year.toLocaleDateString('sv-SE');
    const byDisp = {}; state.wasteOther.filter(r => r.date >= since).forEach(r => { byDisp[r.disposition] = (byDisp[r.disposition] || 0) + toKg(r); });
    const entries = Object.entries(byDisp).filter(([, v]) => v > 0).sort((a, z) => z[1] - a[1]), total = entries.reduce((s, [, v]) => s + v, 0);
    el('wsDispStack').innerHTML = entries.map(([d, v], i) => `<span style="width:${v / total * 100}%;background:${PALETTE[i % PALETTE.length]}" title="${esc(d)}"></span>`).join('');
    const reused = entries.filter(([d]) => ['Reproceso en planta', 'Alimentación animal (subproducto)', 'Compostaje', 'Reciclado'].includes(d)).reduce((s, [, v]) => s + v, 0);
    el('wsDispLegend').innerHTML = entries.length ? entries.map(([d, v], i) => `<div><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(d)} · ${num(v)} kg (${num(v / total * 100, 0)}%)</div>`).join('') + `<div style="grid-column:1/-1"><b class="positive">${num(reused / total * 100, 0)}% reaprovechado</b> (reproceso, subproducto, compostaje o reciclado)</div>` : '<div>Sin residuos registrados en el último año</div>';
  }
  function renderContainers() {
    const rows = [...state.wasteContainers].sort(byDate);
    el('wsContainerRows').innerHTML = rows.length ? rows.map(c => `<tr><td>${fmtDate(c.date)}</td><td>${esc(c.category)}${isHazardousContainer(c) ? ' <span class="badge red class-badge">Peligroso</span>' : ''}</td><td><b>${esc(c.product)}</b>${pendingTag(c)}${c.notes ? `<br><small class="text-muted">${esc(c.notes)}</small>` : ''}</td><td>${num(c.quantity)}</td><td>${esc(c.containerType)}${NEEDS_WASH.includes(c.containerType) ? '<br><small class="text-muted">requiere triple lavado</small>' : ''}</td><td>${esc(c.batchId) || '—'}</td>
      <td><select class="inline-status ws-container-status" data-id="${esc(c.id)}">${options(CONTAINER_STATUS, c.status)}</select></td>
      <td><div class="row-actions"><button class="ghost-btn" data-ws-edit="container" data-id="${esc(c.id)}">Editar</button><button class="danger-btn" data-ws-del="wasteContainers" data-id="${esc(c.id)}" aria-label="Eliminar">×</button></div></td></tr>`).join('') : '<tr><td colspan="8">Sin envases registrados</td></tr>';
  }
  function renderWashes() {
    const rows = [...state.wasteWashes].sort(byDate);
    el('wsWashRows').innerHTML = rows.length ? rows.map(w => `<tr><td>${fmtDate(w.date)}</td><td>${esc(containerLabel(state.wasteContainers.find(c => c.id === w.containerId)))}${pendingTag(w)}</td><td>${num(w.quantity)}</td><td>${esc(w.method)}</td><td>${esc(w.rinseDestination)}</td><td>${esc(w.responsible)}</td>
      <td><button class="danger-btn" data-ws-del="wasteWashes" data-id="${esc(w.id)}" aria-label="Eliminar">×</button></td></tr>`).join('') : '<tr><td colspan="7">Sin registros de triple lavado</td></tr>';
  }
  function renderDeliveries() {
    const rows = [...state.wasteDeliveries].sort(byDate);
    el('wsDeliveryRows').innerHTML = rows.length ? rows.map(d => `<tr><td>${fmtDate(d.date)}</td><td>${esc(d.deliveryType)}</td><td><b>${esc(d.receiver)}</b>${pendingTag(d)}${d.location ? `<br><small class="text-muted">${esc(d.location)}</small>` : ''}</td><td>${esc(containerLabel(state.wasteContainers.find(c => c.id === d.containerId)))}</td><td>${d.quantity ? `${num(d.quantity)} env.` : ''}${d.weightKg ? `${d.quantity ? ' · ' : ''}${num(d.weightKg, 1)} kg` : ''}</td><td>${esc(d.voucher) || '—'}</td>
      <td><label class="check" style="padding:0;background:none"><input type="checkbox" class="ws-cert" data-id="${esc(d.id)}" ${d.certificate ? 'checked' : ''}> ${d.certificate ? 'Recibido' : '<span class="warning">Pendiente</span>'}</label></td><td>${esc(d.responsible)}</td>
      <td><div class="row-actions"><button class="ghost-btn" data-ws-edit="delivery" data-id="${esc(d.id)}">Editar</button><button class="danger-btn" data-ws-del="wasteDeliveries" data-id="${esc(d.id)}" aria-label="Eliminar">×</button></div></td></tr>`).join('') : '<tr><td colspan="9">Sin entregas registradas</td></tr>';
  }
  function renderOther() {
    const rows = [...state.wasteOther].sort(byDate);
    el('wsOtherRows').innerHTML = rows.length ? rows.map(r => { const cls = WASTE_TYPES[r.type] || 'No peligroso', stored = r.disposition === 'Almacenamiento transitorio', age = daysSince(r.date);
      return `<tr><td>${fmtDate(r.date)}</td><td><b>${esc(r.type)}</b>${pendingTag(r)}${r.notes ? `<br><small class="text-muted">${esc(r.notes)}</small>` : ''}</td><td><span class="badge ${CLASS_BADGE[cls]} class-badge">${cls}</span></td><td>${num(r.quantity, r.quantity % 1 ? 1 : 0)} ${esc(r.unit)}</td><td>${esc(r.disposition)}${stored ? `<br><small class="${age > 60 ? 'negative' : 'text-muted'}">hace ${age} días</small>` : ''}</td><td>${esc(r.batchId) || '—'}</td><td>${esc(r.manifest) || (cls === 'Peligroso' && !stored ? '<span class="warning">Falta</span>' : '—')}</td><td>${esc(r.responsible)}</td>
        <td><div class="row-actions"><button class="ghost-btn" data-ws-edit="other" data-id="${esc(r.id)}">Editar</button><button class="danger-btn" data-ws-del="wasteOther" data-id="${esc(r.id)}" aria-label="Eliminar">×</button></div></td></tr>`; }).join('') : '<tr><td colspan="9">Sin residuos registrados</td></tr>';
  }
  function renderTrace() {
    const filter = el('wsTraceFilter').value;
    const events = [
      ...state.wasteContainers.map(c => ({ date: c.date, kind: 'Generación de envases', detail: `${c.product} (${c.category})`, qty: `${num(c.quantity)} envases`, who: c.batchId ? `Lote ${c.batchId}` : '—' })),
      ...state.wasteWashes.map(w => ({ date: w.date, kind: 'Triple lavado', detail: `${containerLabel(state.wasteContainers.find(c => c.id === w.containerId))} · ${w.method}`, qty: `${num(w.quantity)} envases`, who: w.responsible })),
      ...state.wasteDeliveries.map(d => ({ date: d.date, kind: 'Entrega', detail: `${d.deliveryType} · ${d.receiver}${d.voucher ? ` · ${d.voucher}` : ''}${d.certificate ? ' · certificado' : ''}`, qty: [d.quantity ? `${num(d.quantity)} envases` : '', d.weightKg ? `${num(d.weightKg, 1)} kg` : ''].filter(Boolean).join(' · ') || '—', who: d.responsible })),
      ...state.wasteOther.map(r => ({ date: r.date, kind: 'Residuo', detail: `${r.type} → ${r.disposition}`, qty: `${num(r.quantity, r.quantity % 1 ? 1 : 0)} ${r.unit}`, who: [r.responsible, r.batchId ? `lote ${r.batchId}` : ''].filter(Boolean).join(' · ') }))
    ].filter(e => !filter || e.kind === filter).sort(byDate);
    el('wsTraceRows').innerHTML = events.length ? events.map(e => `<tr><td>${fmtDate(e.date)}</td><td><b>${esc(e.kind)}</b></td><td style="white-space:normal">${esc(e.detail)}</td><td>${esc(e.qty)}</td><td>${esc(e.who)}</td></tr>`).join('') : '<tr><td colspan="5">Sin eventos</td></tr>';
  }
  el('wsTraceFilter').addEventListener('change', renderTrace);
  function render() { renderPanel(); renderContainers(); renderWashes(); renderDeliveries(); renderOther(); renderTrace(); }

  /* ---------- cambios rápidos en tablas ---------- */
  const page = el('page-waste');
  page.addEventListener('change', async e => {
    const st = e.target.closest('.ws-container-status'), cert = e.target.closest('.ws-cert');
    try {
      if (st) { const c = state.wasteContainers.find(x => x.id === st.dataset.id); const r = await saveRecord('wasteContainers', { ...c, status: st.value }, false); savedMessage(r, 'Estado actualizado'); }
      if (cert) { const d = state.wasteDeliveries.find(x => x.id === cert.dataset.id); const r = await saveRecord('wasteDeliveries', { ...d, certificate: cert.checked }, false); savedMessage(r, cert.checked ? 'Certificado de disposición final registrado' : 'Certificado marcado como pendiente'); }
    } catch (error) { toast(error.message); }
    if (st || cert) render();
  });
  page.addEventListener('click', async e => {
    const del = e.target.closest('[data-ws-del]'), nb = e.target.closest('[data-ws-new]'), eb = e.target.closest('[data-ws-edit]');
    if (nb) return openForm(nb.dataset.wsNew, null);
    if (eb) return openForm(eb.dataset.wsEdit, state[FORMS[eb.dataset.wsEdit].key].find(x => x.id === eb.dataset.id));
    if (!del || !confirm('¿Eliminar este registro?')) return;
    try { const r = await removeRecord(del.dataset.wsDel, del.dataset.id); savedMessage(r, 'Registro eliminado'); render(); } catch (error) { toast(error.message); }
  });

  /* ---------- formularios ---------- */
  const people = () => [...new Set(state.employees.filter(x => x.status !== 'Baja').map(x => x.name))];
  const batchOptions = () => [['', 'Sin lote asociado'], ...[...state.batches].map(b => [b.id, `${b.id} · ${b.phase}`])];
  const FORMS = {
    container: { key: 'wasteContainers', title: 'envases', prefix: 'ENV', defaults: () => ({ date: todayISO(), category: CATEGORIES[0], containerType: CONTAINER_TYPES[0], status: 'Pendiente de entrega', quantity: 1, batchId: '' }),
      fields: [
        { key: 'date', label: 'Fecha', type: 'date', required: true },
        { key: 'category', label: 'Categoría del producto', type: 'select', options: CATEGORIES },
        { key: 'product', label: 'Producto', type: 'text', required: true, full: true, placeholder: 'Nombre comercial y presentación' },
        { key: 'quantity', label: 'Cantidad de envases', type: 'number', required: true, min: 1, step: 1 },
        { key: 'containerType', label: 'Tipo de envase', type: 'select', options: CONTAINER_TYPES, onChange: (v, f) => { f.querySelector('[name=status]').value = NEEDS_WASH.includes(v) ? 'Pendiente triple lavado' : 'Pendiente de entrega'; } },
        { key: 'status', label: 'Estado', type: 'select', options: CONTAINER_STATUS },
        { key: 'batchId', label: 'Lote de producción', type: 'select', options: batchOptions },
        { key: 'notes', label: 'Observaciones', type: 'text', full: true }
      ] },
    wash: { key: 'wasteWashes', title: 'triple lavado', prefix: 'LAV', newOnly: true, defaults: () => { const c = state.wasteContainers.find(x => x.status === 'Pendiente triple lavado'); return { date: todayISO(), containerId: c ? c.id : '', quantity: c ? c.quantity : 1, method: WASH_METHODS[0], rinseDestination: RINSE[0] }; },
      fields: [
        { key: 'date', label: 'Fecha', type: 'date', required: true },
        { key: 'containerId', label: 'Envases lavados', type: 'select', options: () => [['', 'Otros (sin registro previo)'], ...state.wasteContainers.filter(c => c.status === 'Pendiente triple lavado').map(c => [c.id, containerLabel(c)])], onChange: (v, f) => { const c = state.wasteContainers.find(x => x.id === v); if (c) f.querySelector('[name=quantity]').value = c.quantity; } },
        { key: 'quantity', label: 'Cantidad de envases', type: 'number', required: true, min: 1, step: 1 },
        { key: 'method', label: 'Método', type: 'select', options: WASH_METHODS },
        { key: 'rinseDestination', label: 'Destino del agua de lavado', type: 'select', options: RINSE },
        { key: 'responsible', label: 'Responsable', type: 'text', required: true, list: people },
        { key: 'notes', label: 'Observaciones', type: 'text', full: true }
      ],
      async after(draft) { // si se lavó todo el registro de envases, pasa a "Lavado, pendiente entrega"
        const c = state.wasteContainers.find(x => x.id === draft.containerId);
        if (c && draft.quantity >= c.quantity) await saveRecord('wasteContainers', { ...c, status: 'Lavado, pendiente entrega' }, false);
      } },
    delivery: { key: 'wasteDeliveries', title: 'entrega', prefix: 'ENT', defaults: () => { const c = state.wasteContainers.find(x => ['Lavado, pendiente entrega', 'Pendiente de entrega'].includes(x.status)); return { date: todayISO(), deliveryType: c && isHazardousContainer(c) ? 'Operador de residuos peligrosos' : 'CAT CampoLimpio', containerId: c ? c.id : '', quantity: c ? c.quantity : 0, weightKg: 0, certificate: false }; },
      fields: [
        { key: 'date', label: 'Fecha', type: 'date', required: true },
        { key: 'deliveryType', label: 'Tipo de entrega', type: 'select', options: DELIVERY_TYPES },
        { key: 'receiver', label: 'Receptor (CAT, operador o reciclador)', type: 'text', required: true, list: () => [...new Set(state.wasteDeliveries.map(d => d.receiver))] },
        { key: 'location', label: 'Ubicación', type: 'text' },
        { key: 'containerId', label: 'Envases entregados', type: 'select', options: () => [['', 'Otros residuos / sin registro'], ...state.wasteContainers.filter(c => c.status !== 'Entregado' || c.id === current?.record.containerId).map(c => [c.id, containerLabel(c)])], onChange: (v, f) => { const c = state.wasteContainers.find(x => x.id === v); if (c) { f.querySelector('[name=quantity]').value = c.quantity; f.querySelector('[name=deliveryType]').value = isHazardousContainer(c) ? 'Operador de residuos peligrosos' : 'CAT CampoLimpio'; } } },
        { key: 'quantity', label: 'Cantidad de envases', type: 'number', min: 0, step: 1 },
        { key: 'weightKg', label: 'Peso (kg)', type: 'number', min: 0, step: 0.1 },
        { key: 'voucher', label: 'N° de comprobante o manifiesto', type: 'text' },
        { key: 'responsible', label: 'Responsable de la entrega', type: 'text', required: true, list: people },
        { key: 'certificate', label: 'Certificado de disposición final recibido', type: 'checkbox', full: true },
        { key: 'notes', label: 'Observaciones', type: 'text', full: true }
      ],
      async after(draft) {
        const c = state.wasteContainers.find(x => x.id === draft.containerId);
        if (c && c.status !== 'Entregado') await saveRecord('wasteContainers', { ...c, status: 'Entregado' }, false);
      } },
    other: { key: 'wasteOther', title: 'residuo', prefix: 'RES', defaults: () => ({ date: todayISO(), type: Object.keys(WASTE_TYPES)[0], unit: 'kg', disposition: 'Reproceso en planta', batchId: '' }),
      fields: [
        { key: 'date', label: 'Fecha', type: 'date', required: true },
        { key: 'type', label: 'Tipo de residuo', type: 'select', options: Object.keys(WASTE_TYPES).map(t => [t, `${t} · ${WASTE_TYPES[t]}`]), onChange: (v, f) => { f.querySelector('[name=disposition]').value = DEFAULT_DISPOSITION[WASTE_TYPES[v]]; } },
        { key: 'quantity', label: 'Cantidad', type: 'number', required: true, min: 0.001, step: 0.001 },
        { key: 'unit', label: 'Unidad', type: 'select', options: UNITS },
        { key: 'disposition', label: 'Disposición', type: 'select', options: DISPOSITIONS },
        { key: 'batchId', label: 'Lote de producción relacionado', type: 'select', options: batchOptions },
        { key: 'manifest', label: 'N° de manifiesto (residuos peligrosos)', type: 'text', showIf: v => WASTE_TYPES[v.type] === 'Peligroso' || v.disposition === 'Operador habilitado' },
        { key: 'responsible', label: 'Responsable', type: 'text', required: true, list: people },
        { key: 'notes', label: 'Observaciones', type: 'text', full: true }
      ] }
  };
  let current = null;
  function fieldHtml(f, value) {
    const id = `ws-${f.key}`, list = typeof f.list === 'function' ? f.list() : f.list;
    const attrs = `id="${id}" name="${f.key}" ${f.required ? 'required' : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.step !== undefined ? `step="${f.step}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
    if (f.type === 'checkbox') return `<div class="field full check-field" data-field="${f.key}"><label class="check"><input type="checkbox" ${attrs} ${value ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
    const input = f.type === 'select' ? `<select ${attrs}>${options(typeof f.options === 'function' ? f.options() : f.options, value)}</select>`
      : `<input type="${f.type}" ${attrs} value="${esc(value ?? '')}" ${list ? `list="${id}-list"` : ''}>${list ? `<datalist id="${id}-list">${list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
    return `<div class="field${f.full ? ' full' : ''}" data-field="${f.key}"><label for="${id}">${esc(f.label)}</label>${input}</div>`;
  }
  function readForm() {
    const v = { ...current.record };
    for (const f of current.spec.fields) { const i = el('wasteForm').querySelector(`[name="${f.key}"]`); if (i) v[f.key] = f.type === 'checkbox' ? i.checked : f.type === 'number' ? Number(i.value || 0) : i.value.trim(); }
    return v;
  }
  function syncVisibility() {
    const v = readForm();
    for (const f of current.spec.fields) { const w = el('wasteForm').querySelector(`[data-field="${f.key}"]`); if (!w || !f.showIf) continue; const vis = f.showIf(v); w.hidden = !vis; w.querySelectorAll('input,select').forEach(i => { i.disabled = !vis; }); }
  }
  function openForm(kind, record) {
    const spec = FORMS[kind];
    current = { spec, isNew: !record, record: record ? { ...record } : { id: uid(spec.prefix), ...spec.defaults() } };
    el('wasteDialogTitle').textContent = `${record ? 'Editar' : 'Registrar'} ${spec.title}`;
    el('wasteFields').innerHTML = spec.fields.map(f => fieldHtml(f, current.record[f.key])).join('');
    syncVisibility();
    el('wasteDialog').showModal();
    setTimeout(() => el('wasteFields').querySelector('input:not([type=checkbox]):not([disabled]),select')?.focus(), 50);
  }
  el('wasteFields').addEventListener('change', e => { const f = current?.spec.fields.find(x => x.key === e.target.name); if (f?.onChange) f.onChange(e.target.value, el('wasteForm')); syncVisibility(); });
  el('wasteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = el('wasteSubmit'); btn.disabled = true;
    try {
      const draft = readForm();
      const r = await saveRecord(current.spec.key, draft, current.isNew);
      if (current.spec.after) await current.spec.after(draft);
      el('wasteDialog').close(); savedMessage(r, current.isNew ? 'Registro guardado' : 'Cambios guardados'); render();
    } catch (error) { toast(error.message); } finally { btn.disabled = false; }
  });
  document.querySelectorAll('[data-close-dialog="wasteDialog"]').forEach(b => b.addEventListener('click', () => el('wasteDialog').close()));
  window.pbpOpenWasteForm = kind => { showSection(kind === 'other' ? 'other' : kind === 'container' ? 'containers' : kind === 'wash' ? 'washes' : 'deliveries'); openForm(kind, null); };

  document.addEventListener('pbp:bootstrap', event => load(event.detail));
  if (window.pbpData) load(window.pbpData); else render();
})();
