/* Pampa PBP - Pliego técnico y compras (editable)
 * Bloques con ítems evaluables, cotización en USD o pesos, hitos y condiciones generales.
 * Usa los helpers globales del script principal (api, toast, escapeHTML, money, usdMoney, fxRate, num).
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = v => escapeHTML(v ?? '');
  const uid = prefix => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const savedMessage = (result, ok) => toast(result && result.offline ? 'Guardado sin conexión: se sincroniza al volver la señal' : ok);
  const pendingTag = item => (item && item._pending ? '<span class="pending-tag">sin sincronizar</span>' : '');
  const fmtDate = iso => (iso ? iso.split('-').reverse().join('/') : '—');

  // Opciones de las listas desplegables (las mismas que valida el servidor)
  const CATEGORIES = ['Recepción y limpieza', 'Molienda', 'Dosificación y mezcla', 'Pelletizado', 'Enfriamiento', 'Almacenamiento y despacho', 'Servicios', 'Automatización y control', 'Eléctrica', 'Obra civil', 'Legal y contractual', 'Otros'];
  const STATUS = ['Borrador', 'En cotización', 'Cotizado', 'Adjudicado', 'Rechazado'];
  const STATUS_BADGE = { 'Borrador': 'blue', 'En cotización': 'amber', 'Cotizado': 'blue', 'Adjudicado': 'green', 'Rechazado': 'red' };
  const PRIORITY = ['Obligatorio', 'Deseable'];
  const COMPLIANCE = ['Sin evaluar', 'Cumple', 'Parcial', 'No cumple'];
  const COMPLIANCE_SCORE = { 'Cumple': 1, 'Parcial': 0.5, 'No cumple': 0, 'Sin evaluar': 0 };
  const COMPLIANCE_CLASS = { 'Cumple': 'cmp-cumple', 'Parcial': 'cmp-parcial', 'No cumple': 'cmp-no', 'Sin evaluar': '' };
  const RESPONSIBLES = ['Proveedor', 'Planta', 'Proveedor + planta', 'Laboratorio', 'Director técnico', 'Comitente'];
  const MILESTONE_STATUS = ['A definir', 'Definido', 'A validar', 'Programado', 'Cumplido', 'Incumplido'];
  const MILESTONE_BADGE = { 'A definir': 'blue', 'Definido': 'green', 'A validar': 'amber', 'Programado': 'blue', 'Cumplido': 'green', 'Incumplido': 'red' };
  const DEFAULT_TERMS = { warrantyMonths: 24, warrantyScope: 'Incluye repuestos y viáticos', retentionPct: 10, retentionRelease: 'Hasta aceptación definitiva', penaltyWeeklyPct: 0.5, penaltyCapPct: 10 };
  const options = (list, selected) => list.map(o => `<option ${o === selected ? 'selected' : ''}>${esc(o)}</option>`).join('');

  const state = { blocks: [], milestones: [], terms: { ...DEFAULT_TERMS }, suppliers: [] };
  function load(data) {
    if (!data) return;
    if (Array.isArray(data.tenderBlocks)) state.blocks = data.tenderBlocks;
    if (Array.isArray(data.tenderMilestones)) state.milestones = data.tenderMilestones;
    state.terms = { ...DEFAULT_TERMS, ...(data.settings?.tenderTerms || {}) };
    // Proveedores sugeridos: los ya cotizados y los de egresos en Finanzas
    state.suppliers = [...new Set([...state.blocks.map(b => b.supplier), ...(data.transactions || []).filter(t => t.type === 'Egreso').map(t => t.counterparty)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    render();
  }

  /* ---------- cálculos ---------- */
  // Obligatorio pesa el doble que Deseable; Parcial suma la mitad; Sin evaluar queda por validar
  function compliance(items) {
    const list = items || [];
    const weight = x => (x.priority === 'Obligatorio' ? 2 : 1);
    const total = list.reduce((s, x) => s + weight(x), 0);
    return {
      count: list.length,
      pct: total ? list.reduce((s, x) => s + weight(x) * (COMPLIANCE_SCORE[x.compliance] || 0), 0) / total * 100 : null,
      pending: list.filter(x => x.compliance === 'Sin evaluar').length,
      blocking: list.filter(x => x.priority === 'Obligatorio' && x.compliance === 'No cumple').length,
      ok: list.filter(x => x.compliance === 'Cumple').length
    };
  }
  const active = () => state.blocks.filter(b => b.status !== 'Rechazado');
  const complianceColor = pct => (pct === null ? 'var(--text-dim)' : pct >= 90 ? 'var(--ok)' : pct >= 60 ? 'var(--orange)' : 'var(--red)');
  function amountHtml(block) {
    const amount = Number(block.quoteAmount) || 0;
    if (!amount) return 'Sin cotizar';
    if (block.currency === 'ARS') return money(amount);
    const rate = fxRate();
    return `${usdMoney(amount)}${rate ? `<small>≈ ${money(amount * rate)}</small>` : ''}`;
  }

  /* ---------- render ---------- */
  function renderMetrics() {
    const blocks = active().filter(b => Number(b.quoteAmount) > 0), rate = fxRate();
    const usd = blocks.filter(b => b.currency !== 'ARS').reduce((s, b) => s + Number(b.quoteAmount), 0);
    const ars = blocks.filter(b => b.currency === 'ARS').reduce((s, b) => s + Number(b.quoteAmount), 0);
    if (!blocks.length) { el('tdCapex').textContent = 'USD 0'; el('tdCapexFoot').textContent = 'Sin cotizaciones cargadas'; }
    else if (rate) {
      const totalUsd = usd + ars / rate;
      el('tdCapex').textContent = usdMoney(totalUsd);
      el('tdCapexFoot').textContent = `≈ ${money(totalUsd * rate)} al MEP · ${blocks.length} bloque${blocks.length === 1 ? '' : 's'} cotizado${blocks.length === 1 ? '' : 's'}`;
    } else {
      el('tdCapex').textContent = usdMoney(usd);
      el('tdCapexFoot').textContent = ars ? `+ ${money(ars)} en pesos (sin MEP para sumar)` : 'Sin MEP para pasar a pesos';
    }
    const c = compliance(active().flatMap(b => b.items || []));
    el('tdCompliance').textContent = c.pct === null ? '—' : `${num(c.pct, 0)}%`;
    const foot = el('tdComplianceFoot');
    foot.textContent = c.count ? `${c.pending} ítem${c.pending === 1 ? '' : 's'} por validar${c.blocking ? ` · ${c.blocking} obligatorio${c.blocking === 1 ? '' : 's'} sin cumplir` : ''}` : 'Sin ítems cargados';
    foot.className = `metric-foot ${c.blocking ? 'negative' : c.pending ? 'warning' : 'positive'}`;
    const t = state.terms;
    el('tdWarranty').textContent = `${num(t.warrantyMonths)} meses`;
    el('tdWarrantyFoot').textContent = t.warrantyScope || '';
    el('tdRetention').textContent = `${num(t.retentionPct, 1)}%`;
    el('tdRetentionFoot').textContent = `${t.retentionRelease} · multa ${num(t.penaltyWeeklyPct, 1)}% semanal, tope ${num(t.penaltyCapPct, 1)}%`;
  }
  function renderBlocks() {
    const cat = el('tdFilterCategory').value, st = el('tdFilterStatus').value;
    const list = [...state.blocks].sort((a, b) => (a.order || 0) - (b.order || 0) || a.code.localeCompare(b.code, 'es'))
      .filter(b => (!cat || b.category === cat) && (!st || b.status === st));
    el('tdCount').textContent = `${list.length} de ${state.blocks.length} bloques`;
    el('tdBlocks').innerHTML = list.length ? list.map(b => {
      const c = compliance(b.items);
      const note = c.pct === null ? 'Sin ítems cargados' : `Cumplimiento ${num(c.pct, 0)}% · ${c.ok}/${c.count} ítems cumplen${c.pending ? ` · ${c.pending} por validar` : ''}${c.blocking ? ` · <span class="negative">${c.blocking} obligatorio${c.blocking === 1 ? '' : 's'} sin cumplir</span>` : ''}`;
      const terms = [b.deliveryWeeks ? `${num(b.deliveryWeeks)} sem.` : '', b.warrantyMonths ? `${num(b.warrantyMonths)} meses de garantía` : ''].filter(Boolean).join(' · ') || '—';
      return `<article class="doc-card tender-card${b.status === 'Rechazado' ? ' rejected' : ''}">
        <div class="tender-card-head"><span class="doc-code">${esc(b.code)}</span><span class="badge ${STATUS_BADGE[b.status] || 'blue'}">${esc(b.status)}</span></div>
        <h3>${esc(b.title)}${pendingTag(b)}</h3><small class="text-muted">${esc(b.category)}</small>
        <p>${esc(b.specification)}</p>
        <div class="tender-meta"><span>Proveedor</span><b>${esc(b.supplier) || 'Sin asignar'}</b><span>Cotización</span><b>${amountHtml(b)}</b><span>Plazo y garantía</span><b>${esc(terms)}</b></div>
        <div class="track"><span style="width:${c.pct || 0}%;background:${complianceColor(c.pct)}"></span></div><span class="compliance-note">${note}</span>
        <div class="row-actions"><button class="ghost-btn" data-td-edit="${esc(b.id)}">Evaluar y editar</button><button class="danger-btn" data-td-delete="${esc(b.id)}" aria-label="Eliminar bloque ${esc(b.code)}">×</button></div>
      </article>`;
    }).join('') : '<p class="text-muted">No hay bloques para el filtro elegido.</p>';
  }
  function renderMilestones() {
    const list = [...state.milestones].sort((a, b) => (a.order || 0) - (b.order || 0));
    el('tdMilestones').innerHTML = list.length ? list.map(m => `<tr><td><b>${esc(m.name)}</b>${pendingTag(m)}</td><td style="white-space:normal">${esc(m.criterion) || '—'}</td><td style="white-space:normal">${esc(m.guarantee) || '—'}</td><td>${fmtDate(m.dueDate)}</td>
      <td><select class="ms-change" data-field="responsible" data-ms-id="${esc(m.id)}">${options(RESPONSIBLES, m.responsible)}</select></td>
      <td><select class="ms-change ms-status-${MILESTONE_BADGE[m.status] || 'blue'}" data-field="status" data-ms-id="${esc(m.id)}">${options(MILESTONE_STATUS, m.status)}</select></td>
      <td><div class="row-actions"><button class="ghost-btn" data-ms-edit="${esc(m.id)}">Editar</button><button class="danger-btn" data-ms-delete="${esc(m.id)}" aria-label="Eliminar hito">×</button></div></td></tr>`).join('') : '<tr><td colspan="7">Sin hitos cargados</td></tr>';
  }
  function render() { renderMetrics(); renderBlocks(); renderMilestones(); }

  /* ---------- filtros ---------- */
  el('tdFilterCategory').insertAdjacentHTML('beforeend', options(CATEGORIES));
  el('tdFilterStatus').insertAdjacentHTML('beforeend', options(STATUS));
  el('tdFilterCategory').addEventListener('change', renderBlocks);
  el('tdFilterStatus').addEventListener('change', renderBlocks);

  /* ---------- bloque: alta, edición y evaluación de ítems ---------- */
  el('tbCategory').innerHTML = options(CATEGORIES);
  el('tbStatus').innerHTML = options(STATUS);
  let editingBlock = null;
  function itemRow(item) {
    return `<tr data-item-id="${esc(item.id)}"><td><input class="it-text" value="${esc(item.text)}" maxlength="255" required placeholder="Requisito técnico o contractual"></td>
      <td><select class="it-priority">${options(PRIORITY, item.priority)}</select></td>
      <td><select class="it-compliance ${COMPLIANCE_CLASS[item.compliance] || ''}">${options(COMPLIANCE, item.compliance)}</select></td>
      <td><input class="it-notes" value="${esc(item.notes)}" maxlength="255" placeholder="Observación"></td>
      <td><button type="button" class="danger-btn it-remove" aria-label="Quitar ítem">×</button></td></tr>`;
  }
  function readItems() {
    return [...el('tbItems').querySelectorAll('tr[data-item-id]')].map(row => ({
      id: row.dataset.itemId, text: row.querySelector('.it-text').value.trim(), priority: row.querySelector('.it-priority').value,
      compliance: row.querySelector('.it-compliance').value, notes: row.querySelector('.it-notes').value.trim()
    }));
  }
  function refreshItemsSummary() {
    const c = compliance(readItems());
    el('tbItemsSummary').textContent = c.count ? `${c.count} ítem${c.count === 1 ? '' : 's'} · cumplimiento ${num(c.pct, 0)}%${c.blocking ? ` · ${c.blocking} obligatorio${c.blocking === 1 ? '' : 's'} sin cumplir` : ''}` : 'Sin ítems';
  }
  function nextCode() {
    const letters = state.blocks.map(b => (b.code.match(/^BLOQUE ([A-Z])$/) || [])[1]).filter(Boolean).sort();
    const last = letters.pop();
    return `BLOQUE ${last ? String.fromCharCode(Math.min(last.charCodeAt(0) + 1, 90)) : 'A'}`;
  }
  function openBlock(block) {
    editingBlock = block || null;
    el('tenderBlockTitle').textContent = block ? `${block.code} · ${block.title}` : 'Nuevo bloque';
    el('tbCode').value = block ? block.code : nextCode();
    el('tbTitle').value = block ? block.title : '';
    el('tbCategory').value = block ? block.category : 'Otros';
    el('tbSpec').value = block ? block.specification : '';
    el('tbSupplier').value = block ? block.supplier : '';
    el('tbSuppliers').innerHTML = state.suppliers.map(s => `<option value="${esc(s)}">`).join('');
    el('tbStatus').value = block ? block.status : 'Borrador';
    el('tbCurrency').value = block ? block.currency || 'USD' : 'USD';
    el('tbAmount').value = block ? block.quoteAmount : 0;
    el('tbDelivery').value = block ? block.deliveryWeeks : 0;
    el('tbWarranty').value = block ? block.warrantyMonths : 0;
    el('tbItems').innerHTML = (block ? block.items : []).map(itemRow).join('');
    if (!block) el('tbItems').innerHTML = itemRow({ id: uid('ITM'), text: '', priority: 'Obligatorio', compliance: 'Sin evaluar', notes: '' });
    refreshItemsSummary();
    el('tenderBlockDialog').showModal();
    setTimeout(() => (block ? el('tbItems').querySelector('.it-compliance') || el('tbTitle') : el('tbTitle')).focus(), 50);
  }
  el('newTenderBlock').addEventListener('click', () => openBlock(null));
  el('tbAddItem').addEventListener('click', () => {
    el('tbItems').insertAdjacentHTML('beforeend', itemRow({ id: uid('ITM'), text: '', priority: 'Obligatorio', compliance: 'Sin evaluar', notes: '' }));
    el('tbItems').lastElementChild.querySelector('.it-text').focus();
    refreshItemsSummary();
  });
  el('tbItems').addEventListener('click', event => { if (event.target.closest('.it-remove')) { event.target.closest('tr').remove(); refreshItemsSummary(); } });
  el('tbItems').addEventListener('change', event => {
    const select = event.target.closest('.it-compliance');
    if (select) select.className = `it-compliance ${COMPLIANCE_CLASS[select.value] || ''}`;
    refreshItemsSummary();
  });
  el('tenderBlockForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter; if (submit) submit.disabled = true;
    try {
      const draft = {
        id: editingBlock ? editingBlock.id : uid('BLK'), code: el('tbCode').value.trim(), title: el('tbTitle').value.trim(), category: el('tbCategory').value,
        specification: el('tbSpec').value.trim(), supplier: el('tbSupplier').value.trim(), status: el('tbStatus').value, currency: el('tbCurrency').value,
        quoteAmount: Number(el('tbAmount').value) || 0, deliveryWeeks: Number(el('tbDelivery').value) || 0, warrantyMonths: Number(el('tbWarranty').value) || 0,
        items: readItems().filter(x => x.text), order: editingBlock ? editingBlock.order : Math.max(0, ...state.blocks.map(b => b.order || 0)) + 1
      };
      if (state.blocks.some(b => b.code.toLowerCase() === draft.code.toLowerCase() && b.id !== draft.id)) throw new Error(`Ya existe un bloque con el código ${draft.code}`);
      const result = editingBlock
        ? await api(`/api/tender-blocks/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: JSON.stringify(draft) })
        : await api('/api/tender-blocks', { method: 'POST', body: JSON.stringify(draft) });
      const saved = { ...draft, ...result, _pending: !!result.offline };
      const index = state.blocks.findIndex(b => b.id === draft.id);
      if (index >= 0) state.blocks[index] = saved; else state.blocks.push(saved);
      if (draft.supplier && !state.suppliers.includes(draft.supplier)) state.suppliers.push(draft.supplier);
      render();
      el('tenderBlockDialog').close();
      savedMessage(result, editingBlock ? 'Bloque actualizado' : 'Bloque agregado al pliego');
    } catch (error) { toast(error.message); } finally { if (submit) submit.disabled = false; }
  });
  el('tdBlocks').addEventListener('click', async event => {
    const edit = event.target.closest('[data-td-edit]'), del = event.target.closest('[data-td-delete]');
    if (edit) return openBlock(state.blocks.find(b => b.id === edit.dataset.tdEdit));
    if (!del) return;
    const block = state.blocks.find(b => b.id === del.dataset.tdDelete);
    if (!block || !confirm(`¿Eliminar ${block.code} · ${block.title} y sus ${block.items?.length || 0} ítems?`)) return;
    del.disabled = true;
    try {
      const result = await api(`/api/tender-blocks/${encodeURIComponent(block.id)}`, { method: 'DELETE' });
      state.blocks = state.blocks.filter(b => b.id !== block.id);
      render();
      savedMessage(result, 'Bloque eliminado');
    } catch (error) { toast(error.message); del.disabled = false; }
  });

  /* ---------- hitos ---------- */
  el('msResponsible').innerHTML = options(RESPONSIBLES);
  el('msStatus').innerHTML = options(MILESTONE_STATUS);
  let editingMilestone = null;
  function openMilestone(m) {
    editingMilestone = m || null;
    el('milestoneTitle').textContent = m ? `Editar hito · ${m.name}` : 'Nuevo hito';
    el('msName').value = m ? m.name : ''; el('msDate').value = m ? m.dueDate : '';
    el('msCriterion').value = m ? m.criterion : ''; el('msGuarantee').value = m ? m.guarantee : '';
    el('msResponsible').value = m ? m.responsible : 'Proveedor'; el('msStatus').value = m ? m.status : 'A definir';
    el('milestoneDialog').showModal(); setTimeout(() => el('msName').focus(), 50);
  }
  document.querySelectorAll('.open-milestone').forEach(b => b.addEventListener('click', () => openMilestone(null)));
  async function saveMilestone(draft, isNew) {
    const result = isNew
      ? await api('/api/tender-milestones', { method: 'POST', body: JSON.stringify(draft) })
      : await api(`/api/tender-milestones/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: JSON.stringify(draft) });
    const saved = { ...draft, ...result, _pending: !!result.offline };
    const index = state.milestones.findIndex(m => m.id === draft.id);
    if (index >= 0) state.milestones[index] = saved; else state.milestones.push(saved);
    return result;
  }
  el('milestoneForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter; if (submit) submit.disabled = true;
    try {
      const draft = { id: editingMilestone ? editingMilestone.id : uid('HIT'), name: el('msName').value.trim(), dueDate: el('msDate').value, criterion: el('msCriterion').value.trim(),
        guarantee: el('msGuarantee').value.trim(), responsible: el('msResponsible').value, status: el('msStatus').value,
        order: editingMilestone ? editingMilestone.order : Math.max(0, ...state.milestones.map(m => m.order || 0)) + 1 };
      const result = await saveMilestone(draft, !editingMilestone);
      renderMilestones();
      el('milestoneDialog').close();
      savedMessage(result, editingMilestone ? 'Hito actualizado' : 'Hito agregado');
    } catch (error) { toast(error.message); } finally { if (submit) submit.disabled = false; }
  });
  el('tdMilestones').addEventListener('change', async event => {
    const select = event.target.closest('.ms-change');
    if (!select) return;
    const m = state.milestones.find(x => x.id === select.dataset.msId);
    if (!m) return;
    select.disabled = true;
    try {
      const result = await saveMilestone({ ...m, [select.dataset.field]: select.value }, false);
      renderMilestones();
      savedMessage(result, 'Hito actualizado');
    } catch (error) { toast(error.message); renderMilestones(); }
  });
  el('tdMilestones').addEventListener('click', async event => {
    const edit = event.target.closest('[data-ms-edit]'), del = event.target.closest('[data-ms-delete]');
    if (edit) return openMilestone(state.milestones.find(m => m.id === edit.dataset.msEdit));
    if (!del) return;
    const m = state.milestones.find(x => x.id === del.dataset.msDelete);
    if (!m || !confirm(`¿Eliminar el hito "${m.name}"?`)) return;
    try {
      const result = await api(`/api/tender-milestones/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      state.milestones = state.milestones.filter(x => x.id !== m.id);
      renderMilestones();
      savedMessage(result, 'Hito eliminado');
    } catch (error) { toast(error.message); }
  });

  /* ---------- condiciones generales ---------- */
  el('editTenderTerms').addEventListener('click', () => {
    const t = state.terms;
    el('ttWarranty').value = t.warrantyMonths; el('ttScope').value = t.warrantyScope; el('ttRetention').value = t.retentionPct;
    el('ttRelease').value = t.retentionRelease; el('ttPenalty').value = t.penaltyWeeklyPct; el('ttPenaltyCap').value = t.penaltyCapPct;
    el('tenderTermsDialog').showModal();
  });
  el('tenderTermsForm').addEventListener('submit', async event => {
    event.preventDefault();
    const value = { warrantyMonths: Number(el('ttWarranty').value), warrantyScope: el('ttScope').value.trim(), retentionPct: Number(el('ttRetention').value),
      retentionRelease: el('ttRelease').value, penaltyWeeklyPct: Number(el('ttPenalty').value), penaltyCapPct: Number(el('ttPenaltyCap').value) };
    try {
      const result = await api('/api/settings/tenderTerms', { method: 'PUT', body: JSON.stringify({ value }) });
      state.terms = value;
      renderMetrics();
      el('tenderTermsDialog').close();
      savedMessage(result, 'Condiciones generales guardadas');
    } catch (error) { toast(error.message); }
  });

  document.addEventListener('pbp:bootstrap', event => load(event.detail));
  // La cotización del MEP llega después: refrescar los importes en dólares
  document.addEventListener('pbp:fx', render);
  if (window.pbpData) load(window.pbpData); else render();
})();
