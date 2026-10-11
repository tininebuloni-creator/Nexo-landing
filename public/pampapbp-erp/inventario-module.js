/* Pampa PBP - Inventario e Instalaciones
 * Productos con stock calculado a partir de los movimientos (recepción, consumo, producción, despacho,
 * transferencias, ajustes y mermas), asociados a las instalaciones de la planta (silos, celdas, tolvas,
 * micro-bins, tanques y depósitos) para conocer la ocupación real de cada una.
 * Usa helpers del script principal (api, toast, escapeHTML, money, num, go) y window.pbpData.
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = v => escapeHTML(v ?? '');
  const pesos = n => money(Number(n) || 0);
  const todayISO = () => new Date().toLocaleDateString('sv-SE');
  const fmtDate = iso => (iso ? iso.split('-').reverse().join('/') : '—');
  const daysSince = iso => Math.round((new Date(todayISO() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
  const uid = prefix => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const savedMessage = (result, ok) => toast(result && result.offline ? 'Guardado sin conexión: se sincroniza al volver la señal' : ok);
  const pendingTag = item => (item && item._pending ? '<span class="pending-tag">sin sincronizar</span>' : '');
  const options = (list, selected) => list.map(o => (Array.isArray(o) ? o : [o, o])).map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const SINGULAR = { unidades: 'unidad', bolsas: 'bolsa' };
  const qty = (v, unit) => `${num(+v, Math.abs(v) < 10 && v % 1 ? 2 : v % 1 ? 1 : 0)} ${Math.abs(+v) === 1 && SINGULAR[unit] ? SINGULAR[unit] : unit}`;

  // Listas desplegables (las mismas que valida el servidor)
  const INSTALLATION_TYPES = ['Silo de materia prima', 'Silo de producto terminado', 'Celda o galpón', 'Tolva de recepción', 'Tolva de dosificación / micro-bin', 'Tanque de líquidos', 'Depósito', 'Báscula', 'Otro'];
  const INSTALLATION_STATUS = ['Operativa', 'En limpieza', 'Fuera de servicio'];
  const CAPACITY_UNITS = ['TM', 'kg', 'L', 'm³', 'unidades'];
  const ITEM_CATEGORIES = ['Grano o cereal', 'Harina o expeller proteico', 'Subproducto', 'Núcleo o premezcla', 'Aditivo o aminoácido', 'Medicamento veterinario', 'Aceite o grasa', 'Producto terminado', 'Envase o embalaje', 'Repuesto o insumo de mantenimiento', 'Combustible o lubricante', 'Otro'];
  const ITEM_UNITS = ['TM', 'kg', 'L', 'unidades', 'bolsas'];
  const MOVEMENT_TYPES = ['Recepción', 'Consumo en producción', 'Producción terminada', 'Despacho', 'Transferencia entre instalaciones', 'Ajuste positivo', 'Ajuste negativo', 'Merma', 'Devolución a proveedor', 'Devolución de cliente'];
  const SIGN = { 'Recepción': 1, 'Producción terminada': 1, 'Ajuste positivo': 1, 'Devolución de cliente': 1, 'Consumo en producción': -1, 'Despacho': -1, 'Ajuste negativo': -1, 'Merma': -1, 'Devolución a proveedor': -1, 'Transferencia entre instalaciones': 0 };
  const TYPE_BADGE = t => (SIGN[t] > 0 ? 'green' : SIGN[t] < 0 ? 'red' : 'blue');
  const SILO_TYPES = ['Silo de materia prima', 'Silo de producto terminado'];

  const COLLECTIONS = { inventoryItems: '/api/inventory-items', inventoryMovements: '/api/inventory-movements', installations: '/api/installations' };
  const OTHER = ['batches', 'transactions', 'lots'];
  const state = { settings: {} };
  [...Object.keys(COLLECTIONS), ...OTHER].forEach(k => { state[k] = []; });
  function load(data) {
    if (!data) return;
    for (const k of [...Object.keys(COLLECTIONS), ...OTHER]) { if (!Array.isArray(data[k])) data[k] = []; state[k] = data[k]; }
    state.settings = data.settings || {};
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
    const list = state[key], i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1);
    return result;
  }
  const notify = () => document.dispatchEvent(new CustomEvent('pbp:inventory'));

  /* ---------- cálculos de stock ---------- */
  const itemById = id => state.inventoryItems.find(x => x.id === id);
  const installationById = id => state.installations.find(x => x.id === id);
  function itemStock(itemId, extra) {
    return [...state.inventoryMovements, ...(extra ? [extra] : [])].filter(m => m.itemId === itemId).reduce((s, m) => s + SIGN[m.type] * m.quantity, 0);
  }
  // Stock de cada producto dentro de una instalación (las transferencias salen del origen y entran al destino)
  function installationContents(insId, extra) {
    const contents = {};
    for (const m of [...state.inventoryMovements, ...(extra ? [extra] : [])]) {
      if (m.installationId === insId) contents[m.itemId] = (contents[m.itemId] || 0) + (m.type === 'Transferencia entre instalaciones' ? -m.quantity : SIGN[m.type] * m.quantity);
      if (m.toInstallationId === insId) contents[m.itemId] = (contents[m.itemId] || 0) + m.quantity;
    }
    return Object.entries(contents).filter(([, q]) => Math.abs(q) > 1e-9).map(([itemId, q]) => ({ item: itemById(itemId), itemId, quantity: q }));
  }
  // Cantidad expresada en la unidad de capacidad de la instalación (null si no es comparable)
  function inCapacityUnit(quantity, itemUnit, capUnit) {
    if (capUnit === 'TM') return itemUnit === 'TM' ? quantity : itemUnit === 'kg' ? quantity / 1000 : null;
    if (capUnit === 'kg') return itemUnit === 'kg' ? quantity : itemUnit === 'TM' ? quantity * 1000 : null;
    if (capUnit === 'L') return itemUnit === 'L' ? quantity : null;
    if (capUnit === 'unidades') return ['unidades', 'bolsas'].includes(itemUnit) ? quantity : null;
    return null;
  }
  function occupancy(ins, extra) {
    const contents = installationContents(ins.id, extra);
    const used = contents.reduce((s, c) => { const v = c.item ? inCapacityUnit(c.quantity, c.item.unit, ins.unit) : null; return v === null ? s : s + v; }, 0);
    return { contents, used, pct: ins.capacity ? used / ins.capacity * 100 : null };
  }
  function itemStatus(item) {
    const stock = itemStock(item.id);
    const since = new Date(); since.setDate(since.getDate() - 30); const from = since.toLocaleDateString('sv-SE');
    const out30 = state.inventoryMovements.filter(m => m.itemId === item.id && m.date >= from && ['Consumo en producción', 'Despacho', 'Merma'].includes(m.type)).reduce((s, m) => s + m.quantity, 0);
    const daily = out30 / 30;
    return { item, stock, value: stock * (Number(item.unitCost) || 0), level: stock <= 0 ? 'out' : stock < item.minStock ? 'low' : 'ok', days: daily > 0 ? stock / daily : null };
  }
  const zoneName = id => ((state.settings.sanitaryZones || []).find(z => z.id === id) || {}).name || '—';
  const occColor = pct => (pct === null ? 'var(--text-dim)' : pct > 100 ? 'var(--red)' : pct > 95 ? 'var(--orange)' : pct > 80 ? 'var(--accent)' : 'var(--ok)');
  function aggregate(types) {
    const list = state.installations.filter(i => types.includes(i.type) && i.status !== 'Fuera de servicio');
    const cap = list.reduce((s, i) => s + (i.unit === 'TM' ? i.capacity : 0), 0), used = list.reduce((s, i) => s + (i.unit === 'TM' ? occupancy(i).used : 0), 0);
    return { count: list.length, capacity: cap, used, pct: cap ? used / cap * 100 : null };
  }

  /* ---------- Inventario ---------- */
  function renderInventory() {
    const active = state.inventoryItems.filter(i => i.status === 'Activo'), statuses = active.map(itemStatus);
    const low = statuses.filter(s => s.level === 'low'), out = statuses.filter(s => s.level === 'out');
    el('invKpiItems').textContent = num(active.length);
    el('invKpiItemsFoot').textContent = `${state.inventoryItems.length - active.length} inactivos · ${new Set(active.map(i => i.category)).size} categorías`;
    el('invKpiValue').textContent = pesos(statuses.reduce((s, x) => s + Math.max(0, x.value), 0));
    const pt = statuses.filter(s => s.item.category === 'Producto terminado').reduce((s, x) => s + Math.max(0, x.value), 0);
    el('invKpiValueFoot').textContent = `Producto terminado ${pesos(pt)}`;
    el('invKpiLow').textContent = low.length; el('invKpiLowFoot').textContent = low.length ? low.map(s => s.item.name).slice(0, 2).join(', ') + (low.length > 2 ? '…' : '') : 'Ninguno debajo del mínimo';
    el('invKpiOut').textContent = out.length; el('invKpiOutFoot').textContent = out.length ? out.map(s => s.item.name).slice(0, 2).join(', ') : 'Sin productos agotados';
    const catSel = el('invFilterCategory'); if (catSel.options.length === 1) catSel.insertAdjacentHTML('beforeend', options(ITEM_CATEGORIES));
    const cat = catSel.value, lvl = el('invFilterStatus').value;
    const rows = state.inventoryItems.map(itemStatus).filter(s => (!cat || s.item.category === cat) && (!lvl || s.level === lvl)).sort((a, z) => a.item.code.localeCompare(z.item.code, 'es', { numeric: true }));
    el('invItemRows').innerHTML = rows.length ? rows.map(s => { const i = s.item, places = state.installations.map(ins => ({ ins, q: installationContents(ins.id).find(c => c.itemId === i.id)?.quantity || 0 })).filter(x => Math.abs(x.q) > 1e-9);
      return `<tr><td><b>${esc(i.code)}</b></td><td><b>${esc(i.name)}</b>${pendingTag(i)}${i.status !== 'Activo' ? ' <span class="badge red">Inactivo</span>' : ''}</td><td>${esc(i.category)}</td><td><b class="${s.level === 'out' ? 'negative' : s.level === 'low' ? 'warning' : ''}">${qty(s.stock, i.unit)}</b></td><td>${qty(i.minStock, i.unit)}</td>
        <td>${s.days === null ? '—' : `<span class="${s.days < 7 ? 'negative' : s.days < 15 ? 'warning' : ''}">${num(s.days, s.days < 10 ? 1 : 0)}</span>`}</td><td>${pesos(i.unitCost)}/${esc(i.unit)}</td><td>${pesos(Math.max(0, s.value))}</td>
        <td style="white-space:normal;min-width:160px">${places.length ? places.map(x => `${esc(x.ins.code)}: ${qty(x.q, i.unit)}`).join('<br>') : '<span class="text-muted">—</span>'}</td>
        <td><span class="badge ${s.level === 'out' ? 'red' : s.level === 'low' ? 'amber' : 'green'}">${s.level === 'out' ? 'Sin stock' : s.level === 'low' ? 'Crítico' : 'Normal'}</span></td>
        <td><div class="row-actions"><button class="ghost-btn" data-inv-move="${esc(i.id)}">Movimiento</button><button class="ghost-btn" data-inv-edit="item" data-id="${esc(i.id)}">Editar</button><button class="danger-btn" data-inv-del="inventoryItems" data-id="${esc(i.id)}" aria-label="Eliminar">×</button></div></td></tr>`; }).join('') : '<tr><td colspan="11">Sin productos para el filtro elegido</td></tr>';
    const typeSel = el('invFilterType'); if (typeSel.options.length === 1) typeSel.insertAdjacentHTML('beforeend', options(MOVEMENT_TYPES));
    const type = typeSel.value, month = el('invFilterMonth').value;
    const moves = [...state.inventoryMovements].filter(m => (!type || m.type === type) && (!month || m.date.slice(0, 7) === month)).sort((a, z) => z.date.localeCompare(a.date) || z.id.localeCompare(a.id));
    el('invMovRows').innerHTML = moves.length ? moves.map(m => { const i = itemById(m.itemId) || { name: m.itemId, unit: '' }, from = installationById(m.installationId), to = installationById(m.toInstallationId);
      return `<tr><td>${fmtDate(m.date)}</td><td><span class="badge ${TYPE_BADGE(m.type)}">${esc(m.type)}</span></td><td><b>${esc(i.name)}</b>${pendingTag(m)}</td><td class="${SIGN[m.type] > 0 ? 'positive' : SIGN[m.type] < 0 ? 'negative' : ''}">${SIGN[m.type] > 0 ? '+' : SIGN[m.type] < 0 ? '−' : ''}${qty(m.quantity, i.unit)}</td>
        <td>${from ? esc(from.code) : '—'}${to ? ` → ${esc(to.code)}` : ''}</td><td>${esc(m.reference) || '—'}</td><td>${esc(m.counterparty) || '—'}</td><td>${esc(m.vehicle) || '—'}</td><td>${esc(m.batchId) || '—'}</td>
        <td><button class="danger-btn" data-inv-del="inventoryMovements" data-id="${esc(m.id)}" aria-label="Eliminar">×</button></td></tr>`; }).join('') : '<tr><td colspan="10">Sin movimientos para el filtro elegido</td></tr>';
  }
  ['invFilterCategory', 'invFilterStatus', 'invFilterType', 'invFilterMonth'].forEach(id => el(id).addEventListener('change', renderInventory));

  /* ---------- Instalaciones ---------- */
  function renderInstallations() {
    const raw = aggregate(['Silo de materia prima']), fin = aggregate(['Silo de producto terminado']);
    const kpi = (id, a) => { el(id).textContent = a.pct === null ? '—' : `${num(a.pct, 0)}%`; el(`${id}Foot`).textContent = a.count ? `${num(a.used, 1)} de ${num(a.capacity)} TM en ${a.count} silo${a.count === 1 ? '' : 's'}` : 'Sin silos cargados'; };
    kpi('insKpiRaw', raw); kpi('insKpiFinished', fin);
    const operative = state.installations.filter(i => i.status === 'Operativa').length;
    el('insKpiOperative').textContent = `${operative}/${state.installations.length}`;
    el('insKpiOperativeFoot').textContent = `${state.installations.filter(i => i.status === 'En limpieza').length} en limpieza · ${state.installations.filter(i => i.status === 'Fuera de servicio').length} fuera de servicio`;
    const dirty = state.installations.filter(i => !i.lastCleaning || daysSince(i.lastCleaning) > 60);
    el('insKpiCleaning').textContent = dirty.length; el('insKpiCleaningFoot').textContent = dirty.length ? `Más de 60 días: ${dirty.map(i => i.code).slice(0, 3).join(', ')}` : 'Limpiezas al día';
    const typeSel = el('insFilterType'); if (typeSel.options.length === 1) typeSel.insertAdjacentHTML('beforeend', options(INSTALLATION_TYPES));
    const list = state.installations.filter(i => !typeSel.value || i.type === typeSel.value).sort((a, z) => a.code.localeCompare(z.code, 'es', { numeric: true }));
    el('insCount').textContent = `${list.length} de ${state.installations.length} instalaciones`;
    el('insCards').innerHTML = list.length ? list.map(ins => { const o = occupancy(ins), assigned = itemById(ins.itemId), clean = ins.lastCleaning ? daysSince(ins.lastCleaning) : null;
      const pct = o.pct, bar = pct === null ? 0 : Math.min(100, pct);
      return `<article class="doc-card ins-card"><div class="tender-card-head"><span class="doc-code">${esc(ins.code)}</span><span class="badge ${ins.status === 'Operativa' ? 'green' : ins.status === 'En limpieza' ? 'amber' : 'red'}">${esc(ins.status)}</span></div>
        <h3>${esc(ins.name)}${pendingTag(ins)}</h3><small class="text-muted">${esc(ins.type)} · ${esc(zoneName(ins.zoneId))}</small>
        <div class="ins-fill"><span style="width:${bar}%;background:${occColor(pct)}"></span></div>
        <div><span class="ins-stock">${pct === null ? '—' : `${num(pct, 0)}%`}</span> <small class="text-muted">${num(o.used, ins.unit === 'TM' ? 1 : 0)} de ${num(ins.capacity)} ${esc(ins.unit)}</small></div>
        <div class="ins-items">${o.contents.length ? o.contents.map(c => `${esc(c.item?.name || c.itemId)}: <b>${qty(c.quantity, c.item?.unit || '')}</b>`).join('<br>') : '<span class="text-muted">Vacía</span>'}${assigned && !o.contents.some(c => c.itemId === assigned.id) ? `<br><span class="text-muted">Asignada a ${esc(assigned.name)}</span>` : ''}${o.contents.some(c => assigned && c.itemId !== assigned.id) ? '<br><span class="warning">Contiene otro producto que el asignado</span>' : ''}</div>
        <small class="${clean !== null && clean > 60 ? 'warning' : 'text-muted'}">Última limpieza: ${ins.lastCleaning ? `${fmtDate(ins.lastCleaning)} (hace ${clean} días)` : 'sin registrar'}</small>
        <div class="row-actions"><button class="ghost-btn" data-ins-move="${esc(ins.id)}">Movimiento</button><button class="ghost-btn" data-ins-clean="${esc(ins.id)}">Limpieza hoy</button><button class="ghost-btn" data-inv-edit="installation" data-id="${esc(ins.id)}">Editar</button><button class="danger-btn" data-inv-del="installations" data-id="${esc(ins.id)}" aria-label="Eliminar">×</button></div></article>`; }).join('') : '<p class="text-muted">Sin instalaciones para el filtro elegido.</p>';
  }
  el('insFilterType').addEventListener('change', renderInstallations);
  function render() { renderInventory(); renderInstallations(); notify(); }

  /* ---------- formularios ---------- */
  const itemOptions = () => state.inventoryItems.filter(i => i.status === 'Activo').map(i => [i.id, `${i.code} · ${i.name} (stock ${qty(itemStock(i.id), i.unit)})`]);
  const installationOptions = empty => [...(empty ? [['', empty]] : []), ...state.installations.map(i => [i.id, `${i.code} · ${i.name}`])];
  const nextCode = prefix => { const nums = state.inventoryItems.map(i => (i.code.match(new RegExp(`^${prefix}-(\\d+)$`)) || [])[1]).filter(Boolean).map(Number); return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`; };
  const counterparties = () => [...new Set([...state.transactions.map(t => t.counterparty), ...state.lots.map(l => l.producer), ...state.inventoryMovements.map(m => m.counterparty)].filter(Boolean))].sort((a, z) => a.localeCompare(z, 'es'));
  const FORMS = {
    item: { key: 'inventoryItems', title: 'producto', prefix: 'ITM', defaults: () => ({ code: nextCode('MP'), category: ITEM_CATEGORIES[0], unit: 'TM', minStock: 0, unitCost: 0, defaultInstallationId: '', status: 'Activo' }),
      fields: [
        { key: 'code', label: 'Código', type: 'text', required: true },
        { key: 'name', label: 'Producto', type: 'text', required: true },
        { key: 'category', label: 'Categoría', type: 'select', options: ITEM_CATEGORIES, onChange: (v, f) => { const code = f.querySelector('[name=code]'); if (!state.inventoryItems.some(i => i.code === code.value)) code.value = nextCode(v === 'Producto terminado' ? 'PT' : v.startsWith('Repuesto') ? 'RP' : 'MP'); } },
        { key: 'unit', label: 'Unidad', type: 'select', options: ITEM_UNITS },
        { key: 'minStock', label: 'Stock mínimo', type: 'number', min: 0, step: 'any' },
        { key: 'unitCost', label: 'Costo unitario ($ por unidad)', type: 'number', min: 0, step: 'any' },
        { key: 'defaultInstallationId', label: 'Instalación habitual', type: 'select', options: () => installationOptions('Sin instalación fija') },
        { key: 'status', label: 'Estado', type: 'select', options: ['Activo', 'Inactivo'] },
        { key: 'notes', label: 'Observaciones', type: 'text', full: true }
      ] },
    installation: { key: 'installations', title: 'instalación', prefix: 'INS', defaults: () => ({ type: 'Silo de materia prima', unit: 'TM', capacity: 0, itemId: '', zoneId: (state.settings.sanitaryZones || [])[0]?.id || '', status: 'Operativa', lastCleaning: '' }),
      fields: [
        { key: 'code', label: 'Código', type: 'text', required: true, placeholder: 'SIL-MP3' },
        { key: 'name', label: 'Nombre', type: 'text', required: true },
        { key: 'type', label: 'Tipo', type: 'select', options: INSTALLATION_TYPES, onChange: (v, f) => { f.querySelector('[name=unit]').value = v === 'Tanque de líquidos' ? 'L' : 'TM'; } },
        { key: 'capacity', label: 'Capacidad', type: 'number', min: 0, step: 'any', required: true },
        { key: 'unit', label: 'Unidad de capacidad', type: 'select', options: CAPACITY_UNITS },
        { key: 'itemId', label: 'Producto asignado', type: 'select', options: () => [['', 'Sin asignar'], ...state.inventoryItems.map(i => [i.id, `${i.code} · ${i.name}`])] },
        { key: 'zoneId', label: 'Zona sanitaria', type: 'select', options: () => [['', 'Sin zona'], ...(state.settings.sanitaryZones || []).map(z => [z.id, `${z.name} (${z.level})`])] },
        { key: 'status', label: 'Estado', type: 'select', options: INSTALLATION_STATUS },
        { key: 'lastCleaning', label: 'Última limpieza', type: 'date' },
        { key: 'notes', label: 'Observaciones', type: 'text', full: true, placeholder: 'Aireación, termometría, sensores…' }
      ] },
    movement: { key: 'inventoryMovements', title: 'movimiento de stock', prefix: 'MOV-INV', newOnly: true, defaults: () => ({ date: todayISO(), type: 'Recepción', itemId: state.inventoryItems.find(i => i.status === 'Activo')?.id || '', quantity: '', installationId: '', toInstallationId: '', batchId: '' }),
      fields: [
        { key: 'date', label: 'Fecha', type: 'date', required: true },
        { key: 'type', label: 'Tipo de movimiento', type: 'select', options: MOVEMENT_TYPES, onChange: (v, f) => suggestPrice(f) },
        { key: 'itemId', label: 'Producto', type: 'select', options: itemOptions, full: true, onChange: (v, f) => { const i = itemById(v); if (i?.defaultInstallationId) f.querySelector('[name=installationId]').value = i.defaultInstallationId; suggestPrice(f); } },
        { key: 'quantity', label: 'Cantidad', type: 'number', min: 0.0001, step: 'any', required: true, labelIf: v => `Cantidad (${itemById(v.itemId)?.unit || ''})` },
        { key: 'installationId', label: 'Instalación', type: 'select', options: () => installationOptions('Sin instalación'), labelIf: v => (v.type === 'Transferencia entre instalaciones' ? 'Instalación de origen' : SIGN[v.type] > 0 ? 'Instalación de destino' : 'Instalación de origen') },
        { key: 'toInstallationId', label: 'Instalación de destino', type: 'select', options: () => installationOptions(), showIf: v => v.type === 'Transferencia entre instalaciones' },
        { key: 'batchId', label: 'Lote de producción', type: 'select', options: () => [['', 'Sin lote'], ...state.batches.map(b => [b.id, `${b.id} · ${b.phase}`])], showIf: v => ['Consumo en producción', 'Producción terminada'].includes(v.type) },
        { key: 'counterparty', label: 'Proveedor o cliente', type: 'text', list: counterparties, showIf: v => ['Recepción', 'Despacho', 'Devolución a proveedor', 'Devolución de cliente'].includes(v.type) },
        { key: 'vehicle', label: 'Patente del camión', type: 'text', placeholder: 'AB 123 CD', showIf: v => ['Recepción', 'Despacho', 'Devolución a proveedor', 'Devolución de cliente'].includes(v.type) },
        { key: 'reference', label: 'Comprobante (remito, CPE, factura)', type: 'text' },
        { key: 'unitPrice', label: 'Precio', type: 'number', min: 0, step: 'any', showIf: v => ['Recepción', 'Despacho'].includes(v.type), labelIf: v => `${v.type === 'Recepción' ? 'Precio de compra' : 'Precio de venta'} ($ por ${itemById(v.itemId)?.unit || 'unidad'})` },
        { key: 'createTx', label: 'Generar en Tesorería', type: 'checkbox', full: true, showIf: v => ['Recepción', 'Despacho'].includes(v.type), labelIf: v => (v.type === 'Recepción' ? 'Generar el pago pendiente en Tesorería (vence a 30 días)' : 'Generar el cobro pendiente en Tesorería (vence a 15 días)') },
        { key: 'notes', label: 'Observaciones', type: 'text', full: true }
      ],
      preview(v) {
        const i = itemById(v.itemId); if (!i || !(Number(v.quantity) > 0)) return null;
        const draft = { ...v, quantity: Number(v.quantity) }, after = itemStock(i.id, draft), msgs = [];
        let level = 'ok';
        msgs.push(`Stock de ${esc(i.name)} después del movimiento: <b>${qty(after, i.unit)}</b>${after < i.minStock && after >= 0 ? ' (debajo del mínimo)' : ''}.`);
        if (after < 0) { level = 'bad'; msgs.push('<b>Quedaría stock negativo:</b> revise la cantidad o registre primero la entrada.'); } else if (after < i.minStock) level = 'warn';
        for (const id of [v.installationId, v.toInstallationId].filter(Boolean)) {
          const ins = installationById(id); if (!ins) continue;
          const o = occupancy(ins, draft), here = o.contents.find(c => c.itemId === i.id);
          if (here && here.quantity < 0) { level = 'bad'; msgs.push(`<b>${esc(ins.code)}</b> no tiene esa cantidad de ${esc(i.name)}.`); }
          if (o.pct !== null && o.pct >= 0) { msgs.push(`${esc(ins.code)} quedaría al <b>${num(o.pct, 0)}%</b> de su capacidad.`); if (o.pct > 100) level = 'bad'; else if (o.pct > 95 && level === 'ok') level = 'warn'; }
          // Aviso si el producto entra a una instalación asignada a otro
          const isDestination = v.type === 'Transferencia entre instalaciones' ? id === v.toInstallationId : SIGN[v.type] > 0;
          if (isDestination && ins.itemId && ins.itemId !== i.id) { if (level === 'ok') level = 'warn'; msgs.push(`${esc(ins.code)} está asignada a otro producto.`); }
        }
        if (['Recepción', 'Despacho'].includes(v.type) && Number(v.unitPrice) > 0) {
          const total = Number(v.quantity) * Number(v.unitPrice);
          msgs.push(v.type === 'Recepción' ? `Compra por <b>${pesos(total)}</b>: actualiza el costo promedio del producto${v.createTx ? ' y queda como pago pendiente' : ''} (no va a Costos: a Costos va lo consumido).` : `Venta por <b>${pesos(total)}</b>${v.createTx ? ': queda como cobro pendiente' : ''}.`);
        }
        return { level, html: msgs.join(' ') };
      } }
  };
  // Precio sugerido: compra al costo promedio actual; venta de alimento al precio comercial del modelo
  function suggestPrice(form) {
    const type = form.querySelector('[name=type]')?.value, i = itemById(form.querySelector('[name=itemId]')?.value), price = form.querySelector('[name=unitPrice]');
    if (!price || !i) return;
    if (type === 'Recepción') price.value = Math.round(Number(i.unitCost) || 0);
    else if (type === 'Despacho') price.value = i.category === 'Producto terminado' && i.unit === 'TM' ? Math.round(Number(state.settings.finance?.commercialPrice) || 0) : '';
  }
  let current = null;
  function fieldHtml(f, value) {
    const id = `inv-${f.key}`, list = typeof f.list === 'function' ? f.list() : f.list;
    const attrs = `id="${id}" name="${f.key}" ${f.required ? 'required' : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.step !== undefined ? `step="${f.step}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
    if (f.type === 'checkbox') return `<div class="field full check-field" data-field="${f.key}"><label class="check"><input type="checkbox" ${attrs} ${value ? 'checked' : ''}> <span>${esc(f.label)}</span></label></div>`;
    const input = f.type === 'select' ? `<select ${attrs}>${options(typeof f.options === 'function' ? f.options() : f.options, value)}</select>`
      : `<input type="${f.type}" ${attrs} value="${esc(value ?? '')}" ${list ? `list="${id}-list"` : ''}>${list ? `<datalist id="${id}-list">${list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
    return `<div class="field${f.full ? ' full' : ''}" data-field="${f.key}"><label for="${id}">${esc(f.label)}</label>${input}</div>`;
  }
  function readForm() {
    const v = { ...current.record };
    for (const f of current.spec.fields) { const i = el('invForm').querySelector(`[name="${f.key}"]`); if (i && !i.disabled) v[f.key] = f.type === 'checkbox' ? i.checked : f.type === 'number' ? (i.value === '' ? '' : Number(i.value)) : i.value.trim(); else if (i) v[f.key] = f.type === 'checkbox' ? false : ''; }
    return v;
  }
  function sync() {
    const v = readForm();
    for (const f of current.spec.fields) {
      const w = el('invForm').querySelector(`[data-field="${f.key}"]`); if (!w) continue;
      if (f.showIf) { const vis = f.showIf(v); w.hidden = !vis; w.querySelectorAll('input,select').forEach(i => { i.disabled = !vis; }); }
      if (f.labelIf) { const lab = f.type === 'checkbox' ? w.querySelector('label span') : w.querySelector('label'); if (lab) lab.textContent = f.labelIf(v); }
    }
    const p = el('invPreview'), r = current.spec.preview ? current.spec.preview(readForm()) : null;
    p.hidden = !r; if (r) { p.style.setProperty('--status-color', r.level === 'bad' ? 'var(--red)' : r.level === 'warn' ? 'var(--orange)' : 'var(--ok)'); p.innerHTML = r.html; }
  }
  function openForm(kind, record, preset) {
    const spec = FORMS[kind];
    current = { spec, isNew: !record, record: record ? { ...record } : { id: uid(spec.prefix), ...spec.defaults(), ...(preset || {}) } };
    if (kind === 'movement' && !state.inventoryItems.length) return toast('Primero cargue un producto en el inventario');
    if (kind === 'movement' && !current.record.installationId) current.record.installationId = itemById(current.record.itemId)?.defaultInstallationId || '';
    el('invDialogTitle').textContent = `${record ? 'Editar' : kind === 'movement' ? 'Registrar' : 'Nuevo'} ${spec.title}`;
    el('invFields').innerHTML = spec.fields.map(f => fieldHtml(f, current.record[f.key])).join('');
    sync();
    if (kind === 'movement') { suggestPrice(el('invForm')); sync(); }
    el('invDialog').showModal();
    setTimeout(() => el('invFields').querySelector('input:not([disabled]),select')?.focus(), 50);
  }
  ['input', 'change'].forEach(t => el('invFields').addEventListener(t, e => { const f = current?.spec.fields.find(x => x.key === e.target.name); if (t === 'change' && f?.onChange) f.onChange(e.target.value, el('invForm')); sync(); }));
  el('invForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = el('invSubmit'); btn.disabled = true;
    try {
      const draft = readForm();
      if (current.spec.preview) { const r = current.spec.preview(draft); if (r && r.level === 'bad' && !confirm('El movimiento deja stock negativo o supera la capacidad de la instalación. ¿Guardarlo igual?')) return; }
      if (current.spec.key === 'inventoryItems' && state.inventoryItems.some(i => i.code === draft.code && i.id !== draft.id)) throw new Error(`Ya existe un producto con el código ${draft.code}`);
      if (current.spec.key === 'installations' && state.installations.some(i => i.code === draft.code && i.id !== draft.id)) throw new Error(`Ya existe una instalación con el código ${draft.code}`);
      const r = await saveRecord(current.spec.key, draft, current.isNew);
      el('invDialog').close(); savedMessage(r, current.isNew ? (draft.createTx && Number(draft.unitPrice) > 0 ? `Movimiento guardado y ${draft.type === 'Recepción' ? 'pago' : 'cobro'} pendiente generado en Tesorería` : 'Registro guardado') : 'Cambios guardados'); render();
      if (current.spec.key === 'inventoryMovements' && !r.offline && typeof loadBackend === 'function') loadBackend();
    } catch (error) { toast(error.message); } finally { btn.disabled = false; }
  });
  document.querySelectorAll('[data-close-dialog="invDialog"]').forEach(b => b.addEventListener('click', () => el('invDialog').close()));

  /* ---------- acciones ---------- */
  ['page-inventory', 'page-installations'].forEach(pageId => el(pageId).addEventListener('click', async e => {
    const nb = e.target.closest('[data-inv-new]'), eb = e.target.closest('[data-inv-edit]'), del = e.target.closest('[data-inv-del]');
    const mv = e.target.closest('[data-inv-move]'), imv = e.target.closest('[data-ins-move]'), clean = e.target.closest('[data-ins-clean]');
    if (nb) return openForm(nb.dataset.invNew, null);
    if (eb) return openForm(eb.dataset.invEdit, state[FORMS[eb.dataset.invEdit].key].find(x => x.id === eb.dataset.id));
    if (mv) { const i = itemById(mv.dataset.invMove); return openForm('movement', null, { itemId: i.id, installationId: i.defaultInstallationId || '' }); }
    if (imv) { const ins = installationById(imv.dataset.insMove), contents = installationContents(ins.id); return openForm('movement', null, { installationId: ins.id, itemId: ins.itemId || contents[0]?.itemId || state.inventoryItems[0]?.id }); }
    if (clean) { const ins = installationById(clean.dataset.insClean); try { const r = await saveRecord('installations', { ...ins, lastCleaning: todayISO(), status: ins.status === 'En limpieza' ? 'Operativa' : ins.status }, false); savedMessage(r, `Limpieza de ${ins.code} registrada`); render(); } catch (error) { toast(error.message); } return; }
    if (!del) return;
    const key = del.dataset.invDel, id = del.dataset.id;
    if (key === 'inventoryItems' && state.inventoryMovements.some(m => m.itemId === id)) return toast('El producto tiene movimientos: márquelo como Inactivo en lugar de eliminarlo');
    if (key === 'installations' && installationContents(id).length) return toast('La instalación tiene stock: vacíela con una transferencia o ajuste antes de eliminarla');
    if (!confirm('¿Eliminar este registro?')) return;
    try { const r = await removeRecord(key, id); savedMessage(r, 'Registro eliminado'); render(); } catch (error) { toast(error.message); }
  }));

  /* ---------- datos para Control de planta, Producción y el Dashboard ---------- */
  window.pbpInventorySummary = () => ({
    items: state.inventoryItems.filter(i => i.status === 'Activo').map(itemStatus),
    installations: state.installations.map(ins => ({ ins, ...occupancy(ins) })),
    aggregate, movements: state.inventoryMovements, itemById, toTM: (q, unit) => inCapacityUnit(q, unit, 'TM'), daysSince
  });
  window.pbpOpenInventoryMovement = preset => openForm('movement', null, preset || {});

  document.addEventListener('pbp:bootstrap', event => load(event.detail));
  if (window.pbpData) load(window.pbpData); else render();
})();
