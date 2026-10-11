/* Pampa PBP - Control de planta y Producción conectados
 * Reemplaza los valores fijos por datos de los otros módulos: Costos (producción y costo de proceso),
 * Equipamiento (disponibilidad), Inventario e Instalaciones (recepción, silos, despacho, almacenamiento),
 * Calidad (pellet conforme), Recetas (parámetros por fase), telemetría (PLC) y las alertas reales.
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = v => escapeHTML(v ?? '');
  const todayISO = () => new Date().toLocaleDateString('sv-SE');
  const fmtDate = iso => (iso ? iso.split('-').reverse().join('/') : '—');
  const monthKey = (offset = 0) => { const d = new Date(); d.setMonth(d.getMonth() + offset, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const monthLabel = key => { const [y, m] = key.split('-').map(Number); return new Intl.DateTimeFormat('es-AR', { month: 'short' }).format(new Date(y, m - 1, 1)).replace('.', ''); };
  const data = () => window.pbpData || {};
  const setFoot = (id, text, cls = '') => { const n = el(id); if (n) { n.textContent = text; n.className = `metric-foot ${cls}`; } };
  const OPERATIONAL_PAGES = ['dashboard', 'production', 'inventory', 'installations', 'equipment', 'quality', 'waste'];

  function renderMetrics() {
    const d = data(), cur = monthKey(), prev = monthKey(-1);
    const tonsOf = p => (window.pbpProductionTons ? window.pbpProductionTons(p).tons : Number(((d.settings || {}).costTons || {})[p]) || 0);
    const now = tonsOf(cur), before = tonsOf(prev);
    el('monthlyProduction').textContent = now ? `${num(now)} TM` : '—';
    const source = window.pbpProductionTons ? window.pbpProductionTons(cur).source : 'manual';
    if (now && before) { const diff = (now - before) / before * 100; setFoot('monthlyProductionFoot', `${diff >= 0 ? '+' : ''}${num(diff, 1)}% vs ${monthLabel(prev)} · ${source === 'inventario' ? 'según Inventario' : 'carga manual'}`, diff >= 0 ? 'positive' : 'negative'); }
    else setFoot('monthlyProductionFoot', now ? 'Primer mes con datos' : 'Cargar toneladas del mes en Costos', now ? '' : 'warning');
    const badge = el('cpChartBadge');
    if (now && before) { const up = now >= before; badge.className = `badge ${up ? 'green' : 'red'}`; badge.textContent = up ? 'En alza' : 'En baja'; } else { badge.className = 'badge blue'; badge.textContent = 'Sin comparación'; }
    const cost = window.pbpCostSummary ? window.pbpCostSummary(cur) : null, model = Number(d.settings?.finance?.opex) || 0;
    if (cost && cost.conversion !== null) {
      el('cpProcessCost').textContent = `${money(cost.conversion)}/TM`;
      setFoot('cpProcessCostFoot', `Conversión sin materias primas · modelo ${money(model)}/TM`, model && cost.conversion > model ? 'warning' : 'positive');
    } else { el('cpProcessCost').textContent = '—'; setFoot('cpProcessCostFoot', 'Cargar costos y toneladas del mes', 'warning'); }
    const eq = d.equipment || [], op = eq.filter(e => e.status === 'Operativo').length;
    el('cpAvailability').textContent = eq.length ? `${num(op / eq.length * 100, 0)}%` : '—';
    setFoot('cpAvailabilityFoot', eq.length ? (eq.length - op ? `${eq.length - op} en alerta, mantenimiento o fuera de servicio` : 'Todos los equipos operativos') : 'Sin equipos cargados', eq.length && op / eq.length < 0.9 ? 'warning' : 'positive');
    const f = d.settings?.finance;
    if (f && f.commercialPrice) { const margin = f.commercialPrice - f.rawCost - f.opex, pct = margin / f.commercialPrice * 100; setFoot('dashMarginFoot', `Modelo de viabilidad · ${num(pct, 1)}% del precio`, pct > 6.5 ? 'positive' : pct >= 4 ? 'warning' : 'negative'); }
  }

  function renderAlerts() {
    const list = (window.pbpComputeAlerts ? window.pbpComputeAlerts() : []).filter(a => OPERATIONAL_PAGES.includes(a.page));
    const color = { red: 'var(--red)', amber: 'var(--orange)', blue: 'var(--blue)' };
    el('cpAlertCount').textContent = list.filter(a => a.level !== 'blue').length;
    el('cpAlerts').innerHTML = list.length ? list.slice(0, 4).map(a => `<div class="alert" style="--alert:${color[a.level]};cursor:pointer" data-cp-page="${a.page}"><b>${esc(a.title)}</b><time>${a.date ? fmtDate(a.date) : ''}</time><p>${esc(a.detail)}</p></div>`).join('') + (list.length > 4 ? `<button class="ghost-btn" data-cp-all>Ver las ${list.length} alertas</button>` : '')
      : '<div class="alert" style="--alert:var(--ok)"><b>Sin alertas operativas</b><time></time><p>Equipos, stock, calidad y residuos al día.</p></div>';
  }
  el('cpAlerts').addEventListener('click', e => { const a = e.target.closest('[data-cp-page]'); if (a) window.go(a.dataset.cpPage); if (e.target.closest('[data-cp-all]')) { window.go('home'); document.querySelector('#page-home [data-home-action=alerts]')?.click(); } });

  function paint(stage, value, sub, state) {
    const node = document.querySelector(`.stage[data-stage="${stage}"]`); if (!node) return;
    node.classList.remove('stage-ok', 'stage-bad', 'stage-none'); node.classList.add(state);
    node.querySelector('small').textContent = value; node.querySelector('.stage-sub').textContent = sub;
  }
  function renderStages() {
    const inv = window.pbpInventorySummary ? window.pbpInventorySummary() : null;
    if (!inv) return;
    const today = todayISO(), tm = m => { const i = inv.itemById(m.itemId); return i ? inv.toTM(m.quantity, i.unit) || 0 : 0; };
    const flow = (type, labelOne, labelMany) => {
      const todays = inv.movements.filter(m => m.type === type && m.date === today), last = inv.movements.filter(m => m.type === type).sort((a, z) => z.date.localeCompare(a.date))[0];
      if (todays.length) { const trucks = new Set(todays.map(m => m.vehicle || m.id)).size; return [`${num(todays.reduce((s, m) => s + tm(m), 0), 1)} TM hoy`, `${trucks} ${trucks === 1 ? labelOne : labelMany}`, 'stage-ok']; }
      return last ? ['Sin movimientos hoy', `último: ${fmtDate(last.date)}`, 'stage-none'] : ['Sin datos', 'registrar en Inventario', 'stage-none'];
    };
    paint('reception', ...flow('Recepción', 'camión', 'camiones'));
    const dispatch = flow('Despacho', 'carga', 'cargas');
    paint('dispatch', ...dispatch);
    const raw = inv.aggregate(['Silo de materia prima']), fin = inv.aggregate(['Silo de producto terminado']), all = inv.aggregate(['Silo de materia prima', 'Silo de producto terminado']);
    const full = inv.installations.filter(x => ['Silo de materia prima', 'Silo de producto terminado'].includes(x.ins.type) && x.pct !== null && x.pct > 95);
    if (all.pct === null) paint('silos', 'Sin silos', 'cargar en Instalaciones', 'stage-none');
    else paint('silos', `${num(all.pct, 0)}% ocupación`, `MP ${raw.pct === null ? '—' : num(raw.pct, 0) + '%'} · PT ${fin.pct === null ? '—' : num(fin.pct, 0) + '%'}`, full.length ? 'stage-bad' : 'stage-ok');
  }
  document.querySelectorAll('.stage[data-go-page]').forEach(s => s.addEventListener('click', () => window.go(s.dataset.goPage)));

  function renderPlc() {
    const badge = el('cpPlcBadge'), log = window.pbpLastTelemetry;
    if (!log || !log.loggedAt) { badge.className = 'badge blue'; badge.textContent = 'PLC: sin lecturas'; return; }
    const min = Math.max(0, Math.round((Date.now() - new Date(log.loggedAt)) / 60000));
    const ago = min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} días`;
    badge.className = `badge ${min <= 15 ? 'green' : min <= 1440 ? 'amber' : 'red'}`;
    badge.textContent = min <= 15 ? `PLC conectado · hace ${ago}` : `PLC: última lectura hace ${ago}`;
  }

  function renderProduction() {
    const d = data(), active = (d.batches || []).filter(b => ['En proceso', 'Control'].includes(b.status));
    el('prInProcess').textContent = active.length ? `${num(active.reduce((s, b) => s + (+b.volume || 0), 0))} TM` : '0 TM';
    setFoot('prInProcessFoot', active.length ? `${active.filter(b => b.status === 'En proceso').length} en proceso · ${active.filter(b => b.status === 'Control').length} en control` : 'Sin lotes en curso');
    const all = d.batches || [];
    setFoot('activeLotsFoot', `${all.filter(b => b.status === 'Programado').length} programados · ${all.filter(b => b.status === 'Terminado').length} terminados`);
    const qs = window.pbpQualitySummary ? window.pbpQualitySummary() : null;
    const recent = (d.qualityBatchControls || []).filter(c => c.pdi !== null && c.pdi !== undefined && c.pdi !== '' && (Date.now() - new Date(c.date + 'T00:00:00')) / 86400000 <= 30);
    if (qs && recent.length) { const min = qs.targets().pdiMin, ok = recent.filter(c => c.pdi >= min).length, pct = ok / recent.length * 100; el('prPellet').textContent = `${num(pct, 0)}%`; setFoot('prPelletFoot', `${ok} de ${recent.length} controles con PDI ≥ ${num(min, 0)}% (30 días)`, pct >= 90 ? 'positive' : 'warning'); }
    else { el('prPellet').textContent = '—'; setFoot('prPelletFoot', 'Sin controles de durabilidad en 30 días', 'warning'); }
    const cost = window.pbpCostSummary ? window.pbpCostSummary(monthKey()) : null;
    if (cost && cost.energyPerTon !== null) { el('prEnergy').textContent = `${money(cost.energyPerTon)}/TM`; setFoot('prEnergyFoot', 'Energía eléctrica + vapor del mes (Costos)'); }
    else { el('prEnergy').textContent = '—'; setFoot('prEnergyFoot', 'Cargar costos y toneladas del mes', 'warning'); }
    const recipes = (d.recipes || []).filter(r => r.status === 'Activa');
    el('prPhaseRows').innerHTML = recipes.length ? recipes.map(r => `<tr><td><b>${esc(r.phase)}</b><br><small class="text-muted">${esc(r.name)}</small></td><td>${esc(r.format)}</td><td>${num(+r.particleMin)}–${num(+r.particleMax)} µm</td><td>${num(+r.protein, 1)}%</td></tr>`).join('') : '<tr><td colspan="4">Sin recetas activas</td></tr>';
    const inv = window.pbpInventorySummary ? window.pbpInventorySummary() : null;
    if (!inv) return;
    const groups = [['Silos de materia prima', ['Silo de materia prima']], ['Silos de producto terminado', ['Silo de producto terminado']], ['Celdas y galpones', ['Celda o galpón']], ['Micro-bins y tolvas de dosificación', ['Tolva de dosificación / micro-bin']], ['Tanques de líquidos', ['Tanque de líquidos']], ['Depósitos', ['Depósito']]];
    el('prStorage').innerHTML = groups.map(([label, types]) => {
      const list = inv.installations.filter(x => types.includes(x.ins.type) && x.ins.status !== 'Fuera de servicio'); if (!list.length) return '';
      const unit = list[0].ins.unit, same = list.filter(x => x.ins.unit === unit), cap = same.reduce((s, x) => s + x.ins.capacity, 0), used = same.reduce((s, x) => s + x.used, 0), pct = cap ? used / cap * 100 : 0;
      return `<div class="progress-row"><span>${esc(label)} · ${num(cap)} ${esc(unit)}</span><div class="track"><span style="width:${Math.min(100, pct)}%;background:${pct > 95 ? 'var(--red)' : pct > 80 ? 'var(--orange)' : 'var(--accent)'}"></span></div><b>${num(pct, 0)}%</b></div>`;
    }).join('') || '<p class="text-muted">Sin instalaciones cargadas.</p>';
  }

  function render() {
    try { renderMetrics(); renderAlerts(); renderStages(); renderPlc(); renderProduction(); } catch (error) { console.error('Control de planta:', error); }
    if (document.getElementById('page-dashboard').classList.contains('active') && typeof drawProductionChart === 'function') setTimeout(drawProductionChart, 30);
  }
  ['pbp:bootstrap', 'pbp:inventory', 'pbp:fx', 'pbp:plc'].forEach(ev => document.addEventListener(ev, () => setTimeout(render, 0)));
  document.addEventListener('pbp:telemetry', renderPlc);
  setInterval(renderPlc, 60000);
  render();
})();
