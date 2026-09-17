(function () {
  'use strict';

  const appName = document.title.includes('Tambo') ? 'tambo'
    : document.title.includes('Porcinos') ? 'porcinos'
      : document.title.includes('Ganader') ? 'ganaderia' : 'agro';
  const storageKey = `pampa_fiscal_normativa_${appName}`;

  function readStore() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return {
        proposals: Array.isArray(stored.proposals) ? stored.proposals : [],
        ledger: Array.isArray(stored.ledger) ? stored.ledger : [],
      };
    } catch {
      return { proposals: [], ledger: [] };
    }
  }

  function writeStore(store) {
    localStorage.setItem(storageKey, JSON.stringify(store));
  }

  function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `norma-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function getTarget() {
    return document.querySelector('#mod-fiscal, #mod-arca, #arca, #fiscal');
  }

  function statusLabel(status) {
    return { PROPUESTA: 'Pendiente de aprobación', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada' }[status] || status;
  }

  function render() {
    const host = document.getElementById('pampaNormativeList');
    if (!host) return;
    const store = readStore();
    const rows = store.proposals.slice().reverse();
    host.innerHTML = rows.length ? rows.map((proposal) => `
      <tr>
        <td>${escapeHtml(proposal.norma)}</td>
        <td>${escapeHtml(proposal.parametro)}</td>
        <td>${escapeHtml(proposal.valorAnterior)} → <strong>${escapeHtml(proposal.valorNuevo)}</strong></td>
        <td>${escapeHtml(proposal.vigenciaDesde)}</td>
        <td>${escapeHtml(statusLabel(proposal.estado))}</td>
        <td>${proposal.estado === 'PROPUESTA' ? `<button type="button" class="btn" data-approve="${proposal.id}">Aprobar</button> <button type="button" class="btn" data-reject="${proposal.id}">Rechazar</button>` : escapeHtml(proposal.resueltoPor || '-')}</td>
      </tr>`).join('') : '<tr><td colspan="6">No hay cambios normativos propuestos.</td></tr>';

    host.querySelectorAll('[data-approve]').forEach((button) => button.addEventListener('click', () => resolveProposal(button.dataset.approve, 'APROBADA')));
    host.querySelectorAll('[data-reject]').forEach((button) => button.addEventListener('click', () => resolveProposal(button.dataset.reject, 'RECHAZADA')));
  }

  function resolveProposal(id, status) {
    const store = readStore();
    const proposal = store.proposals.find((item) => item.id === id);
    if (!proposal || proposal.estado !== 'PROPUESTA') return;
    const reason = status === 'RECHAZADA' ? prompt('Motivo del rechazo:') : '';
    if (status === 'RECHAZADA' && !reason) return;
    proposal.estado = status;
    proposal.resueltoEn = new Date().toISOString();
    proposal.resueltoPor = 'Administrador local';
    proposal.motivoRechazo = reason || '';
    store.ledger.push({ id: makeId(), fecha: proposal.resueltoEn, accion: status === 'APROBADA' ? 'APROBAR' : 'RECHAZAR', propuestaId: id, snapshot: { ...proposal } });
    writeStore(store);
    render();
  }

  function createProposal(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const required = ['norma', 'parametro', 'valorNuevo', 'vigenciaDesde', 'fuente'];
    if (required.some((key) => !String(data.get(key) || '').trim())) {
      alert('Completá norma, parámetro, valor nuevo, vigencia y fuente oficial.');
      return;
    }
    try {
      const source = new URL(data.get('fuente'));
      if (!/^https?:$/.test(source.protocol)) throw new Error('URL inválida');
    } catch {
      alert('Ingresá una URL oficial válida para la fuente normativa.');
      return;
    }
    const store = readStore();
    const createdAt = new Date().toISOString();
    const proposal = {
      id: makeId(),
      norma: data.get('norma').trim(),
      articulo: data.get('articulo').trim(),
      parametro: data.get('parametro').trim(),
      valorAnterior: data.get('valorAnterior').trim(),
      valorNuevo: data.get('valorNuevo').trim(),
      vigenciaDesde: data.get('vigenciaDesde'),
      vigenciaHasta: data.get('vigenciaHasta'),
      fuente: data.get('fuente').trim(),
      motivo: data.get('motivo').trim(),
      estado: 'PROPUESTA',
      propuestoPor: 'Usuario local',
      propuestoEn: createdAt,
    };
    store.proposals.push(proposal);
    store.ledger.push({ id: makeId(), fecha: createdAt, accion: 'PROPONER', propuestaId: proposal.id, snapshot: { ...proposal } });
    writeStore(store);
    form.reset();
    render();
  }

  function activeRules(date = new Date().toISOString().slice(0, 10)) {
    return readStore().proposals.filter((item) => item.estado === 'APROBADA'
      && item.vigenciaDesde <= date && (!item.vigenciaHasta || item.vigenciaHasta >= date))
      .map((item) => ({ norma: item.norma, articulo: item.articulo, parametro: item.parametro, valor: item.valorNuevo, vigenciaDesde: item.vigenciaDesde, fuente: item.fuente }));
  }

  function attach() {
    const target = getTarget();
    if (!target || document.getElementById('pampaNormativeCard')) return;
    const card = document.createElement('section');
    card.id = 'pampaNormativeCard';
    card.className = 'card';
    card.style.marginTop = '16px';
    card.innerHTML = `
      <div class="card-header"><div class="card-title">Parámetros fiscales y cambios normativos</div></div>
      <p class="text-muted">Registro normativo auditado: las propuestas requieren aprobación. La aprobación conserva el parámetro y su vigencia; la aplicación automática a cálculos exige integrar el adaptador fiscal de cada jurisdicción.</p>
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
      <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Norma</th><th>Parámetro</th><th>Cambio</th><th>Vigencia</th><th>Estado</th><th>Acción</th></tr></thead><tbody id="pampaNormativeList"></tbody></table></div>`;
    target.appendChild(card);
    card.querySelector('#pampaNormativeForm').addEventListener('submit', createProposal);
    render();
  }

  window.PampaFiscalNormativa = {
    attach,
    activeRules,
    snapshot(date) { return { fecha: date || new Date().toISOString().slice(0, 10), reglas: activeRules(date), ledgerVersion: readStore().ledger.length }; },
    listProposals() { return readStore().proposals; },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
}());