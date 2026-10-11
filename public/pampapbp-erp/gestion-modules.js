/* Pampa PBP - módulos de gestión: Finanzas, Costos y RRHH
 * Usa los helpers globales del script principal (api, toast, escapeHTML, money, num) y los
 * datos que publica loadBackend() en window.pbpData / evento 'pbp:bootstrap'.
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = v => escapeHTML(v ?? '');
  // Todos los importes de la app están en pesos (money() del script principal formatea ARS)
  const pesos = n => money(Number(n) || 0);
  const PALETTE = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#eab308', '#64748b', '#ec4899'];
  const todayISO = () => new Date().toLocaleDateString('sv-SE');
  const monthOf = date => String(date || '').slice(0, 7);
  const fmtDate = iso => (iso ? iso.split('-').reverse().join('/') : '—');
  const periodLabel = period => { const [y, m] = period.split('-').map(Number); return new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' }).format(new Date(y, m - 1, 1)); };
  const shortMonth = period => { const [y, m] = period.split('-').map(Number); return new Intl.DateTimeFormat('es-AR', { month: 'short' }).format(new Date(y, m - 1, 1)); };
  const addMonths = (period, delta) => { const [y, m] = period.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const daysUntil = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
  const uid = prefix => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const pendingTag = item => (item && item._pending ? '<span class="pending-tag" title="Se enviará al servidor cuando vuelva la conexión">sin sincronizar</span>' : '');
  const savedMessage = (result, ok) => toast(result && result.offline ? 'Guardado sin conexión: se sincroniza al volver la señal' : ok);

  const TX_CATEGORIES = { Ingreso: ['Venta de alimento', 'Servicio de maquila', 'Otros ingresos', 'Saldo inicial'], Egreso: ['Materias primas', 'Energía', 'Sueldos y cargas', 'Mantenimiento', 'Fletes', 'Impuestos', 'Otros egresos'] };
  const TX_STATUS = { Ingreso: ['Cobrado', 'Pendiente'], Egreso: ['Pagado', 'Pendiente'] };
  // Materias primas y repuestos no se cargan a mano: salen de lo consumido del inventario
  const COST_CENTERS = { 'Energía eléctrica': 'Variable', 'Vapor / caldera': 'Variable', 'Fletes': 'Variable', 'Envases': 'Variable', 'Mantenimiento': 'Fijo', 'Seguros': 'Fijo', 'Servicios generales': 'Fijo', 'Otros': 'Fijo' };
  const LABOR_CENTER = 'Mano de obra (RRHH)';
  const POSITIONS = {
    'Jefe de planta': ['Producción y mantenimiento', 'USR-DIR-GER'],
    'Operador de consola (SCADA)': ['Producción y mantenimiento', 'USR-OP-CON'],
    'Operario de piso / recepción': ['Producción y mantenimiento', 'USR-OP-MAN'],
    'Técnico de mantenimiento': ['Producción y mantenimiento', 'USR-OP-MAN'],
    'Control de calidad y nutrición': ['Calidad, logística y administración', 'USR-QC-NUT'],
    'Logística y despacho': ['Calidad, logística y administración', 'USR-LOG-DES'],
    'Administrativo / facturación': ['Calidad, logística y administración', 'USR-ADM-FAC'],
    'Operario polivalente': ['Granja', 'USR-OP-MAN'],
    'Supervisor / encargado de granja': ['Granja', 'USR-DIR-GER']
  };
  const AREAS = ['Producción y mantenimiento', 'Calidad, logística y administración', 'Granja'];
  // Estructuras de referencia (rrhh.txt)
  const STRUCTURES = {
    comercial: { label: 'planta comercial', positions: [['Jefe de planta', 1], ['Operador de consola (SCADA)', 2], ['Operario de piso / recepción', 2], ['Técnico de mantenimiento', 1], ['Control de calidad y nutrición', 1], ['Logística y despacho', 1], ['Administrativo / facturación', 1]] },
    autoconsumo: { label: 'planta de autoconsumo', positions: [['Operario polivalente', 1], ['Supervisor / encargado de granja', 1]] }
  };
  const ROLES = [
    ['USR-OP-MAN', 'Operario de planta manual', 'Autoconsumo', 'Ve las órdenes de fabricación, confirma cierres de lote e imprime recetas.'],
    ['USR-OP-CON', 'Operador de consola / panel', 'Comercial', 'Sincroniza las OF con el PLC/SCADA y supervisa desvíos de peso.'],
    ['USR-QC-NUT', 'Nutricionista / control de calidad', 'Ambos', 'Modifica recetas, carga análisis de laboratorio y ajusta la matriz nutricional.'],
    ['USR-LOG-DES', 'Encargado de logística', 'Comercial', 'Planifica camiones y registra entradas y salidas en la báscula.'],
    ['USR-ADM-FAC', 'Administrador / facturación', 'Comercial', 'Listas de precios, facturación, inventario teórico y órdenes de compra.'],
    ['USR-DIR-GER', 'Director / gerencia', 'Ambos', 'Tablero de control, costos de conversión, rentabilidad por lote y mermas.']
  ];

  const data = { transactions: [], costs: [], employees: [], lots: [], bankAccounts: [], finMovements: [], inventoryItems: [], inventoryMovements: [], settings: {} };

  // Saldos por cuenta (caja y bancos): saldo inicial + cobros/pagos realizados de Tesorería + movimientos
  // operativos. Lo usa también el submódulo Operativo (finanzas-operativo.js).
  function accountBalances(source) {
    const accounts = source.bankAccounts || [], movements = source.finMovements || [], txs = source.transactions || [];
    const main = (accounts.find(a => a.main && a.status === 'Activa' && a.currency !== 'USD') || accounts.find(a => a.status === 'Activa' && a.currency !== 'USD') || {}).id || '';
    const list = [{ id: 'CAJA', name: 'Caja', bank: 'Caja', currency: 'ARS', openingBalance: 0, status: 'Activa' }, ...accounts.map(a => ({ ...a, name: `${a.bank} · ${a.type}${a.currency === 'USD' ? ' USD' : ''}` }))];
    const txAccount = t => (t.account === 'Caja' ? 'CAJA' : t.bankAccountId || main);
    const sign = t => (t.type === 'Ingreso' ? 1 : -1);
    const realized = t => t.status === 'Cobrado' || t.status === 'Pagado';
    for (const acc of list) {
      acc.balance = (Number(acc.openingBalance) || 0)
        + txs.filter(t => realized(t) && txAccount(t) === acc.id).reduce((s, t) => s + sign(t) * t.amount, 0)
        + movements.filter(m => m.accountId === acc.id).reduce((s, m) => s + sign(m) * m.amount, 0);
    }
    const rate = Number(window.pbpFx?.venta || source.settings?.mepRate?.venta) || 0;
    const inArs = a => (a.currency === 'USD' ? a.balance * rate : a.balance);
    const banks = list.filter(a => a.id !== 'CAJA' && a.status === 'Activa');
    return { list, main, txAccount, cash: list[0].balance, banksArs: banks.reduce((s, a) => s + inArs(a), 0), hasUsdWithoutRate: banks.some(a => a.currency === 'USD') && !rate, inArs };
  }
  window.pbpAccountBalances = accountBalances;
  function load(source) {
    if (!source) return;
    for (const key of ['transactions', 'costs', 'employees', 'lots', 'bankAccounts', 'finMovements', 'inventoryItems', 'inventoryMovements']) if (Array.isArray(source[key])) data[key] = source[key];
    if (source.settings) data.settings = source.settings;
    renderAll();
  }
  const replaceItem = (list, item) => { const i = list.findIndex(x => x.id === item.id); if (i >= 0) list[i] = { ...list[i], ...item }; };

  /* ================= FINANZAS ================= */
  const realized = tx => tx.status === 'Cobrado' || tx.status === 'Pagado';
  const operating = tx => tx.category !== 'Saldo inicial';
  function renderTreasury() {
    const txs = data.transactions, month = monthOf(todayISO()), today = todayISO();
    const bal = accountBalances(data);
    el('trBalance').textContent = pesos(bal.cash + bal.banksArs);
    el('trBalanceSplit').textContent = `Bancos ${pesos(bal.banksArs)}${bal.hasUsdWithoutRate ? ' (sin la cuenta en USD)' : ''} · Caja ${pesos(bal.cash)}`;
    const inMonth = txs.filter(t => monthOf(t.date) === month && operating(t));
    const income = inMonth.filter(t => t.type === 'Ingreso'), expense = inMonth.filter(t => t.type === 'Egreso');
    const sum = list => list.reduce((s, t) => s + t.amount, 0);
    el('trIncome').textContent = pesos(sum(income));
    el('trIncomeFoot').textContent = `${pesos(sum(income.filter(realized)))} cobrados`;
    el('trExpense').textContent = pesos(sum(expense));
    el('trExpenseFoot').textContent = `${pesos(sum(expense.filter(realized)))} pagados`;
    const result = sum(income) - sum(expense);
    el('trResult').textContent = pesos(result);
    el('trResultFoot').textContent = sum(income) ? `Margen ${num(result / sum(income) * 100, 1)}% · ${periodLabel(month)}` : periodLabel(month);
    el('trResultFoot').className = `metric-foot ${result >= 0 ? 'positive' : 'negative'}`;

    const pendingRows = (type, label) => {
      const list = txs.filter(t => t.type === type && t.status === 'Pendiente').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
      const overdue = list.filter(t => t.dueDate && t.dueDate < today);
      el(type === 'Ingreso' ? 'trReceivable' : 'trPayable').textContent = pesos(sum(list));
      el(type === 'Ingreso' ? 'trReceivableFoot' : 'trPayableFoot').textContent = `${list.length} pendiente${list.length === 1 ? '' : 's'}${overdue.length ? ` · ${overdue.length} vencido${overdue.length === 1 ? '' : 's'}` : ''}`;
      el(type === 'Ingreso' ? 'trReceivableRows' : 'trPayableRows').innerHTML = list.length ? list.map(t => {
        const late = t.dueDate && t.dueDate < today, soon = t.dueDate && !late && daysUntil(t.dueDate) <= 7;
        return `<tr><td>${t.dueDate ? `<span class="badge ${late ? 'red' : soon ? 'amber' : 'blue'}">${late ? 'Vencido ' : ''}${fmtDate(t.dueDate)}</span>` : '—'}</td><td><b>${esc(t.counterparty)}</b>${pendingTag(t)}<br><small class="text-muted">${esc(t.description || t.category)}</small></td><td>${pesos(t.amount)}</td><td><button class="ghost-btn tx-settle" data-tx-id="${esc(t.id)}">${label}</button></td></tr>`;
      }).join('') : '<tr><td colspan="4">Sin pendientes</td></tr>';
    };
    pendingRows('Ingreso', 'Cobrar');
    pendingRows('Egreso', 'Pagar');

    const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5));
    const flows = months.map(p => { const list = txs.filter(t => monthOf(t.date) === p && operating(t)); return { p, in: sum(list.filter(t => t.type === 'Ingreso')), out: sum(list.filter(t => t.type === 'Egreso')) }; });
    const max = Math.max(1, ...flows.map(f => Math.max(f.in, f.out)));
    el('trFlow').innerHTML = flows.map(f => `<div class="flow-col"><div class="flow-pair"><span class="in" style="height:${f.in / max * 92}%" title="Ingresos ${pesos(f.in)}"></span><span class="out" style="height:${f.out / max * 92}%" title="Egresos ${pesos(f.out)}"></span></div><small>${shortMonth(f.p)}</small></div>`).join('');

    const byCategory = {};
    expense.forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + t.amount; });
    const cats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]), totalOut = sum(expense);
    el('trCategoriesFoot').textContent = `${periodLabel(month)} · ${pesos(totalOut)}`;
    el('trCategoryStack').innerHTML = cats.map(([c, v], i) => `<span style="width:${v / totalOut * 100}%;background:${PALETTE[i % PALETTE.length]}" title="${esc(c)}"></span>`).join('');
    el('trCategoryLegend').innerHTML = cats.length ? cats.map(([c, v], i) => `<div><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(c)} · ${pesos(v)} (${num(v / totalOut * 100, 0)}%)</div>`).join('') : '<div>Sin egresos en el mes</div>';

    const typeFilter = el('trFilterType').value, monthFilter = el('trFilterMonth').value;
    const visible = txs.filter(t => (!typeFilter || t.type === typeFilter) && (!monthFilter || monthOf(t.date) === monthFilter))
      .sort((a, b) => b.date.localeCompare(a.date));
    el('trRows').innerHTML = visible.length ? visible.map(t => `<tr><td>${fmtDate(t.date)}</td><td><span class="badge ${t.type === 'Ingreso' ? 'green' : 'red'}">${t.type}</span></td><td>${esc(t.category)}</td><td><b>${esc(t.counterparty)}</b>${pendingTag(t)}</td><td>${esc(t.description)}</td><td>${esc(t.account)}</td><td class="${t.type === 'Ingreso' ? 'positive' : 'negative'}">${t.type === 'Ingreso' ? '+' : '−'} ${pesos(t.amount)}</td><td><span class="badge ${realized(t) ? 'green' : t.dueDate && t.dueDate < todayISO() ? 'red' : 'amber'}">${esc(t.status)}</span></td><td>${realized(t) ? '—' : `<button class="ghost-btn tx-settle" data-tx-id="${esc(t.id)}">${t.type === 'Ingreso' ? 'Cobrar' : 'Pagar'}</button>`}</td></tr>`).join('') : '<tr><td colspan="9">No hay movimientos para el filtro elegido</td></tr>';
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('.tx-settle');
    if (!button) return;
    const tx = data.transactions.find(t => t.id === button.dataset.txId);
    if (!tx) return;
    button.disabled = true;
    try {
      const status = tx.type === 'Ingreso' ? 'Cobrado' : 'Pagado';
      const result = await api(`/api/transactions/${encodeURIComponent(tx.id)}`, { method: 'PUT', body: JSON.stringify({ status }) });
      replaceItem(data.transactions, { ...result, id: tx.id, status, _pending: !!result.offline });
      renderTreasury();
      savedMessage(result, `Movimiento marcado como ${status.toLowerCase()}`);
    } catch (error) { toast(error.message); button.disabled = false; }
  });
  el('trFilterType').addEventListener('change', renderTreasury);
  el('trFilterMonth').addEventListener('change', renderTreasury);

  function fillTxSelects() {
    const type = el('txType').value;
    el('txCategory').innerHTML = TX_CATEGORIES[type].map(c => `<option>${c}</option>`).join('');
    el('txStatus').innerHTML = TX_STATUS[type].map(s => `<option>${s}</option>`).join('');
  }
  el('txType').addEventListener('change', fillTxSelects);
  // Cuenta bancaria del cobro o pago (solo cuentas en pesos activas; por defecto, la principal)
  function fillTxBankAccounts() {
    const accounts = data.bankAccounts.filter(a => a.status === 'Activa' && a.currency !== 'USD');
    const main = accountBalances(data).main;
    el('txBankAccount').innerHTML = accounts.map(a => `<option value="${esc(a.id)}" ${a.id === main ? 'selected' : ''}>${esc(a.bank)} · ${esc(a.number || a.type)}</option>`).join('') || '<option value="">Sin cuentas cargadas</option>';
    el('txBankField').hidden = el('txAccount').value !== 'Banco';
  }
  el('txAccount').addEventListener('change', fillTxBankAccounts);
  document.querySelectorAll('.open-tx').forEach(b => b.addEventListener('click', () => {
    el('txForm').reset(); el('txType').value = 'Egreso'; fillTxSelects(); fillTxBankAccounts(); el('txDate').value = todayISO();
    el('txDialog').showModal(); setTimeout(() => el('txCounterparty').focus(), 50);
  }));
  el('txForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter; if (submit) submit.disabled = true;
    try {
      const draft = { id: uid('MOV'), date: el('txDate').value, type: el('txType').value, category: el('txCategory').value, counterparty: el('txCounterparty').value.trim(), description: el('txDescription').value.trim(), amount: +el('txAmount').value, account: el('txAccount').value, bankAccountId: el('txAccount').value === 'Banco' ? el('txBankAccount').value : '', status: el('txStatus').value, dueDate: el('txDueDate').value };
      const result = await api('/api/transactions', { method: 'POST', body: JSON.stringify(draft) });
      data.transactions.unshift({ ...draft, ...result, _pending: !!result.offline });
      renderTreasury();
      el('txDialog').close();
      savedMessage(result, 'Movimiento guardado');
    } catch (error) { toast(error.message); } finally { if (submit) submit.disabled = false; }
  });

  /* ================= COSTOS ================= */
  const payroll = () => data.employees.filter(e => e.status === 'Activo' || e.status === 'Licencia').reduce((s, e) => s + (+e.monthlyCost || 0), 0);
  // Toneladas producidas: producción terminada registrada en Inventario; si el mes no tiene, la carga manual
  const RAW_CENTER = 'Materias primas (consumo de inventario)', PARTS_CENTER = 'Repuestos (consumo de inventario)', AMORT_CENTER = 'Amortización de equipos (Equipamiento)';
  // Amortización del período: la calcula Equipamiento (vida útil, valor residual y tipo de cambio de la compra)
  const amortization = period => (typeof window.pbpEquipmentAmortization === 'function' ? (window.pbpData?.equipment || []).reduce((s, e) => s + window.pbpEquipmentAmortization(e, period).inPeriod, 0) : 0);
  const itemOf = id => data.inventoryItems.find(i => i.id === id);
  function productionTons(period) {
    const produced = data.inventoryMovements.filter(m => m.type === 'Producción terminada' && String(m.date).slice(0, 7) === period).reduce((s, m) => { const u = itemOf(m.itemId)?.unit; return s + (u === 'TM' ? m.quantity : u === 'kg' ? m.quantity / 1000 : 0); }, 0);
    if (produced > 0) return { tons: produced, source: 'inventario' };
    const manual = Number((data.settings.costTons || {})[period]) || 0;
    return { tons: manual, source: manual ? 'manual' : 'sin datos' };
  }
  window.pbpProductionTons = productionTons;
  const tonsFor = period => productionTons(period).tons;
  // Lo consumido del inventario en el período, valorizado al costo del momento del consumo
  function consumedValue(period, parts) {
    return data.inventoryMovements.filter(m => ['Consumo en producción', 'Merma'].includes(m.type) && String(m.date).slice(0, 7) === period).reduce((s, m) => {
      const it = itemOf(m.itemId); if (!it || it.category === 'Producto terminado') return s;
      const isPart = it.category.startsWith('Repuesto');
      return isPart === parts ? s + m.quantity * (m.unitCost ?? it.unitCost ?? 0) : s;
    }, 0);
  }
  const periodRows = period => {
    const rows = data.costs.filter(c => c.period === period);
    const labor = payroll(), raw = consumedValue(period, false), parts = consumedValue(period, true), amort = amortization(period);
    return [...rows,
      ...(raw ? [{ id: 'auto-raw', center: RAW_CENTER, type: 'Variable', amount: raw, auto: true }] : []),
      ...(parts ? [{ id: 'auto-parts', center: PARTS_CENTER, type: 'Fijo', amount: parts, auto: true }] : []),
      ...(amort ? [{ id: 'auto-amort', center: AMORT_CENTER, type: 'Fijo', amount: amort, auto: true }] : []),
      ...(labor ? [{ id: 'auto-labor', center: LABOR_CENTER, type: 'Fijo', amount: labor, auto: true }] : [])];
  };
  const isRawRow = r => r.center === RAW_CENTER || r.center === 'Materias primas';
  window.pbpCostSummary = period => {
    const rows = periodRows(period), tons = tonsFor(period), total = rows.reduce((s, r) => s + r.amount, 0);
    const sumOf = centers => rows.filter(r => centers.includes(r.center)).reduce((s, r) => s + r.amount, 0);
    const raw = rows.filter(isRawRow).reduce((s, r) => s + r.amount, 0), energy = sumOf(['Energía eléctrica', 'Vapor / caldera']);
    return { tons, total, raw, energy, perTon: tons ? total / tons : null, conversion: tons ? (total - raw) / tons : null, energyPerTon: tons ? energy / tons : null, rows, price: Number(data.settings.finance?.commercialPrice) || 0 };
  };
  function defaultPeriod() {
    const periods = [...new Set([...data.costs.map(c => c.period), ...Object.keys(data.settings.costTons || {}), ...data.inventoryMovements.map(m => String(m.date).slice(0, 7))])].sort();
    const current = monthOf(todayISO());
    return periods.includes(current) || !periods.length ? current : periods[periods.length - 1];
  }
  function renderCosts() {
    if (!el('costPeriod').value) el('costPeriod').value = defaultPeriod();
    const period = el('costPeriod').value, tons = tonsFor(period), rows = periodRows(period);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const variable = rows.filter(r => r.type === 'Variable').reduce((s, r) => s + r.amount, 0), fixed = total - variable;
    const raw = rows.filter(isRawRow).reduce((s, r) => s + r.amount, 0);
    const price = Number(data.settings.finance?.commercialPrice) || 0, modelOpex = Number(data.settings.finance?.opex) || 0;
    // Con producción registrada en Inventario las toneladas no se cargan a mano
    const src = productionTons(period);
    el('costTons').value = tons ? Math.round(tons * 10) / 10 : '';
    el('costTons').disabled = src.source === 'inventario'; el('saveCostTons').disabled = src.source === 'inventario';
    el('costTons').title = src.source === 'inventario' ? 'Producción terminada registrada en Inventario' : 'Carga manual (el mes no tiene producción registrada en Inventario)';
    el('costTons').closest('.field').querySelector('label').textContent = src.source === 'inventario' ? 'Toneladas producidas (desde Inventario)' : 'Toneladas producidas (carga manual)';
    el('cTotal').textContent = pesos(total);
    el('cTotalFoot').textContent = `${periodLabel(period)} · incluye ${pesos(payroll())} de RRHH`;
    if (!tons) {
      ['cPerTon', 'cMargin', 'cBreakeven', 'cConversion', 'cRawPerTon'].forEach(id => { el(id).textContent = '—'; });
      el('cPerTonFoot').textContent = 'Cargue las toneladas producidas';
      el('cMarginFoot').textContent = `Precio de venta ${pesos(price)}/TM`;
      el('cBreakevenFoot').textContent = 'Requiere toneladas del período';
      el('cConversionFoot').textContent = 'Por TM, sin materias primas';
      el('cRawFoot').textContent = 'Por TM producida';
    } else {
      const perTon = total / tons, margin = price - perTon, contribution = price - variable / tons;
      el('cPerTon').textContent = pesos(perTon);
      el('cPerTonFoot').textContent = `${num(tons)} TM producidas`;
      el('cMargin').textContent = pesos(margin);
      el('cMarginFoot').textContent = `Precio de venta ${pesos(price)}/TM`;
      el('cMarginFoot').className = `metric-foot ${margin >= 0 ? 'positive' : 'negative'}`;
      if (contribution > 0) {
        const breakeven = fixed / contribution;
        el('cBreakeven').textContent = `${num(breakeven)} TM`;
        el('cBreakevenFoot').textContent = `${num(breakeven / tons * 100, 0)}% de la producción del período`;
        el('cBreakevenFoot').className = `metric-foot ${breakeven <= tons ? 'positive' : 'negative'}`;
      } else {
        el('cBreakeven').textContent = 'Sin equilibrio';
        el('cBreakevenFoot').textContent = 'El costo variable supera el precio';
        el('cBreakevenFoot').className = 'metric-foot negative';
      }
      const conversion = (total - raw) / tons;
      el('cConversion').textContent = pesos(conversion);
      el('cConversionFoot').textContent = `Por TM · modelo de viabilidad: ${pesos(modelOpex)}`;
      el('cRawPerTon').textContent = pesos(raw / tons);
      el('cRawFoot').textContent = `${num(raw / total * 100, 1)}% del costo total`;
    }
    const sorted = [...rows].sort((a, b) => b.amount - a.amount);
    el('cStructureFoot').textContent = `Variables ${pesos(variable)} · Fijos ${pesos(fixed)}`;
    el('cStack').innerHTML = total ? sorted.map((r, i) => `<span style="width:${r.amount / total * 100}%;background:${PALETTE[i % PALETTE.length]}" title="${esc(r.center)}"></span>`).join('') : '';
    el('cLegend').innerHTML = sorted.length ? sorted.map((r, i) => `<div><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(r.center)} · ${num(r.amount / total * 100, 1)}%</div>`).join('') : '<div>Sin costos en el período</div>';
    const status = el('cStatus');
    if (!tons) { status.style.setProperty('--status-color', 'var(--orange)'); status.innerHTML = '<b>Faltan las toneladas del período.</b> Sin ese dato no se puede calcular el costo unitario.'; }
    else {
      const margin = price - total / tons;
      const marginPct = price ? margin / price * 100 : 0;
      status.style.setProperty('--status-color', marginPct > 4 ? 'var(--ok)' : margin >= 0 ? 'var(--orange)' : 'var(--red)');
      status.innerHTML = margin >= 0
        ? `<b>${marginPct > 4 ? 'Costo bajo control.' : 'Margen ajustado.'}</b> El precio de venta cubre el costo total con ${pesos(margin)} por tonelada.`
        : `<b>Costo por encima del precio.</b> Cada tonelada cuesta ${pesos(-margin)} más de lo que se cobra: revisar materias primas y conversión.`;
    }
    el('costCenterRows').innerHTML = sorted.length ? sorted.map(r => `<tr><td><b>${esc(r.center)}</b>${r.auto ? ' <span class="badge blue">auto</span>' : ''}</td><td>${r.type}</td><td>${pesos(r.amount)}</td><td>${tons ? pesos(r.amount / tons) : '—'}</td><td>${total ? num(r.amount / total * 100, 1) : 0}%</td></tr>`).join('') + `<tr><td><b>Total</b></td><td></td><td><b>${pesos(total)}</b></td><td><b>${tons ? pesos(total / tons) : '—'}</b></td><td>100%</td></tr>` : '<tr><td colspan="5">Sin costos en el período</td></tr>';

    const trendPeriods = [...new Set([...data.costs.map(c => c.period), ...data.inventoryMovements.map(m => String(m.date).slice(0, 7)), period])].filter(p => tonsFor(p) > 0).sort().slice(-6);
    const trend = trendPeriods.map(p => ({ p, v: periodRows(p).reduce((s, r) => s + r.amount, 0) / tonsFor(p) }));
    const maxV = Math.max(1, ...trend.map(t => t.v));
    el('cTrend').innerHTML = trend.length ? trend.map(t => `<div class="bar-col"><div class="bar" style="height:${t.v / maxV * 90}%${t.p === period ? '' : ';opacity:.55'}"><span class="bar-tip">${pesos(t.v)}/TM</span></div><span>${shortMonth(t.p)}</span></div>`).join('') : '<p class="text-muted">Cargue toneladas en al menos un período para ver la evolución.</p>';

    const manual = data.costs.filter(c => c.period === period);
    el('costRows').innerHTML = manual.length ? manual.map(c => `<tr><td><b>${esc(c.center)}</b>${pendingTag(c)}</td><td>${esc(c.type)}</td><td>${pesos(c.amount)}</td><td>${esc(c.note)}</td><td><button class="danger-btn cost-delete" data-cost-id="${esc(c.id)}" aria-label="Eliminar costo">×</button></td></tr>`).join('') : '<tr><td colspan="5">Sin registros manuales en el período</td></tr>';
    if (el('cOrigin')) renderLotsEconomy();
  }
  el('costPeriod').addEventListener('change', renderCosts);
  el('saveCostTons').addEventListener('click', async () => {
    const period = el('costPeriod').value, tons = Number(el('costTons').value);
    if (!period || !Number.isFinite(tons) || tons < 0) return toast('Ingrese las toneladas del período');
    const value = { ...(data.settings.costTons || {}), [period]: tons };
    try {
      const result = await api('/api/settings/costTons', { method: 'PUT', body: JSON.stringify({ value }) });
      data.settings.costTons = value;
      renderCosts(); renderHR();
      savedMessage(result, 'Producción del período guardada');
    } catch (error) { toast(error.message); }
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('.cost-delete');
    if (!button) return;
    const id = button.dataset.costId;
    if (!confirm('¿Eliminar este registro de costo?')) return;
    button.disabled = true;
    try {
      const result = await api(`/api/costs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      data.costs = data.costs.filter(c => c.id !== id);
      renderCosts();
      savedMessage(result, 'Registro eliminado');
    } catch (error) { toast(error.message); button.disabled = false; }
  });
  el('costCenter').innerHTML = Object.keys(COST_CENTERS).map(c => `<option>${c}</option>`).join('');
  el('costCenter').addEventListener('change', () => { el('costType').value = COST_CENTERS[el('costCenter').value]; });
  document.querySelectorAll('.open-cost').forEach(b => b.addEventListener('click', () => {
    el('costForm').reset(); el('costEntryPeriod').value = el('costPeriod').value || monthOf(todayISO());
    el('costType').value = COST_CENTERS[el('costCenter').value];
    el('costDialog').showModal(); setTimeout(() => el('costAmount').focus(), 50);
  }));
  el('costForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter; if (submit) submit.disabled = true;
    try {
      const draft = { id: uid('CST'), period: el('costEntryPeriod').value, center: el('costCenter').value, type: el('costType').value, amount: +el('costAmount').value, note: el('costNote').value.trim() };
      const result = await api('/api/costs', { method: 'POST', body: JSON.stringify(draft) });
      data.costs.unshift({ ...draft, ...result, _pending: !!result.offline });
      el('costPeriod').value = draft.period;
      renderCosts();
      el('costDialog').close();
      savedMessage(result, 'Costo registrado');
    } catch (error) { toast(error.message); } finally { if (submit) submit.disabled = false; }
  });

  /* ================= RRHH ================= */
  function renderHR() {
    const emps = data.employees, today = todayISO();
    const active = emps.filter(e => e.status === 'Activo'), leave = emps.filter(e => e.status === 'Licencia'), current = emps.filter(e => e.status !== 'Baja');
    el('hrActive').textContent = active.length;
    el('hrActiveFoot').textContent = `${leave.length} en licencia · ${emps.length - current.length} de baja`;
    const cost = payroll();
    el('hrCost').textContent = pesos(cost);
    el('hrCostFoot').textContent = current.length ? `Promedio ${pesos(cost / current.length)} por persona` : 'Sin personal cargado';
    const months = [...new Set([...Object.keys(data.settings.costTons || {}), ...data.inventoryMovements.map(m => String(m.date).slice(0, 7))])].map(p => [p, tonsFor(p)]).filter(([, t]) => t > 0).sort((a, b) => a[0].localeCompare(b[0]));
    const last = months[months.length - 1];
    el('hrCostTon').textContent = last ? pesos(cost / Number(last[1])) : '—';
    el('hrCostTonFoot').textContent = last ? `Sobre ${num(+last[1])} TM de ${periodLabel(last[0])}` : 'Cargue toneladas en Costos';
    const overdue = current.filter(e => e.trainingDue && e.trainingDue < today);
    const soon = current.filter(e => e.trainingDue && e.trainingDue >= today && daysUntil(e.trainingDue) <= 30);
    el('hrTraining').textContent = overdue.length;
    const missingTrn = window.pbpTrainingSummary ? window.pbpTrainingSummary().people.filter(p => p.pending.some(i => i.state === 'missing')).length : 0;
    el('hrTrainingFoot').textContent = `Vencidas · ${soon.length} vencen en 30 días${missingTrn ? ` · ${missingTrn} con temas sin registrar` : ''}`;
    el('hrTrainingFoot').className = `metric-foot ${overdue.length ? 'negative' : soon.length || missingTrn ? 'warning' : 'positive'}`;

    const structure = STRUCTURES[el('hrScale').value];
    let missing = 0;
    el('hrCoverage').innerHTML = structure.positions.map(([position, required]) => {
      const have = active.filter(e => e.position === position).length;
      if (have < required) missing += required - have;
      return `<div class="coverage-row"><span>${esc(position)}</span><div class="track"><span class="${have >= required ? 'full' : 'short'}" style="width:${Math.min(have / required, 1) * 100}%"></span></div><b>${have}/${required}</b></div>`;
    }).join('');
    const required = structure.positions.reduce((s, [, r]) => s + r, 0);
    const coverage = el('hrCoverageStatus');
    coverage.style.setProperty('--status-color', missing ? 'var(--orange)' : 'var(--ok)');
    coverage.innerHTML = missing
      ? `<b>Faltan ${missing} puesto${missing === 1 ? '' : 's'}</b> para la estructura de ${structure.label} (${required} personas).${leave.length ? ` ${leave.length} persona${leave.length === 1 ? ' está' : 's están'} en licencia y no cubre${leave.length === 1 ? '' : 'n'} su puesto.` : ''}`
      : `<b>Estructura completa</b> para ${structure.label}: ${required} puestos cubiertos.`;

    el('hrShifts').innerHTML = ['Mañana', 'Tarde', 'Noche', 'Rotativo'].map(s => `<div><span>${s}</span><b>${active.filter(e => e.shift === s).length}</b></div>`).join('');
    const alerts = [
      ...overdue.map(e => ({ color: 'var(--red)', title: `Capacitación vencida · ${e.name}`, time: fmtDate(e.trainingDue), text: `${e.position}. Renovar capacitación y entrega de EPP.` })),
      ...soon.map(e => ({ color: 'var(--orange)', title: `Vence capacitación · ${e.name}`, time: fmtDate(e.trainingDue), text: `${e.position}. Faltan ${daysUntil(e.trainingDue)} días.` })),
      ...leave.map(e => ({ color: 'var(--blue)', title: `En licencia · ${e.name}`, time: e.shift, text: `${e.position}. Prever reemplazo en el turno.` }))
    ];
    el('hrAlerts').innerHTML = alerts.length ? alerts.map(a => `<div class="alert" style="--alert:${a.color}"><b>${esc(a.title)}</b><time>${esc(a.time)}</time><p>${esc(a.text)}</p></div>`).join('') : '<div class="alert" style="--alert:var(--ok)"><b>Sin alertas</b><time></time><p>Capacitaciones al día y sin licencias.</p></div>';

    const sorted = [...emps].sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));
    el('hrRows').innerHTML = sorted.length ? sorted.map(e => {
      const late = e.trainingDue < today, near = !late && daysUntil(e.trainingDue) <= 30;
      return `<tr><td><b>${esc(e.id)}</b>${pendingTag(e)}</td><td>${esc(e.name)}</td><td>${esc(e.position)}<br><small class="text-muted">${esc(e.area)}</small></td><td><select class="hr-change" data-field="shift" data-emp-id="${esc(e.id)}">${['Mañana', 'Tarde', 'Noche', 'Rotativo'].map(s => `<option ${s === e.shift ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><span class="badge blue">${esc(e.systemRole)}</span></td><td>${fmtDate(e.startDate)}</td><td>${pesos(e.monthlyCost)}</td><td><span class="badge ${late ? 'red' : near ? 'amber' : 'green'}">${late ? 'Vencida ' : ''}${fmtDate(e.trainingDue)}</span></td><td><select class="hr-change" data-field="status" data-emp-id="${esc(e.id)}">${['Activo', 'Licencia', 'Baja'].map(s => `<option ${s === e.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td class="row-actions"><button class="ghost-btn" data-emp-edit="${esc(e.id)}">Editar</button></td></tr>`;
    }).join('') : '<tr><td colspan="10">Sin legajos cargados</td></tr>';

    el('hrRoleRows').innerHTML = ROLES.map(([code, profile, plant, actions]) => `<tr><td><span class="badge blue">${code}</span></td><td><b>${profile}</b></td><td>${plant}</td><td style="white-space:normal;min-width:260px">${actions}</td><td>${current.filter(e => e.systemRole === code).length}</td></tr>`).join('');
  }
  el('hrScale').addEventListener('change', renderHR);
  document.addEventListener('change', async event => {
    const select = event.target.closest('.hr-change');
    if (!select) return;
    const id = select.dataset.empId, field = select.dataset.field;
    select.disabled = true;
    try {
      const result = await api(`/api/employees/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ [field]: select.value }) });
      replaceItem(data.employees, { ...result, id, [field]: select.value, _pending: !!result.offline });
      renderHR(); renderCosts();
      savedMessage(result, 'Legajo actualizado');
    } catch (error) { toast(error.message); renderHR(); }
  });
  el('empPosition').innerHTML = Object.keys(POSITIONS).map(p => `<option>${p}</option>`).join('');
  el('empArea').innerHTML = AREAS.map(a => `<option>${a}</option>`).join('');
  el('empRole').innerHTML = ROLES.map(([code, profile]) => `<option value="${code}">${code} · ${profile}</option>`).join('');
  const syncPositionDefaults = () => { const [area, role] = POSITIONS[el('empPosition').value]; el('empArea').value = area; el('empRole').value = role; };
  el('empPosition').addEventListener('change', syncPositionDefaults);
  let editingEmployee = null;
  const setEmployeeMode = emp => {
    editingEmployee = emp;
    el('employeeDialogTitle').textContent = emp ? `Editar legajo · ${emp.name}` : 'Nuevo legajo';
    el('empSubmit').textContent = emp ? 'Guardar cambios' : 'Guardar legajo';
    el('empId').readOnly = !!emp;
  };
  el('hrRows').addEventListener('click', e => {
    const b = e.target.closest('[data-emp-edit]'); if (!b) return;
    const emp = data.employees.find(x => x.id === b.dataset.empEdit); if (!emp) return;
    el('employeeForm').reset(); setEmployeeMode(emp);
    el('empId').value = emp.id; el('empName').value = emp.name; el('empPosition').value = emp.position; el('empArea').value = emp.area; el('empRole').value = emp.systemRole;
    el('empShift').value = emp.shift; el('empStart').value = emp.startDate; el('empCost').value = emp.monthlyCost; el('empStatus').value = emp.status; el('empTraining').value = emp.trainingDue || '';
    el('employeeDialog').showModal(); setTimeout(() => el('empName').focus(), 50);
  });
  document.querySelectorAll('.open-employee').forEach(b => b.addEventListener('click', () => {
    el('employeeForm').reset(); setEmployeeMode(null);
    const next = Math.max(0, ...data.employees.map(e => Number(String(e.id).replace(/\D/g, '')) || 0)) + 1;
    el('empId').value = `LEG-${String(next).padStart(3, '0')}`;
    syncPositionDefaults();
    el('empStart').value = todayISO();
    const due = new Date(); due.setFullYear(due.getFullYear() + 1); el('empTraining').value = due.toLocaleDateString('sv-SE');
    el('employeeDialog').showModal(); setTimeout(() => el('empName').focus(), 50);
  }));
  el('employeeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter; if (submit) submit.disabled = true;
    try {
      const draft = { id: el('empId').value.trim(), name: el('empName').value.trim(), position: el('empPosition').value, area: el('empArea').value, systemRole: el('empRole').value, shift: el('empShift').value, startDate: el('empStart').value, monthlyCost: +el('empCost').value, status: el('empStatus').value, trainingDue: el('empTraining').value };
      if (editingEmployee) {
        const { id, ...changes } = draft;
        const result = await api(`/api/employees/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(changes) });
        replaceItem(data.employees, { ...draft, _pending: !!result.offline });
        renderHR(); renderCosts();
        el('employeeDialog').close();
        document.dispatchEvent(new CustomEvent('pbp:bootstrap', { detail: window.pbpData }));
        return savedMessage(result, 'Legajo actualizado');
      }
      if (data.employees.some(e => e.id === draft.id)) throw new Error('Ese legajo ya existe');
      const result = await api('/api/employees', { method: 'POST', body: JSON.stringify(draft) });
      data.employees.push({ ...draft, ...result, _pending: !!result.offline });
      renderHR(); renderCosts();
      el('employeeDialog').close();
      savedMessage(result, 'Legajo guardado');
    } catch (error) { toast(error.message); } finally { if (submit) submit.disabled = false; }
  });

  /* ================= MATERIA PRIMA DE LOTES (tenencia) ================= */
  const TENURES = [['Propio', 'var(--ok)'], ['Arrendamiento', 'var(--orange)'], ['Aparcería', 'var(--blue)']];
  // Precios de mercado en pesos ($/TM), como la pizarra de Rosario
  const DEFAULT_PRICES_ARS = { 'Maíz': 293500, 'Soja': 560000, 'Sorgo': 262000, 'Trigo': 342700, 'Otro': 270000 };
  const PIZARRA_CROPS = { MAIZ: 'Maíz', SOJA: 'Soja', SORGO: 'Sorgo', TRIGO: 'Trigo' };
  const grainPricesArs = () => ({ ...DEFAULT_PRICES_ARS, ...(data.settings.grainPricesArs || {}) });
  let mep = null, mepStale = false; // dólar MEP del día (DolarAPI): { venta, compra, fecha, fuente }

  // Economía de la campaña de un lote según su tenencia
  function lotEconomics(lot, pricesArs) {
    const ha = Number(lot.hectares) || 0, tenure = lot.tenure || 'Propio', aparceria = tenure === 'Aparcería';
    const gross = ha * (Number(lot.expectedYield) || 0);
    const ownerShare = aparceria ? (Number(lot.ownerSharePct) || 0) / 100 : 0;
    const ownerCost = aparceria ? (Number(lot.ownerCostPct) || 0) / 100 : 0;
    const plantTons = gross * (1 - ownerShare);
    const production = ha * (Number(lot.productionCost) || 0) * (1 - ownerCost);
    const rent = tenure === 'Arrendamiento' ? ha * (Number(lot.rentPerHa) || 0) : 0;
    const total = production + rent;
    const marketArs = Number(pricesArs[lot.crop] ?? pricesArs['Otro']) || 0;
    const market = marketArs;
    const marketValue = market === null ? null : plantTons * market;
    return { lot, tenure, ha, gross, plantTons, production, rent, total, marketArs, market, costPerTon: plantTons ? total / plantTons : null, marketValue, saving: marketValue === null ? null : marketValue - total };
  }
  function summarize(rows) {
    const sum = key => rows.reduce((s, r) => s + (r[key] || 0), 0);
    const tons = sum('plantTons'), total = sum('total'), priced = rows.every(r => r.market !== null);
    return { count: rows.length, ha: sum('ha'), tons, total, costPerTon: tons ? total / tons : null, marketValue: priced ? sum('marketValue') : null, saving: priced ? sum('saving') : null };
  }
  function tenureBoxes(rows, mode) {
    const groups = TENURES.map(([name, color]) => [name, color, summarize(rows.filter(r => r.tenure === name))]);
    groups.push(['Total', 'var(--accent)', summarize(rows)]);
    return groups.map(([name, color, g]) => `<div class="tenure-box" style="--tenure-color:${color}"><span>${name}</span><b>${num(g.tons)} TM</b><small>${g.count} lote${g.count === 1 ? '' : 's'} · ${num(g.ha, 1)} ha<br>${g.costPerTon === null ? 'Sin cosecha estimada' : `Costo ${pesos(g.costPerTon)}/TM`}${mode === 'costs' && g.tons && g.saving !== null ? `<em class="${g.saving >= 0 ? 'positive' : 'negative'}">${g.saving >= 0 ? 'Ahorro' : 'Sobrecosto'} ${pesos(Math.abs(g.saving))}</em>` : ''}</small></div>`).join('');
  }
  // Cotización usada para mostrar en pesos los equipos importados (Equipamiento y Pliego)
  function renderMepChip() {
    const chip = el('equipMepInfo'), info = mep || data.settings.mepRate;
    window.pbpFx = info && Number(info.venta) ? info : null;
    chip.classList.remove('stale', 'missing');
    if (!info || !Number(info.venta)) { chip.textContent = 'Dólar MEP sin cotización: se necesita conexión una vez para pasar a pesos los equipos en USD'; chip.classList.add('missing'); return; }
    const when = info.fecha ? new Date(info.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const old = info.fecha && (Date.now() - new Date(info.fecha)) / 86400000 > 2;
    chip.textContent = `Dólar MEP (venta) ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(info.venta)} · DolarAPI${when ? ` · ${when}` : ''}${mepStale || old ? ' · última cotización guardada' : ''}`;
    chip.title = 'Los equipos cargados en dólares se pasan a pesos con esta cotización';
    if (mepStale || old) chip.classList.add('stale');
  }
  function renderLotsEconomy() {
    const prices = grainPricesArs();
    const rows = (data.lots || []).filter(l => l.status !== 'Inactivo').map(l => lotEconomics(l, prices));
    // --- página Lotes ---
    el('lotEconSummary').innerHTML = tenureBoxes(rows, 'lots');
    el('lotEconRows').innerHTML = rows.length ? rows.map(r => {
      const aparceria = r.tenure === 'Aparcería';
      const tenureNote = aparceria ? `<br><small class="text-muted">${num(+r.lot.ownerSharePct, 1)}% cosecha · ${num(+r.lot.ownerCostPct || 0, 1)}% costos al propietario</small>` : '';
      return `<tr><td><b>${esc(r.lot.id)}</b>${pendingTag(r.lot)}<br><small class="text-muted">${esc(r.lot.name)}</small></td><td><span class="badge ${r.tenure === 'Arrendamiento' ? 'amber' : aparceria ? 'blue' : 'green'}">${esc(r.tenure)}</span>${tenureNote}</td><td>${esc(r.lot.crop)}</td><td>${num(r.gross)} TM<br><small class="text-muted">${num(+r.lot.expectedYield, 1)} TM/ha</small></td><td><b>${num(r.plantTons)} TM</b></td><td>${pesos(r.production)}</td><td>${r.rent ? pesos(r.rent) : '—'}</td><td>${r.costPerTon === null ? '—' : pesos(r.costPerTon)}</td><td>${pesos(r.marketArs)}</td><td class="${r.saving === null ? '' : r.saving >= 0 ? 'positive' : 'negative'}">${r.plantTons && r.saving !== null ? `${r.saving >= 0 ? '+' : '−'} ${pesos(Math.abs(r.saving))}` : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="10">No hay lotes activos</td></tr>';
    const crops = [...new Set([...Object.keys(prices), ...(data.lots || []).map(l => l.crop)])];
    const inputs = el('lotEconPrices');
    // No pisar lo que el usuario está escribiendo
    if (!inputs.contains(document.activeElement)) inputs.innerHTML = crops.map(c => { const v = Number(prices[c] ?? prices['Otro']) || 0; return `<label>${esc(c)} $<input type="number" min="0" step="100" data-crop="${esc(c)}" value="${v}"></label>`; }).join('');

    // --- página Costos: origen de la materia prima ---
    const all = summarize(rows), period = el('costPeriod').value, tons = tonsFor(period);
    el('cOrigin').innerHTML = tenureBoxes(rows, 'costs');
    const status = el('cOriginStatus');
    if (!all.tons) {
      status.style.setProperty('--status-color', 'var(--orange)');
      status.innerHTML = '<b>Sin cosecha estimada.</b> Cargue rinde esperado y costos en los lotes para comparar contra la compra a mercado.';
    } else {
      const avgMarket = all.marketValue / all.tons, diff = avgMarket - all.costPerTon;
      const share = tons ? ` Es un volumen equivalente al ${num(all.tons / (tons * 12) * 100, 0)}% del alimento que la planta produce en un año al ritmo de ${periodLabel(period)}.` : '';
      status.style.setProperty('--status-color', diff >= 0 ? 'var(--ok)' : 'var(--red)');
      status.innerHTML = diff >= 0
        ? `<b>El grano de lotes sale ${pesos(all.costPerTon)}/TM</b>, ${num(diff / avgMarket * 100, 1)}% menos que comprarlo (${pesos(avgMarket)}/TM): ahorro estimado de ${pesos(all.saving)} por campaña.${share}`
        : `<b>El grano de lotes sale ${pesos(all.costPerTon)}/TM</b>, más caro que comprarlo (${pesos(avgMarket)}/TM): sobrecosto de ${pesos(-all.saving)} por campaña. Revisar alquileres y porcentajes de aparcería.${share}`;
    }
  }
  async function refreshMep() {
    try {
      const result = await api('/api/market/dolar');
      if (result && result.mep) { mep = result.mep; mepStale = !!result.stale || !!result.offline; }
    } catch { mepStale = true; }
    renderMepChip();
    if (typeof renderEquipment === 'function') renderEquipment();
    document.dispatchEvent(new Event('pbp:fx'));
  }
  el('saveGrainPrices').addEventListener('click', async () => {
    const value = {};
    el('lotEconPrices').querySelectorAll('input[data-crop]').forEach(input => { value[input.dataset.crop] = Number(input.value) || 0; });
    try {
      const result = await api('/api/settings/grainPricesArs', { method: 'PUT', body: JSON.stringify({ value }) });
      data.settings.grainPricesArs = value;
      renderLotsEconomy();
      savedMessage(result, 'Precios de mercado guardados');
    } catch (error) { toast(error.message); }
  });
  el('loadPizarra').addEventListener('click', async () => {
    const button = el('loadPizarra');
    button.disabled = true;
    try {
      const pizarra = await api('/api/market/pizarra');
      let loaded = 0;
      for (const [key, crop] of Object.entries(PIZARRA_CROPS)) {
        const price = pizarra.precios?.[key]?.pesos;
        const input = el('lotEconPrices').querySelector(`input[data-crop="${CSS.escape(crop)}"]`);
        if (price && input) { input.value = Math.round(price); input.dispatchEvent(new Event('input', { bubbles: true })); loaded++; }
      }
      toast(loaded ? `Pizarra de Rosario del ${fmtDate(pizarra.fecha)} cargada (${loaded} granos). Revise y guarde los precios.` : 'La pizarra no trajo precios para estos granos');
    } catch (error) { toast(error.message); } finally { button.disabled = false; }
  });
  // Formulario de lote: mostrar alquiler o porcentajes según la tenencia
  function syncTenureFields() {
    const tenure = el('lotTenure').value;
    el('lotRentField').hidden = tenure !== 'Arrendamiento';
    el('lotShareField').hidden = tenure !== 'Aparcería';
    el('lotOwnerCostField').hidden = tenure !== 'Aparcería';
    el('lotRent').required = tenure === 'Arrendamiento';
    el('lotOwnerShare').required = tenure === 'Aparcería';
    el('lotOwnerCost').required = tenure === 'Aparcería';
  }
  el('lotTenure').addEventListener('change', syncTenureFields);
  el('lotForm').addEventListener('reset', () => setTimeout(syncTenureFields, 0));
  document.addEventListener('plantabase:lots', event => { data.lots = Array.isArray(event.detail) ? event.detail : data.lots; renderLotsEconomy(); });
  refreshMep();
  setInterval(refreshMep, 30 * 60000);

  /* ================= común ================= */
  document.querySelectorAll('[data-close-dialog]').forEach(b => b.addEventListener('click', () => el(b.dataset.closeDialog).close()));
  function renderAll() { renderTreasury(); renderCosts(); renderHR(); renderLotsEconomy(); renderMepChip(); }
  document.addEventListener('pbp:bootstrap', event => load(event.detail));
  if (window.pbpData) load(window.pbpData); else renderAll();
})();
