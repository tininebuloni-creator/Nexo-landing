/* Pampa PBP - Capacitaciones (RRHH)
 * Registro de capacitaciones dictadas (tema, instructor, horas, asistentes, vigencia y certificado),
 * temas obligatorios por puesto y estado de cada persona. El vencimiento de cada legajo lo recalcula
 * el servidor al guardar; acá se replica el cálculo para mostrarlo también sin conexión.
 * Usa helpers del script principal (api, toast, escapeHTML, num, loadBackend) y window.pbpData.
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  if (!el('trnCard')) return;
  const esc = v => escapeHTML(v ?? '');
  const todayISO = () => new Date().toLocaleDateString('sv-SE');
  const fmtDate = iso => (iso ? iso.split('-').reverse().join('/') : '—');
  const daysUntil = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
  const uid = prefix => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const savedMessage = (result, ok) => toast(result && result.offline ? 'Guardado sin conexión: se sincroniza al volver la señal' : ok);
  const pendingTag = item => (item && item._pending ? '<span class="pending-tag">sin sincronizar</span>' : '');
  const options = (list, selected) => list.map(o => (Array.isArray(o) ? o : [o, o])).map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const POSITIONS = ['Jefe de planta', 'Operador de consola (SCADA)', 'Operario de piso / recepción', 'Técnico de mantenimiento', 'Control de calidad y nutrición', 'Logística y despacho', 'Administrativo / facturación', 'Operario polivalente', 'Supervisor / encargado de granja'];
  const SOON_DAYS = 30;

  /* ---------- datos y cálculo ---------- */
  const data = () => {
    const d = window.pbpData || {};
    if (!Array.isArray(d.trainings)) d.trainings = [];
    if (!Array.isArray(d.employees)) d.employees = [];
    if (!d.settings) d.settings = {};
    return d;
  };
  const topics = () => data().settings.trainingTopics || [];
  const staff = () => data().employees.filter(e => e.status !== 'Baja').sort((a, z) => a.id.localeCompare(z.id, 'es', { numeric: true }));
  const addMonths = (iso, months) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); };
  const dueOf = t => (Number(t.validityMonths) > 0 ? addMonths(t.date, Number(t.validityMonths)) : null);
  const required = emp => topics().filter(t => !t.positions || !t.positions.length || t.positions.includes(emp.position));
  const lastFor = (empId, topic) => data().trainings.filter(x => x.topic === topic && (x.attendees || []).includes(empId)).sort((a, z) => z.date.localeCompare(a.date))[0] || null;
  function topicState(emp, topic) {
    const last = lastFor(emp.id, topic.name), due = last ? dueOf(last) : null;
    const state = !last ? 'missing' : due && due < todayISO() ? 'late' : due && daysUntil(due) <= SOON_DAYS ? 'soon' : 'ok';
    return { emp, topic, last, due, state };
  }
  function personStatus(emp) {
    const items = required(emp).map(t => topicState(emp, t));
    const dues = items.map(i => i.due).filter(Boolean).sort();
    return { emp, items, ok: items.filter(i => i.state === 'ok' || i.state === 'soon').length, pending: items.filter(i => i.state === 'missing' || i.state === 'late'), soon: items.filter(i => i.state === 'soon'), nextDue: dues[0] || null };
  }
  // Mismo criterio que el servidor: el vencimiento del legajo es el más próximo de sus temas obligatorios
  const employeeDue = emp => personStatus(emp).nextDue;
  function topicCoverage(topic) {
    const people = staff().filter(e => !topic.positions || !topic.positions.length || topic.positions.includes(e.position)).map(e => topicState(e, topic));
    return { topic, people, ok: people.filter(p => p.state === 'ok' || p.state === 'soon'), missing: people.filter(p => p.state === 'missing' || p.state === 'late') };
  }
  window.pbpTrainingSummary = () => ({ topics: topics(), people: staff().map(personStatus), coverage: topicCoverage, personStatus });

  /* ---------- render ---------- */
  const STATE_BADGE = { ok: ['green', 'Al día'], soon: ['amber', 'Por vencer'], late: ['red', 'Vencida'], missing: ['red', 'Falta'] };
  const peopleNames = ids => ids.map(id => data().employees.find(e => e.id === id)?.name || id);
  function renderPeople() {
    const rows = staff().map(personStatus);
    el('trnPeopleRows').innerHTML = rows.length ? rows.map(p => {
      const total = p.items.length, color = p.pending.length ? 'red' : p.soon.length ? 'amber' : 'green';
      const issues = [...p.pending, ...p.soon].map(i => `<span class="badge ${STATE_BADGE[i.state][0]}" title="${i.due ? 'Vence ' + fmtDate(i.due) : 'Sin registro'}">${STATE_BADGE[i.state][1]}: ${esc(i.topic.name)}</span>`).join(' ');
      return `<tr><td><b>${esc(p.emp.name)}</b><br><small class="text-muted">${esc(p.emp.id)}${p.emp.status === 'Licencia' ? ' · en licencia' : ''}</small></td><td>${esc(p.emp.position)}</td>
        <td><span class="badge ${color}">${p.ok} de ${total}</span></td><td>${p.nextDue ? `<span class="${p.nextDue < todayISO() ? 'negative' : daysUntil(p.nextDue) <= SOON_DAYS ? 'warning' : ''}">${fmtDate(p.nextDue)}</span>` : '—'}</td>
        <td style="white-space:normal;min-width:260px">${issues || '<span class="text-muted">Sin pendientes</span>'}</td><td class="row-actions"><button class="ghost-btn" data-trn-history="${esc(p.emp.id)}">Historial</button></td></tr>`;
    }).join('') : '<tr><td colspan="6">Sin personal cargado</td></tr>';
  }
  function renderTopics() {
    const list = topics();
    el('trnTopicRows').innerHTML = list.length ? list.map(t => {
      const c = topicCoverage(t), total = c.people.length, pct = total ? c.ok.length / total * 100 : 0;
      const missing = c.missing.map(p => p.emp.name);
      return `<tr><td><b>${esc(t.name)}</b>${t.quality ? ' <span class="badge blue" title="Evidencia para las auditorías de Calidad">Calidad</span>' : ''}</td><td>${Number(t.validityMonths) ? `${t.validityMonths} meses` : 'No vence'}</td>
        <td style="white-space:normal;min-width:180px"><small>${t.positions && t.positions.length ? t.positions.map(esc).join(', ') : 'Todos los puestos'}</small></td>
        <td style="min-width:150px"><div class="track"><span style="width:${pct}%;background:${pct >= 100 ? 'var(--ok)' : pct >= 70 ? 'var(--orange)' : 'var(--red)'}"></span></div><small>${c.ok.length} de ${total} al día</small></td>
        <td style="white-space:normal;min-width:180px"><small>${missing.length ? missing.map(esc).join(', ') : '—'}</small></td>
        <td class="row-actions"><button class="ghost-btn" data-trn-topic="${esc(t.name)}">Registrar</button></td></tr>`;
    }).join('') : '<tr><td colspan="6">Sin temas configurados. Use «Temas y vigencias».</td></tr>';
  }
  function renderRecords() {
    const rows = [...data().trainings].sort((a, z) => z.date.localeCompare(a.date));
    el('trnRecordRows').innerHTML = rows.length ? rows.map(t => {
      const names = peopleNames(t.attendees || []), due = dueOf(t);
      return `<tr><td>${fmtDate(t.date)}</td><td><b>${esc(t.topic)}</b>${pendingTag(t)}${t.notes ? `<br><small class="text-muted">${esc(t.notes)}</small>` : ''}</td><td>${esc(t.instructor)}</td><td>${num(+t.hours, 1)} h</td>
        <td style="white-space:normal;min-width:180px"><b>${names.length}</b> · <small>${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ` y ${names.length - 3} más` : ''}</small></td>
        <td>${due ? `<span class="${due < todayISO() ? 'negative' : daysUntil(due) <= SOON_DAYS ? 'warning' : ''}">${fmtDate(due)}</span>` : 'No vence'}</td><td>${esc(t.certificate || '—')}</td>
        <td class="row-actions"><button class="ghost-btn" data-trn-edit="${esc(t.id)}">Editar</button><button class="danger-btn" data-trn-del="${esc(t.id)}" aria-label="Eliminar">×</button></td></tr>`;
    }).join('') : '<tr><td colspan="8">Sin capacitaciones registradas</td></tr>';
  }
  function render() {
    try { renderPeople(); renderTopics(); renderRecords(); } catch (error) { console.error('Capacitaciones:', error); }
  }
  function showSection(name) {
    document.querySelectorAll('#trnNav .pill').forEach(b => b.classList.toggle('active', b.dataset.trn === name));
    document.querySelectorAll('.trn-section').forEach(s => s.classList.toggle('active', s.dataset.trnSection === name));
    try { localStorage.setItem('pbp:trn-section', name); } catch {}
  }
  el('trnNav').addEventListener('click', e => { const b = e.target.closest('.pill'); if (b) showSection(b.dataset.trn); });
  try { showSection(localStorage.getItem('pbp:trn-section') || 'people'); } catch {}

  /* ---------- diálogo ---------- */
  let current = null;
  function openDialog(title, bodyHtml, onSubmit, submitLabel = 'Guardar') {
    el('trnDialogTitle').textContent = title;
    el('trnFormBody').innerHTML = bodyHtml;
    el('trnSubmit').textContent = submitLabel;
    el('trnCancel').hidden = !onSubmit;
    current = { onSubmit };
    el('trnDialog').showModal();
  }
  el('trnForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!current?.onSubmit) return el('trnDialog').close();
    const btn = el('trnSubmit'); btn.disabled = true;
    try { await current.onSubmit(); el('trnDialog').close(); } catch (error) { toast(error.message); } finally { btn.disabled = false; }
  });
  ['input', 'change'].forEach(type => el('trnFormBody').addEventListener(type, e => current?.onInput?.(e)));
  document.querySelectorAll('[data-close-dialog="trnDialog"]').forEach(b => b.addEventListener('click', () => el('trnDialog').close()));
  const field = (name, label, type, value, attrs = '', full = false) => `<div class="field${full ? ' full' : ''}"><label for="trn-${name}">${label}</label>${type === 'select' ? `<select id="trn-${name}" name="${name}" ${attrs}>${value}</select>` : `<input id="trn-${name}" name="${name}" type="${type}" value="${esc(value ?? '')}" ${attrs}>`}</div>`;
  const formValue = name => { const i = el('trnForm').querySelector(`[name="${name}"]`); return i ? i.value.trim() : ''; };

  // Después de guardar: con conexión se recarga del servidor (vencimientos recalculados allá);
  // sin conexión se recalculan acá y se avisa al resto de los módulos
  function afterChange(result, affected) {
    if (result && result.offline) {
      for (const id of affected) { const emp = data().employees.find(e => e.id === id); const due = emp && employeeDue(emp); if (due) emp.trainingDue = due; }
      document.dispatchEvent(new CustomEvent('pbp:bootstrap', { detail: window.pbpData }));
    } else if (typeof loadBackend === 'function') loadBackend();
    else render();
  }

  function openTraining(record, preset = {}) {
    const list = topics(), r = record || { id: uid('TRN'), date: todayISO(), topic: preset.topic || list[0]?.name || '', hours: 2, attendees: preset.attendees || [], certificate: '', notes: '' };
    const topicOf = name => list.find(t => t.name === name);
    if (!record) r.validityMonths = topicOf(r.topic)?.validityMonths ?? 12;
    const topicOpts = [...list.map(t => t.name), ...(r.topic && !topicOf(r.topic) ? [r.topic] : [])];
    const instructors = [...new Set([...data().trainings.map(t => t.instructor), ...staff().map(e => e.name)])].filter(Boolean);
    const people = [...staff(), ...data().employees.filter(e => e.status === 'Baja' && (r.attendees || []).includes(e.id))];
    const attendeeHtml = people.map(e => `<label><input type="checkbox" class="trn-att" value="${esc(e.id)}" ${(r.attendees || []).includes(e.id) ? 'checked' : ''}><span>${esc(e.name)}<small>${esc(e.position)}</small><small class="trn-att-state" data-emp="${esc(e.id)}"></small></span></label>`).join('');
    openDialog(record ? 'Editar capacitación' : 'Registrar capacitación', `<div class="form-grid">${field('date', 'Fecha', 'date', r.date, 'required')}${field('topic', 'Tema', 'select', options(topicOpts, r.topic), 'required')}
      ${field('instructor', 'Instructor o entidad', 'text', r.instructor, 'required maxlength="160" list="trn-instructors"')}<datalist id="trn-instructors">${instructors.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      ${field('hours', 'Duración (horas)', 'number', r.hours, 'required min="0" step="0.5"')}${field('validityMonths', 'Vigencia (meses · 0 = no vence)', 'number', r.validityMonths, 'required min="0" max="240" step="1"')}
      ${field('certificate', 'Certificado / constancia N°', 'text', r.certificate, 'maxlength="120"')}${field('notes', 'Contenido u observaciones', 'text', r.notes, 'maxlength="255"', true)}</div>
      <div class="dialog-section"><h3>Asistentes <small class="text-muted" id="trnAttCount"></small></h3>
      <div class="head-actions" style="margin-bottom:8px"><button type="button" class="ghost-btn" data-trn-pick="needed">Marcar quienes lo necesitan</button><button type="button" class="ghost-btn" data-trn-pick="all">Todos</button><button type="button" class="ghost-btn" data-trn-pick="none">Ninguno</button></div>
      <div class="trn-attendees">${attendeeHtml || '<p class="text-muted">Sin personal cargado.</p>'}</div></div>
      <div class="status-strip" id="trnPreview" style="--status-color:var(--blue)"></div>`, async () => {
      const attendees = [...el('trnFormBody').querySelectorAll('.trn-att:checked')].map(x => x.value);
      if (!attendees.length) throw new Error('Seleccione al menos un asistente');
      const draft = { ...r, date: formValue('date'), topic: formValue('topic'), instructor: formValue('instructor'), hours: Number(formValue('hours')), validityMonths: Number(formValue('validityMonths')), certificate: formValue('certificate'), notes: formValue('notes'), attendees };
      delete draft._pending;
      const result = record ? await api(`/api/trainings/${encodeURIComponent(r.id)}`, { method: 'PUT', body: JSON.stringify(draft) }) : await api('/api/trainings', { method: 'POST', body: JSON.stringify(draft) });
      const saved = { ...draft, ...result, _pending: !!result.offline }; delete saved.offline;
      const all = data().trainings, i = all.findIndex(x => x.id === r.id);
      if (i >= 0) all[i] = saved; else all.push(saved);
      afterChange(result, [...new Set([...(record?.attendees || []), ...attendees])]);
      savedMessage(result, `Capacitación registrada · ${attendees.length} asistente${attendees.length === 1 ? '' : 's'}`);
    });
    let validityTouched = !!record;
    const paint = () => {
      const topic = topicOf(formValue('topic')), checked = el('trnFormBody').querySelectorAll('.trn-att:checked').length;
      el('trnAttCount').textContent = `· ${checked} seleccionado${checked === 1 ? '' : 's'}`;
      el('trnFormBody').querySelectorAll('.trn-att-state').forEach(s => {
        const emp = data().employees.find(e => e.id === s.dataset.emp), needs = topic && emp && (!topic.positions?.length || topic.positions.includes(emp.position));
        const st = needs ? topicState(emp, topic) : null;
        s.textContent = !topic ? '' : !needs ? 'No obligatoria para su puesto' : st.state === 'missing' ? 'Nunca la hizo' : `${STATE_BADGE[st.state][1]} · vence ${fmtDate(st.due) === '—' ? 'nunca' : fmtDate(st.due)}`;
        s.className = `trn-att-state ${st && (st.state === 'missing' || st.state === 'late') ? 'negative' : st && st.state === 'soon' ? 'warning' : ''}`;
      });
      const months = Number(formValue('validityMonths')), date = formValue('date'), p = el('trnPreview');
      p.innerHTML = date ? (months > 0 ? `Vigente hasta el <b>${fmtDate(addMonths(date, months))}</b>. Al guardar se actualiza el vencimiento de capacitación del legajo de cada asistente.` : 'Esta capacitación <b>no vence</b>.') : '';
    };
    current.onInput = e => {
      if (e?.target?.name === 'validityMonths') validityTouched = true;
      if (e?.target?.name === 'topic' && !validityTouched) { const t = topicOf(formValue('topic')); if (t) el('trn-validityMonths').value = t.validityMonths; }
      paint();
    };
    el('trnFormBody').addEventListener('click', e => {
      const pick = e.target.closest('[data-trn-pick]'); if (!pick) return;
      const topic = topicOf(formValue('topic'));
      el('trnFormBody').querySelectorAll('.trn-att').forEach(c => {
        const emp = data().employees.find(x => x.id === c.value);
        if (pick.dataset.trnPick === 'all') c.checked = true;
        else if (pick.dataset.trnPick === 'none') c.checked = false;
        else c.checked = !!(topic && emp && emp.status !== 'Baja' && (!topic.positions?.length || topic.positions.includes(emp.position)) && topicState(emp, topic).state !== 'ok');
      });
      paint();
    });
    paint();
  }

  function openHistory(empId) {
    const emp = data().employees.find(e => e.id === empId); if (!emp) return;
    const st = personStatus(emp), records = data().trainings.filter(t => (t.attendees || []).includes(empId)).sort((a, z) => z.date.localeCompare(a.date));
    const hours = records.reduce((s, t) => s + (Number(t.hours) || 0), 0);
    openDialog(`Capacitaciones de ${emp.name}`, `<p class="text-muted" style="margin:0 0 12px">${esc(emp.position)} · ${esc(emp.id)} · ${records.length} capacitaciones · ${num(hours, 1)} horas en total</p>
      <div class="dialog-section"><h3>Temas obligatorios del puesto</h3><div class="table-wrap"><table><thead><tr><th>Tema</th><th>Última</th><th>Vence</th><th>Estado</th></tr></thead><tbody>
      ${st.items.map(i => `<tr><td>${esc(i.topic.name)}</td><td>${i.last ? fmtDate(i.last.date) : '—'}</td><td>${i.last ? (i.due ? fmtDate(i.due) : 'No vence') : '—'}</td><td><span class="badge ${STATE_BADGE[i.state][0]}">${STATE_BADGE[i.state][1]}</span></td></tr>`).join('') || '<tr><td colspan="4">Sin temas obligatorios</td></tr>'}</tbody></table></div></div>
      <div class="dialog-section"><h3>Historial</h3><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tema</th><th>Instructor</th><th>Horas</th><th>Certificado</th></tr></thead><tbody>
      ${records.map(t => `<tr><td>${fmtDate(t.date)}</td><td>${esc(t.topic)}</td><td>${esc(t.instructor)}</td><td>${num(+t.hours, 1)} h</td><td>${esc(t.certificate || '—')}</td></tr>`).join('') || '<tr><td colspan="5">Sin capacitaciones registradas</td></tr>'}</tbody></table></div></div>`, null, 'Cerrar');
  }

  function openTopics() {
    const row = (t = {}) => `<div class="trn-topic-row"><div class="list-editor-row trn-topic"><input class="tt-name" value="${esc(t.name || '')}" placeholder="Tema" maxlength="160" required><input class="tt-validity" type="number" min="0" max="240" step="1" value="${esc(t.validityMonths ?? 12)}" title="Vigencia en meses (0 = no vence)"><label class="tt-quality" title="Evidencia para las auditorías de Calidad"><input type="checkbox" class="tt-q" ${t.quality ? 'checked' : ''}> Calidad</label><button type="button" class="danger-btn tt-del" aria-label="Quitar">×</button></div>
      <details class="trn-positions"><summary>${t.positions && t.positions.length ? `Obligatoria para ${t.positions.length} puesto${t.positions.length === 1 ? '' : 's'}` : 'Obligatoria para todos los puestos'}</summary><div>${POSITIONS.map(p => `<label><input type="checkbox" class="tt-pos" value="${esc(p)}" ${(t.positions || []).includes(p) ? 'checked' : ''}> ${esc(p)}</label>`).join('')}</div></details></div>`;
    openDialog('Temas de capacitación y vigencias', `<p class="text-muted" style="margin:0 0 12px">Vigencia en meses (0 = no vence). Si no se marca ningún puesto, el tema es obligatorio para todos. «Calidad» lo muestra como evidencia en las auditorías.</p>
      <div id="trnTopicList">${topics().map(row).join('')}</div><button type="button" class="ghost-btn" id="trnTopicAdd">Agregar tema</button>`, async () => {
      const value = [...el('trnTopicList').querySelectorAll('.trn-topic-row')].map(r => ({ name: r.querySelector('.tt-name').value.trim(), validityMonths: Number(r.querySelector('.tt-validity').value), quality: r.querySelector('.tt-q').checked, positions: [...r.querySelectorAll('.tt-pos:checked')].map(x => x.value) })).filter(t => t.name);
      if (!value.length) throw new Error('Cargue al menos un tema');
      const result = await api('/api/settings/trainingTopics', { method: 'PUT', body: JSON.stringify({ value }) });
      data().settings.trainingTopics = result.value || value;
      document.dispatchEvent(new CustomEvent('pbp:bootstrap', { detail: window.pbpData }));
      savedMessage(result, 'Temas de capacitación guardados');
    });
    current.onInput = e => {
      const r = e?.target?.closest('.trn-topic-row'); if (!r || !e.target.classList.contains('tt-pos')) return;
      const n = r.querySelectorAll('.tt-pos:checked').length;
      r.querySelector('summary').textContent = n ? `Obligatoria para ${n} puesto${n === 1 ? '' : 's'}` : 'Obligatoria para todos los puestos';
    };
    el('trnFormBody').addEventListener('click', e => {
      if (e.target.id === 'trnTopicAdd') { el('trnTopicList').insertAdjacentHTML('beforeend', row()); el('trnTopicList').lastElementChild.querySelector('.tt-name').focus(); }
      if (e.target.closest('.tt-del')) e.target.closest('.trn-topic-row').remove();
    });
  }

  /* ---------- acciones ---------- */
  el('trnNewBtn').addEventListener('click', () => openTraining(null));
  el('trnTopicsBtn').addEventListener('click', openTopics);
  el('trnCard').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.trnHistory) return openHistory(b.dataset.trnHistory);
    if (b.dataset.trnTopic) {
      const topic = topics().find(t => t.name === b.dataset.trnTopic);
      return openTraining(null, { topic: b.dataset.trnTopic, attendees: topic ? topicCoverage(topic).missing.map(p => p.emp.id) : [] });
    }
    if (b.dataset.trnEdit) { const t = data().trainings.find(x => x.id === b.dataset.trnEdit); if (t) openTraining(t); return; }
    if (b.dataset.trnDel) {
      const t = data().trainings.find(x => x.id === b.dataset.trnDel);
      if (!t || !confirm(`¿Eliminar la capacitación «${t.topic}» del ${fmtDate(t.date)}?`)) return;
      try {
        const result = await api(`/api/trainings/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
        const all = data().trainings; all.splice(all.indexOf(t), 1);
        afterChange(result, t.attendees || []);
        savedMessage(result, 'Capacitación eliminada');
      } catch (error) { toast(error.message); }
    }
  });

  document.addEventListener('pbp:bootstrap', () => setTimeout(render, 0));
  render();
})();
