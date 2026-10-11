/* Pampa PBP - PampaIA
 * 1) Diagnóstico automático: reglas sobre los datos de todos los módulos (costos, stock, calidad,
 *    PLC, tesorería, equipos, personal y mercado). Corre en el navegador y funciona sin conexión.
 * 2) Consultas en lenguaje natural: el navegador arma un resumen de la planta y el servidor local lo
 *    envía al proveedor configurado (Claude, OpenAI o compatible, u Ollama en esta PC). La clave queda
 *    en el servidor local y nunca vuelve al navegador. La IA no modifica registros.
 * Usa helpers del script principal (toast, escapeHTML, num, money, go) y window.pbpData.
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  if (!el('page-ai')) return;
  const esc = v => escapeHTML(v ?? '');
  const todayISO = () => new Date().toLocaleDateString('sv-SE');
  const fmtDate = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
  const daysUntil = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
  const pesos = v => money(Number(v) || 0);
  const n = (v, d = 0) => num(Number(v) || 0, d);
  const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
  const D = () => window.pbpData || {};
  const list = key => (Array.isArray(D()[key]) ? D()[key] : []);
  const settings = () => D().settings || {};
  const periodLabel = p => { const [y, m] = p.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }); };
  const shiftPeriod = (p, k) => { const [y, m] = p.split('-').map(Number), d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const allowed = page => (typeof window.pbpAllowedPage === 'function' ? window.pbpAllowedPage(page) : true);
  // Las consultas a la IA no pasan por la cola offline: sin servidor no tiene sentido encolarlas
  async function call(path, method = 'GET', body) {
    let res;
    try { res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); }
    catch { throw new Error('Sin conexión con el servidor de la planta'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.offline) throw new Error(data.error || 'Sin conexión con el servidor de la planta');
    return data;
  }

  /* ---------- diagnóstico automático ---------- */
  function insights() {
    const out = [], add = (level, title, text, page) => out.push({ level, title, text, page });
    const today = todayISO(), period = today.slice(0, 7), prev = shiftPeriod(period, -1);
    const cs = window.pbpCostSummary, inv = window.pbpInventorySummary ? window.pbpInventorySummary() : null;
    const qs = window.pbpQualitySummary ? window.pbpQualitySummary() : null;

    // Costo por tonelada y margen (materias primas = consumo de inventario)
    if (cs) {
      const a = cs(period), b = cs(prev);
      if (a.perTon !== null && b.perTon !== null) {
        const change = (a.perTon - b.perTon) / b.perTon * 100;
        const byCenter = s => (s.rows || []).reduce((m, r) => m.set(r.center, (m.get(r.center) || 0) + r.amount), new Map());
        const ca = byCenter(a), cb = byCenter(b);
        const top = [...new Set([...ca.keys(), ...cb.keys()])].map(k => [k, (ca.get(k) || 0) / a.tons - (cb.get(k) || 0) / b.tons]).sort((x, z) => Math.abs(z[1]) - Math.abs(x[1]))[0];
        if (Math.abs(change) >= 3) add(change > 0 ? 'amber' : 'green', `El costo por tonelada ${change > 0 ? 'subió' : 'bajó'} ${n(Math.abs(change), 1)}% contra ${periodLabel(prev)}`, `${pesos(a.perTon)}/TM contra ${pesos(b.perTon)}/TM.${top ? ` Lo que más explica la diferencia: ${top[0]} (${top[1] > 0 ? '+' : ''}${pesos(top[1])}/TM).` : ''}`, 'costs');
        else add('green', 'Costo por tonelada estable', `${pesos(a.perTon)}/TM en ${periodLabel(period)} (${change > 0 ? '+' : ''}${n(change, 1)}% contra ${periodLabel(prev)}).`, 'costs');
      }
      if (a.perTon !== null && a.price) {
        const m = a.price - a.perTon, share = m / a.price * 100;
        if (m < 0) add('red', 'Margen negativo por tonelada', `Se vende a ${pesos(a.price)}/TM y cuesta ${pesos(a.perTon)}/TM: se pierden ${pesos(-m)} por tonelada. Revisar precio o la fórmula de las recetas.`, 'costs');
        else if (share < 8) add('amber', `Margen ajustado: ${n(share, 1)}% del precio`, `${pesos(m)}/TM de margen sobre ${pesos(a.price)}/TM. Una suba chica de materias primas lo deja en cero.`, 'costs');
        else add('green', `Margen de ${pesos(m)}/TM (${n(share, 1)}%)`, `Precio de referencia ${pesos(a.price)}/TM contra un costo de ${pesos(a.perTon)}/TM.`, 'costs');
      }
    }

    // Cobertura de stock: días que alcanza cada insumo al ritmo de los últimos 30 días
    if (inv) {
      const raw = inv.items.filter(x => !['Producto terminado'].includes(x.item.category) && !x.item.category.startsWith('Repuesto'));
      raw.filter(x => x.level === 'out').forEach(x => add('red', `Sin stock: ${x.item.name}`, 'No se puede producir con las recetas que lo usan hasta reponerlo.', 'inventory'));
      raw.filter(x => x.level !== 'out' && x.days !== null && x.days < 15).sort((a, z) => a.days - z.days).slice(0, 4).forEach(x => {
        const daily = x.stock / x.days, need = Math.max(0, daily * 30 - x.stock);
        add(x.days < 7 ? 'red' : 'amber', `${x.item.name}: alcanza para ${n(x.days)} ${Math.round(x.days) === 1 ? "día" : "días"}`, `Stock ${n(x.stock, 1)} ${x.item.unit}, consumo promedio ${n(daily, 2)} ${x.item.unit}/día. Para cubrir 30 días hay que comprar unos ${n(need, 1)} ${x.item.unit} (≈ ${pesos(need * (x.item.unitCost || 0))}).`, 'inventory');
      });
      raw.filter(x => x.level === 'low' && !(x.days !== null && x.days < 15)).slice(0, 3).forEach(x => add('amber', `${x.item.name} bajo el mínimo`, `${n(x.stock, 1)} ${x.item.unit} contra un mínimo de ${n(x.item.minStock, 1)} ${x.item.unit}.`, 'inventory'));
      const pt = inv.installations.filter(x => x.ins.type === 'Silo de producto terminado' && x.ins.status !== 'Fuera de servicio');
      const cap = pt.reduce((s, x) => s + x.ins.capacity, 0), used = pt.reduce((s, x) => s + x.used, 0);
      if (cap && used / cap > 0.9) add('amber', `Silos de producto terminado al ${n(used / cap * 100)}%`, 'Quedan pocas toneladas libres: priorizar despachos o el próximo cierre de lote no va a tener dónde descargar.', 'installations');
    }

    // Calidad: PLC del acondicionador, controles recientes, laboratorio y homogeneidad
    if (qs) {
      const plc = qs.plc ? qs.plc() : null;
      const temp = (plc?.parameters || []).find(p => p.equipmentName === 'ACONDICIONADOR' && p.parameterMeasured === 'TEMPERATURA');
      if (temp && temp.criticalCount) add('red', `PCC térmico: ${temp.criticalCount} lecturas del PLC bajo el mínimo en 24 h`, `Mínimo registrado ${n(temp.min, 1)} °C${temp.lastOut?.batchId ? ` en el lote ${temp.lastOut.batchId}` : ''}. Retener y evaluar el lote antes de despacharlo.`, 'quality');
      const recent = list('qualityBatchControls').filter(c => daysUntil(c.date) >= -7).map(c => ({ c, e: qs.evalControl(c) }));
      const pcc = recent.filter(x => !x.e.pccOk), other = recent.filter(x => x.e.pccOk && !x.e.ok);
      if (pcc.length) add('red', `${pcc.length} lote${pcc.length === 1 ? '' : 's'} con desvío en el PCC térmico (7 días)`, pcc.map(x => x.c.batchId).join(', '), 'quality');
      if (other.length) {
        const fails = other.flatMap(x => x.e.fails), common = Object.entries(fails.reduce((m, f) => ({ ...m, [f]: (m[f] || 0) + 1 }), {})).sort((a, z) => z[1] - a[1])[0];
        const LABEL = { microns: 'granulometría', pdi: 'durabilidad del pellet', moisture: 'humedad', conditionerTemp: 'temperatura', retentionSec: 'retención' };
        add('amber', `${other.length} control${other.length === 1 ? '' : 'es'} con desvío de calidad (7 días)`, `El desvío más repetido es ${LABEL[common[0]] || common[0]}.${common[0] === 'pdi' ? ' Revisar vapor del acondicionador, matriz y enfriado.' : common[0] === 'microns' ? ' Revisar cribas y martillos del molino.' : ''}`, 'quality');
      }
      const rejected = list('labAnalyses').filter(a => a.verdict === 'Rechazado' && daysUntil(a.date) >= -30);
      if (rejected.length) add('amber', `${rejected.length} materia${rejected.length === 1 ? '' : 's'} prima${rejected.length === 1 ? '' : 's'} rechazada${rejected.length === 1 ? '' : 's'} en 30 días`, rejected.map(a => `${a.rawMaterial} (${a.supplier || a.supplierLot})`).join(', '), 'quality');
      const lastHom = [...list('homogeneityTests')].sort((a, z) => z.date.localeCompare(a.date))[0];
      if (!lastHom || daysUntil(lastHom.date) < -30) add('blue', 'Ensayo de homogeneidad vencido', lastHom ? `El último fue el ${fmtDate(lastHom.date)}: corresponde uno por mes.` : 'No hay ensayos registrados.', 'quality');
    }

    // Tesorería: lo que vence en 15 días contra lo disponible
    if (window.pbpAccountBalances) {
      const bal = window.pbpAccountBalances(D()), available = bal.cash + bal.banksArs;
      const pending = list('transactions').filter(t => t.status === 'Pendiente' && t.dueDate);
      const within = (t, days) => daysUntil(t.dueDate) <= days;
      const pay = pending.filter(t => t.type === 'Egreso' && within(t, 15)).reduce((s, t) => s + t.amount, 0);
      const collect = pending.filter(t => t.type === 'Ingreso' && within(t, 15)).reduce((s, t) => s + t.amount, 0);
      const overduePay = pending.filter(t => t.type === 'Egreso' && daysUntil(t.dueDate) < 0), overdueCol = pending.filter(t => t.type === 'Ingreso' && daysUntil(t.dueDate) < 0);
      if (pay > available + collect) add('red', 'Riesgo de liquidez en los próximos 15 días', `Vencen pagos por ${pesos(pay)} y hay ${pesos(available)} disponibles más ${pesos(collect)} a cobrar.`, 'treasury');
      if (overduePay.length) add('red', `${overduePay.length} pago${overduePay.length === 1 ? '' : 's'} vencido${overduePay.length === 1 ? '' : 's'}`, `${pesos(overduePay.reduce((s, t) => s + t.amount, 0))}: ${overduePay.map(t => t.counterparty).join(', ')}.`, 'treasury');
      if (overdueCol.length) add('amber', `${overdueCol.length} cobro${overdueCol.length === 1 ? '' : 's'} vencido${overdueCol.length === 1 ? '' : 's'}`, `${pesos(overdueCol.reduce((s, t) => s + t.amount, 0))}: ${overdueCol.map(t => t.counterparty).join(', ')}.`, 'treasury');
    }

    // Equipos críticos y mantenimiento
    for (const e of list('equipment')) {
      const d = e.nextMaintenance ? daysUntil(e.nextMaintenance) : null;
      if (d !== null && d < 0 && ['Alta', 'Crítica'].includes(e.criticality)) add('red', `Mantenimiento vencido: ${e.name}`, `Criticidad ${e.criticality.toLowerCase()} · venció el ${fmtDate(e.nextMaintenance)}. Una parada no programada frena la línea.`, 'equipment');
      else if (d !== null && d >= 0 && d <= 7) add('amber', `Mantenimiento ${d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`}: ${e.name}`, 'Coordinarlo con el programa de producción.', 'equipment');
      if (e.status !== 'Operativo' && e.criticality === 'Crítica') add('red', `${e.name}: ${e.status.toLowerCase()}`, 'Equipo crítico fuera de operación normal.', 'equipment');
    }

    // Personal: capacitaciones vencidas o sin registrar
    const trn = window.pbpTrainingSummary ? window.pbpTrainingSummary() : null;
    if (trn) {
      const late = trn.people.filter(p => p.emp.status === 'Activo' && p.pending.length);
      if (late.length) add('amber', `${late.length} persona${late.length === 1 ? '' : 's'} con capacitaciones vencidas o sin registrar`, late.slice(0, 4).map(p => `${p.emp.name} (${p.pending.map(i => i.topic.name).slice(0, 2).join(', ')})`).join(' · '), 'hr');
    }

    // Mercado: pizarra contra el costo promedio del stock
    const prices = settings().grainPricesArs || {};
    for (const [crop, match] of [['Maíz', /^ma[ií]z/i], ['Sorgo', /^sorgo/i]]) {
      const item = list('inventoryItems').find(i => match.test(i.name) && i.status === 'Activo'), market = Number(prices[crop]);
      if (!item || !market || !item.unitCost) continue;
      const diff = (market - item.unitCost) / item.unitCost * 100;
      if (diff <= -4) add('blue', `${crop} en pizarra ${n(-diff, 1)}% debajo de tu costo promedio`, `Pizarra ${pesos(market)}/TM contra ${pesos(item.unitCost)}/TM del stock: puede convenir reponer ahora.`, 'supply');
      else if (diff >= 6) add('blue', `${crop}: tu stock costó ${n(diff, 1)}% menos que la pizarra`, `Costo promedio ${pesos(item.unitCost)}/TM contra pizarra ${pesos(market)}/TM. El costo de las próximas compras va a subir el costo por tonelada.`, 'supply');
    }

    const order = { red: 0, amber: 1, blue: 2, green: 3 };
    return out.filter(i => allowed(i.page)).sort((a, z) => order[a.level] - order[z.level]);
  }

  /* ---------- resumen de la planta que se envía como contexto ---------- */
  function buildContext(extra = {}) {
    const today = todayISO(), period = today.slice(0, 7);
    const cs = window.pbpCostSummary, pt = window.pbpProductionTons, inv = window.pbpInventorySummary ? window.pbpInventorySummary() : null;
    const qs = window.pbpQualitySummary ? window.pbpQualitySummary() : null, trn = window.pbpTrainingSummary ? window.pbpTrainingSummary() : null;
    const bal = window.pbpAccountBalances ? window.pbpAccountBalances(D()) : null;
    const months = Array.from({ length: 6 }, (_, i) => shiftPeriod(period, i - 5));
    const ctx = {
      fecha: today,
      empresa: settings().company?.name || 'Pampa PBP',
      nota: 'Valores en pesos argentinos. Costos de producción = consumo de inventario valorizado (no compras) + gastos del período + RRHH.',
      produccionTM: pt ? months.map(p => ({ periodo: p, tm: r2(pt(p).tons), fuente: pt(p).source })) : [],
      costos: cs ? [shiftPeriod(period, -1), period].map(p => { const s = cs(p); return { periodo: p, toneladas: r2(s.tons), total: Math.round(s.total), porTM: s.perTon && Math.round(s.perTon), materiaPrimaPorTM: s.tons ? Math.round(s.raw / s.tons) : null, conversionPorTM: s.conversion && Math.round(s.conversion), energiaPorTM: s.energyPerTon && Math.round(s.energyPerTon), precioVentaTM: s.price || null, centros: (s.rows || []).map(r => ({ centro: r.center, tipo: r.type, importe: Math.round(r.amount) })) }; }) : [],
      inventario: inv ? inv.items.map(x => ({ producto: x.item.name, categoria: x.item.category, stock: r2(x.stock), unidad: x.item.unit, minimo: x.item.minStock, costoUnitario: Math.round(x.item.unitCost || 0), valor: Math.round(x.value), coberturaDias: x.days === null ? null : Math.round(x.days), estado: x.level })) : [],
      silos: inv ? inv.installations.filter(x => /Silo|Tolva|Tanque|Celda/.test(x.ins.type)).map(x => ({ codigo: x.ins.code, tipo: x.ins.type, capacidad: x.ins.capacity, unidad: x.ins.unit, ocupado: r2(x.used), ocupacionPct: x.pct === null ? null : Math.round(x.pct), contenido: (x.contents || []).map(c => c.item?.name).filter(Boolean) })) : [],
      lotes: list('batches').map(b => ({ id: b.id, fase: b.phase, tm: b.volume, estado: b.status, inicio: b.start })),
      recetas: list('recipes').filter(r => r.status === 'Activa').map(r => ({ nombre: r.name, fase: r.phase, costoTM: r.costPerTon, proteina: r.protein, lisina: r.lysine, energia: r.energy, ingredientes: (r.ingredients || []).map(i => `${i.name} ${i.percentage}%`) })),
      movimientosUltimos30Dias: (() => { const from = new Date(); from.setDate(from.getDate() - 30); const f = from.toLocaleDateString('sv-SE'); const m = list('inventoryMovements').filter(x => x.date >= f); const it = id => list('inventoryItems').find(i => i.id === id); return Object.values(m.reduce((acc, x) => { const k = `${x.type}|${x.itemId}`; acc[k] = acc[k] || { tipo: x.type, producto: it(x.itemId)?.name || x.itemId, unidad: it(x.itemId)?.unit, cantidad: 0, movimientos: 0 }; acc[k].cantidad = r2(acc[k].cantidad + x.quantity); acc[k].movimientos++; return acc; }, {})); })(),
      calidad: qs ? { objetivos: qs.targets(), controles: [...list('qualityBatchControls')].sort((a, z) => z.date.localeCompare(a.date)).slice(0, 12).map(c => { const e = qs.evalControl(c); return { fecha: c.date, lote: c.batchId, temp: c.conditionerTemp, retencion: c.retentionSec, micrones: c.microns, pdi: c.pdi, humedad: c.moisture, conforme: e.ok, desvios: e.fails }; }), plc24h: (qs.plc?.()?.parameters || []).map(p => ({ equipo: p.equipmentName, parametro: p.parameterMeasured, lecturas: p.count, fueraDeRango: p.outCount, criticas: p.criticalCount, min: p.min, max: p.max, prom: r2(p.avg), ultima: p.last?.valueNumeric })), laboratorio: list('labAnalyses').slice(-8).map(a => ({ fecha: a.date, materia: a.rawMaterial, proveedor: a.supplier, veredicto: a.verdict })), ultimaAuditoria: (() => { const a = [...list('qualityAudits')].sort((x, z) => z.date.localeCompare(x.date))[0]; return a ? { fecha: a.date, ...qs.auditScore(a), pendientes: (a.items || []).filter(i => !i.ok).map(i => i.text) } : null; })() } : null,
      tesoreria: bal ? { disponible: Math.round(bal.cash + bal.banksArs), pendientes: list('transactions').filter(t => t.status === 'Pendiente').sort((a, z) => String(a.dueDate).localeCompare(String(z.dueDate))).slice(0, 25).map(t => ({ vence: t.dueDate, tipo: t.type, contraparte: t.counterparty, categoria: t.category, importe: Math.round(t.amount) })) } : null,
      personal: { activos: list('employees').filter(e => e.status === 'Activo').length, costoMensual: Math.round(list('employees').filter(e => e.status !== 'Baja').reduce((s, e) => s + (Number(e.monthlyCost) || 0), 0)), capacitacionesPendientes: trn ? trn.people.filter(p => p.pending.length).map(p => ({ persona: p.emp.name, puesto: p.emp.position, temas: p.pending.map(i => `${i.topic.name} (${i.state === 'missing' ? 'falta' : 'vencida'})`) })) : [] },
      equipos: list('equipment').map(e => ({ equipo: e.name, estado: e.status, horas: e.hours, proximoMantenimiento: e.nextMaintenance, criticidad: e.criticality })),
      mercado: { pizarraGranosArsTM: settings().grainPricesArs || {}, dolarMEP: window.pbpFx?.venta || null },
      alertas: (window.pbpComputeAlerts ? window.pbpComputeAlerts() : []).slice(0, 25).map(a => ({ nivel: a.level, titulo: a.title, detalle: a.detail, fecha: a.date, modulo: a.page })),
      diagnostico: insights().map(i => `${i.title}: ${i.text}`),
      ...extra
    };
    return ctx;
  }

  /* ---------- resumen en texto para modelos chicos (servidor PampaIA) ----------
   * Frases con los números ya calculados, primero los temas de la pregunta. Un modelo de 3B
   * interpreta mucho mejor esto que el JSON completo, y responde más rápido. */
  const TOPICS = [
    ['costos', /cost|margen|tonelad|precio|rentab|gast/i], ['stock', /stock|insumo|compr|inventar|silo|termin|alcanz|materia/i],
    ['calidad', /calidad|inocu|pcc|pellet|pdi|humedad|granulo|micotox|bioseg|auditor|temperat/i], ['caja', /caja|pago|cobr|deud|banco|cheque|financ|liquidez/i],
    ['equipos', /equipo|manten|molino|peleti|parada|repuest/i], ['personal', /personal|capacit|emplead|rrhh|turno|epp/i], ['produccion', /produc|lote|despach|fabric/i]
  ];
  function briefing(question = '') {
    const today = todayISO(), period = today.slice(0, 7), prev = shiftPeriod(period, -1);
    const cs = window.pbpCostSummary, pt = window.pbpProductionTons, inv = window.pbpInventorySummary ? window.pbpInventorySummary() : null;
    const qs = window.pbpQualitySummary ? window.pbpQualitySummary() : null, trn = window.pbpTrainingSummary ? window.pbpTrainingSummary() : null;
    const blocks = {};
    if (pt) { const a = pt(period), b = pt(prev); blocks.produccion = [`Producción de ${periodLabel(period)}: ${n(a.tons, 1)} TM; ${periodLabel(prev)}: ${n(b.tons, 1)} TM.`, `Lotes en curso: ${list('batches').filter(x => x.status !== 'Terminado').map(x => `${x.id} (${x.phase}, ${n(x.volume)} TM, ${x.status})`).join('; ') || 'ninguno'}.`]; }
    if (cs) {
      const a = cs(period), b = cs(prev);
      blocks.costos = [a.perTon !== null ? `Costo por tonelada ${periodLabel(period)}: ${pesos(a.perTon)} (materia prima ${pesos(a.raw / a.tons)}, conversión ${pesos(a.conversion)}); mes anterior ${b.perTon !== null ? pesos(b.perTon) : 'sin datos'}.` : 'Sin costo por tonelada del mes (faltan toneladas o costos).',
        a.price && a.perTon !== null ? `Precio de venta de referencia ${pesos(a.price)}/TM; margen ${pesos(a.price - a.perTon)}/TM.` : '',
        `Centros de costo del mes: ${(a.rows || []).sort((x, z) => z.amount - x.amount).slice(0, 6).map(r => `${r.center} ${pesos(r.amount)}`).join('; ')}.`];
    }
    if (inv) {
      const raw = inv.items.filter(x => x.item.category !== 'Producto terminado' && !x.item.category.startsWith('Repuesto'));
      const low = raw.filter(x => x.level !== 'ok');
      blocks.stock = [`Stock de materias primas (stock · mínimo · días que alcanza): ${raw.map(x => `${x.item.name} ${n(x.stock, 1)} ${x.item.unit} · mín. ${n(x.item.minStock)} · ${x.days === null ? 'sin consumo' : n(x.days) + ' días'}`).join('; ')}.`,
        low.length ? `POR DEBAJO DEL MÍNIMO: ${low.map(x => x.item.name).join(', ')}. Todos los demás están sobre el mínimo.` : 'Ninguna materia prima está por debajo del mínimo.',
        `Producto terminado en silos: ${inv.items.filter(x => x.item.category === 'Producto terminado').map(x => `${x.item.name} ${n(x.stock, 1)} ${x.item.unit}`).join('; ')}.`,
        `Valor total del inventario: ${pesos(inv.items.reduce((t, x) => t + x.value, 0))}.`];
    }
    if (qs) {
      const t = qs.targets(), recent = list('qualityBatchControls').filter(c => daysUntil(c.date) >= -14).map(c => ({ c, e: qs.evalControl(c) }));
      const LABEL = { conditionerTemp: 'temperatura de acondicionado', retentionSec: 'retención', microns: 'granulometría', pdi: 'durabilidad del pellet (PDI)', moisture: 'humedad' };
      const plcTemp = (qs.plc?.()?.parameters || []).find(p => p.equipmentName === 'ACONDICIONADOR' && p.parameterMeasured === 'TEMPERATURA');
      blocks.calidad = [`Objetivos: acondicionado ${t.tempMin}–${t.tempMax} °C y ${t.retentionMin}–${t.retentionMax} s, PDI mínimo ${t.pdiMin}%, humedad máxima ${t.moistureMax}%.`,
        recent.length ? `Controles de los últimos 14 días: ${recent.map(x => `lote ${x.c.batchId} ${x.e.ok ? 'conforme' : 'con desvío en ' + x.e.fails.map(f => LABEL[f]).join(' y ')}`).join('; ')}.` : 'Sin controles de calidad en 14 días.',
        plcTemp ? `PLC del acondicionador (24 h): ${plcTemp.count} lecturas, ${plcTemp.outCount} fuera de rango, mínima ${n(plcTemp.min, 1)} °C.` : '',
        `Análisis de materias primas rechazados (30 días): ${list('labAnalyses').filter(a => a.verdict === 'Rechazado' && daysUntil(a.date) >= -30).map(a => `${a.rawMaterial} de ${a.supplier}`).join(', ') || 'ninguno'}.`];
    }
    if (window.pbpAccountBalances) {
      const bal = window.pbpAccountBalances(D()), pend = list('transactions').filter(t => t.status === 'Pendiente' && t.dueDate).sort((a, z) => a.dueDate.localeCompare(z.dueDate));
      const sum = l => pesos(l.reduce((x, t) => x + t.amount, 0)), in30 = t => daysUntil(t.dueDate) <= 30;
      blocks.caja = [`Disponible en caja y bancos: ${pesos(bal.cash + bal.banksArs)}.`, `Próximos 30 días: pagos ${sum(pend.filter(t => t.type === 'Egreso' && in30(t)))}, cobros ${sum(pend.filter(t => t.type === 'Ingreso' && in30(t)))}.`,
        `Pendientes: ${pend.slice(0, 8).map(t => `${t.type === 'Ingreso' ? 'cobro' : 'pago'} ${t.counterparty} ${pesos(t.amount)} vence ${fmtDate(t.dueDate)}`).join('; ') || 'ninguno'}.`];
    }
    blocks.equipos = [`Equipos: ${list('equipment').map(e => `${e.name} ${e.status.toLowerCase()}, próximo mantenimiento ${fmtDate(e.nextMaintenance)}`).join('; ')}.`];
    if (trn) blocks.personal = [`Personal activo: ${list('employees').filter(e => e.status === 'Activo').length}.`, `Capacitaciones vencidas o faltantes: ${trn.people.filter(p => p.pending.length).map(p => `${p.emp.name} (${p.pending.map(i => i.topic.name).join(', ')})`).join('; ') || 'ninguna'}.`];
    const wanted = TOPICS.filter(([, re]) => re.test(question)).map(([k]) => k);
    const order = [...wanted, ...TOPICS.map(([k]) => k).filter(k => !wanted.includes(k))];
    const lines = [`Fecha: ${fmtDate(today)}. Valores en pesos argentinos.`, `Diagnóstico calculado por la app: ${insights().map(i => i.title).join('; ')}.`];
    order.forEach(k => (blocks[k] || []).filter(Boolean).forEach(l => lines.push(l)));
    return lines.join('\n').slice(0, 9000);
  }

  /* ---------- pantalla: diagnóstico ---------- */
  const COLOR = { red: 'var(--red)', amber: 'var(--orange)', blue: 'var(--blue)', green: 'var(--ok)' };
  const PAGE_LABEL = { costs: 'Costos', inventory: 'Inventario', installations: 'Instalaciones', quality: 'Calidad', treasury: 'Finanzas', equipment: 'Equipamiento', hr: 'RRHH', supply: 'Abastecimiento', dashboard: 'Control de planta' };
  function renderInsights() {
    const items = insights();
    const counts = items.reduce((m, i) => ({ ...m, [i.level]: (m[i.level] || 0) + 1 }), {});
    el('aiSummary').innerHTML = [['red', 'críticos'], ['amber', 'a revisar'], ['blue', 'información'], ['green', 'en orden']].map(([k, label]) => `<span class="badge ${k === 'red' ? 'red' : k === 'amber' ? 'amber' : k === 'blue' ? 'blue' : 'green'}">${counts[k] || 0} ${label}</span>`).join(' ');
    el('aiInsights').innerHTML = items.length ? items.map(i => `<div class="alert ai-insight" style="--alert:${COLOR[i.level]}"><b>${esc(i.title)}</b><time>${i.page ? `<button class="ghost-btn" data-go-page="${i.page}">${esc(PAGE_LABEL[i.page] || 'Ver')}</button>` : ''}</time><p>${esc(i.text)}</p></div>`).join('') : '<div class="alert" style="--alert:var(--ok)"><b>Sin observaciones</b><time></time><p>Cargue datos en los módulos para obtener el diagnóstico.</p></div>';
  }
  el('aiInsights').addEventListener('click', e => { const b = e.target.closest('[data-go-page]'); if (b) window.go(b.dataset.goPage); });

  /* ---------- pantalla: consultas ---------- */
  const PROVIDERS = { pampa: 'Servidor PampaIA', anthropic: 'Claude (Anthropic)', openai: 'OpenAI o compatible', ollama: 'Ollama en esta PC' };
  let status = null, history = [], pendingExtra = null, busy = false;
  // Sesión de la conversación: Flowise la usa para recordar las preguntas anteriores
  const newSession = () => `pbp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let session = newSession();
  async function loadStatus() {
    try { status = await call('/api/ia/estado'); } catch (error) { status = { error: error.message }; }
    const s = el('aiStatus');
    if (status.error) { s.className = 'badge amber'; s.textContent = 'Servidor no disponible'; }
    else if (status.configurado) { s.className = 'badge green'; s.textContent = status.provider === 'pampa' ? `Servidor PampaIA · ${status.ruta?.[0] || ''}` : `${PROVIDERS[status.provider] || status.provider} · ${status.model}`; }
    else { s.className = 'badge blue'; s.textContent = status.error || 'Sin configurar'; }
    const own = status.provider === 'ollama' || (status.provider === 'pampa' && status.ruta?.length && status.ruta[0] !== 'servidor central de Pampa');
    el('aiDisclosure').textContent = own
      ? 'La consulta se procesa en el servidor de IA de la planta: los datos no salen de su red. La IA no modifica registros.'
      : status.provider === 'pampa'
        ? 'La consulta va al servidor PampaIA de Pampa (Flowise + Ollama) con un resumen de los datos de la planta; no hace falta ninguna clave. La IA no modifica registros.'
        : 'Para responder se envía un resumen de los datos de la planta (no la base completa) al proveedor configurado. La IA no modifica registros.';
  }
  function bubble(role, content, meta = '') {
    const node = document.createElement('div');
    node.className = `ai-msg ai-${role}`;
    node.innerHTML = `${role === 'assistant' ? formatAnswer(content) : esc(content)}${meta ? `<small>${esc(meta)}</small>` : ''}`;
    el('aiChat').appendChild(node);
    el('aiChat').scrollTop = el('aiChat').scrollHeight;
    return node;
  }
  // Markdown mínimo: negritas, listas y saltos de línea (el texto se escapa antes)
  function formatAnswer(t) {
    return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>').replace(/^\s*[-•*]\s+(.+)$/gm, '<span class="ai-li">• $1</span>').replace(/\n/g, '<br>');
  }
  async function ask(question, extra) {
    question = String(question || '').trim();
    if (!question || busy) return;
    if (!status?.configurado) { await loadStatus(); if (!status?.configurado) { bubble('assistant', status?.error ? `${status.error}. El diagnóstico automático sigue disponible sin conexión.` : 'No hay un servidor de IA disponible. En «Configurar IA» se puede indicar el Flowise u Ollama de la planta, activar el servidor central de Pampa o usar una clave propia de Claude u OpenAI. Mientras tanto, el diagnóstico automático funciona sin configurar nada.'); return; } }
    busy = true; el('aiSend').disabled = true;
    bubble('user', question);
    const wait = bubble('assistant', 'Analizando los datos de la planta…');
    try {
      const result = await call('/api/ia/consulta', 'POST', { pregunta: question, historial: history.slice(-6), contexto: { ...buildContext(extra || {}), resumen: briefing(question) }, sesion: session });
      wait.remove();
      bubble('assistant', result.respuesta, result.modelo);
      history.push({ role: 'user', content: question }, { role: 'assistant', content: result.respuesta });
    } catch (error) {
      wait.remove();
      bubble('assistant', `No se pudo responder: ${error.message}.${status?.provider !== 'ollama' && !navigator.onLine ? ' Sin internet solo funciona el diagnóstico automático (o Ollama instalado en esta PC).' : ''}`);
    } finally { busy = false; el('aiSend').disabled = false; }
  }
  el('aiForm').addEventListener('submit', e => { e.preventDefault(); const q = el('aiInput').value; el('aiInput').value = ''; const extra = pendingExtra; pendingExtra = null; ask(q, extra); });
  el('aiInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el('aiForm').requestSubmit(); } });
  el('aiPrompts').addEventListener('click', e => { const b = e.target.closest('[data-prompt]'); if (b) ask(b.dataset.prompt); });
  el('aiClear').addEventListener('click', () => { history = []; session = newSession(); el('aiChat').innerHTML = ''; bubble('assistant', 'Conversación nueva. ¿Qué querés analizar?'); });
  window.pbpAskAI = (question, extra) => { window.go('ai'); setTimeout(() => ask(question, extra), 50); };

  /* ---------- configuración del proveedor ---------- */
  const DEFAULT_MODELS = { pampa: 'qwen2.5:3b', anthropic: 'claude-sonnet-5-5', openai: 'gpt-4o-mini', ollama: 'qwen2.5:3b' };
  function openConfig() {
    const s = status && !status.error ? status : { provider: 'pampa', model: DEFAULT_MODELS.pampa, useCentral: true };
    const provider = s.provider || 'pampa';
    el('aiCfgProvider').value = provider; el('aiCfgModel').value = s.model || DEFAULT_MODELS[provider]; el('aiCfgBase').value = s.baseUrl || ''; el('aiCfgKey').value = '';
    el('aiCfgFlowiseUrl').value = s.flowiseUrl || ''; el('aiCfgChatflow').value = s.chatflowId || ''; el('aiCfgOllamaUrl').value = s.ollamaUrl || ''; el('aiCfgCentral').checked = s.useCentral !== false;
    el('aiCfgKeyHint').textContent = s.keyHint ? `Clave guardada: ${s.keyHint}${s.keySource === 'env' ? ' (variable de entorno)' : ''}. Déjelo vacío para conservarla.` : 'Sin clave guardada.';
    el('aiCfgResult').hidden = true;
    paintConfig();
    el('aiConfigDialog').showModal();
  }
  function paintConfig() {
    const p = el('aiCfgProvider').value;
    document.querySelectorAll('#aiConfigForm [data-ai-for]').forEach(f => { f.hidden = !f.dataset.aiFor.split(' ').includes(p); });
    el('aiCfgKeyField').hidden = p === 'ollama';
    el('aiCfgKeyLabel').textContent = p === 'pampa' ? 'API key de Flowise (si el chatflow la pide)' : 'Clave de API';
    el('aiCfgModel').closest('.field').querySelector('label').textContent = p === 'pampa' ? 'Modelo de Ollama (respaldo directo)' : 'Modelo';
    el('aiCfgBase').placeholder = p === 'ollama' ? 'http://localhost:11434' : p === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com';
    el('aiCfgHelp').textContent = p === 'pampa' ? 'Orden de consulta: Flowise propio → Ollama propio → servidor central de Pampa. Sin datos propios usa el central, como las otras apps de Pampa. Ver tools/servidor-ia para instalar Flowise + Ollama en la planta (las variables PAMPA_IA_* del equipo también sirven).' : p === 'ollama' ? 'Instale Ollama en esta PC (ollama.com) y descargue un modelo, por ejemplo: ollama pull qwen2.5:3b. Funciona sin internet.' : p === 'openai' ? 'Sirve para OpenAI y para servicios compatibles (indique la dirección base).' : 'Cree una clave en console.anthropic.com. Modelos sugeridos: claude-sonnet-5-5 (equilibrado) o claude-haiku-5-5 (más rápido y económico).';
  }
  el('aiCfgProvider').addEventListener('change', () => { el('aiCfgModel').value = DEFAULT_MODELS[el('aiCfgProvider').value]; paintConfig(); });
  const configBody = () => ({ provider: el('aiCfgProvider').value, model: el('aiCfgModel').value.trim(), baseUrl: el('aiCfgBase').value.trim(), apiKey: el('aiCfgKey').value.trim(), flowiseUrl: el('aiCfgFlowiseUrl').value.trim(), chatflowId: el('aiCfgChatflow').value.trim(), ollamaUrl: el('aiCfgOllamaUrl').value.trim(), useCentral: el('aiCfgCentral').checked });
  el('aiConfigForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; if (btn) btn.disabled = true;
    try { status = await call('/api/ia/config', 'PUT', configBody()); await loadStatus(); el('aiConfigDialog').close(); toast('Configuración de IA guardada'); }
    catch (error) { toast(error.message); } finally { if (btn) btn.disabled = false; }
  });
  el('aiCfgTest').addEventListener('click', async () => {
    const out = el('aiCfgResult'); out.hidden = false; out.style.setProperty('--status-color', 'var(--blue)'); out.textContent = 'Probando la conexión…';
    try { const r = await call('/api/ia/probar', 'POST', configBody()); out.style.setProperty('--status-color', 'var(--ok)'); out.textContent = `Conexión correcta (${r.modelo}): ${r.respuesta}`; }
    catch (error) { out.style.setProperty('--status-color', 'var(--red)'); out.textContent = error.message; }
  });
  el('aiCfgClearKey').addEventListener('click', async () => {
    if (!confirm('¿Borrar la clave guardada en esta PC?')) return;
    try { status = await call('/api/ia/config', 'PUT', { ...configBody(), apiKey: '', clearKey: true }); await loadStatus(); el('aiCfgKeyHint').textContent = 'Sin clave guardada.'; toast('Clave borrada'); } catch (error) { toast(error.message); }
  });
  el('aiConfigBtn').addEventListener('click', openConfig);
  document.querySelectorAll('[data-close-dialog="aiConfigDialog"]').forEach(b => b.addEventListener('click', () => el('aiConfigDialog').close()));

  ['pbp:bootstrap', 'pbp:inventory', 'pbp:plc', 'pbp:fx', 'pbp:role'].forEach(ev => document.addEventListener(ev, () => setTimeout(renderInsights, 0)));
  window.pbpInsights = insights;
  renderInsights();
  loadStatus();
  bubble('assistant', 'Hola, soy PampaIA. Puedo responder sobre producción, costos, stock, calidad, finanzas y personal con los datos cargados en la app. No modifico registros.');
})();
