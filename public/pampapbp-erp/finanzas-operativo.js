/* Pampa PBP - Finanzas · submódulo 2 · Operativo
 * Caja y bancos, cuentas bancarias, cheques (por cobrar y por cubrir), créditos con cuotas,
 * canje de granos, flujo proyectado y homebanking, como en PampaAgro, Ganadería, Tambo y Porcinos.
 * Usa helpers del script principal (api, toast, escapeHTML, money, usdMoney, fxRate, num) y
 * window.pbpAccountBalances de gestion-modules.js para que Tesorería y Operativo muestren el mismo saldo.
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = v => escapeHTML(v ?? '');
  const pesos = n => money(Number(n) || 0);
  const todayISO = () => new Date().toLocaleDateString('sv-SE');
  const monthOf = d => String(d || '').slice(0, 7);
  const fmtDate = iso => (iso ? iso.split('-').reverse().join('/') : '—');
  const uid = prefix => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const daysUntil = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
  const addMonthsISO = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const last = new Date(y, m - 1 + n + 1, 0).getDate(); const t = new Date(y, m - 1 + n, Math.min(d, last)); return t.toLocaleDateString('sv-SE'); };
  const periodLabel = p => { const [y, m] = p.split('-').map(Number); return new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' }).format(new Date(y, m - 1, 1)); };
  const savedMessage = (result, ok) => toast(result && result.offline ? 'Guardado sin conexión: se sincroniza al volver la señal' : ok);
  const pendingTag = item => (item && item._pending ? '<span class="pending-tag">sin sincronizar</span>' : '');
  const options = (list, selected) => list.map(o => (Array.isArray(o) ? o : [o, o])).map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');

  // Listas desplegables (las mismas que valida el servidor)
  const BANKS = ['Banco de la Nación Argentina', 'Banco de la Provincia de Buenos Aires', 'Banco Galicia', 'Banco Santander', 'BBVA', 'Banco Macro', 'Banco Credicoop', 'ICBC', 'Banco Ciudad', 'Banco de Santa Fe', 'Bancor (Córdoba)', 'Banco Patagonia', 'Banco Supervielle', 'Banco Comafi', 'Banco Hipotecario', 'Banco de Entre Ríos', 'Banco de La Pampa', 'Mercado Pago', 'Otro'];
  // Sitio oficial de cada banco como punto de partida; se puede editar en la cuenta
  const BANK_SITES = { 'Banco de la Nación Argentina': 'https://www.bna.com.ar/', 'Banco de la Provincia de Buenos Aires': 'https://www.bancoprovincia.com.ar/', 'Banco Galicia': 'https://www.galicia.ar/', 'Banco Santander': 'https://www.santander.com.ar/', 'BBVA': 'https://www.bbva.com.ar/', 'Banco Macro': 'https://www.macro.com.ar/', 'Banco Credicoop': 'https://www.bancocredicoop.coop/', 'ICBC': 'https://www.icbc.com.ar/', 'Banco Ciudad': 'https://www.bancociudad.com.ar/', 'Banco de Santa Fe': 'https://www.bancosantafe.com.ar/', 'Bancor (Córdoba)': 'https://www.bancor.com.ar/', 'Banco Patagonia': 'https://www.bancopatagonia.com.ar/', 'Banco Supervielle': 'https://www.supervielle.com.ar/', 'Banco Comafi': 'https://www.comafi.com.ar/', 'Banco Hipotecario': 'https://www.hipotecario.com.ar/', 'Banco de Entre Ríos': 'https://www.bancoentrerios.com.ar/', 'Banco de La Pampa': 'https://www.blp.com.ar/', 'Mercado Pago': 'https://www.mercadopago.com.ar/' };
  const MOVEMENT_CATEGORIES = ['Depósito', 'Extracción', 'Transferencia entre cuentas', 'Gastos bancarios', 'Impuesto a los débitos y créditos', 'Intereses', 'Cuota de crédito', 'Depósito de cheque', 'Pago con cheque', 'Gastos menores', 'Ajuste', 'Otros'];
  const METHODS = ['Efectivo', 'Transferencia', 'Cheque', 'eCheq', 'Débito automático', 'Tarjeta', 'Otro'];
  const CHEQUE_STATUS = { Recibido: ['En cartera', 'Depositado', 'Cobrado', 'Endosado', 'Rechazado'], Emitido: ['Emitido', 'Entregado', 'Debitado', 'Anulado', 'Rechazado'] };
  const CHEQUE_BADGE = { 'En cartera': 'blue', 'Depositado': 'amber', 'Cobrado': 'green', 'Endosado': 'blue', 'Rechazado': 'red', 'Emitido': 'blue', 'Entregado': 'amber', 'Debitado': 'green', 'Anulado': 'red' };
  const CREDIT_ENTITIES = [...BANKS.filter(b => b !== 'Otro'), 'Proveedor', 'Cooperativa', 'Sociedad de garantía recíproca', 'Otro'];
  const CREDIT_PURPOSES = ['Capital de trabajo', 'Compra de equipos', 'Obra civil', 'Compra de granos', 'Leasing', 'Prefinanciación', 'Otro'];
  const GRAINS = ['Maíz', 'Soja', 'Sorgo', 'Trigo', 'Girasol', 'Otro'];
  const SWAP_KINDS = ['Insumo recibido', 'Grano entregado', 'Ajuste a favor', 'Ajuste en contra'];

  const COLLECTIONS = { bankAccounts: '/api/bank-accounts', finMovements: '/api/fin-movements', cheques: '/api/cheques', credits: '/api/credits', swapContracts: '/api/swap-contracts', swapMovements: '/api/swap-movements' };
  const KEYS = [...Object.keys(COLLECTIONS), 'transactions', 'employees'];
  const state = { selectedCredit: null, selectedSwap: null };
  KEYS.forEach(k => { state[k] = []; });
  state.settings = {};

  function load(data) {
    if (!data) return;
    // Mismos arreglos que window.pbpData: los cambios se ven en Tesorería sin recargar
    for (const k of KEYS) { if (!Array.isArray(data[k])) data[k] = []; state[k] = data[k]; }
    state.settings = data.settings || {};
    render();
  }
  const refreshAll = () => { if (window.pbpData) document.dispatchEvent(new CustomEvent('pbp:bootstrap', { detail: window.pbpData })); else render(); };
  const balances = () => window.pbpAccountBalances({ ...state });
  const accountById = id => balances().list.find(a => a.id === id);
  const accountLabel = id => { const a = accountById(id); return a ? (a.id === 'CAJA' ? 'Caja' : `${a.bank}${a.number ? ` · ${a.number}` : ''}${a.currency === 'USD' ? ' (USD)' : ''}`) : '—'; };
  const amountIn = (currency, n) => (currency === 'USD' ? usdMoney(n) : pesos(n));
  const accountOptions = (includeCash, onlyArs) => balances().list.filter(a => a.status === 'Activa' && (includeCash || a.id !== 'CAJA') && (!onlyArs || a.currency !== 'USD')).map(a => [a.id, accountLabel(a.id)]);

  /* ---------- guardar en el servidor (y en la cola sin conexión) ---------- */
  async function saveRecord(key, draft, isNew) {
    const path = COLLECTIONS[key];
    const result = isNew ? await api(path, { method: 'POST', body: JSON.stringify(draft) }) : await api(`${path}/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: JSON.stringify(draft) });
    const saved = { ...draft, ...result, _pending: !!result.offline };
    delete saved.offline;
    const list = state[key], index = list.findIndex(x => x.id === draft.id);
    if (index >= 0) list[index] = saved; else list.push(saved);
    return result;
  }
  async function removeRecord(key, id) {
    const result = await api(`${COLLECTIONS[key]}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const list = state[key], index = list.findIndex(x => x.id === id);
    if (index >= 0) list.splice(index, 1);
    return result;
  }
  async function updateTransaction(tx, changes) {
    const result = await api(`/api/transactions/${encodeURIComponent(tx.id)}`, { method: 'PUT', body: JSON.stringify(changes) });
    Object.assign(tx, changes, { _pending: !!result.offline });
    return result;
  }

  /* ---------- submódulos (Tesorería / Operativo) y secciones ---------- */
  function showSubtab(name) {
    document.querySelectorAll('#page-treasury .subtab').forEach(b => b.classList.toggle('active', b.dataset.subtab === name));
    document.querySelectorAll('#page-treasury .subpage').forEach(p => p.classList.toggle('active', p.dataset.subpage === name));
    document.querySelectorAll('#page-treasury [data-subtab-only]').forEach(x => { x.hidden = x.dataset.subtabOnly !== name; });
    try { localStorage.setItem('pbp:finanzas-subtab', name); } catch {}
    if (name === 'operativo' && typeof render === 'function' && state.transactions) render();
  }
  document.querySelectorAll('#page-treasury .subtab').forEach(b => b.addEventListener('click', () => showSubtab(b.dataset.subtab)));
  function showSection(name) {
    document.querySelectorAll('#opNav .pill').forEach(b => b.classList.toggle('active', b.dataset.op === name));
    document.querySelectorAll('.op-section').forEach(s => s.classList.toggle('active', s.dataset.opSection === name));
    try { localStorage.setItem('pbp:operativo-section', name); } catch {}
  }
  el('opNav').addEventListener('click', e => { const b = e.target.closest('.pill'); if (b) showSection(b.dataset.op); });
  try { showSubtab(localStorage.getItem('pbp:finanzas-subtab') || 'tesoreria'); showSection(localStorage.getItem('pbp:operativo-section') || 'ledger'); } catch { showSubtab('tesoreria'); }

  /* ---------- cálculos de créditos ---------- */
  function schedule(credit) {
    const P = Number(credit.amount) || 0, n = Number(credit.termMonths) || 0, i = Math.pow(1 + (Number(credit.tea) || 0) / 100, 1 / 12) - 1;
    const rows = []; let balance = P;
    const french = i > 0 ? P * i / (1 - Math.pow(1 + i, -n)) : P / n;
    for (let k = 1; k <= n; k++) {
      const interest = balance * i;
      const capital = credit.system === 'Alemán' ? P / n : french - interest;
      balance = Math.max(0, balance - capital);
      rows.push({ n: k, date: addMonthsISO(credit.startDate, k), payment: capital + interest, capital, interest, balance });
    }
    return rows;
  }
  window.pbpCreditStatus = credit => creditStatus(credit);
  function creditStatus(credit) {
    const rows = schedule(credit), paid = Number(credit.paidInstallments) || 0;
    return { rows, paid, next: rows[paid] || null, balance: paid ? rows[paid - 1].balance : Number(credit.amount) || 0, interestTotal: rows.reduce((s, r) => s + r.interest, 0) };
  }

  /* ---------- canje: cuenta corriente ---------- */
  function swapEntry(m, contract) {
    const price = Number(contract?.refPrice) || 0;
    if (m.kind === 'Insumo recibido') return { debit: m.netAmount * (1 + (Number(m.vatRate) || 0) / 100), credit: 0 };
    if (m.kind === 'Grano entregado') return { debit: 0, credit: (Number(m.kilos) || 0) / 1000 * price };
    if (m.kind === 'Ajuste en contra') return { debit: Number(m.netAmount) || 0, credit: 0 };
    return { debit: 0, credit: Number(m.netAmount) || 0 };
  }
  function swapSummary(contract) {
    const moves = state.swapMovements.filter(m => m.contractId === contract.id);
    const debit = moves.reduce((s, m) => s + swapEntry(m, contract).debit, 0), credit = moves.reduce((s, m) => s + swapEntry(m, contract).credit, 0);
    const deliveredTons = moves.reduce((s, m) => s + (Number(m.kilos) || 0), 0) / 1000;
    const balance = debit - credit;
    return { moves, debit, credit, balance, deliveredTons, pendingKg: contract.refPrice ? balance / contract.refPrice * 1000 : 0 };
  }

  /* ---------- render ---------- */
  function renderKpis() {
    const b = balances();
    el('opCash').textContent = pesos(b.cash);
    el('opBanks').textContent = pesos(b.banksArs);
    const usd = b.list.filter(a => a.currency === 'USD' && a.status === 'Activa');
    el('opBanksFoot').textContent = `${b.list.filter(a => a.id !== 'CAJA' && a.status === 'Activa').length} cuentas activas${usd.length ? ` · incluye ${usdMoney(usd.reduce((s, a) => s + a.balance, 0))}${fxRate() ? ' al MEP' : ' (sin MEP)'}` : ''}`;
    const inWallet = state.cheques.filter(c => c.direction === 'Recibido' && ['En cartera', 'Depositado'].includes(c.status));
    el('opChecks').textContent = pesos(inWallet.reduce((s, c) => s + c.amount, 0));
    const soon = inWallet.filter(c => daysUntil(c.dueDate) <= 7);
    el('opChecksFoot').textContent = `${inWallet.length} cheque${inWallet.length === 1 ? '' : 's'}${soon.length ? ` · ${soon.length} se cobra${soon.length === 1 ? '' : 'n'} en 7 días` : ''}`;
    const active = state.credits.filter(c => c.status !== 'Cancelado').map(c => ({ c, s: creditStatus(c) }));
    el('opDebt').textContent = pesos(active.reduce((s, x) => s + x.s.balance, 0));
    const next = active.filter(x => x.s.next).sort((a, z) => a.s.next.date.localeCompare(z.s.next.date))[0];
    el('opDebtFoot').textContent = next ? `Próxima cuota ${pesos(next.s.next.payment)} el ${fmtDate(next.s.next.date)}` : 'Sin cuotas pendientes';
    el('opDebtFoot').className = `metric-foot ${next && next.s.next.date < todayISO() ? 'negative' : ''}`;
  }

  function ledgerRows() {
    const b = balances();
    const txRows = state.transactions.filter(t => t.status === 'Cobrado' || t.status === 'Pagado').map(t => ({
      key: `tx:${t.id}`, date: t.date, accountId: b.txAccount(t), concept: [t.counterparty, t.description].filter(Boolean).join(' · '), category: t.category,
      method: t.account === 'Caja' ? 'Efectivo' : 'Transferencia', sign: t.type === 'Ingreso' ? 1 : -1, amount: t.amount, origin: 'Tesorería', pending: t._pending
    }));
    const opRows = state.finMovements.map(m => ({
      key: `mv:${m.id}`, movement: m, date: m.date, accountId: m.accountId, concept: m.concept, category: m.category, method: m.method, sign: m.type === 'Ingreso' ? 1 : -1, amount: m.amount,
      origin: m.reference.startsWith('CHQ:') ? 'Cheque' : m.reference.startsWith('CRD:') ? 'Crédito' : m.reference.startsWith('TRF-') ? 'Transferencia' : 'Operativo', pending: m._pending
    }));
    return [...txRows, ...opRows].sort((a, z) => a.date.localeCompare(z.date) || a.key.localeCompare(z.key));
  }
  function renderLedger() {
    const b = balances(), rows = ledgerRows();
    const accSel = el('opLedgerAccount'), monthSel = el('opLedgerMonth');
    const accValue = accSel.value, monthValue = monthSel.value;
    accSel.innerHTML = `<option value="">Todas las cuentas</option>${options(b.list.map(a => [a.id, accountLabel(a.id)]), accValue)}`;
    const months = [...new Set(rows.map(r => monthOf(r.date)))].sort().reverse();
    monthSel.innerHTML = `<option value="">Todos los meses</option>${options(months.map(m => [m, periodLabel(m)]), monthValue)}`;
    const account = accValue ? b.list.find(a => a.id === accValue) : null;
    let running = account ? Number(account.openingBalance) || 0 : 0;
    const visible = [];
    for (const r of rows) {
      if (account && r.accountId !== account.id) continue;
      running += r.sign * r.amount;
      if (!monthValue || monthOf(r.date) === monthValue) visible.push({ ...r, running });
    }
    visible.reverse();
    el('opLedgerRows').innerHTML = visible.length ? visible.map(r => {
      const acc = b.list.find(a => a.id === r.accountId) || { currency: 'ARS' };
      const m = r.movement, isBank = r.accountId !== 'CAJA';
      const reconcile = m && isBank ? `<select class="inline-status op-reconcile" data-id="${esc(m.id)}">${options(['Pendiente', 'Conciliado'], m.reconciled)}</select>` : '<span class="text-muted">—</span>';
      const removable = m && (r.origin === 'Operativo' || r.origin === 'Transferencia');
      return `<tr><td>${fmtDate(r.date)}</td><td>${esc(accountLabel(r.accountId))}</td><td><b>${esc(r.concept)}</b>${r.pending ? '<span class="pending-tag">sin sincronizar</span>' : ''}</td><td>${esc(r.category)}</td><td>${esc(r.method)}</td>
        <td class="positive">${r.sign > 0 ? amountIn(acc.currency, r.amount) : ''}</td><td class="negative">${r.sign < 0 ? amountIn(acc.currency, r.amount) : ''}</td>
        <td>${account ? amountIn(account.currency, r.running) : '<span class="text-muted">—</span>'}</td><td>${reconcile}</td><td><span class="op-origin">${esc(r.origin)}</span></td>
        <td>${removable ? `<button class="danger-btn op-del-movement" data-id="${esc(m.id)}" aria-label="Eliminar movimiento">×</button>` : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="11">Sin movimientos para el filtro elegido</td></tr>';
  }
  el('opLedgerAccount').addEventListener('change', renderLedger);
  el('opLedgerMonth').addEventListener('change', renderLedger);
  el('opLedgerRows').addEventListener('change', async e => {
    const sel = e.target.closest('.op-reconcile'); if (!sel) return;
    const m = state.finMovements.find(x => x.id === sel.dataset.id); if (!m) return;
    try { const r = await saveRecord('finMovements', { ...m, reconciled: sel.value }, false); savedMessage(r, 'Conciliación guardada'); refreshAll(); } catch (error) { toast(error.message); refreshAll(); }
  });
  el('opLedgerRows').addEventListener('click', async e => {
    const btn = e.target.closest('.op-del-movement'); if (!btn) return;
    const m = state.finMovements.find(x => x.id === btn.dataset.id); if (!m) return;
    const pair = m.reference.startsWith('TRF-') ? state.finMovements.filter(x => x.reference === m.reference) : [m];
    if (!confirm(pair.length > 1 ? '¿Eliminar la transferencia (sale de una cuenta y entra en la otra)?' : `¿Eliminar el movimiento "${m.concept}"?`)) return;
    try { let r; for (const x of pair) r = await removeRecord('finMovements', x.id); savedMessage(r, 'Movimiento eliminado'); refreshAll(); } catch (error) { toast(error.message); }
  });

  function renderAccounts() {
    const b = balances();
    const accounts = b.list.filter(a => a.id !== 'CAJA');
    el('opAccountRows').innerHTML = accounts.length ? accounts.map(a => `<tr><td><b>${esc(a.bank)}</b>${a.main ? ' <span class="badge green">Principal</span>' : ''}${pendingTag(a)}</td><td>${esc(a.type)}</td><td>${esc(a.number) || '—'}</td><td style="font-family:var(--font-mono);font-size:12px">${esc(a.cbu) || '—'}</td><td>${esc(a.alias) || '—'}</td><td>${a.currency === 'USD' ? 'Dólares' : 'Pesos'}</td>
      <td><b>${amountIn(a.currency, a.balance)}</b>${a.currency === 'USD' && fxRate() ? `<br><small class="text-muted">≈ ${pesos(a.balance * fxRate())}</small>` : ''}</td><td><span class="badge ${a.status === 'Activa' ? 'green' : 'red'}">${esc(a.status)}</span></td>
      <td><div class="row-actions"><button class="ghost-btn" data-op-edit="account" data-id="${esc(a.id)}">Editar</button><button class="danger-btn op-del-account" data-id="${esc(a.id)}" aria-label="Eliminar cuenta">×</button></div></td></tr>`).join('') : '<tr><td colspan="9">Sin cuentas bancarias cargadas</td></tr>';
  }
  el('opAccountRows').addEventListener('click', async e => {
    const btn = e.target.closest('.op-del-account'); if (!btn) return;
    const a = state.bankAccounts.find(x => x.id === btn.dataset.id); if (!a) return;
    const used = state.finMovements.some(m => m.accountId === a.id) || state.transactions.some(t => t.bankAccountId === a.id) || state.cheques.some(c => c.accountId === a.id) || state.credits.some(c => c.accountId === a.id);
    if (used) { if (!confirm(`La cuenta tiene movimientos, cheques o créditos asociados: no se puede borrar. ¿Marcarla como Cerrada?`)) return; try { const r = await saveRecord('bankAccounts', { ...a, status: 'Cerrada', main: false }, false); savedMessage(r, 'Cuenta cerrada'); refreshAll(); } catch (error) { toast(error.message); } return; }
    if (!confirm(`¿Eliminar la cuenta ${a.bank} ${a.number || ''}?`)) return;
    try { const r = await removeRecord('bankAccounts', a.id); savedMessage(r, 'Cuenta eliminada'); refreshAll(); } catch (error) { toast(error.message); }
  });

  function chequeRows(direction) {
    const list = state.cheques.filter(c => c.direction === direction).sort((a, z) => a.dueDate.localeCompare(z.dueDate));
    const open = direction === 'Recibido' ? ['En cartera', 'Depositado'] : ['Emitido', 'Entregado'];
    const active = list.filter(c => open.includes(c.status)), soon = active.filter(c => daysUntil(c.dueDate) <= 7);
    el(direction === 'Recibido' ? 'opChqInFoot' : 'opChqOutFoot').textContent = `${direction === 'Recibido' ? 'A cobrar' : 'A cubrir'}: ${pesos(active.reduce((s, c) => s + c.amount, 0))}${soon.length ? ` · ${soon.length} en los próximos 7 días` : ''}`;
    return list.length ? list.map(c => {
      const d = daysUntil(c.dueDate), late = open.includes(c.status) && d < 0, near = open.includes(c.status) && d >= 0 && d <= 7;
      const link = c.linkTxId ? state.transactions.find(t => t.id === c.linkTxId) : null;
      return `<tr><td><b>${esc(c.number)}</b> <span class="op-origin">${esc(c.kind)}</span>${pendingTag(c)}<br><small class="text-muted">${esc(c.bank)}</small></td><td>${esc(c.counterparty)}${link ? `<br><small class="text-muted">Paga: ${esc(link.description || link.category)}</small>` : ''}</td><td><b>${pesos(c.amount)}</b></td>
        <td><span class="badge ${late ? 'red' : near ? 'amber' : 'blue'}">${late ? 'Vencido ' : ''}${fmtDate(c.dueDate)}</span></td>
        <td><select class="inline-status op-cheque-status" data-id="${esc(c.id)}">${options(CHEQUE_STATUS[direction], c.status)}</select></td>
        <td><div class="row-actions"><button class="ghost-btn" data-op-edit="${direction === 'Recibido' ? 'chequeIn' : 'chequeOut'}" data-id="${esc(c.id)}">Editar</button><button class="danger-btn op-del-cheque" data-id="${esc(c.id)}" aria-label="Eliminar cheque">×</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="6">Sin cheques</td></tr>';
  }
  function renderCheques() { el('opChqInRows').innerHTML = chequeRows('Recibido'); el('opChqOutRows').innerHTML = chequeRows('Emitido'); }
  // Cobrar o debitar un cheque impacta en la cuenta: si paga un movimiento de Tesorería lo marca realizado,
  // si no, registra el depósito o el débito. Volver atrás deshace ese impacto.
  async function applyChequeStatus(cheque, status) {
    const done = cheque.direction === 'Recibido' ? 'Cobrado' : 'Debitado';
    const ref = `CHQ:${cheque.id}`, accountId = cheque.accountId || balances().main;
    const link = cheque.linkTxId ? state.transactions.find(t => t.id === cheque.linkTxId) : null;
    const auto = state.finMovements.find(m => m.reference === ref);
    if (status === done && cheque.status !== done) {
      if (link) await updateTransaction(link, { status: cheque.direction === 'Recibido' ? 'Cobrado' : 'Pagado', bankAccountId: accountId });
      else if (!auto && accountId) await saveRecord('finMovements', { id: uid('MOP'), date: todayISO(), accountId, type: cheque.direction === 'Recibido' ? 'Ingreso' : 'Egreso', category: cheque.direction === 'Recibido' ? 'Depósito de cheque' : 'Pago con cheque', concept: `Cheque ${cheque.number} · ${cheque.counterparty}`, amount: cheque.amount, method: cheque.kind === 'eCheq' ? 'eCheq' : 'Cheque', reference: ref, reconciled: 'Pendiente' }, true);
    }
    if (status !== done && cheque.status === done) {
      if (link && link.status !== 'Pendiente') await updateTransaction(link, { status: 'Pendiente' });
      if (auto) await removeRecord('finMovements', auto.id);
    }
    return saveRecord('cheques', { ...cheque, status }, false);
  }
  ['opChqInRows', 'opChqOutRows'].forEach(id => {
    el(id).addEventListener('change', async e => {
      const sel = e.target.closest('.op-cheque-status'); if (!sel) return;
      const c = state.cheques.find(x => x.id === sel.dataset.id); if (!c) return;
      sel.disabled = true;
      try { const r = await applyChequeStatus(c, sel.value); savedMessage(r, sel.value === 'Rechazado' ? 'Cheque rechazado: gestionar el reclamo con el librador' : `Cheque ${sel.value.toLowerCase()}`); refreshAll(); }
      catch (error) { toast(error.message); refreshAll(); }
    });
    el(id).addEventListener('click', async e => {
      const btn = e.target.closest('.op-del-cheque'); if (!btn) return;
      const c = state.cheques.find(x => x.id === btn.dataset.id); if (!c || !confirm(`¿Eliminar el cheque ${c.number} de ${c.counterparty}?`)) return;
      try { const r = await removeRecord('cheques', c.id); savedMessage(r, 'Cheque eliminado'); refreshAll(); } catch (error) { toast(error.message); }
    });
  });

  function renderCredits() {
    el('opCreditRows').innerHTML = state.credits.length ? state.credits.map(c => {
      const s = creditStatus(c), late = s.next && s.next.date < todayISO() && c.status !== 'Cancelado';
      return `<tr class="${state.selectedCredit === c.id ? 'op-selected' : ''}"><td><b>${esc(c.number)}</b>${pendingTag(c)}</td><td>${esc(c.entity)}</td><td>${esc(c.purpose)}</td><td>${pesos(c.amount)}</td><td><b>${pesos(s.balance)}</b></td><td>${s.paid}/${c.termMonths}</td><td>${esc(c.system)} · ${num(+c.tea, 1)}%</td>
        <td>${s.next && c.status !== 'Cancelado' ? `${pesos(s.next.payment)}<br><span class="badge ${late ? 'red' : 'blue'}">${late ? 'Vencida ' : ''}${fmtDate(s.next.date)}</span>` : '—'}</td>
        <td><span class="badge ${c.status === 'Vigente' ? 'green' : c.status === 'En mora' ? 'red' : 'blue'}">${esc(c.status)}</span></td>
        <td><div class="row-actions"><button class="ghost-btn op-credit-view" data-id="${esc(c.id)}">Cuotas</button>${s.next && c.status !== 'Cancelado' ? `<button class="primary-btn op-credit-pay" data-id="${esc(c.id)}">Pagar cuota</button>` : ''}<button class="ghost-btn" data-op-edit="credit" data-id="${esc(c.id)}">Editar</button><button class="danger-btn op-del-credit" data-id="${esc(c.id)}" aria-label="Eliminar crédito">×</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="10">Sin créditos cargados</td></tr>';
    const c = state.credits.find(x => x.id === state.selectedCredit);
    el('opScheduleCard').hidden = !c;
    if (!c) return;
    const s = creditStatus(c);
    el('opScheduleTitle').textContent = `Cronograma · ${c.number} (${c.entity})`;
    el('opScheduleFoot').textContent = `Capital amortizado ${pesos(c.amount - s.balance)} · intereses totales ${pesos(s.interestTotal)} · ${accountLabel(c.accountId || balances().main)}`;
    el('opScheduleRows').innerHTML = s.rows.map(r => { const paid = r.n <= s.paid, late = !paid && r.date < todayISO(); return `<tr class="${r.n === s.paid + 1 ? 'op-selected' : ''}"><td>${r.n}</td><td>${fmtDate(r.date)}</td><td><b>${pesos(r.payment)}</b></td><td>${pesos(r.capital)}</td><td>${pesos(r.interest)}</td><td>${pesos(r.balance)}</td><td><span class="badge ${paid ? 'green' : late ? 'red' : 'blue'}">${paid ? 'Pagada' : late ? 'Vencida' : 'Pendiente'}</span></td></tr>`; }).join('');
  }
  el('opCreditRows').addEventListener('click', async e => {
    const view = e.target.closest('.op-credit-view'), pay = e.target.closest('.op-credit-pay'), del = e.target.closest('.op-del-credit');
    if (view) { state.selectedCredit = state.selectedCredit === view.dataset.id ? null : view.dataset.id; renderCredits(); if (state.selectedCredit) el('opScheduleCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
    if (pay) {
      const c = state.credits.find(x => x.id === pay.dataset.id); const s = creditStatus(c); if (!s.next) return;
      const accountId = c.accountId || balances().main;
      if (!confirm(`¿Registrar el pago de la cuota ${s.next.n} de ${c.number} por ${pesos(s.next.payment)} desde ${accountLabel(accountId)}?`)) return;
      pay.disabled = true;
      try {
        await saveRecord('finMovements', { id: uid('MOP'), date: todayISO(), accountId, type: 'Egreso', category: 'Cuota de crédito', concept: `Cuota ${s.next.n}/${c.termMonths} · ${c.number} (${c.entity})`, amount: Math.round(s.next.payment * 100) / 100, method: 'Débito automático', reference: `CRD:${c.id}:${s.next.n}`, reconciled: 'Pendiente' }, true);
        const paid = s.paid + 1;
        const r = await saveRecord('credits', { ...c, paidInstallments: paid, status: paid >= c.termMonths ? 'Cancelado' : c.status }, false);
        savedMessage(r, paid >= c.termMonths ? 'Última cuota pagada: crédito cancelado' : `Cuota ${s.next.n} registrada`); refreshAll();
      } catch (error) { toast(error.message); pay.disabled = false; }
      return;
    }
    if (del) {
      const c = state.credits.find(x => x.id === del.dataset.id); if (!c || !confirm(`¿Eliminar el crédito ${c.number}? Las cuotas ya pagadas quedan registradas en caja y bancos.`)) return;
      try { const r = await removeRecord('credits', c.id); if (state.selectedCredit === c.id) state.selectedCredit = null; savedMessage(r, 'Crédito eliminado'); refreshAll(); } catch (error) { toast(error.message); }
    }
  });

  function renderSwap() {
    el('opSwapRows').innerHTML = state.swapContracts.length ? state.swapContracts.map(k => {
      const s = swapSummary(k), pct = k.tons ? s.deliveredTons / k.tons * 100 : 0;
      return `<tr class="${state.selectedSwap === k.id ? 'op-selected' : ''}"><td><b>${esc(k.contractNumber || k.id)}</b>${pendingTag(k)}<br><small class="text-muted">Firma ${fmtDate(k.signDate)}${k.dueDate ? ` · vence ${fmtDate(k.dueDate)}` : ''}</small></td><td>${esc(k.supplier)}${k.cuit ? `<br><small class="text-muted">CUIT ${esc(k.cuit)}</small>` : ''}</td><td>${esc(k.grain)}</td><td>${num(k.tons)} TM</td><td>${pesos(k.refPrice)}/TM</td>
        <td>${pesos(s.debit)}</td><td>${num(s.deliveredTons, 1)} TM<br><small class="text-muted">${num(pct, 0)}% de lo pactado</small></td>
        <td class="${s.balance > 0 ? 'negative' : 'positive'}"><b>${pesos(Math.abs(s.balance))}</b><br><small class="text-muted">${s.balance > 0 ? `faltan ${num(s.pendingKg / 1000, 1)} TM` : s.balance < 0 ? 'a favor de la planta' : 'saldado'}</small></td>
        <td><span class="badge ${k.status === 'Vigente' ? 'green' : k.status === 'Cumplido' ? 'blue' : 'red'}">${esc(k.status)}</span></td>
        <td><div class="row-actions"><button class="ghost-btn op-swap-view" data-id="${esc(k.id)}">Cuenta corriente</button><button class="ghost-btn" data-op-edit="swapContract" data-id="${esc(k.id)}">Editar</button><button class="danger-btn op-del-swap" data-id="${esc(k.id)}" aria-label="Eliminar contrato">×</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="10">Sin contratos de canje</td></tr>';
    const k = state.swapContracts.find(x => x.id === state.selectedSwap);
    el('opSwapCard').hidden = !k;
    if (!k) return;
    const s = swapSummary(k);
    el('opSwapTitle').textContent = `Cuenta corriente · ${k.contractNumber || k.id} (${k.supplier})`;
    el('opSwapFoot').textContent = `Debe ${pesos(s.debit)} · haber ${pesos(s.credit)} · saldo ${pesos(s.balance)}${s.balance > 0 ? ` ≈ ${num(s.pendingKg)} kg de ${k.grain.toLowerCase()} a entregar` : ''}`;
    let running = 0;
    const rows = [...s.moves].sort((a, z) => a.date.localeCompare(z.date)).map(m => { const e = swapEntry(m, k); running += e.debit - e.credit; return { m, e, running }; }).reverse();
    el('opSwapMovRows').innerHTML = rows.length ? rows.map(({ m, e, running: bal }) => `<tr><td>${fmtDate(m.date)}</td><td>${esc(m.kind)}${pendingTag(m)}</td><td>${esc(m.voucher) || '—'}</td><td>${m.kind === 'Insumo recibido' ? `${esc(m.input)} · ${num(+m.quantity)} ${esc(m.unit)} · IVA ${num(+m.vatRate, 1)}%` : m.kind === 'Grano entregado' ? `${num(+m.kilos)} kg × ${pesos(k.refPrice)}/TM` : '—'}</td>
      <td>${e.debit ? pesos(e.debit) : ''}</td><td>${e.credit ? pesos(e.credit) : ''}</td><td>${m.kilos ? num(+m.kilos) : ''}</td><td><b>${pesos(bal)}</b></td><td><button class="danger-btn op-del-swapmov" data-id="${esc(m.id)}" aria-label="Eliminar movimiento">×</button></td></tr>`).join('') : '<tr><td colspan="9">Sin movimientos en este contrato</td></tr>';
  }
  el('opSwapRows').addEventListener('click', async e => {
    const view = e.target.closest('.op-swap-view'), del = e.target.closest('.op-del-swap');
    if (view) { state.selectedSwap = state.selectedSwap === view.dataset.id ? null : view.dataset.id; renderSwap(); if (state.selectedSwap) el('opSwapCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
    if (!del) return;
    const k = state.swapContracts.find(x => x.id === del.dataset.id); const moves = state.swapMovements.filter(m => m.contractId === k.id);
    if (!k || !confirm(`¿Eliminar el contrato ${k.contractNumber || k.id}${moves.length ? ` y sus ${moves.length} movimientos` : ''}?`)) return;
    try { let r; for (const m of moves) await removeRecord('swapMovements', m.id); r = await removeRecord('swapContracts', k.id); if (state.selectedSwap === k.id) state.selectedSwap = null; savedMessage(r, 'Contrato eliminado'); refreshAll(); } catch (error) { toast(error.message); }
  });
  el('opSwapMovRows').addEventListener('click', async e => {
    const btn = e.target.closest('.op-del-swapmov'); if (!btn || !confirm('¿Eliminar el movimiento de la cuenta corriente?')) return;
    try { const r = await removeRecord('swapMovements', btn.dataset.id); savedMessage(r, 'Movimiento eliminado'); refreshAll(); } catch (error) { toast(error.message); }
  });

  function renderCashflow() {
    const start = monthOf(todayISO()), months = Array.from({ length: 6 }, (_, i) => monthOf(addMonthsISO(`${start}-01`, i)));
    const bucket = date => { const m = monthOf(date); return !m || m < start ? start : m; };
    const openIn = ['En cartera', 'Depositado'], openOut = ['Emitido', 'Entregado'];
    // Un cheque vigente que paga un movimiento de Tesorería reemplaza a ese movimiento (no se cuenta dos veces)
    const covered = new Set(state.cheques.filter(c => c.linkTxId && [...openIn, ...openOut].includes(c.status)).map(c => c.linkTxId));
    const payroll = state.employees.filter(e => e.status === 'Activo' || e.status === 'Licencia').reduce((s, e) => s + (+e.monthlyCost || 0), 0);
    const b = balances();
    let balance = b.cash + b.banksArs;
    const rows = months.map(m => {
      const inMonth = d => bucket(d) === m;
      const tx = type => state.transactions.filter(t => t.type === type && t.status === 'Pendiente' && !covered.has(t.id) && inMonth(t.dueDate || t.date)).reduce((s, t) => s + t.amount, 0);
      const chq = (dir, open) => state.cheques.filter(c => c.direction === dir && open.includes(c.status) && inMonth(c.dueDate)).reduce((s, c) => s + c.amount, 0);
      const installments = state.credits.filter(c => c.status !== 'Cancelado').flatMap(c => { const s = creditStatus(c); return s.rows.slice(s.paid); }).filter(r => inMonth(r.date)).reduce((s, r) => s + r.payment, 0);
      const r = { m, collect: tx('Ingreso'), chqIn: chq('Recibido', openIn), pay: tx('Egreso'), chqOut: chq('Emitido', openOut), installments, payroll };
      r.net = r.collect + r.chqIn - r.pay - r.chqOut - r.installments - r.payroll;
      balance += r.net; r.balance = balance;
      return r;
    });
    const max = Math.max(1, ...rows.map(r => Math.max(r.collect + r.chqIn, r.pay + r.chqOut + r.installments + r.payroll)));
    el('opFlowBars').innerHTML = rows.map(r => `<div class="flow-col"><div class="flow-pair"><span class="in" style="height:${(r.collect + r.chqIn) / max * 92}%" title="Ingresos ${pesos(r.collect + r.chqIn)}"></span><span class="out" style="height:${(r.pay + r.chqOut + r.installments + r.payroll) / max * 92}%" title="Egresos ${pesos(r.pay + r.chqOut + r.installments + r.payroll)}"></span></div><small>${periodLabel(r.m)}</small></div>`).join('');
    el('opFlowRows').innerHTML = rows.map(r => `<tr><td><b>${periodLabel(r.m)}</b></td><td>${pesos(r.collect)}</td><td>${pesos(r.chqIn)}</td><td>${pesos(r.pay)}</td><td>${pesos(r.chqOut)}</td><td>${pesos(r.installments)}</td><td>${pesos(r.payroll)}</td><td class="${r.net >= 0 ? 'positive' : 'negative'}">${pesos(r.net)}</td><td class="${r.balance >= 0 ? '' : 'negative'}"><b>${pesos(r.balance)}</b></td></tr>`).join('');
  }

  function renderHomebanking() {
    const accounts = state.bankAccounts.filter(a => a.status === 'Activa');
    const byBank = new Map(); accounts.forEach(a => { if (!byBank.has(a.bank)) byBank.set(a.bank, []); byBank.get(a.bank).push(a); });
    el('opHomebanking').innerHTML = byBank.size ? [...byBank.entries()].map(([bank, list]) => { const url = list.find(a => a.homebankingUrl)?.homebankingUrl;
      return url ? `<a class="market-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span class="market-icon" aria-hidden="true">🏦</span><span><b>${esc(bank)}</b><small>${list.map(a => `${esc(a.type)} ${esc(a.number || '')}`).join(' · ')}</small></span><i aria-hidden="true">↗</i></a>`
        : `<div class="market-link"><span class="market-icon" aria-hidden="true">🏦</span><span><b>${esc(bank)}</b><small>Sin enlace cargado</small></span><button class="ghost-btn" data-op-edit="account" data-id="${esc(list[0].id)}">Cargar enlace</button></div>`; }).join('')
      : '<p class="text-muted">Cargue una cuenta bancaria para ver su acceso.</p>';
  }

  function render() { renderKpis(); renderLedger(); renderAccounts(); renderCheques(); renderCredits(); renderSwap(); renderCashflow(); renderHomebanking(); }

  /* ---------- formulario genérico ---------- */
  const counterparties = () => [...new Set([...state.transactions.map(t => t.counterparty), ...state.cheques.map(c => c.counterparty)].filter(Boolean))].sort((a, z) => a.localeCompare(z, 'es'));
  const pendingTx = type => state.transactions.filter(t => t.type === type && t.status === 'Pendiente').map(t => [t.id, `${t.counterparty} · ${pesos(t.amount)}${t.dueDate ? ` · vence ${fmtDate(t.dueDate)}` : ''}`]);
  const chequeFields = direction => [
    { key: 'number', label: 'Número de cheque', type: 'text', required: true },
    { key: 'kind', label: 'Formato', type: 'select', options: ['eCheq', 'Físico'] },
    { key: 'bank', label: 'Banco librador', type: 'select', options: BANKS },
    { key: 'counterparty', label: direction === 'Recibido' ? 'Origen (quien lo emite)' : 'Destino (a favor de)', type: 'text', required: true, list: counterparties() },
    { key: 'amount', label: 'Importe ($)', type: 'number', required: true, min: 0.01, step: 0.01 },
    { key: 'status', label: 'Estado', type: 'select', options: CHEQUE_STATUS[direction] },
    { key: 'issueDate', label: 'Fecha de emisión', type: 'date', required: true },
    { key: 'dueDate', label: 'Fecha de pago', type: 'date', required: true },
    { key: 'accountId', label: direction === 'Recibido' ? 'Cuenta de depósito' : 'Cuenta emisora', type: 'select', options: () => [['', 'Cuenta principal'], ...accountOptions(false, true)] },
    { key: 'linkTxId', label: direction === 'Recibido' ? 'Cobro de Tesorería que paga' : 'Pago de Tesorería que cancela', type: 'select', options: () => [['', 'Ninguno'], ...pendingTx(direction === 'Recibido' ? 'Ingreso' : 'Egreso')], help: 'Al cobrarse o debitarse, ese movimiento queda realizado (no se cuenta dos veces)' },
    { key: 'notes', label: 'Notas', type: 'text', full: true }
  ];
  const FORMS = {
    account: { key: 'bankAccounts', title: 'cuenta bancaria', defaults: () => ({ bank: 'Banco de la Nación Argentina', type: 'Cuenta corriente', currency: 'ARS', openingBalance: 0, status: 'Activa', main: !state.bankAccounts.some(a => a.main), homebankingUrl: BANK_SITES['Banco de la Nación Argentina'] }),
      fields: [
        { key: 'bank', label: 'Banco', type: 'select', options: BANKS, onChange: (v, form) => { const url = form.querySelector('[name=homebankingUrl]'); if (!url.value || Object.values(BANK_SITES).includes(url.value)) url.value = BANK_SITES[v] || ''; } },
        { key: 'type', label: 'Tipo de cuenta', type: 'select', options: ['Cuenta corriente', 'Caja de ahorro', 'Cuenta CVU'] },
        { key: 'number', label: 'Número de cuenta', type: 'text' },
        { key: 'currency', label: 'Moneda', type: 'select', options: [['ARS', 'Pesos'], ['USD', 'Dólares']] },
        { key: 'cbu', label: 'CBU / CVU (22 dígitos)', type: 'text', pattern: '\\d{22}' },
        { key: 'alias', label: 'Alias', type: 'text' },
        { key: 'openingBalance', label: 'Saldo inicial (en la moneda de la cuenta)', type: 'number', step: 0.01 },
        { key: 'status', label: 'Estado', type: 'select', options: ['Activa', 'Cerrada'] },
        { key: 'main', label: 'Cuenta principal (recibe los cobros y pagos bancarios de Tesorería sin cuenta asignada)', type: 'checkbox', full: true },
        { key: 'homebankingUrl', label: 'Enlace de homebanking', type: 'url', full: true, placeholder: 'https://' }
      ],
      async save(draft, isNew) {
        if (draft.main) for (const a of state.bankAccounts.filter(x => x.main && x.id !== draft.id)) await saveRecord('bankAccounts', { ...a, main: false }, false);
        return saveRecord('bankAccounts', draft, isNew);
      } },
    movement: { key: 'finMovements', title: 'movimiento de caja o banco', newOnly: true, defaults: () => ({ date: todayISO(), type: 'Egreso', accountId: 'CAJA', category: 'Gastos menores', method: 'Efectivo', reconciled: 'Pendiente' }),
      fields: [
        { key: 'date', label: 'Fecha', type: 'date', required: true },
        { key: 'type', label: 'Tipo', type: 'select', options: ['Ingreso', 'Egreso', 'Transferencia'] },
        { key: 'accountId', label: 'Cuenta', type: 'select', options: () => accountOptions(true, false), labelIf: v => (v.type === 'Transferencia' ? 'Cuenta de origen' : 'Cuenta') },
        { key: 'toAccountId', label: 'Cuenta de destino', type: 'select', options: () => accountOptions(true, false), showIf: v => v.type === 'Transferencia' },
        { key: 'category', label: 'Categoría', type: 'select', options: MOVEMENT_CATEGORIES, showIf: v => v.type !== 'Transferencia' },
        { key: 'method', label: 'Medio', type: 'select', options: METHODS },
        { key: 'concept', label: 'Concepto', type: 'text', full: true, required: true, placeholder: 'Detalle del movimiento' },
        { key: 'amount', label: 'Importe (en la moneda de la cuenta)', type: 'number', required: true, min: 0.01, step: 0.01 },
        { key: 'reference', label: 'Referencia / comprobante', type: 'text' },
        { key: 'reconciled', label: 'Conciliación bancaria', type: 'select', options: ['Pendiente', 'Conciliado'] }
      ],
      async save(draft) {
        if (draft.type !== 'Transferencia') { delete draft.toAccountId; return saveRecord('finMovements', draft, true); }
        const from = accountById(draft.accountId), to = accountById(draft.toAccountId);
        if (!to || from.id === to.id) throw new Error('Elija una cuenta de destino distinta a la de origen');
        if (from.currency !== to.currency) throw new Error('Cuentas de distinta moneda: registre la compra o venta de dólares como un egreso y un ingreso');
        const ref = uid('TRF'), base = { date: draft.date, category: 'Transferencia entre cuentas', method: draft.method, amount: draft.amount, reference: ref, reconciled: draft.reconciled };
        await saveRecord('finMovements', { ...base, id: uid('MOP'), accountId: from.id, type: 'Egreso', concept: draft.concept || `Transferencia a ${accountLabel(to.id)}` }, true);
        return saveRecord('finMovements', { ...base, id: uid('MOP'), accountId: to.id, type: 'Ingreso', concept: draft.concept || `Transferencia desde ${accountLabel(from.id)}` }, true);
      } },
    chequeIn: { key: 'cheques', title: 'cheque por cobrar', defaults: () => ({ direction: 'Recibido', kind: 'eCheq', bank: BANKS[0], status: 'En cartera', issueDate: todayISO(), dueDate: todayISO(), accountId: '', linkTxId: '' }), fields: chequeFields('Recibido'), linkFill: true },
    chequeOut: { key: 'cheques', title: 'cheque por cubrir', defaults: () => ({ direction: 'Emitido', kind: 'eCheq', bank: BANKS[0], status: 'Emitido', issueDate: todayISO(), dueDate: todayISO(), accountId: '', linkTxId: '' }), fields: chequeFields('Emitido'), linkFill: true },
    credit: { key: 'credits', title: 'crédito', defaults: () => ({ entity: BANKS[0], purpose: 'Capital de trabajo', system: 'Francés', termMonths: 12, tea: 40, startDate: todayISO(), status: 'Vigente', paidInstallments: 0, accountId: '' }),
      fields: [
        { key: 'number', label: 'Número de crédito', type: 'text', required: true },
        { key: 'entity', label: 'Entidad', type: 'select', options: CREDIT_ENTITIES },
        { key: 'purpose', label: 'Destino', type: 'select', options: CREDIT_PURPOSES },
        { key: 'amount', label: 'Monto del crédito ($)', type: 'number', required: true, min: 0.01, step: 0.01 },
        { key: 'termMonths', label: 'Plazo (meses)', type: 'number', required: true, min: 1, max: 360, step: 1 },
        { key: 'tea', label: 'Tasa efectiva anual (%)', type: 'number', required: true, min: 0, step: 0.01 },
        { key: 'system', label: 'Sistema de amortización', type: 'select', options: ['Francés', 'Alemán'], help: 'Francés: cuota fija. Alemán: capital fijo, cuota decreciente.' },
        { key: 'startDate', label: 'Fecha de inicio', type: 'date', required: true },
        { key: 'accountId', label: 'Cuenta de débito de las cuotas', type: 'select', options: () => [['', 'Cuenta principal'], ...accountOptions(false, true)] },
        { key: 'status', label: 'Estado', type: 'select', options: ['Vigente', 'En mora', 'Cancelado'] },
        { key: 'paidInstallments', label: 'Cuotas ya pagadas', type: 'number', min: 0, step: 1 }
      ] },
    swapContract: { key: 'swapContracts', title: 'contrato de canje', defaults: () => ({ grain: 'Maíz', status: 'Vigente', signDate: todayISO(), refPrice: Number(state.settings.grainPricesArs?.['Maíz']) || 0 }),
      fields: [
        { key: 'supplier', label: 'Proveedor / agronomía', type: 'text', required: true, list: counterparties() },
        { key: 'cuit', label: 'CUIT (11 dígitos, sin guiones)', type: 'text', pattern: '\\d{11}' },
        { key: 'contractNumber', label: 'N° de contrato (registro ARCA / SISA)', type: 'text' },
        { key: 'grain', label: 'Grano', type: 'select', options: GRAINS, onChange: (v, form) => { const p = Number(state.settings.grainPricesArs?.[v]); if (p) form.querySelector('[name=refPrice]').value = p; } },
        { key: 'tons', label: 'Toneladas pactadas', type: 'number', required: true, min: 0.01, step: 0.01 },
        { key: 'refPrice', label: 'Precio de referencia ($/TM)', type: 'number', required: true, min: 0.01, step: 1, help: 'Se propone el precio de mercado cargado en Lotes' },
        { key: 'signDate', label: 'Fecha de firma', type: 'date', required: true },
        { key: 'dueDate', label: 'Vencimiento', type: 'date' },
        { key: 'status', label: 'Estado', type: 'select', options: ['Vigente', 'Cumplido', 'Vencido', 'Anulado'] }
      ] },
    swapMovement: { key: 'swapMovements', title: 'movimiento de canje', newOnly: true, defaults: () => ({ contractId: state.selectedSwap || state.swapContracts[0]?.id || '', date: todayISO(), kind: 'Insumo recibido', vatRate: 21, unit: 'kg' }),
      fields: [
        { key: 'contractId', label: 'Contrato', type: 'select', options: () => state.swapContracts.map(k => [k.id, `${k.contractNumber || k.id} · ${k.supplier}`]) },
        { key: 'date', label: 'Fecha', type: 'date', required: true },
        { key: 'kind', label: 'Movimiento', type: 'select', options: SWAP_KINDS },
        { key: 'voucher', label: 'Comprobante (factura / CPE)', type: 'text' },
        { key: 'input', label: 'Insumo recibido (va al stock)', type: 'text', showIf: v => v.kind === 'Insumo recibido' },
        { key: 'quantity', label: 'Cantidad recibida', type: 'number', min: 0, step: 0.01, showIf: v => v.kind === 'Insumo recibido' },
        { key: 'unit', label: 'Unidad', type: 'select', options: ['kg', 'TM', 'L', 'unidades', 'bolsas'], showIf: v => v.kind === 'Insumo recibido' },
        { key: 'netAmount', label: 'Importe neto ($)', type: 'number', min: 0, step: 0.01, showIf: v => v.kind !== 'Grano entregado' },
        { key: 'vatRate', label: 'Alícuota de IVA', type: 'select', options: [[0, '0%'], [10.5, '10,5%'], [21, '21%'], [27, '27%']], showIf: v => v.kind === 'Insumo recibido' },
        { key: 'kilos', label: 'Kilos netos entregados', type: 'number', min: 0, step: 1, showIf: v => v.kind === 'Grano entregado' }
      ] }
  };
  let current = null;
  function fieldHtml(f, value) {
    const id = `op-${f.key}`, req = f.required ? 'required' : '';
    const attrs = `id="${id}" name="${f.key}" ${req} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step !== undefined ? `step="${f.step}"` : ''} ${f.pattern ? `pattern="${f.pattern}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
    let input;
    if (f.type === 'select') input = `<select ${attrs}>${options(typeof f.options === 'function' ? f.options() : f.options, value)}</select>`;
    else if (f.type === 'checkbox') return `<div class="field full check-field" data-field="${f.key}"><label class="check"><input type="checkbox" ${attrs} ${value ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
    else input = `<input type="${f.type}" ${attrs} value="${esc(value ?? '')}" ${f.list ? `list="${id}-list"` : ''}>${f.list ? `<datalist id="${id}-list">${f.list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}`;
    return `<div class="field${f.full ? ' full' : ''}" data-field="${f.key}"><label for="${id}">${esc(f.label)}</label>${input}${f.help ? `<small class="text-muted">${esc(f.help)}</small>` : ''}</div>`;
  }
  function readForm() {
    const values = { ...current.record };
    for (const f of current.spec.fields) {
      const input = el('opForm').querySelector(`[name="${f.key}"]`);
      if (!input) continue;
      values[f.key] = f.type === 'checkbox' ? input.checked : f.type === 'number' ? (input.value === '' ? 0 : Number(input.value)) : f.key === 'vatRate' ? Number(input.value) : input.value.trim();
    }
    return values;
  }
  function syncVisibility() {
    const v = readForm();
    for (const f of current.spec.fields) {
      const wrap = el('opForm').querySelector(`[data-field="${f.key}"]`); if (!wrap) continue;
      const visible = !f.showIf || f.showIf(v);
      wrap.hidden = !visible;
      wrap.querySelectorAll('input,select').forEach(i => { i.disabled = !visible; });
      if (f.labelIf) wrap.querySelector('label').textContent = f.labelIf(v);
    }
  }
  function openForm(kind, record) {
    const spec = FORMS[kind]; const isNew = !record;
    current = { kind, spec, isNew, record: record ? { ...record } : { id: uid(spec.key === 'bankAccounts' ? 'CTA' : spec.key === 'cheques' ? 'CHQ' : spec.key === 'credits' ? 'CRD' : spec.key === 'swapContracts' ? 'SWP' : spec.key === 'swapMovements' ? 'SWM' : 'MOP'), reference: '', ...spec.defaults() } };
    if (kind === 'swapMovement' && !state.swapContracts.length) return toast('Primero cargue un contrato de canje');
    el('opDialogTitle').textContent = `${isNew ? 'Nuevo' : 'Editar'} ${spec.title}`;
    el('opFields').innerHTML = spec.fields.map(f => fieldHtml(f, current.record[f.key])).join('');
    syncVisibility();
    el('opDialog').showModal();
    setTimeout(() => el('opFields').querySelector('input:not([type=checkbox]):not([disabled]),select')?.focus(), 50);
  }
  el('opFields').addEventListener('change', e => {
    const f = current?.spec.fields.find(x => x.key === e.target.name);
    if (f?.onChange) f.onChange(e.target.value, el('opForm'));
    // Al vincular un cheque a un movimiento de Tesorería, proponer contraparte e importe
    if (current?.spec.linkFill && e.target.name === 'linkTxId' && e.target.value) {
      const tx = state.transactions.find(t => t.id === e.target.value);
      if (tx) { const cp = el('opForm').querySelector('[name=counterparty]'), amt = el('opForm').querySelector('[name=amount]'); if (!cp.value) cp.value = tx.counterparty; if (!Number(amt.value)) amt.value = tx.amount; }
    }
    syncVisibility();
  });
  el('opForm').addEventListener('submit', async e => {
    e.preventDefault();
    const submit = el('opSubmit'); submit.disabled = true;
    try {
      const draft = readForm();
      const r = current.spec.save ? await current.spec.save(draft, current.isNew) : await saveRecord(current.spec.key, draft, current.isNew);
      el('opDialog').close();
      savedMessage(r, current.isNew ? 'Registro guardado' : 'Cambios guardados');
      refreshAll();
    } catch (error) { toast(error.message); } finally { submit.disabled = false; }
  });
  document.getElementById('page-treasury').addEventListener('click', e => {
    const nb = e.target.closest('[data-op-new]'), eb = e.target.closest('[data-op-edit]');
    if (nb) openForm(nb.dataset.opNew, null);
    if (eb) { const spec = FORMS[eb.dataset.opEdit]; openForm(eb.dataset.opEdit, state[spec.key].find(x => x.id === eb.dataset.id)); }
  });

  document.addEventListener('pbp:bootstrap', event => load(event.detail));
  document.addEventListener('pbp:fx', render);
  if (window.pbpData) load(window.pbpData); else render();
})();
