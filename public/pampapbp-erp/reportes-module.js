/* Pampa PBP - Reportes
 * Reportes armados con los datos de cada módulo (parte diario, producción, costos, inventario,
 * trazabilidad, calidad, tesorería, personal, residuos y equipos). Se exportan a PDF (jsPDF) o
 * Excel (xlsx) incluidos en /vendor, se comparten por WhatsApp y se pueden analizar con PampaIA.
 * Todo se calcula en el navegador, así que funcionan sin conexión.
 * Usa helpers del script principal (api, toast, escapeHTML, num, money, go) y window.pbpData.
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  if (!el('page-reports')) return;
  const esc = v => escapeHTML(v ?? '');
  const todayISO = () => new Date().toLocaleDateString('sv-SE');
  const fmtDate = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
  const daysUntil = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
  const pesos = v => money(Number(v) || 0);
  const n = (v, d = 0) => num(Number(v) || 0, d);
  const D = () => window.pbpData || {};
  const list = key => (Array.isArray(D()[key]) ? D()[key] : []);
  const settings = () => D().settings || {};
  const periodLabel = p => { const [y, m] = p.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }); };
  const shiftPeriod = (p, k) => { const [y, m] = p.split('-').map(Number), d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const inPeriod = (date, p) => String(date || '').slice(0, 7) === p;
  const itemOf = id => list('inventoryItems').find(i => i.id === id);
  const insOf = id => list('installations').find(i => i.id === id);
  const empName = id => list('employees').find(e => e.id === id)?.name || id;
  const toTM = (q, unit) => (unit === 'TM' ? q : unit === 'kg' ? q / 1000 : 0);
  const tmOf = movements => movements.reduce((s, m) => s + toTM(Number(m.quantity) || 0, itemOf(m.itemId)?.unit), 0);
  const allowed = page => (typeof window.pbpAllowedPage === 'function' ? window.pbpAllowedPage(page) : true);
  // Celda con valor numérico (para Excel) y texto formateado (pantalla y PDF)
  const cell = (v, t) => ({ v, t });
  const cm = v => cell(Math.round(Number(v) || 0), pesos(v));
  const cn = (v, d = 0, unit = '') => cell(Math.round((Number(v) || 0) * 10 ** d) / 10 ** d, `${n(v, d)}${unit ? ' ' + unit : ''}`);
  const pct = v => cell(Math.round((Number(v) || 0) * 10) / 10, `${n(v, 1)}%`);
  const LEVEL = { red: 'Crítica', amber: 'Atención', blue: 'Información', green: 'Bien' };
  const kpi = (label, value, tone = '') => ({ label, value, tone });
  const days = v => `${n(v)} ${Math.round(Number(v) || 0) === 1 ? 'día' : 'días'}`;

  /* ---------- reportes ---------- */
  const REPORTS = [
    { id: 'daily', icon: '🗓️', title: 'Parte diario de planta', desc: 'Producción, consumo, recepciones, despachos y alertas del día', page: 'dashboard', param: 'date', build: buildDaily },
    { id: 'production', icon: '🏭', title: 'Producción mensual', desc: 'Toneladas por producto y por lote, despachos y evolución anual', page: 'production', param: 'period', build: buildProduction },
    { id: 'costs', icon: '💲', title: 'Costo por tonelada', desc: 'Centros de costo, costo y margen por TM, evolución', page: 'costs', param: 'period', build: buildCosts },
    { id: 'inventory', icon: '📦', title: 'Inventario valorizado', desc: 'Stock, valor, cobertura en días y ocupación de silos', page: 'inventory', param: 'none', build: buildInventory },
    { id: 'movements', icon: '🔁', title: 'Movimientos de inventario', desc: 'Recepciones, consumos, producción, despachos y ajustes', page: 'inventory', param: 'period', build: buildMovements },
    { id: 'trace', icon: '🧬', title: 'Trazabilidad de lote', desc: 'Ingredientes y lotes de origen, silos, calidad y PLC', page: 'lots', param: 'batch', build: buildTrace },
    { id: 'quality', icon: '🧪', title: 'Calidad y bioseguridad', desc: 'Controles, PCC térmico, homogeneidad, laboratorio y auditorías', page: 'quality', param: 'period', build: buildQuality },
    { id: 'treasury', icon: '🏦', title: 'Tesorería', desc: 'Saldos, movimientos del mes, cobros y pagos pendientes', page: 'treasury', param: 'period', build: buildTreasury },
    { id: 'hr', icon: '👷', title: 'Personal y capacitaciones', desc: 'Dotación, costo laboral y estado de capacitación por persona', page: 'hr', param: 'none', build: buildHR },
    { id: 'waste', icon: '♻️', title: 'Residuos', desc: 'Envases, triple lavado, entregas con certificado y otros residuos', page: 'waste', param: 'period', build: buildWaste },
    { id: 'equipment', icon: '⚙️', title: 'Equipos y mantenimiento', desc: 'Estado, horas, próximos mantenimientos y criticidad', page: 'equipment', param: 'none', build: buildEquipment }
  ];

  function buildDaily(date) {
    const mv = list('inventoryMovements').filter(m => m.date === date), of = type => mv.filter(m => m.type === type);
    const prod = of('Producción terminada'), cons = of('Consumo en producción'), rec = of('Recepción'), dis = of('Despacho');
    const alerts = window.pbpComputeAlerts ? window.pbpComputeAlerts() : [];
    const trucks = l => new Set(l.map(m => m.vehicle || m.id)).size;
    const running = list('batches').filter(b => b.status !== 'Terminado');
    const qty = m => cn(m.quantity, 2, itemOf(m.itemId)?.unit || '');
    return {
      subtitle: `${new Date(date + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`,
      kpis: [kpi('Producción', `${n(tmOf(prod), 1)} TM`), kpi('Lotes producidos', new Set(prod.map(m => m.batchId).filter(Boolean)).size), kpi('Recepciones', `${n(tmOf(rec), 1)} TM · ${trucks(rec)} camiones`), kpi('Despachos', `${n(tmOf(dis), 1)} TM · ${trucks(dis)} cargas`), kpi('Alertas críticas', alerts.filter(a => a.level === 'red').length, alerts.some(a => a.level === 'red') ? 'negative' : 'positive')],
      sections: [
        { title: 'Producción terminada', head: ['Lote', 'Producto', 'Cantidad', 'Silo'], num: [2], rows: prod.map(m => [m.batchId || '—', itemOf(m.itemId)?.name || m.itemId, qty(m), insOf(m.installationId)?.code || '—']) },
        { title: 'Consumo de materias primas', head: ['Insumo', 'Cantidad', 'Valor'], num: [1, 2], rows: groupBy(cons, m => m.itemId).map(([id, g]) => { const q = g.reduce((s, m) => s + m.quantity, 0); return [itemOf(id)?.name || id, cn(q, 2, itemOf(id)?.unit || ''), cm(g.reduce((s, m) => s + m.quantity * (m.unitCost ?? itemOf(id)?.unitCost ?? 0), 0))]; }) },
        { title: 'Recepciones', head: ['Insumo', 'Cantidad', 'Proveedor', 'Vehículo', 'Remito'], num: [1], rows: rec.map(m => [itemOf(m.itemId)?.name || m.itemId, qty(m), m.counterparty || '—', m.vehicle || '—', m.reference || '—']) },
        { title: 'Despachos', head: ['Producto', 'Cantidad', 'Cliente', 'Vehículo', 'Remito'], num: [1], rows: dis.map(m => [itemOf(m.itemId)?.name || m.itemId, qty(m), m.counterparty || '—', m.vehicle || '—', m.reference || '—']) },
        { title: 'Lotes en curso', head: ['Lote', 'Fase', 'Volumen', 'Estado', 'Inicio'], num: [2], rows: running.map(b => [b.id, b.phase, cn(b.volume, 1, 'TM'), b.status, b.start]) },
        { title: 'Alertas', head: ['Nivel', 'Alerta', 'Detalle', 'Fecha'], rows: alerts.map(a => [LEVEL[a.level] || a.level, a.title, a.detail || '', a.date ? fmtDate(a.date) : '']) }
      ]
    };
  }

  function buildProduction(period) {
    const pt = window.pbpProductionTons || (() => ({ tons: 0, source: 'sin datos' }));
    const mv = list('inventoryMovements').filter(m => inPeriod(m.date, period));
    const prod = mv.filter(m => m.type === 'Producción terminada'), dis = mv.filter(m => m.type === 'Despacho');
    const cur = pt(period), prev = pt(shiftPeriod(period, -1));
    const inv = window.pbpInventorySummary ? window.pbpInventorySummary() : null;
    const ptStock = inv ? inv.items.filter(x => x.item.category === 'Producto terminado').reduce((s, x) => s + toTM(x.stock, x.item.unit), 0) : 0;
    const change = prev.tons ? (cur.tons - prev.tons) / prev.tons * 100 : null;
    const months = Array.from({ length: 12 }, (_, i) => shiftPeriod(period, i - 11));
    return {
      subtitle: periodLabel(period),
      kpis: [kpi('Producción', `${n(cur.tons, 1)} TM`), kpi('Fuente', cur.source === 'inventario' ? 'Inventario' : cur.source === 'manual' ? 'Carga manual' : 'Sin datos'), kpi('Contra mes anterior', change === null ? '—' : `${change > 0 ? '+' : ''}${n(change, 1)}%`, change === null ? '' : change >= 0 ? 'positive' : 'warning'), kpi('Despachado', `${n(tmOf(dis), 1)} TM`), kpi('Stock de producto terminado', `${n(ptStock, 1)} TM`)],
      sections: [
        { title: 'Producción por producto', head: ['Producto', 'Toneladas', '% del total'], num: [1, 2], rows: groupBy(prod, m => m.itemId).map(([id, g]) => { const t = tmOf(g); return [itemOf(id)?.name || id, cn(t, 1, 'TM'), pct(cur.tons ? t / tmOf(prod) * 100 : 0)]; }) },
        { title: 'Producción por lote', head: ['Lote', 'Producto', 'Fecha', 'Toneladas'], num: [3], rows: prod.filter(m => m.batchId).map(m => [m.batchId, itemOf(m.itemId)?.name || m.itemId, fmtDate(m.date), cn(toTM(m.quantity, itemOf(m.itemId)?.unit), 1, 'TM')]) },
        { title: 'Despachos por producto', head: ['Producto', 'Toneladas', 'Cargas'], num: [1, 2], rows: groupBy(dis, m => m.itemId).map(([id, g]) => [itemOf(id)?.name || id, cn(tmOf(g), 1, 'TM'), cn(g.length)]) },
        { title: 'Evolución de los últimos 12 meses', head: ['Mes', 'Toneladas', 'Fuente'], num: [1], rows: months.map(p => { const r = pt(p); return [periodLabel(p), cn(r.tons, 1, 'TM'), r.source]; }) }
      ]
    };
  }

  function buildCosts(period) {
    const cs = window.pbpCostSummary;
    if (!cs) return { subtitle: periodLabel(period), kpis: [], sections: [], note: 'El módulo de Costos no está disponible.' };
    const s = cs(period), p = cs(shiftPeriod(period, -1)), price = s.price || 0;
    const byCenter = sum => (sum.rows || []).reduce((m, r) => m.set(r.center, { type: r.type, amount: (m.get(r.center)?.amount || 0) + r.amount }), new Map());
    const cur = byCenter(s), prev = byCenter(p);
    const months = Array.from({ length: 6 }, (_, i) => shiftPeriod(period, i - 5));
    const margin = s.perTon !== null && price ? price - s.perTon : null;
    return {
      subtitle: `${periodLabel(period)} · materias primas según consumo de inventario`,
      kpis: [kpi('Costo total', pesos(s.total)), kpi('Toneladas', `${n(s.tons, 1)} TM`), kpi('Costo por TM', s.perTon === null ? '—' : pesos(s.perTon)), kpi('Materia prima por TM', s.tons ? pesos(s.raw / s.tons) : '—'), kpi('Conversión por TM', s.conversion === null ? '—' : pesos(s.conversion)), kpi('Margen por TM', margin === null ? '—' : pesos(margin), margin === null ? '' : margin >= 0 ? 'positive' : 'negative')],
      sections: [
        { title: 'Centros de costo', head: ['Centro', 'Tipo', 'Importe', '$/TM', '% del total', '$/TM mes anterior'], num: [2, 3, 4, 5], rows: [...cur.entries()].sort((a, z) => z[1].amount - a[1].amount).map(([center, r]) => [center, r.type, cm(r.amount), s.tons ? cm(r.amount / s.tons) : '—', pct(s.total ? r.amount / s.total * 100 : 0), prev.get(center) && p.tons ? cm(prev.get(center).amount / p.tons) : '—']) },
        { title: 'Evolución de los últimos 6 meses', head: ['Mes', 'Toneladas', 'Costo total', '$/TM', 'Materia prima $/TM'], num: [1, 2, 3, 4], rows: months.map(m => { const x = cs(m); return [periodLabel(m), cn(x.tons, 1), cm(x.total), x.perTon === null ? '—' : cm(x.perTon), x.tons ? cm(x.raw / x.tons) : '—']; }) }
      ],
      note: `Precio comercial de referencia: ${price ? pesos(price) + '/TM' : 'sin cargar'}. Las compras no se imputan a Costos: las materias primas entran cuando se consumen en producción.`
    };
  }

  function buildInventory() {
    const inv = window.pbpInventorySummary ? window.pbpInventorySummary() : null;
    if (!inv) return { subtitle: '', kpis: [], sections: [], note: 'El módulo de Inventario no está disponible.' };
    const items = [...inv.items].sort((a, z) => a.item.category.localeCompare(z.item.category) || a.item.name.localeCompare(z.item.name));
    const total = items.reduce((s, x) => s + x.value, 0), withDays = items.filter(x => x.days !== null && x.item.category !== 'Producto terminado').sort((a, z) => a.days - z.days);
    const LEVELS = { ok: 'Normal', low: 'Bajo mínimo', out: 'Sin stock' };
    return {
      subtitle: `Al ${fmtDate(todayISO())}`,
      kpis: [kpi('Valor del inventario', pesos(total)), kpi('Productos activos', items.length), kpi('Bajo mínimo', items.filter(x => x.level === 'low').length, items.some(x => x.level === 'low') ? 'warning' : 'positive'), kpi('Sin stock', items.filter(x => x.level === 'out').length, items.some(x => x.level === 'out') ? 'negative' : 'positive'), kpi('Menor cobertura', withDays[0] ? `${withDays[0].item.name}: ${days(withDays[0].days)}` : '—')],
      sections: [
        { title: 'Stock valorizado', head: ['Código', 'Producto', 'Categoría', 'Stock', 'Costo unitario', 'Valor', 'Cobertura', 'Estado'], num: [3, 4, 5, 6], rows: items.map(x => [x.item.code, x.item.name, x.item.category, cn(x.stock, 2, x.item.unit), cm(x.item.unitCost), cm(x.value), x.days === null ? '—' : cell(Math.round(x.days), days(x.days)), LEVELS[x.level]]) },
        { title: 'Ocupación de instalaciones', head: ['Código', 'Instalación', 'Tipo', 'Capacidad', 'Ocupado', 'Ocupación', 'Contenido'], num: [3, 4, 5], rows: inv.installations.filter(x => x.ins.status !== 'Fuera de servicio').map(x => [x.ins.code, x.ins.name, x.ins.type, cn(x.ins.capacity, 0, x.ins.unit), cn(x.used, 1, x.ins.unit), x.pct === null ? '—' : pct(x.pct), (x.contents || []).map(c => c.item?.name).filter(Boolean).join(', ') || '—']) }
      ],
      note: 'Cobertura = stock dividido por la salida promedio diaria (consumo, despacho y merma) de los últimos 30 días.'
    };
  }

  function buildMovements(period) {
    const mv = list('inventoryMovements').filter(m => inPeriod(m.date, period)).sort((a, z) => a.date.localeCompare(z.date));
    const types = groupBy(mv, m => m.type);
    return {
      subtitle: periodLabel(period),
      kpis: [kpi('Movimientos', mv.length), ...types.slice(0, 5).map(([t, g]) => kpi(t, `${g.length} · ${n(tmOf(g), 1)} TM`))],
      sections: [{ title: 'Detalle de movimientos', head: ['Fecha', 'Tipo', 'Producto', 'Cantidad', 'Instalación', 'Lote', 'Contraparte', 'Remito', 'Valor'], num: [3, 8],
        rows: mv.map(m => { const it = itemOf(m.itemId), price = m.type === 'Despacho' && m.unitPrice ? m.unitPrice : m.unitCost ?? it?.unitCost ?? 0;
          return [fmtDate(m.date), m.type, it?.name || m.itemId, cn(m.quantity, 2, it?.unit || ''), [insOf(m.installationId)?.code, insOf(m.toInstallationId)?.code].filter(Boolean).join(' → ') || '—', m.batchId || '—', m.counterparty || '—', m.reference || '—', cm(m.quantity * price)]; }) }],
      note: 'Valor: despachos al precio de venta informado; el resto al costo unitario del momento.'
    };
  }

  async function buildTrace(batchId) {
    const batch = list('batches').find(b => b.id === batchId);
    if (!batch) return { subtitle: 'Seleccione un lote', kpis: [], sections: [] };
    const recipe = list('recipes').find(r => r.phase === batch.phase && r.status === 'Activa') || list('recipes').find(r => r.phase === batch.phase);
    const mv = list('inventoryMovements').filter(m => m.batchId === batchId);
    const lotBySupplier = code => list('lots').find(l => l.supplierLot === code);
    let ingredients = [], plc = null, offline = false;
    try { ingredients = await api(`/api/reports/trazabilidad/${encodeURIComponent(batchId)}`); if (!Array.isArray(ingredients)) ingredients = []; } catch { offline = true; }
    try { plc = await api(`/api/telemetry/batch/${encodeURIComponent(batchId)}`); } catch { offline = true; }
    const qs = window.pbpQualitySummary ? window.pbpQualitySummary() : null;
    const controls = list('qualityBatchControls').filter(c => c.batchId === batchId).sort((a, z) => a.date.localeCompare(z.date));
    const plcRow = (label, s, unit) => (s ? [label, cn(s.count), cn(s.min, 1, unit), cn(s.avg, 1, unit), cn(s.max, 1, unit), cn(s.outCount)] : null);
    return {
      subtitle: `${batch.id} · ${batch.phase}`,
      kpis: [kpi('Volumen', `${n(batch.volume, 1)} TM`), kpi('Estado', batch.status), kpi('Receta', recipe ? recipe.name : '—'), kpi('Inicio', batch.start || '—'), kpi('Controles de calidad', controls.length ? `${controls.filter(c => qs?.evalControl(c).ok).length} de ${controls.length} conformes` : 'Sin controles', controls.some(c => qs && !qs.evalControl(c).ok) ? 'negative' : '')],
      sections: [
        { title: 'Ingredientes y lotes de origen', head: ['Ingrediente', 'Lote proveedor', 'Lote de campo', 'Teórico', 'Real', 'Desvío', 'Estado'], num: [3, 4, 5], rows: ingredients.map(r => { const lot = lotBySupplier(r.supplierLot); return [r.ingredient, r.supplierLot || '—', lot ? `${lot.name} (${lot.producer})` : '—', cn(r.theoreticalKg, 0, 'kg'), cn(r.realKg, 0, 'kg'), pct(r.deviationPct), r.statusFlag]; }), empty: offline ? 'Sin conexión con el servidor: no se pudo leer el detalle de dosificación.' : 'Sin detalle de dosificación.' },
        { title: 'Consumo de inventario', head: ['Insumo', 'Cantidad', 'Desde', 'Valor'], num: [1, 3], rows: mv.filter(m => m.type === 'Consumo en producción').map(m => [itemOf(m.itemId)?.name || m.itemId, cn(m.quantity, 3, itemOf(m.itemId)?.unit || ''), insOf(m.installationId)?.code || '—', cm(m.quantity * (m.unitCost ?? itemOf(m.itemId)?.unitCost ?? 0))]) },
        { title: 'Producto terminado', head: ['Producto', 'Cantidad', 'Silo', 'Fecha'], num: [1], rows: mv.filter(m => m.type === 'Producción terminada').map(m => [itemOf(m.itemId)?.name || m.itemId, cn(m.quantity, 2, itemOf(m.itemId)?.unit || ''), insOf(m.installationId)?.code || '—', fmtDate(m.date)]) },
        { title: 'Controles de calidad', head: ['Fecha', 'Temperatura', 'Retención', 'Granulometría', 'PDI', 'Humedad', 'Resultado', 'Responsable'], rows: controls.map(c => { const e = qs ? qs.evalControl(c) : { ok: true, fails: [] }; return [fmtDate(c.date), c.conditionerTemp ?? '—', c.retentionSec ?? '—', c.microns ?? '—', c.pdi ?? '—', c.moisture ?? '—', e.ok ? 'Conforme' : `Desvío (${e.fails.length})`, c.responsible]; }) },
        { title: 'PLC del acondicionador', head: ['Parámetro', 'Lecturas', 'Mínimo', 'Promedio', 'Máximo', 'Fuera de rango'], num: [1, 2, 3, 4, 5], rows: [plcRow('Temperatura', plc?.temperature, '°C'), plcRow('Retención', plc?.retention, 's')].filter(Boolean), empty: offline ? 'Sin conexión con el servidor.' : 'Sin lecturas del PLC para este lote.' },
        { title: 'Envases generados', head: ['Fecha', 'Producto', 'Cantidad', 'Estado'], num: [2], rows: list('wasteContainers').filter(w => w.batchId === batchId).map(w => [fmtDate(w.date), w.product, cn(w.quantity), w.status]) }
      ]
    };
  }

  function buildQuality(period) {
    const qs = window.pbpQualitySummary ? window.pbpQualitySummary() : null;
    const controls = list('qualityBatchControls').filter(c => inPeriod(c.date, period)).sort((a, z) => a.date.localeCompare(z.date));
    const evals = controls.map(c => ({ c, e: qs ? qs.evalControl(c) : { ok: true, fails: [], pccOk: true } }));
    const hom = list('homogeneityTests').filter(h => inPeriod(h.date, period)), labs = list('labAnalyses').filter(a => inPeriod(a.date, period));
    const lastAudit = [...list('qualityAudits')].sort((a, z) => z.date.localeCompare(a.date))[0], score = lastAudit && qs ? qs.auditScore(lastAudit) : null;
    const t = qs ? qs.targets() : {}, trn = window.pbpTrainingSummary ? window.pbpTrainingSummary() : null;
    const LABELS = { conditionerTemp: 'temperatura', retentionSec: 'retención', microns: 'granulometría', pdi: 'durabilidad', moisture: 'humedad' };
    return {
      subtitle: periodLabel(period),
      kpis: [kpi('Controles de lote', controls.length), kpi('Conformes', controls.length ? `${n(evals.filter(x => x.e.ok).length / controls.length * 100)}%` : '—'), kpi('Desvíos en PCC térmico', evals.filter(x => !x.e.pccOk).length, evals.some(x => !x.e.pccOk) ? 'negative' : 'positive'), kpi('Análisis rechazados', labs.filter(a => a.verdict === 'Rechazado').length, labs.some(a => a.verdict === 'Rechazado') ? 'warning' : 'positive'), kpi('Última auditoría', score ? `${n(score.pct)}% (${fmtDate(lastAudit.date)})` : '—')],
      sections: [
        { title: 'Controles de proceso por lote', head: ['Fecha', 'Lote', 'Temp. °C', 'Retención s', 'µm', 'PDI %', 'Humedad %', 'Resultado'], num: [2, 3, 4, 5, 6], rows: evals.map(({ c, e }) => [fmtDate(c.date), c.batchId, c.conditionerTemp ?? '—', c.retentionSec ?? '—', c.microns ?? '—', c.pdi ?? '—', c.moisture ?? '—', e.ok ? 'Conforme' : `Desvío: ${e.fails.map(f => LABELS[f]).join(', ')}`]) },
        { title: 'Homogeneidad del mezclado', head: ['Fecha', 'Mezclador', 'Método', 'Muestras', 'CV', 'Resultado'], num: [3, 4], rows: hom.map(h => { const cv = qs ? qs.cvOf(h.samples).cv : null; return [fmtDate(h.date), h.mixer, h.method, cn((h.samples || []).length), cv === null ? '—' : pct(cv), cv !== null && cv <= (t.cvMax ?? 5) ? 'Homogéneo' : 'No homogéneo']; }) },
        { title: 'Análisis de materias primas', head: ['Fecha', 'Materia prima', 'Proveedor', 'Lote proveedor', 'Veredicto', 'Observaciones'], rows: labs.map(a => [fmtDate(a.date), a.rawMaterial, a.supplier || '—', a.supplierLot || '—', a.verdict, a.notes || '']) },
        { title: 'Auditorías', head: ['Fecha', 'Auditor', 'Cumplimiento', 'Pendientes'], rows: list('qualityAudits').filter(a => inPeriod(a.date, period) || a === lastAudit).map(a => { const s = qs ? qs.auditScore(a) : { ok: 0, total: 0, pct: 0 }; return [fmtDate(a.date), a.auditor, `${s.ok} de ${s.total} (${n(s.pct)}%)`, (a.items || []).filter(x => !x.ok).map(x => x.text).join(', ') || '—']; }) },
        { title: 'Capacitación del personal (evidencia)', head: ['Tema', 'Al día', 'Faltan o vencidas'], rows: trn ? trn.topics.filter(x => x.quality).map(x => { const c = trn.coverage(x); return [x.name, `${c.ok.length} de ${c.people.length}`, c.missing.map(p => p.emp.name).join(', ') || '—']; }) : [] }
      ],
      note: `Objetivos: acondicionado ${t.tempMin ?? '—'}–${t.tempMax ?? '—'} °C y ${t.retentionMin ?? '—'}–${t.retentionMax ?? '—'} s; PDI mínimo ${t.pdiMin ?? '—'}%; humedad máxima ${t.moistureMax ?? '—'}%; CV máximo ${t.cvMax ?? '—'}%.`
    };
  }

  function buildTreasury(period) {
    const bal = window.pbpAccountBalances ? window.pbpAccountBalances(D()) : null;
    const txs = list('transactions'), inP = txs.filter(t => inPeriod(t.date, period) && t.category !== 'Saldo inicial');
    const sum = l => l.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const pending = txs.filter(t => t.status === 'Pendiente').sort((a, z) => String(a.dueDate || '9').localeCompare(String(z.dueDate || '9')));
    const openCheques = list('cheques').filter(c => (c.direction === 'Recibido' ? ['En cartera', 'Depositado'] : ['Emitido', 'Entregado']).includes(c.status));
    return {
      subtitle: periodLabel(period),
      kpis: [kpi('Disponible (caja + bancos)', bal ? pesos(bal.cash + bal.banksArs) : '—'), kpi('Cobrado en el mes', pesos(sum(inP.filter(t => t.type === 'Ingreso' && t.status === 'Cobrado')))), kpi('Pagado en el mes', pesos(sum(inP.filter(t => t.type === 'Egreso' && t.status === 'Pagado')))), kpi('Por cobrar', pesos(sum(pending.filter(t => t.type === 'Ingreso')))), kpi('Por pagar', pesos(sum(pending.filter(t => t.type === 'Egreso'))), pending.some(t => t.type === 'Egreso' && t.dueDate && daysUntil(t.dueDate) < 0) ? 'negative' : '')],
      sections: [
        { title: 'Saldos por cuenta', head: ['Cuenta', 'Moneda', 'Saldo'], num: [2], rows: bal ? bal.list.filter(a => a.status === 'Activa').map(a => [a.name, a.currency, a.currency === 'USD' ? cell(Math.round(a.balance), `US$ ${n(a.balance)}`) : cm(a.balance)]) : [] },
        { title: 'Pendientes de cobro y pago', head: ['Vence', 'Tipo', 'Contraparte', 'Concepto', 'Importe', 'Situación'], num: [4], rows: pending.map(t => { const d = t.dueDate ? daysUntil(t.dueDate) : null; return [t.dueDate ? fmtDate(t.dueDate) : '—', t.type === 'Ingreso' ? 'Cobro' : 'Pago', t.counterparty, t.description || t.category, cm(t.amount), d === null ? '—' : d < 0 ? `Vencido hace ${-d} días` : d === 0 ? 'Vence hoy' : `En ${d} días`]; }) },
        { title: 'Movimientos del mes', head: ['Fecha', 'Tipo', 'Categoría', 'Contraparte', 'Concepto', 'Importe', 'Estado'], num: [5], rows: inP.sort((a, z) => a.date.localeCompare(z.date)).map(t => [fmtDate(t.date), t.type, t.category, t.counterparty, t.description || '', cm(t.amount), t.status]) },
        { title: 'Cheques abiertos', head: ['Vence', 'Tipo', 'Número', 'Contraparte', 'Banco', 'Importe', 'Estado'], num: [5], rows: openCheques.sort((a, z) => String(a.dueDate).localeCompare(String(z.dueDate))).map(c => [fmtDate(c.dueDate), c.direction === 'Recibido' ? 'A cobrar' : 'A cubrir', c.number, c.counterparty, c.bank, cm(c.amount), c.status]) }
      ]
    };
  }

  function buildHR() {
    const emps = list('employees'), current = emps.filter(e => e.status !== 'Baja');
    const trn = window.pbpTrainingSummary ? window.pbpTrainingSummary() : null, status = id => trn?.people.find(p => p.emp.id === id);
    const since = new Date(); since.setFullYear(since.getFullYear() - 1); const from = since.toLocaleDateString('sv-SE');
    const overdue = current.filter(e => e.trainingDue && e.trainingDue < todayISO());
    return {
      subtitle: `Al ${fmtDate(todayISO())}`,
      kpis: [kpi('Dotación activa', emps.filter(e => e.status === 'Activo').length), kpi('En licencia', emps.filter(e => e.status === 'Licencia').length), kpi('Costo laboral mensual', pesos(current.reduce((s, e) => s + (Number(e.monthlyCost) || 0), 0))), kpi('Capacitaciones vencidas', overdue.length, overdue.length ? 'negative' : 'positive'), kpi('Con temas sin registrar', trn ? trn.people.filter(p => p.pending.some(i => i.state === 'missing')).length : '—')],
      sections: [
        { title: 'Personal', head: ['Legajo', 'Nombre', 'Puesto', 'Turno', 'Estado', 'Costo mensual', 'Vence capacitación', 'Al día', 'Pendientes'], num: [5], rows: current.sort((a, z) => a.id.localeCompare(z.id, 'es', { numeric: true })).map(e => { const s = status(e.id); return [e.id, e.name, e.position, e.shift, e.status, cm(e.monthlyCost), fmtDate(e.trainingDue), s ? `${s.ok} de ${s.items.length}` : '—', s ? s.pending.map(i => `${i.state === 'missing' ? 'Falta' : 'Vencida'}: ${i.topic.name}`).join(' · ') || '—' : '—']; }) },
        { title: 'Capacitaciones de los últimos 12 meses', head: ['Fecha', 'Tema', 'Instructor', 'Horas', 'Asistentes', 'Certificado'], num: [3, 4], rows: list('trainings').filter(t => t.date >= from).sort((a, z) => z.date.localeCompare(a.date)).map(t => [fmtDate(t.date), t.topic, t.instructor, cn(t.hours, 1), cn((t.attendees || []).length), t.certificate || '—']) }
      ]
    };
  }

  function buildWaste(period) {
    const cont = list('wasteContainers'), inP = (key) => list(key).filter(x => inPeriod(x.date, period));
    const pending = cont.filter(c => c.status !== 'Entregado');
    const deliveries = inP('wasteDeliveries');
    return {
      subtitle: periodLabel(period),
      kpis: [kpi('Envases generados', inP('wasteContainers').reduce((s, c) => s + (Number(c.quantity) || 0), 0)), kpi('Envases pendientes (total)', pending.reduce((s, c) => s + (Number(c.quantity) || 0), 0), pending.length ? 'warning' : 'positive'), kpi('Entregas', deliveries.length), kpi('Entregas sin certificado', deliveries.filter(x => !x.certificate).length, deliveries.some(x => !x.certificate) ? 'warning' : 'positive'), kpi('Otros residuos', inP('wasteOther').length)],
      sections: [
        { title: 'Envases', head: ['Fecha', 'Categoría', 'Producto', 'Cantidad', 'Tipo de envase', 'Estado', 'Lote'], num: [3], rows: inP('wasteContainers').map(c => [fmtDate(c.date), c.category, c.product, cn(c.quantity), c.containerType, c.status, c.batchId || '—']) },
        { title: 'Triple lavado', head: ['Fecha', 'Envase', 'Cantidad', 'Método', 'Destino del enjuague', 'Responsable'], num: [2], rows: inP('wasteWashes').map(w => [fmtDate(w.date), cont.find(c => c.id === w.containerId)?.product || w.containerId, cn(w.quantity), w.method, w.rinseDestination, w.responsible]) },
        { title: 'Entregas', head: ['Fecha', 'Tipo', 'Receptor', 'Cantidad', 'Kg', 'Comprobante', 'Certificado'], num: [3, 4], rows: deliveries.map(x => [fmtDate(x.date), x.deliveryType, x.receiver, cn(x.quantity), cn(x.weightKg, 1), x.voucher || '—', x.certificate ? 'Sí' : 'No']) },
        { title: 'Otros residuos', head: ['Fecha', 'Tipo', 'Cantidad', 'Disposición', 'Manifiesto', 'Responsable'], num: [2], rows: inP('wasteOther').map(r => [fmtDate(r.date), r.type, cn(r.quantity, 1, r.unit), r.disposition, r.manifest || '—', r.responsible]) }
      ]
    };
  }

  function buildEquipment() {
    const eq = [...list('equipment')].sort((a, z) => String(a.nextMaintenance || '9').localeCompare(String(z.nextMaintenance || '9')));
    const late = eq.filter(e => e.nextMaintenance && daysUntil(e.nextMaintenance) < 0), soon = eq.filter(e => e.nextMaintenance && daysUntil(e.nextMaintenance) >= 0 && daysUntil(e.nextMaintenance) <= 30);
    const plc = window.pbpLastTelemetry;
    const amount = (v, cur) => (cur === 'USD' ? cell(Number(v) || 0, `US$ ${n(v)}`) : cm(v));
    return {
      subtitle: `Al ${fmtDate(todayISO())}`,
      kpis: [kpi('Equipos operativos', `${eq.filter(e => e.status === 'Operativo').length} de ${eq.length}`), kpi('Mantenimientos vencidos', late.length, late.length ? 'negative' : 'positive'), kpi('Próximos 30 días', soon.length, soon.length ? 'warning' : ''), kpi('Críticos fuera de servicio', eq.filter(e => e.criticality === 'Crítica' && e.status !== 'Operativo').length), kpi('Última lectura del PLC', plc?.loggedAt ? `${plc.equipmentName} ${n(plc.valueNumeric, 1)} (${plc.statusFlag})` : '—')],
      sections: [{ title: 'Equipos', head: ['Código', 'Equipo', 'Área', 'Estado', 'Horas', 'Próximo mantenimiento', 'Criticidad', 'Inversión', 'Costo de mantenimiento'], num: [4, 7, 8],
        rows: eq.map(e => { const d = e.nextMaintenance ? daysUntil(e.nextMaintenance) : null; return [e.id, e.name, e.area, e.status, cn(e.hours), e.nextMaintenance ? `${fmtDate(e.nextMaintenance)} (${d < 0 ? `vencido hace ${-d} d` : `en ${d} d`})` : '—', e.criticality, amount(e.investment, e.currency), amount(e.maintenanceCost, e.currency)]; }) }]
    };
  }

  function groupBy(items, key) {
    const m = new Map();
    for (const x of items) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return [...m.entries()];
  }

  /* ---------- pantalla ---------- */
  let active = null, lastReport = null, building = 0;
  const text = c => (c && typeof c === 'object' ? c.t : c ?? '');
  function renderGrid() {
    const visible = REPORTS.filter(r => allowed(r.page));
    el('rpGrid').innerHTML = visible.map(r => `<button class="report-card${active?.id === r.id ? ' active' : ''}" data-report="${r.id}"><span class="rc-icon">${r.icon}</span><b>${esc(r.title)}</b><small>${esc(r.desc)}</small></button>`).join('') || '<p class="text-muted">Su rol no tiene acceso a ningún reporte.</p>';
  }
  function paramControl(r) {
    const today = todayISO();
    if (r.param === 'date') return `<input type="date" class="form-select" id="rpParam" value="${today}" aria-label="Fecha">`;
    if (r.param === 'period') return `<input type="month" class="form-select" id="rpParam" value="${today.slice(0, 7)}" aria-label="Mes">`;
    if (r.param === 'batch') {
      const batches = [...list('batches')].sort((a, z) => z.id.localeCompare(a.id, 'es', { numeric: true }));
      const first = batches.find(b => b.status === 'Terminado') || batches[0];
      return `<select class="form-select" id="rpParam" aria-label="Lote">${batches.map(b => `<option value="${esc(b.id)}" ${b === first ? 'selected' : ''}>${esc(b.id)} · ${esc(b.phase)} · ${esc(b.status)}</option>`).join('')}</select>`;
    }
    return '';
  }
  async function open(id) {
    active = REPORTS.find(r => r.id === id); if (!active) return;
    renderGrid();
    el('rpViewer').hidden = false;
    el('rpTitle').textContent = active.title;
    el('rpParamWrap').innerHTML = paramControl(active);
    await rebuild();
    el('rpViewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function rebuild() {
    if (!active) return;
    const token = ++building, param = el('rpParam')?.value || '';
    el('rpBody').innerHTML = '<p class="text-muted">Armando el reporte…</p>';
    try {
      const report = await active.build(param);
      if (token !== building) return;
      lastReport = { ...report, title: active.title, id: active.id, param };
      el('rpSubtitle').textContent = report.subtitle || '';
      el('rpBody').innerHTML = renderReport(report);
    } catch (error) { console.error('Reportes:', error); el('rpBody').innerHTML = `<p class="negative">No se pudo armar el reporte: ${esc(error.message)}</p>`; }
  }
  function renderReport(r) {
    const kpis = (r.kpis || []).length ? `<div class="rp-kpis">${r.kpis.map(k => `<div class="rp-kpi"><span>${esc(k.label)}</span><b class="${k.tone || ''}">${esc(k.value)}</b></div>`).join('')}</div>` : '';
    const sections = (r.sections || []).map(s => `<div class="rp-section"><h4>${esc(s.title)} <small class="text-muted">${s.rows.length ? `· ${s.rows.length}` : ''}</small></h4>${s.rows.length
      ? `<div class="table-wrap"><table><thead><tr>${s.head.map((h, i) => `<th class="${(s.num || []).includes(i) ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(row => `<tr>${row.map((c, i) => `<td class="${(s.num || []).includes(i) ? 'num' : ''}">${esc(text(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : `<p class="text-muted">${esc(s.empty || 'Sin registros en el período.')}</p>`}</div>`).join('');
    return kpis + sections + (r.note ? `<p class="rp-note">${esc(r.note)}</p>` : '');
  }

  /* ---------- exportación ---------- */
  const scripts = {};
  function loadScript(src) {
    return scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = src; s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new Error('No se pudo cargar la librería de exportación')); };
      document.head.appendChild(s);
    }));
  }
  const company = () => (settings().company || {}).name || 'Pampa PBP';
  const fileName = ext => `${lastReport.title} ${lastReport.param || todayISO()}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').toLowerCase() + '.' + ext;
  // Las fuentes estándar de PDF no tienen algunos signos tipográficos
  const pdfText = v => String(v ?? '').replace(/[  ]/g, ' ').replace(/[—–]/g, '-').replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[•·]/g, '·').replace(/…/g, '...').replace(/[^\x00-\xff]/g, '');

  async function exportPdf() {
    if (!lastReport) return;
    await loadScript('vendor/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf, r = lastReport;
    const wide = (r.sections || []).some(s => s.head.length > 6);
    const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
    let y = M;
    const header = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120);
      doc.text(pdfText(company()), M, 8); doc.text(pdfText(`Generado el ${new Date().toLocaleString('es-AR')}`), W - M, 8, { align: 'right' });
      doc.setTextColor(20); y = 14;
    };
    const ensure = h => { if (y + h > H - 12) { doc.addPage(); header(); return true; } return false; };
    header();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(pdfText(r.title), M, y + 4); y += 10;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90); doc.text(pdfText(r.subtitle || ''), M, y); doc.setTextColor(20); y += 7;
    if ((r.kpis || []).length) {
      const cols = wide ? 5 : 3, w = (W - 2 * M) / cols;
      r.kpis.forEach((k, i) => {
        if (i % cols === 0) { if (i) y += 13; ensure(13); }
        const x = M + (i % cols) * w;
        doc.setFillColor(242, 244, 247); doc.roundedRect(x, y, w - 3, 11, 1.5, 1.5, 'F');
        doc.setFontSize(7); doc.setTextColor(110); doc.text(pdfText(k.label).toUpperCase(), x + 2, y + 4);
        doc.setTextColor(20); doc.setFont('helvetica', 'bold'); const value = pdfText(k.value); doc.setFontSize(10); if (doc.getTextWidth(value) > w - 6) doc.setFontSize(Math.max(6.5, 10 * (w - 6) / doc.getTextWidth(value))); doc.text(doc.splitTextToSize(value, w - 6)[0], x + 2, y + 9); doc.setFont('helvetica', 'normal');
      });
      y += 17;
    }
    for (const s of r.sections || []) {
      ensure(14);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(pdfText(s.title), M, y); y += 5; doc.setFont('helvetica', 'normal');
      if (!s.rows.length) { doc.setFontSize(8); doc.setTextColor(120); doc.text(pdfText(s.empty || 'Sin registros en el período.'), M, y); doc.setTextColor(20); y += 8; continue; }
      // Ancho de columna proporcional al texto más largo (con mínimo y máximo)
      const all = [s.head, ...s.rows.map(row => row.map(text))].map(row => row.map(c => pdfText(c)));
      const weights = s.head.map((_, i) => Math.min(40, Math.max(6, ...all.map(row => String(row[i] ?? '').length))));
      const total = weights.reduce((a, b) => a + b, 0), widths = weights.map(w => w / total * (W - 2 * M));
      const drawRow = (cells, bold, fill) => {
        doc.setFontSize(7.5); doc.setFont('helvetica', bold ? 'bold' : 'normal');
        const lines = cells.map((c, i) => doc.splitTextToSize(String(c ?? ''), widths[i] - 2));
        const h = Math.max(...lines.map(l => l.length)) * 3.3 + 2;
        if (ensure(h) && !bold) { drawRow(all[0], true, true); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); }
        if (fill) { doc.setFillColor(230, 234, 240); doc.rect(M, y, W - 2 * M, h, 'F'); }
        let x = M;
        lines.forEach((l, i) => { const right = (s.num || []).includes(i); doc.text(l, right ? x + widths[i] - 1 : x + 1, y + 3.4, { align: right ? 'right' : 'left' }); x += widths[i]; });
        doc.setDrawColor(225); doc.line(M, y + h, W - M, y + h);
        y += h;
      };
      drawRow(all[0], true, true);
      all.slice(1).forEach(row => drawRow(row, false, false));
      y += 6;
    }
    if (r.note) { ensure(10); doc.setFontSize(8); doc.setTextColor(100); doc.text(doc.splitTextToSize(pdfText(r.note), W - 2 * M), M, y); doc.setTextColor(20); }
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140); doc.text(`Página ${i} de ${pages}`, W - M, H - 6, { align: 'right' }); doc.text('Pampa PBP', M, H - 6); }
    doc.save(fileName('pdf'));
    toast('PDF generado');
  }

  async function exportXlsx() {
    if (!lastReport) return;
    await loadScript('vendor/xlsx.full.min.js');
    const XLSX = window.XLSX, r = lastReport, wb = XLSX.utils.book_new(), used = new Set();
    const sheetName = name => { let base = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28), out = base, i = 2; while (used.has(out)) out = `${base.slice(0, 25)} ${i++}`; used.add(out); return out; };
    const summary = [[r.title], [r.subtitle || ''], [`${company()} · generado el ${new Date().toLocaleString('es-AR')}`], [], ...(r.kpis || []).map(k => [k.label, k.value]), ...(r.note ? [[], [r.note]] : [])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), sheetName('Resumen'));
    for (const s of r.sections || []) {
      const ws = XLSX.utils.aoa_to_sheet([s.head, ...s.rows.map(row => row.map(c => (c && typeof c === 'object' ? c.v ?? c.t : c ?? '')))]);
      ws['!cols'] = s.head.map((h, i) => ({ wch: Math.min(45, Math.max(10, h.length + 2, ...s.rows.map(row => String(text(row[i])).length + 1))) }));
      XLSX.utils.book_append_sheet(wb, ws, sheetName(s.title));
    }
    XLSX.writeFile(wb, fileName('xlsx'));
    toast('Excel generado');
  }

  // Texto breve del reporte: para WhatsApp y como contexto de PampaIA
  function reportText(r, maxRows = 6) {
    const lines = [`*${r.title}*`, r.subtitle || '', ''];
    (r.kpis || []).forEach(k => lines.push(`• ${k.label}: ${k.value}`));
    for (const s of r.sections || []) {
      if (!s.rows.length) continue;
      lines.push('', `_${s.title}_`);
      s.rows.slice(0, maxRows).forEach(row => lines.push(`- ${row.map(text).filter(x => x !== '' && x !== '—').join(' · ')}`));
      if (s.rows.length > maxRows) lines.push(`(+${s.rows.length - maxRows} más)`);
    }
    if (r.note) lines.push('', r.note);
    return lines.join('\n');
  }
  function shareWhatsApp() {
    if (!lastReport) return;
    const msg = `${company()}\n${reportText(lastReport, 5)}`.slice(0, 3500);
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  }
  function askAI() {
    if (!lastReport) return;
    if (typeof window.pbpAskAI !== 'function') return toast('PampaIA no está disponible');
    window.pbpAskAI(`Analizá el reporte «${lastReport.title}» (${lastReport.subtitle}). Resumí lo más importante, señalá desvíos o riesgos y sugerí acciones concretas.`, { reporte: reportText(lastReport, 25).slice(0, 12000) });
  }
  window.pbpReportText = (id, param) => { const r = REPORTS.find(x => x.id === id); return r ? Promise.resolve(r.build(param)).then(rep => reportText({ ...rep, title: r.title }, 25)) : Promise.resolve(''); };

  /* ---------- eventos ---------- */
  el('rpGrid').addEventListener('click', e => { const b = e.target.closest('[data-report]'); if (b) open(b.dataset.report); });
  el('rpParamWrap').addEventListener('change', rebuild);
  const guard = fn => async () => { try { await fn(); } catch (error) { toast(error.message); } };
  el('rpPdf').addEventListener('click', guard(exportPdf));
  el('rpXlsx').addEventListener('click', guard(exportXlsx));
  el('rpWa').addEventListener('click', shareWhatsApp);
  el('rpAi').addEventListener('click', askAI);
  document.addEventListener('pbp:bootstrap', () => setTimeout(() => { renderGrid(); if (active && !el('rpViewer').hidden) rebuild(); }, 0));
  document.addEventListener('pbp:role', renderGrid);
  renderGrid();
})();
