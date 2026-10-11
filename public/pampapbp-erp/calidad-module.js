/* Pampa PBP - Calidad y bioseguridad
 * Indicadores calculados con los registros: controles de proceso por lote (PCC térmico, granulometría
 * según la receta, durabilidad y humedad), ensayos de homogeneidad (CV), análisis de materias primas,
 * auditorías con historial y zonificación sanitaria editable.
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
  const has = v => v !== null && v !== undefined && v !== '';
  const fmtN = (v, d = 1) => (has(v) ? num(+v, d) : '—');

  const DEFAULT_TARGETS = { tempMin: 82, tempMax: 85, retentionMin: 30, retentionMax: 45, pdiMin: 90, moistureMax: 13, cvMax: 5, rawMoistureMax: 14.5, aflatoxinsMax: 20, donMax: 0.9, zearalenoneMax: 250, fumonisinsMax: 5, damagedMax: 5, foreignMax: 1 };
  const RAW_MATERIALS = ['Maíz', 'Sorgo', 'Expeller de soja', 'Harina de soja', 'Afrechillo de trigo', 'Descarte de panadería', 'Suero lácteo', 'Núcleo o premezcla', 'Aceite vegetal', 'Otro'];
  const METHODS = ['Microtrazadores', 'Sal (cloruros)', 'Aminoácido (lisina / metionina)', 'Otro'];
  const VERDICTS = ['Aprobado', 'Aprobado con observación', 'Rechazado'];
  const VERDICT_BADGE = { 'Aprobado': 'green', 'Aprobado con observación': 'amber', 'Rechazado': 'red' };
  const ZONE_LEVELS = ['Sucia', 'Transición', 'Limpia'];
  const ZONE_COLOR = { 'Sucia': 'var(--red)', 'Transición': 'var(--orange)', 'Limpia': 'var(--ok)' };
  const ZONE_BADGE = { 'Sucia': 'red', 'Transición': 'amber', 'Limpia': 'green' };
  // Límites de materias primas: [campo, etiqueta, unidad, clave del objetivo]
  const LAB_LIMITS = [['moisture', 'Humedad', '%', 'rawMoistureMax'], ['aflatoxins', 'Aflatoxinas', 'ppb', 'aflatoxinsMax'], ['don', 'DON (vomitoxina)', 'ppm', 'donMax'], ['zearalenone', 'Zearalenona', 'ppb', 'zearalenoneMax'], ['fumonisins', 'Fumonisinas', 'ppm', 'fumonisinsMax'], ['damaged', 'Granos dañados', '%', 'damagedMax'], ['foreign', 'Materias extrañas', '%', 'foreignMax']];

  const COLLECTIONS = { qualityBatchControls: '/api/quality-controls', homogeneityTests: '/api/homogeneity-tests', labAnalyses: '/api/lab-analyses', qualityAudits: '/api/quality-audits' };
  const OTHER_KEYS = ['batches', 'recipes', 'equipment', 'employees', 'lots'];
  const state = { settings: {}, plc: null };
  [...Object.keys(COLLECTIONS), ...OTHER_KEYS].forEach(k => { state[k] = []; });
  function load(data) {
    if (!data) return;
    for (const k of [...Object.keys(COLLECTIONS), ...OTHER_KEYS]) { if (!Array.isArray(data[k])) data[k] = []; state[k] = data[k]; }
    state.settings = data.settings || (data.settings = {});
    render();
    renderPlc();
    loadPlc();
  }
  const targets = () => ({ ...DEFAULT_TARGETS, ...(state.settings.qualityTargets || {}) });
  async function saveRecord(key, draft, isNew) {
    const path = COLLECTIONS[key];
    const result = isNew ? await api(path, { method: 'POST', body: JSON.stringify(draft) }) : await api(`${path}/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: JSON.stringify(draft) });
    const saved = { ...draft, ...result, _pending: !!result.offline }; delete saved.offline;
    const list = state[key], i = list.findIndex(x => x.id === draft.id);
    if (i >= 0) list[i] = saved; else list.push(saved);
    return result;
  }
  async function saveSetting(key, value) {
    const result = await api(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) });
    state.settings[key] = result.value || value;
    return result;
  }

  /* ---------- evaluación ---------- */
  function recipeRange(batch) {
    const r = batch && (state.recipes.find(x => x.phase === batch.phase && x.status === 'Activa') || state.recipes.find(x => x.phase === batch.phase));
    return r ? [Number(r.particleMin), Number(r.particleMax)] : null;
  }
  function evalControl(c) {
    const t = targets(), batch = state.batches.find(b => b.id === c.batchId), range = recipeRange(batch), checks = {};
    if (has(c.conditionerTemp)) checks.conditionerTemp = c.conditionerTemp >= t.tempMin && c.conditionerTemp <= t.tempMax;
    if (has(c.retentionSec)) checks.retentionSec = c.retentionSec >= t.retentionMin && c.retentionSec <= t.retentionMax;
    if (has(c.microns) && range) checks.microns = c.microns >= range[0] && c.microns <= range[1];
    if (has(c.pdi)) checks.pdi = c.pdi >= t.pdiMin;
    if (has(c.moisture)) checks.moisture = c.moisture <= t.moistureMax;
    const fails = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    return { batch, range, checks, ok: !fails.length, fails, pccOk: checks.conditionerTemp !== false && checks.retentionSec !== false };
  }
  function cvOf(samples) {
    const s = (samples || []).map(Number), n = s.length;
    if (n < 2) return { mean: null, cv: null };
    const mean = s.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
    return { mean, cv: mean ? sd / mean * 100 : null };
  }
  function evalLab(a) {
    const t = targets(), over = LAB_LIMITS.filter(([k, , , lim]) => has(a[k]) && !(k === 'moisture' && ['Aceite vegetal', 'Suero lácteo'].includes(a.rawMaterial)) && Number(a[k]) > t[lim]).map(([k]) => k);
    return { over, suggested: over.length ? 'Rechazado' : 'Aprobado' };
  }
  const auditScore = a => { const items = a.items || [], ok = items.filter(x => x.ok).length; return { ok, total: items.length, pct: items.length ? ok / items.length * 100 : 0 }; };
  const byDate = (a, z) => z.date.localeCompare(a.date);
  const cell = (v, ok, unit, d = 1) => (has(v) ? `<span class="${ok === false ? 'negative' : ok === true ? 'positive' : ''}">${num(+v, d)}${unit}</span>` : '<span class="text-muted">—</span>');

  /* ---------- secciones ---------- */
  function showSection(name) {
    document.querySelectorAll('#qcNav .pill').forEach(b => b.classList.toggle('active', b.dataset.qc === name));
    document.querySelectorAll('.qc-section').forEach(s => s.classList.toggle('active', s.dataset.qcSection === name));
    try { localStorage.setItem('pbp:calidad-section', name); } catch {}
  }
  el('qcNav').addEventListener('click', e => { const b = e.target.closest('.pill'); if (b) showSection(b.dataset.qc); });
  try { showSection(localStorage.getItem('pbp:calidad-section') || 'controls'); } catch {}

  /* ---------- render ---------- */
  function renderTiles() {
    const t = targets();
    const tile = (section, pct, value, title, text) => `<article class="quality-tile" data-qc-go="${section}"><div class="ring" style="--value:${Math.max(0, Math.min(100, pct || 0))}%"><b>${esc(value)}</b></div><h3>${esc(title)}</h3><p>${text}</p></article>`;
    const recent = state.qualityBatchControls.filter(c => daysSince(c.date) <= 30).map(c => ({ c, e: evalControl(c) }));
    const thermal = recent.filter(x => 'conditionerTemp' in x.e.checks || 'retentionSec' in x.e.checks), thermalOk = thermal.filter(x => x.e.pccOk).length;
    const lastThermal = [...state.qualityBatchControls].sort(byDate).find(c => has(c.conditionerTemp));
    const gran = recent.filter(x => 'microns' in x.e.checks), granOk = gran.filter(x => x.e.checks.microns).length;
    const lastGran = [...state.qualityBatchControls].sort(byDate).find(c => has(c.microns));
    const year = state.homogeneityTests.filter(h => daysSince(h.date) <= 365).map(h => cvOf(h.samples).cv).filter(v => v !== null);
    const lastHom = [...state.homogeneityTests].sort(byDate)[0], lastCv = lastHom ? cvOf(lastHom.samples).cv : null;
    const labs = state.labAnalyses.filter(a => daysSince(a.date) <= 90), rejected = labs.filter(a => a.verdict === 'Rechazado').length;
    const lastAudit = [...state.qualityAudits].sort(byDate)[0], score = lastAudit ? auditScore(lastAudit) : null;
    el('qcTiles').innerHTML = [
      tile('controls', thermal.length ? thermalOk / thermal.length * 100 : 0, lastThermal ? `${fmtN(lastThermal.conditionerTemp, 0)} °C` : '—', 'Control térmico (PCC)', thermal.length ? `${thermalOk} de ${thermal.length} lotes en rango ${t.tempMin}–${t.tempMax} °C y ${t.retentionMin}–${t.retentionMax} s (30 días).` : 'Sin controles en los últimos 30 días.'),
      tile('controls', gran.length ? granOk / gran.length * 100 : 0, lastGran ? fmtN(lastGran.microns, 0) : '—', 'Granulometría', gran.length ? `${granOk} de ${gran.length} lotes dentro del rango de su receta. Último: ${lastGran.batchId} (µm).` : 'Sin mediciones recientes.'),
      tile('homogeneity', year.length ? year.filter(v => v <= t.cvMax).length / year.length * 100 : 0, lastCv !== null ? `${num(lastCv, 1)}%` : '—', 'Homogeneidad', lastHom ? `CV del último ensayo (${fmtDate(lastHom.date)}). Objetivo menor al ${num(t.cvMax, 0)}%${daysSince(lastHom.date) > 30 ? ' · <span class="warning">ensayo mensual vencido</span>' : ''}.` : 'Sin ensayos registrados.'),
      tile('lab', labs.length ? (labs.length - rejected) / labs.length * 100 : 0, labs.length ? `${num((labs.length - rejected) / labs.length * 100, 0)}%` : '—', 'Materias primas', labs.length ? `${labs.length} análisis en 90 días${rejected ? ` · <span class="negative">${rejected} rechazado${rejected === 1 ? '' : 's'}</span>` : ' · sin rechazos'}.` : 'Sin análisis en los últimos 90 días.'),
      tile('audits', score ? score.pct : 0, score ? `${num(score.pct, 0)}%` : '—', 'Cumplimiento', score ? `Auditoría del ${fmtDate(lastAudit.date)} (${esc(lastAudit.auditor)}): ${score.ok} de ${score.total} controles.` : 'Sin auditorías registradas.')
    ].join('');
    const strip = el('qcPccStatus'), last = [...state.qualityBatchControls].sort(byDate).find(c => has(c.conditionerTemp) || has(c.retentionSec));
    if (!last) { strip.style.setProperty('--status-color', 'var(--orange)'); strip.innerHTML = '<b>Sin controles del punto crítico térmico.</b> Registre temperatura y retención del acondicionador en cada lote.'; return; }
    const e = evalControl(last), detail = `El lote ${esc(last.batchId)} alcanzó ${fmtN(last.conditionerTemp, 1)} °C con ${fmtN(last.retentionSec, 0)} s de retención (${fmtDate(last.date)})`;
    strip.style.setProperty('--status-color', e.pccOk ? 'var(--ok)' : 'var(--red)');
    strip.innerHTML = e.pccOk ? `<b>Punto crítico térmico conforme.</b> ${detail}, dentro del rango ${t.tempMin}–${t.tempMax} °C y ${t.retentionMin}–${t.retentionMax} s definido para la reducción de Salmonella y otros patógenos.`
      : `<b>Desvío en el punto crítico térmico.</b> ${detail}: fuera del rango ${t.tempMin}–${t.tempMax} °C / ${t.retentionMin}–${t.retentionMax} s. Retener el lote y evaluar reproceso.`;
  }
  el('qcTiles').addEventListener('click', e => { const t = e.target.closest('[data-qc-go]'); if (t) showSection(t.dataset.qcGo); });

  function renderControls() {
    const t = targets(), rows = [...state.qualityBatchControls].sort(byDate);
    el('qcControlRows').innerHTML = rows.length ? rows.map(c => { const e = evalControl(c);
      return `<tr><td>${fmtDate(c.date)}</td><td><b>${esc(c.batchId)}</b>${pendingTag(c)}<br><small class="text-muted">${esc(e.batch?.phase || '')}</small></td>
        <td>${cell(c.conditionerTemp, e.checks.conditionerTemp, ' °C', 1)}</td><td>${cell(c.retentionSec, e.checks.retentionSec, ' s', 0)}</td>
        <td>${cell(c.microns, e.checks.microns, ' µm', 0)}${e.range ? `<br><small class="text-muted">receta ${e.range[0]}–${e.range[1]}</small>` : ''}</td><td>${cell(c.pdi, e.checks.pdi, '%')}</td><td>${cell(c.moisture, e.checks.moisture, '%')}</td>
        <td><span class="badge ${e.ok ? 'green' : 'red'}">${e.ok ? 'Conforme' : `Desvío (${e.fails.length})`}</span>${c.notes ? `<br><small class="text-muted">${esc(c.notes)}</small>` : ''}</td><td>${esc(c.responsible)}</td>
        <td><div class="row-actions"><button class="ghost-btn" data-qc-edit="control" data-id="${esc(c.id)}">Editar</button><button class="danger-btn" data-qc-del="qualityBatchControls" data-id="${esc(c.id)}" aria-label="Eliminar">×</button></div></td></tr>`; }).join('') : `<tr><td colspan="10">Sin controles registrados. Objetivos: ${t.tempMin}–${t.tempMax} °C, ${t.retentionMin}–${t.retentionMax} s, PDI ≥ ${t.pdiMin}%, humedad ≤ ${t.moistureMax}%.</td></tr>`;
  }
  function renderHomogeneity() {
    const t = targets(), rows = [...state.homogeneityTests].sort(byDate);
    el('qcHomRows').innerHTML = rows.length ? rows.map(h => { const r = cvOf(h.samples), ok = r.cv !== null && r.cv <= t.cvMax;
      return `<tr><td>${fmtDate(h.date)}</td><td>${esc(h.mixer)}${pendingTag(h)}</td><td>${esc(h.method)}</td><td>${esc(h.batchId) || '—'}</td><td>${h.samples.length}${h.samples.length < 10 ? ' <span class="warning" title="Se recomiendan al menos 10 muestras">⚠</span>' : ''}</td><td>${fmtN(r.mean, 3)}</td>
        <td><b class="${ok ? 'positive' : 'negative'}">${r.cv !== null ? `${num(r.cv, 1)}%` : '—'}</b></td><td><span class="badge ${ok ? 'green' : 'red'}">${ok ? 'Homogéneo' : 'No homogéneo'}</span></td><td>${esc(h.responsible)}</td>
        <td><div class="row-actions"><button class="ghost-btn" data-qc-edit="homogeneity" data-id="${esc(h.id)}">Editar</button><button class="danger-btn" data-qc-del="homogeneityTests" data-id="${esc(h.id)}" aria-label="Eliminar">×</button></div></td></tr>`; }).join('') : '<tr><td colspan="10">Sin ensayos de homogeneidad</td></tr>';
  }
  function renderLab() {
    const t = targets(), rows = [...state.labAnalyses].sort(byDate);
    el('qcLabRows').innerHTML = rows.length ? rows.map(a => { const e = evalLab(a), bad = k => e.over.includes(k);
      const v = (k, unit, d = 1) => (has(a[k]) ? `<span class="${bad(k) ? 'negative' : ''}">${num(+a[k], d)} ${unit}</span>` : '<span class="text-muted">—</span>');
      return `<tr><td>${fmtDate(a.date)}</td><td><b>${esc(a.rawMaterial)}</b>${pendingTag(a)}</td><td>${esc(a.supplier) || '—'}<br><small class="text-muted">${esc(a.supplierLot)}</small></td>
        <td>${v('moisture', '%')}</td><td>${has(a.protein) ? `${num(+a.protein, 1)} %` : '—'}</td><td>${v('aflatoxins', 'ppb', 0)}</td><td>${v('don', 'ppm', 2)}</td><td>${v('zearalenone', 'ppb', 0)}</td><td>${v('fumonisins', 'ppm', 1)}</td><td>${v('damaged', '%')} / ${v('foreign', '%')}</td>
        <td><span class="badge ${VERDICT_BADGE[a.verdict]}">${esc(a.verdict)}</span>${a.verdict !== e.suggested && a.verdict !== 'Aprobado con observación' ? '<br><small class="warning">no coincide con los límites</small>' : ''}${a.notes ? `<br><small class="text-muted">${esc(a.notes)}</small>` : ''}</td>
        <td><div class="row-actions">${a.verdict === 'Rechazado' ? `<button class="ghost-btn" data-qc-waste="${esc(a.id)}" title="Registrar como materia prima rechazada en Residuos">A Residuos</button>` : ''}<button class="ghost-btn" data-qc-edit="lab" data-id="${esc(a.id)}">Editar</button><button class="danger-btn" data-qc-del="labAnalyses" data-id="${esc(a.id)}" aria-label="Eliminar">×</button></div></td></tr>`; }).join('') : `<tr><td colspan="12">Sin análisis. Límites: aflatoxinas ≤ ${t.aflatoxinsMax} ppb, DON ≤ ${t.donMax} ppm, zearalenona ≤ ${t.zearalenoneMax} ppb, fumonisinas ≤ ${t.fumonisinsMax} ppm.</td></tr>`;
  }
  // Capacitaciones marcadas «Calidad» (BPM, bioseguridad, etc.): cobertura del personal como evidencia
  function renderTrainingEvidence() {
    const card = el('qcAuditRows')?.closest('article'); if (!card) return;
    let box = el('qcTrainingEvidence');
    if (!box) { box = document.createElement('div'); box.id = 'qcTrainingEvidence'; box.className = 'status-strip'; box.style.margin = '0 0 16px'; card.before(box); }
    const s = window.pbpTrainingSummary ? window.pbpTrainingSummary() : null, list = s ? s.topics.filter(t => t.quality) : [];
    if (!list.length) { box.hidden = true; return; }
    box.hidden = false;
    const cov = list.map(t => s.coverage(t)), full = cov.every(c => !c.missing.length);
    box.style.setProperty('--status-color', full ? 'var(--ok)' : 'var(--orange)');
    box.innerHTML = `<b>Capacitación del personal (evidencia para auditoría).</b> ${cov.map(c => `${esc(c.topic.name)}: <span class="${c.missing.length ? 'warning' : 'positive'}">${c.ok.length} de ${c.people.length} al día</span>`).join(' · ')}.${full ? '' : ' <a href="#hr" data-go="hr">Ver pendientes en RRHH</a>.'}`;
  }
  function renderAudits() {
    renderTrainingEvidence();
    const rows = [...state.qualityAudits].sort(byDate);
    el('qcAuditRows').innerHTML = rows.length ? rows.map(a => { const s = auditScore(a), pend = (a.items || []).filter(x => !x.ok);
      return `<tr><td>${fmtDate(a.date)}</td><td>${esc(a.auditor)}${pendingTag(a)}</td><td><b class="${s.pct >= 90 ? 'positive' : s.pct >= 70 ? 'warning' : 'negative'}">${num(s.pct, 0)}%</b> <small class="text-muted">${s.ok}/${s.total}</small></td>
        <td style="white-space:normal;min-width:220px">${pend.length ? pend.map(x => esc(x.text)).join(' · ') : '<span class="positive">Ninguno</span>'}</td><td style="white-space:normal;min-width:200px">${esc(a.notes) || '—'}</td>
        <td><div class="row-actions"><button class="ghost-btn" data-qc-edit="audit" data-id="${esc(a.id)}">Ver / editar</button><button class="danger-btn" data-qc-del="qualityAudits" data-id="${esc(a.id)}" aria-label="Eliminar">×</button></div></td></tr>`; }).join('') : '<tr><td colspan="6">Sin auditorías registradas</td></tr>';
  }
  function renderZones() {
    const zones = state.settings.sanitaryZones || [];
    el('qcZones').innerHTML = zones.length ? zones.map(z => `<div class="alert" style="--alert:${ZONE_COLOR[z.level]}"><b>${esc(z.name)}</b><span class="badge ${ZONE_BADGE[z.level]}">${esc(z.level)}</span><p><b>Sectores:</b> ${esc(z.sectors) || '—'}<br><b>Controles de ingreso:</b> ${esc(z.controls) || '—'}</p></div>`).join('') : '<p class="text-muted">Sin zonas definidas.</p>';
  }
  // Control de planta: Molienda, Mezclado y Pelletizado muestran el último registro de calidad
  function renderProcess() {
    const t = targets(), sorted = [...state.qualityBatchControls].sort(byDate);
    const paint = (stage, value, sub, ok) => {
      const node = document.querySelector(`.stage[data-stage="${stage}"]`); if (!node) return;
      node.classList.remove('stage-ok', 'stage-bad', 'stage-none');
      node.classList.add(ok === null ? 'stage-none' : ok ? 'stage-ok' : 'stage-bad');
      node.querySelector('small').textContent = value;
      node.querySelector('.stage-sub').textContent = sub;
    };
    const gran = sorted.find(c => has(c.microns));
    if (gran) { const e = evalControl(gran); paint('microns', `${num(gran.microns, 0)} µm`, `${gran.batchId}${e.range ? ` · ${e.range[0]}–${e.range[1]}` : ''}`, e.checks.microns ?? null); }
    else paint('microns', 'Sin datos', 'cargar control', null);
    const hom = [...state.homogeneityTests].sort(byDate)[0], cv = hom ? cvOf(hom.samples).cv : null;
    if (cv !== null) paint('cv', `CV ${num(cv, 1)}%`, `${fmtDate(hom.date)} · objetivo < ${num(t.cvMax, 0)}%`, cv <= t.cvMax);
    else paint('cv', 'Sin datos', 'cargar ensayo', null);
    const pcc = sorted.find(c => has(c.conditionerTemp) || has(c.retentionSec));
    if (pcc) { const e = evalControl(pcc); paint('pcc', [has(pcc.conditionerTemp) ? `${num(pcc.conditionerTemp, 0)} °C` : '', has(pcc.retentionSec) ? `${num(pcc.retentionSec, 0)} s` : ''].filter(Boolean).join(' · '), `${pcc.batchId} · PCC ${t.tempMin}–${t.tempMax} °C`, e.pccOk); }
    else paint('pcc', 'Sin datos', 'cargar control', null);
  }
  document.querySelectorAll('.stage-link').forEach(s => s.addEventListener('click', () => { window.go('quality'); showSection(s.dataset.qcTarget); }));
  function render() { renderTiles(); renderControls(); renderHomogeneity(); renderLab(); renderAudits(); renderZones(); renderProcess(); }

  /* ---------- formularios (diálogo genérico) ---------- */
  const people = () => [...new Set(state.employees.filter(x => x.status !== 'Baja').map(x => x.name))];
  let current = null;
  function openDialog(title, bodyHtml, onSubmit, submitLabel = 'Guardar') {
    el('qcDialogTitle').textContent = title;
    el('qcFormBody').innerHTML = bodyHtml;
    el('qcSubmit').textContent = submitLabel;
    current = { onSubmit };
    el('qcDialog').showModal();
    setTimeout(() => el('qcFormBody').querySelector('input:not([type=checkbox]),select,textarea')?.focus(), 50);
  }
  const field = (name, label, type, value, attrs = '', full = false) => `<div class="field${full ? ' full' : ''}"><label for="qc-${name}">${label}</label>${type === 'select' ? `<select id="qc-${name}" name="${name}" ${attrs}>${value}</select>` : type === 'textarea' ? `<textarea id="qc-${name}" name="${name}" rows="3" ${attrs}>${esc(value)}</textarea>` : `<input id="qc-${name}" name="${name}" type="${type}" value="${esc(value ?? '')}" ${attrs}>`}</div>`;
  const datalist = (id, list) => `<datalist id="${id}">${list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
  const formValue = name => { const i = el('qcForm').querySelector(`[name="${name}"]`); return i ? i.value.trim() : ''; };
  const numValue = name => { const v = formValue(name); return v === '' ? null : Number(v); };
  el('qcForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = el('qcSubmit'); btn.disabled = true;
    try { await current.onSubmit(); el('qcDialog').close(); render(); } catch (error) { toast(error.message); } finally { btn.disabled = false; }
  });
  // Un solo escuchador: actualiza la vista previa del diálogo que está abierto
  ['input', 'change'].forEach(type => el('qcFormBody').addEventListener(type, () => current?.onInput?.()));
  document.querySelectorAll('[data-close-dialog="qcDialog"]').forEach(b => b.addEventListener('click', () => el('qcDialog').close()));

  function openControl(record) {
    const t = targets(), r = record || { id: uid('QBC'), date: todayISO(), batchId: state.batches.find(b => b.status !== 'Terminado')?.id || state.batches[0]?.id || '' };
    const batchOpts = options(state.batches.map(b => [b.id, `${b.id} · ${b.phase} · ${b.status}`]), r.batchId);
    openDialog(`${record ? 'Editar' : 'Registrar'} control de lote`, `<div class="form-grid">${field('date', 'Fecha', 'date', r.date, 'required')}${field('batchId', 'Lote de producción', 'select', batchOpts, 'required')}
      ${field('conditionerTemp', `Temperatura de acondicionado (°C · ${t.tempMin}–${t.tempMax})`, 'number', r.conditionerTemp, 'step="0.1" min="0"')}${field('retentionSec', `Tiempo de retención (s · ${t.retentionMin}–${t.retentionMax})`, 'number', r.retentionSec, 'step="1" min="0"')}
      ${field('microns', 'Granulometría (µm · según receta)', 'number', r.microns, 'step="1" min="50"')}${field('pdi', `Durabilidad del pellet PDI (% · mín. ${t.pdiMin})`, 'number', r.pdi, 'step="0.1" min="0" max="100"')}
      ${field('moisture', `Humedad del producto (% · máx. ${t.moistureMax})`, 'number', r.moisture, 'step="0.1" min="0" max="100"')}${field('responsible', 'Responsable', 'text', r.responsible, 'required list="qc-people"')}${datalist('qc-people', people())}
      ${field('notes', 'Observaciones', 'text', r.notes, 'maxlength="255"', true)}</div><p class="text-muted" id="qcPlcFill" style="margin:8px 0 0;font-size:12px"></p><div class="status-strip" id="qcControlPreview" style="--status-color:var(--blue)"></div>`, async () => {
      const draft = { ...r, date: formValue('date'), batchId: formValue('batchId'), conditionerTemp: numValue('conditionerTemp'), retentionSec: numValue('retentionSec'), microns: numValue('microns'), pdi: numValue('pdi'), moisture: numValue('moisture'), responsible: formValue('responsible'), notes: formValue('notes') };
      const result = await saveRecord('qualityBatchControls', draft, !record);
      const e = evalControl(draft);
      savedMessage(result, e.ok ? 'Control registrado: lote conforme' : `Control registrado con ${e.fails.length} desvío${e.fails.length === 1 ? '' : 's'}`);
    });
    const preview = () => {
      const e = evalControl({ batchId: formValue('batchId'), conditionerTemp: numValue('conditionerTemp'), retentionSec: numValue('retentionSec'), microns: numValue('microns'), pdi: numValue('pdi'), moisture: numValue('moisture') });
      const labels = { conditionerTemp: 'temperatura', retentionSec: 'retención', microns: 'granulometría', pdi: 'durabilidad', moisture: 'humedad' };
      const p = el('qcControlPreview'); p.style.setProperty('--status-color', !Object.keys(e.checks).length ? 'var(--blue)' : e.ok ? 'var(--ok)' : 'var(--red)');
      p.innerHTML = !Object.keys(e.checks).length ? `Rango de la receta: ${e.range ? `${e.range[0]}–${e.range[1]} µm` : 'sin receta para esta fase'}.` : e.ok ? '<b>Conforme</b> en todas las mediciones cargadas.' : `<b>Desvío</b> en ${e.fails.map(f => labels[f]).join(', ')}.`;
    };
    current.onInput = preview; preview();
    if (!record) prefillFromPlc();
  }
  // Control nuevo: temperatura y retención salen de las lecturas del PLC asociadas al lote elegido
  function prefillFromPlc() {
    const form = el('qcForm'), input = name => form.querySelector(`[name="${name}"]`);
    let touched = false;
    ['conditionerTemp', 'retentionSec'].forEach(n => input(n)?.addEventListener('input', () => { touched = true; }));
    const fill = async () => {
      const id = formValue('batchId'), note = el('qcPlcFill');
      if (!id || !note) return;
      note.textContent = 'Buscando lecturas del PLC…';
      try {
        const plc = await api(`/api/telemetry/batch/${encodeURIComponent(id)}`);
        if (formValue('batchId') !== id) return;
        const temp = plc && plc.temperature, ret = plc && plc.retention;
        if (!temp && !ret) { note.textContent = 'Sin lecturas del PLC para este lote: cargue los valores medidos.'; return; }
        const t = targets(), worst = (s, lo, hi) => (s.min < lo ? s.min : s.max > hi ? s.max : s.avg);
        const set = (n, v) => { const i = input(n); if (i && !touched) i.value = v; };
        if (temp) set('conditionerTemp', Math.round(worst(temp, t.tempMin, t.tempMax) * 10) / 10);
        if (ret) set('retentionSec', Math.round(worst(ret, t.retentionMin, t.retentionMax)));
        if (!touched && !formValue('notes')) set('notes', 'Temperatura y retención desde el PLC');
        note.innerHTML = `<b>Desde el PLC</b> (peor valor del lote): ${temp ? `temperatura ${num(temp.min, 1)}–${num(temp.max, 1)} °C en ${temp.count} lecturas` : ''}${temp && ret ? ' · ' : ''}${ret ? `retención ${num(ret.min, 0)}–${num(ret.max, 0)} s` : ''}.`;
        current?.onInput?.();
      } catch { note.textContent = 'No se pudieron leer los datos del PLC (sin conexión con el servidor).'; }
    };
    input('batchId')?.addEventListener('change', fill);
    fill();
  }
  function openHomogeneity(record) {
    const t = targets(), r = record || { id: uid('HOM'), date: todayISO(), mixer: state.equipment.find(e => /mezcl/i.test(e.name))?.name || 'Mezclador', method: METHODS[0], batchId: '', samples: [], lab: 'Laboratorio propio' };
    const mixers = [...new Set(state.equipment.filter(e => /mezcl|dosific/i.test(`${e.name} ${e.area}`)).map(e => e.name))];
    openDialog(`${record ? 'Editar' : 'Registrar'} ensayo de homogeneidad`, `<div class="form-grid">${field('date', 'Fecha', 'date', r.date, 'required')}${field('mixer', 'Mezclador', 'text', r.mixer, 'required list="qc-mixers"')}${datalist('qc-mixers', mixers)}
      ${field('method', 'Método', 'select', options(METHODS, r.method))}${field('batchId', 'Lote ensayado', 'select', options([['', 'Sin lote'], ...state.batches.map(b => [b.id, `${b.id} · ${b.phase}`])], r.batchId))}
      ${field('samples', 'Resultados de las muestras (separados por coma o espacio; se recomiendan 10)', 'textarea', (r.samples || []).join(', '), 'required', true)}
      ${field('lab', 'Laboratorio', 'text', r.lab, 'list="qc-labs"')}${datalist('qc-labs', ['Laboratorio propio', 'Laboratorio externo'])}${field('responsible', 'Responsable', 'text', r.responsible, 'required list="qc-people"')}${datalist('qc-people', people())}
      ${field('notes', 'Observaciones', 'text', r.notes, '', true)}</div><div class="status-strip" id="qcCvPreview" style="--status-color:var(--blue)"></div>`, async () => {
      const samples = formValue('samples').split(/[;,\s]+/).filter(Boolean).map(x => Number(x.replace(',', '.')));
      if (samples.some(v => !Number.isFinite(v))) throw new Error('Hay resultados que no son números');
      const draft = { ...r, date: formValue('date'), mixer: formValue('mixer'), method: formValue('method'), batchId: formValue('batchId'), samples, lab: formValue('lab'), responsible: formValue('responsible'), notes: formValue('notes') };
      const result = await saveRecord('homogeneityTests', draft, !record);
      const cv = cvOf(samples).cv; savedMessage(result, `Ensayo registrado: CV ${num(cv, 1)}% (${cv <= t.cvMax ? 'homogéneo' : 'no homogéneo'})`);
    });
    const preview = () => { const s = formValue('samples').split(/[;,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite), r2 = cvOf(s), p = el('qcCvPreview');
      p.style.setProperty('--status-color', r2.cv === null ? 'var(--blue)' : r2.cv <= t.cvMax ? 'var(--ok)' : 'var(--red)');
      p.innerHTML = r2.cv === null ? 'Cargue al menos 2 resultados para calcular el CV.' : `<b>CV ${num(r2.cv, 2)}%</b> con ${s.length} muestras (media ${num(r2.mean, 3)}). Objetivo: menor al ${num(t.cvMax, 0)}%.`; };
    current.onInput = preview; preview();
  }
  function openLab(record) {
    const t = targets(), r = record || { id: uid('LAB'), date: todayISO(), rawMaterial: 'Maíz', verdict: 'Aprobado', lab: 'Laboratorio propio' };
    const lotOptions = [...new Set(state.lots.map(l => l.supplierLot).filter(Boolean))];
    const limitField = ([k, label, unit, lim]) => field(k, `${label} (${unit} · máx. ${num(t[lim], unit === 'ppm' ? 1 : 0)})`, 'number', r[k], 'step="any" min="0"');
    openDialog(`${record ? 'Editar' : 'Registrar'} análisis de materia prima`, `<div class="form-grid form-grid-3">${field('date', 'Fecha', 'date', r.date, 'required')}${field('rawMaterial', 'Materia prima', 'select', options(RAW_MATERIALS, r.rawMaterial))}${field('supplier', 'Proveedor', 'text', r.supplier, 'list="qc-suppliers"')}${datalist('qc-suppliers', [...new Set(state.lots.map(l => l.producer))])}
      ${field('supplierLot', 'Lote del proveedor', 'text', r.supplierLot, 'list="qc-lots"')}${datalist('qc-lots', lotOptions)}${field('protein', 'Proteína (%)', 'number', r.protein, 'step="any" min="0"')}${LAB_LIMITS.map(limitField).join('')}
      ${field('verdict', 'Dictamen', 'select', options(VERDICTS, r.verdict))}${field('lab', 'Laboratorio', 'text', r.lab, 'list="qc-labs"')}${datalist('qc-labs', ['Laboratorio propio', 'Laboratorio externo'])}${field('notes', 'Observaciones', 'text', r.notes, '', true)}</div>
      <div class="status-strip" id="qcLabPreview" style="--status-color:var(--blue)"></div>`, async () => {
      const draft = { ...r, date: formValue('date'), rawMaterial: formValue('rawMaterial'), supplier: formValue('supplier'), supplierLot: formValue('supplierLot'), protein: numValue('protein'), verdict: formValue('verdict'), lab: formValue('lab'), notes: formValue('notes') };
      LAB_LIMITS.forEach(([k]) => { draft[k] = numValue(k); });
      const result = await saveRecord('labAnalyses', draft, !record);
      savedMessage(result, draft.verdict === 'Rechazado' ? 'Análisis registrado: materia prima rechazada' : 'Análisis registrado');
    });
    let touchedVerdict = !!record;
    el('qcFormBody').querySelector('[name=verdict]').addEventListener('change', () => { touchedVerdict = true; });
    // El dictamen se propone según los límites; si el usuario lo cambia, se respeta
    const preview = () => { const a = { rawMaterial: formValue('rawMaterial') }; LAB_LIMITS.forEach(([k]) => { a[k] = numValue(k); }); const e = evalLab(a), p = el('qcLabPreview');
      if (!touchedVerdict) el('qcFormBody').querySelector('[name=verdict]').value = e.suggested;
      p.style.setProperty('--status-color', e.over.length ? 'var(--red)' : 'var(--ok)');
      p.innerHTML = e.over.length ? `<b>Fuera de límite:</b> ${e.over.map(k => LAB_LIMITS.find(x => x[0] === k)[1]).join(', ')}. Dictamen sugerido: rechazo.` : 'Todos los valores cargados dentro de los límites.'; };
    current.onInput = preview; preview();
  }
  function auditRows(items) {
    return items.map((x, i) => `<div class="audit-check" data-index="${i}"><input type="checkbox" class="au-ok" ${x.ok ? 'checked' : ''} aria-label="Cumple"><div><b>${esc(x.text)}</b>${x.help ? `<small>${esc(x.help)}</small>` : ''}</div><input type="text" class="au-notes" value="${esc(x.notes || '')}" placeholder="Observación" maxlength="255"></div>`).join('');
  }
  function openAudit(record) {
    const template = state.settings.auditTemplate || [];
    const items = record ? record.items.map(x => ({ ...x, help: (template.find(t => t.text === x.text) || {}).help })) : template.map(t => ({ text: t.text, help: t.help, ok: false, notes: '' }));
    const r = record || { id: uid('AUD'), date: todayISO(), auditor: '' };
    openDialog(`${record ? 'Auditoría del ' + fmtDate(r.date) : 'Nueva auditoría de contaminación cruzada'}`, `<div class="form-grid">${field('date', 'Fecha', 'date', r.date, 'required')}${field('auditor', 'Auditor', 'text', r.auditor, 'required list="qc-people"')}${datalist('qc-people', people())}</div>
      <div class="dialog-section"><h3>Controles <small class="text-muted" id="qcAuditScore"></small></h3><div id="qcAuditItems">${auditRows(items)}</div></div>${field('notes', 'Observaciones generales', 'textarea', r.notes, 'maxlength="500"', true)}`, async () => {
      const rows = [...el('qcAuditItems').querySelectorAll('.audit-check')];
      const draft = { ...r, date: formValue('date'), auditor: formValue('auditor'), notes: formValue('notes'), items: rows.map((row, i) => ({ text: items[i].text, ok: row.querySelector('.au-ok').checked, notes: row.querySelector('.au-notes').value.trim() })) };
      const result = await saveRecord('qualityAudits', draft, !record);
      const s = auditScore(draft); savedMessage(result, `Auditoría guardada: ${num(s.pct, 0)}% de cumplimiento`);
    });
    const score = () => { const rows = [...el('qcAuditItems').querySelectorAll('.au-ok')], ok = rows.filter(x => x.checked).length; el('qcAuditScore').textContent = `· ${ok} de ${rows.length} (${rows.length ? num(ok / rows.length * 100, 0) : 0}%)`; };
    current.onInput = score; score();
  }
  function listEditor(rowsHtml, addRow, onSubmit, title, help) {
    openDialog(title, `<p class="text-muted">${help}</p><div id="qcListRows">${rowsHtml}</div><button type="button" class="ghost-btn" id="qcListAdd">Agregar</button>`, onSubmit);
    el('qcListAdd').addEventListener('click', () => el('qcListRows').insertAdjacentHTML('beforeend', addRow()));
    el('qcListRows').addEventListener('click', e => { if (e.target.closest('.qc-list-del')) e.target.closest('.list-editor-row').remove(); });
  }
  el('qcTemplateBtn').addEventListener('click', () => {
    const row = (t = {}) => `<div class="list-editor-row"><input class="tp-text" value="${esc(t.text || '')}" placeholder="Control" maxlength="160" required><input class="tp-help" value="${esc(t.help || '')}" placeholder="Detalle o criterio" maxlength="255"><button type="button" class="danger-btn qc-list-del" aria-label="Quitar">×</button></div>`;
    listEditor((state.settings.auditTemplate || []).map(row).join(''), () => row(), async () => {
      const value = [...el('qcListRows').querySelectorAll('.list-editor-row')].map(r => ({ text: r.querySelector('.tp-text').value.trim(), help: r.querySelector('.tp-help').value.trim() })).filter(x => x.text);
      if (!value.length) throw new Error('La plantilla necesita al menos un control');
      savedMessage(await saveSetting('auditTemplate', value), 'Plantilla guardada: se usa en las próximas auditorías');
    }, 'Plantilla de auditoría', 'Controles que se revisan en cada auditoría. Las auditorías ya hechas conservan sus controles.');
  });
  el('qcZonesBtn').addEventListener('click', () => {
    const row = (z = {}) => `<div class="list-editor-row zones" data-id="${esc(z.id || uid('ZON'))}"><input class="zn-name" value="${esc(z.name || '')}" placeholder="Zona" maxlength="80" required><select class="zn-level">${options(ZONE_LEVELS, z.level || 'Transición')}</select><input class="zn-sectors" value="${esc(z.sectors || '')}" placeholder="Sectores" maxlength="255"><input class="zn-controls" value="${esc(z.controls || '')}" placeholder="Controles de ingreso" maxlength="255"><button type="button" class="danger-btn qc-list-del" aria-label="Quitar">×</button></div>`;
    listEditor((state.settings.sanitaryZones || []).map(row).join(''), () => row(), async () => {
      const value = [...el('qcListRows').querySelectorAll('.list-editor-row')].map(r => ({ id: r.dataset.id, name: r.querySelector('.zn-name').value.trim(), level: r.querySelector('.zn-level').value, sectors: r.querySelector('.zn-sectors').value.trim(), controls: r.querySelector('.zn-controls').value.trim() })).filter(z => z.name);
      savedMessage(await saveSetting('sanitaryZones', value), 'Zonificación guardada');
    }, 'Zonificación sanitaria', 'Zonas de la planta de la más sucia a la más limpia, con sus sectores y los controles para ingresar.');
  });
  el('qcTargetsBtn').addEventListener('click', () => {
    const t = targets(), f = (k, label, step = 'any') => field(k, label, 'number', t[k], `step="${step}" min="0" required`);
    openDialog('Objetivos y límites de calidad', `<div class="dialog-section" style="margin-top:0"><h3>Proceso y producto terminado</h3><div class="form-grid form-grid-3">${f('tempMin', 'Temperatura mínima (°C)')}${f('tempMax', 'Temperatura máxima (°C)')}${f('retentionMin', 'Retención mínima (s)')}${f('retentionMax', 'Retención máxima (s)')}${f('pdiMin', 'Durabilidad mínima PDI (%)')}${f('moistureMax', 'Humedad máxima del alimento (%)')}${f('cvMax', 'CV máximo de mezclado (%)')}</div></div>
      <div class="dialog-section"><h3>Materias primas</h3><div class="form-grid form-grid-3">${f('rawMoistureMax', 'Humedad máxima (%)')}${f('aflatoxinsMax', 'Aflatoxinas (ppb)')}${f('donMax', 'DON (ppm)')}${f('zearalenoneMax', 'Zearalenona (ppb)')}${f('fumonisinsMax', 'Fumonisinas (ppm)')}${f('damagedMax', 'Granos dañados (%)')}${f('foreignMax', 'Materias extrañas (%)')}</div></div>
      <p class="text-muted">La granulometría se controla con el rango de partícula de la receta de cada fase. Los límites de micotoxinas son referencias generales para cerdos: ajustarlos según la categoría y el criterio del nutricionista.</p>`, async () => {
      const value = {}; Object.keys(DEFAULT_TARGETS).forEach(k => { value[k] = numValue(k); });
      savedMessage(await saveSetting('qualityTargets', value), 'Objetivos guardados');
    });
  });

  /* ---------- acciones de tablas ---------- */
  const OPEN = { control: openControl, homogeneity: openHomogeneity, lab: openLab, audit: openAudit };
  const KEY = { control: 'qualityBatchControls', homogeneity: 'homogeneityTests', lab: 'labAnalyses', audit: 'qualityAudits' };
  el('page-quality').addEventListener('click', async e => {
    const nb = e.target.closest('[data-qc-new]'), eb = e.target.closest('[data-qc-edit]'), del = e.target.closest('[data-qc-del]'), waste = e.target.closest('[data-qc-waste]');
    if (nb) return OPEN[nb.dataset.qcNew](null);
    if (eb) return OPEN[eb.dataset.qcEdit](state[KEY[eb.dataset.qcEdit]].find(x => x.id === eb.dataset.id));
    if (waste) {
      const a = state.labAnalyses.find(x => x.id === waste.dataset.qcWaste);
      if (!window.pbpOpenWasteForm) return toast('El módulo de Residuos no está disponible');
      window.go('waste'); window.pbpOpenWasteForm('other');
      setTimeout(() => { const f = document.getElementById('wasteForm'); const set = (n, v) => { const i = f.querySelector(`[name="${n}"]`); if (i) { i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); } };
        set('type', 'Materia prima rechazada'); set('unit', 'TM'); set('disposition', 'Devolución al proveedor'); set('notes', `Rechazo por análisis ${a.id}: ${a.rawMaterial} · ${a.supplier || ''} ${a.supplierLot || ''}`.trim()); }, 80);
      return;
    }
    if (!del || !confirm('¿Eliminar este registro?')) return;
    try {
      const result = await api(`${COLLECTIONS[del.dataset.qcDel]}/${encodeURIComponent(del.dataset.id)}`, { method: 'DELETE' });
      const list = state[del.dataset.qcDel], i = list.findIndex(x => x.id === del.dataset.id); if (i >= 0) list.splice(i, 1);
      savedMessage(result, 'Registro eliminado'); render();
    } catch (error) { toast(error.message); }
  });
  /* ---------- PLC del acondicionador (punto crítico térmico) ---------- */
  const PLC_EQUIPMENT = 'ACONDICIONADOR';
  const plcParam = name => (state.plc?.parameters || []).find(p => p.equipmentName === PLC_EQUIPMENT && p.parameterMeasured === name) || null;
  const timeAgo = iso => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
  async function loadPlc() {
    try {
      const summary = await api('/api/telemetry/summary?hours=24');
      if (!summary || !Array.isArray(summary.parameters)) return;
      state.plc = summary; renderPlc();
      document.dispatchEvent(new CustomEvent('pbp:plc', { detail: summary }));
    } catch { /* sin conexión: queda el último resumen */ }
  }
  function renderPlc() {
    const pcc = el('qcPccStatus'); if (!pcc) return;
    let strip = el('qcPlcStatus');
    if (!strip) { strip = document.createElement('div'); strip.id = 'qcPlcStatus'; strip.className = 'status-strip'; strip.style.margin = '0 0 16px'; pcc.after(strip); }
    const t = targets(), temp = plcParam('TEMPERATURA'), ret = plcParam('RETENCION');
    if (!temp && !ret) {
      strip.style.setProperty('--status-color', 'var(--blue)');
      strip.innerHTML = `<b>PLC del acondicionador: sin lecturas en las últimas 24 h.</b> Las lecturas de TEMPERATURA y RETENCION del equipo ${PLC_EQUIPMENT} se evalúan contra ${t.tempMin}–${t.tempMax} °C y ${t.retentionMin}–${t.retentionMax} s, y al cerrar el lote se registra su control automáticamente.`;
      return;
    }
    const part = (p, label, unit, d) => (p ? `${label} ${num(+p.last.valueNumeric, d)} ${unit} (${timeAgo(p.last.loggedAt)})${p.outCount ? ` · <span class="${p.criticalCount ? 'negative' : 'warning'}">${p.outCount} de ${p.count} lecturas fuera de rango</span>` : ` · ${p.count} lecturas en rango`}` : `${label} sin lecturas`);
    const critical = [temp, ret].some(p => p && p.criticalCount), out = [temp, ret].some(p => p && p.outCount), batch = temp?.last?.batchId || ret?.last?.batchId;
    strip.style.setProperty('--status-color', critical ? 'var(--red)' : out ? 'var(--orange)' : 'var(--ok)');
    strip.innerHTML = `<b>PLC del acondicionador · últimas 24 h${batch ? ` · lote ${esc(batch)}` : ''}.</b> ${part(temp, 'Temperatura', '°C', 1)} · ${part(ret, 'Retención', 's', 0)}.${critical ? ' Hubo lecturas por debajo del mínimo del PCC: retener y evaluar los lotes afectados.' : ''}`;
  }
  let plcTimer = null;
  document.addEventListener('pbp:telemetry', e => { if (e.detail?.equipmentName !== PLC_EQUIPMENT) return; clearTimeout(plcTimer); plcTimer = setTimeout(loadPlc, 1500); });
  setInterval(loadPlc, 5 * 60000);

  window.pbpOpenQualityControl = () => { showSection('controls'); openControl(null); };
  window.pbpQualitySummary = () => ({ evalControl, cvOf, evalLab, auditScore, targets, plc: () => state.plc });

  document.addEventListener('pbp:bootstrap', event => load(event.detail));
  if (window.pbpData) load(window.pbpData); else render();
})();
