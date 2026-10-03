/* PampaIA de PampaPorcinos: las capacidades de cada versión, calculadas con los datos del ERP
 * (mismo esquema que PampaAgro y PampaGanaderia).
 *
 *   SMALL · Básica       resumen del día, alertas de desvíos, existencias por categoría
 *   MEDIUM · Profesional proyección de alimento e insumos, costo por cabeza y por kg, equipos y mantenimiento
 *   LARGE · Premium      rentabilidad, cumplimiento SENASA y fiscal, caja a 90 días
 *
 * Ningún número sale de un modelo de lenguaje: todo se calcula con los registros cargados, con los
 * mismos cálculos que Costos, Inventario, Sanidad/SENASA e IVA (la app los pasa en `d.calc`). Si
 * falta historial, se dice. El texto usa el formato de WhatsApp (*negrita*, _cursiva_) para que el
 * mismo resultado sirva en el panel, en la nota de voz y en el WhatsApp.
 *
 * UMD: navegador (window.PampaAsistenteIA) y Node (el servidor de WhatsApp usa esConsulta).
 */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) raiz.PampaAsistenteIA = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NIVEL_PLAN = { basica: 1, profesional: 2, premium: 3, trial: 3 };
  const NOMBRE_PLAN = { basica: 'Básica', profesional: 'Profesional', premium: 'Premium', trial: 'Trial completo' };

  const CAPACIDADES = [
    { id: 'resumen', nivel: 1, icono: '📋', titulo: 'Resumen del día', detalle: 'Movimientos de hoy y ayer, plata en caja y bancos, ventas del mes y alertas.' },
    { id: 'alertas', nivel: 1, icono: '⚠️', titulo: 'Alertas de desvíos', detalle: 'Mortalidad por lote sobre el umbral, stock por agotarse, lotes en carencia y SENASA.' },
    { id: 'existencias', nivel: 1, icono: '🐖', titulo: 'Existencias por categoría', detalle: 'Cabezas de cada categoría, madres, altas y bajas del mes.' },
    { id: 'stock', nivel: 2, icono: '🌾', titulo: 'Proyección de alimento e insumos', detalle: 'En cuántos días se acaba cada alimento o insumo según el consumo real.' },
    { id: 'costoCabeza', nivel: 2, icono: '🧮', titulo: 'Costo por cabeza y por kg', detalle: 'Costo de los últimos 12 meses por cabeza en stock y por kg vendido, y en qué se va.' },
    { id: 'mantenimiento', nivel: 2, icono: '🔧', titulo: 'Equipos y mantenimiento', detalle: 'Gasto por equipo en 12 meses y services vencidos o próximos.' },
    { id: 'rentabilidad', nivel: 3, icono: '📈', titulo: 'Rentabilidad', detalle: 'Ventas, costo y margen de los últimos 12 meses, por kg y por cabeza vendida.' },
    { id: 'cumplimiento', nivel: 3, icono: '🩺', titulo: 'Cumplimiento SENASA y fiscal', detalle: 'Plan sanitario (Aujeszky), DT-e, RENSPA, posición de IVA del mes y residuos y efluentes.' },
    { id: 'caja90', nivel: 3, icono: '💵', titulo: 'Caja a 90 días', detalle: 'Saldo proyectado con cheques, cuotas de créditos y sueldos.' },
  ];

  // Qué datos ve cada rol de PampaPorcinos (el propietario ve todo). Mismo mapa que los módulos de
  // cada rol en "Módulos y roles por versión": Administración (inventario, costos, finanzas, ventas,
  // ARCA), Ingeniero/Veterinario (animales, sanidad/SENASA, alimentación, costos) y Operador
  // (movimientos, alimentación, sanidad, inventario y equipos). Mantenimiento de equipos: propietario y operador.
  const ROLES = {
    Propietario: null,
    'Administración': ['plata', 'costos', 'ventas', 'fiscal', 'existencias', 'stock', 'residuos'],
    'Ingeniero/Veterinario': ['existencias', 'stock', 'sanidad', 'costos'],
    Operador: ['existencias', 'stock', 'sanidad', 'mantenimiento'],
  };
  const DATOS_CAPACIDAD = {
    resumen: ['existencias'], alertas: ['existencias'], existencias: ['existencias'], stock: ['stock'],
    costoCabeza: ['costos'], mantenimiento: ['mantenimiento'], rentabilidad: ['costos', 'ventas'],
    cumplimiento: [], caja90: ['plata'],
  };

  const pesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
  const num = (n, dec = 0) => (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: dec });
  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const iso = (fecha) => new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const sumarDias = (fechaIso, dias) => { const x = new Date(`${fechaIso}T12:00:00`); x.setDate(x.getDate() + dias); return iso(x); };
  const fechaCorta = (f) => { const [, m, dd] = String(f || '').split('-'); return dd ? `${dd}/${m}` : ''; };
  function fechaIso(f) {
    if (!f) return '';
    const t = String(f).trim();
    const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
  }

  // Pregunta o parte: "¿cuánto gasté?" pregunta; "murieron 3 lechones" cuenta algo que pasó.
  const PALABRAS_PREGUNTA = /^(cuanto|cuanta|cuantos|cuantas|que|como|cual|cuales|donde|cuando|decime|pasame|mostrame|mandame|dame|contame|necesito saber|quiero saber)\b/;
  function esConsulta(texto) {
    const crudo = String(texto || '');
    const t = normalizar(crudo).trim();
    if (!t) return false;
    if (/[¿?]/.test(crudo) || PALABRAS_PREGUNTA.test(t)) return true;
    return /\b(margen|rentabilidad|saldo|saldos|reporte|resumen|existencias)\b/.test(t) &&
      !/\b(pague|pagamos|compre|compramos|cargue|cargamos|vacune|vacunamos|vendi|vendimos|cobre|cobramos|gaste|gastamos|nacieron|murio|murieron|destete|desteté)\b/.test(t);
  }

  /**
   * @param {object} d { estado(): datos de la app, plan(), rol(), calc: { costSummary, stockAutonomy,
   *                     buildLots, evaluarSanidad, ivaLiquidation, creditBalances, monthOf } }
   */
  function crearAsistente(d) {
    const plan = () => (NIVEL_PLAN[d.plan()] ? d.plan() : 'basica');
    const capacidad = (id) => CAPACIDADES.find((c) => c.id === id);
    const planMinimo = (nivel) => ({ 1: 'Básica', 2: 'Profesional', 3: 'Premium' })[nivel];
    const puede = (id) => NIVEL_PLAN[plan()] >= capacidad(id).nivel;
    let rolConsulta;
    const rolActual = () => (rolConsulta !== undefined ? rolConsulta : d.rol ? d.rol() : null);
    const veDato = (dato) => { const rol = rolActual(); const lista = rol ? ROLES[rol] : null; return !rol || lista === null || lista === undefined || lista.includes(dato); };
    const ve = (datos) => (datos || []).every(veDato);
    function conRol(opciones, fn) {
      const previo = rolConsulta;
      if (opciones && opciones.rol !== undefined) rolConsulta = opciones.rol;
      try { return fn(); } finally { rolConsulta = previo; }
    }
    const resultado = (titulo, lineas, extra = {}) => ({ titulo, lineas, texto: [`*${titulo}*`, '', ...lineas.map((l) => l.texto)].join('\n'), ...extra });
    const linea = (nivel, texto) => ({ nivel, texto });
    const s = () => d.estado() || {};
    const hoyIso = (hoy) => iso(hoy || new Date());

    function bloqueado(id) {
      const c = capacidad(id);
      return resultado(`🔒 ${c.titulo}`, [linea('warn', `Esta función es de la versión *${planMinimo(c.nivel)}*. Tu plan actual es ${NOMBRE_PLAN[plan()]}.`), linea('ok', `_${c.detalle}_`)], { bloqueado: true, requiere: planMinimo(c.nivel) });
    }
    function sinAcceso(titulo) {
      return resultado(`🔒 ${titulo}`, [linea('warn', `Tu usuario (*${rolActual() || 'sin rol'}*) no tiene acceso a esta información. Pedísela al propietario.`)], { bloqueado: true, porRol: true });
    }

    // ─── Datos base ──────────────────────────────────────────────────────────────────────
    function existencias(hasta) {
      const cab = {};
      (s().animals || []).forEach((r) => {
        if (hasta && fechaIso(r.fecha) > hasta) return;
        const q = Number(r.cantidad) || 0;
        if (['Alta / ingreso', 'Destete'].includes(r.tipo)) cab[r.categoria] = (cab[r.categoria] || 0) + q;
        if (['Mortalidad', 'Venta', 'Baja'].includes(r.tipo)) cab[r.categoria] = (cab[r.categoria] || 0) - q;
        if (r.tipo === 'Destete' && r.categoria !== 'Lechones maternidad') cab['Lechones maternidad'] = (cab['Lechones maternidad'] || 0) - q;
      });
      return cab;
    }
    const total = (cab) => Object.values(cab).reduce((t, v) => t + Math.max(0, v), 0);
    function saldos() {
      const fin = s().finances || [];
      const neto = (comp) => fin.filter((r) => r.componente === comp).reduce((t, r) => t + (['Ingreso', 'Cobro'].includes(r.tipo) ? 1 : -1) * (Number(r.importe) || 0), 0);
      return { caja: neto('Caja'), bancos: neto('Bancos') };
    }
    const enPeriodo = (lista, desde, hasta, campo = 'fecha') => (lista || []).filter((r) => { const f = fechaIso(r[campo]); return f && f >= desde && f <= hasta; });

    // ─── Básica ──────────────────────────────────────────────────────────────────────────
    function resumenDiario(hoy) {
      const h = hoyIso(hoy);
      const ayer = sumarDias(h, -1);
      const lineas = [];
      const movs = enPeriodo(s().animals, ayer, h);
      lineas.push(linea('ok', movs.length ? `🐖 Movimientos hoy y ayer: ${movs.map((m) => `${m.tipo} ${num(m.cantidad)} ${m.categoria}`).slice(0, 6).join(' · ')}` : '🐖 Sin movimientos de animales hoy ni ayer.'));
      if (veDato('plata')) { const p = saldos(); lineas.push(linea(p.caja + p.bancos < 0 ? 'risk' : 'ok', `💰 Caja ${pesos(p.caja)} · Bancos ${pesos(p.bancos)}`)); }
      if (veDato('ventas')) { const v = enPeriodo(s().sales, `${h.slice(0, 7)}-01`, h); lineas.push(linea('ok', `🧾 Ventas del mes: ${num(v.reduce((t, x) => t + (Number(x.cantidad) || 0), 0))} cab. por ${pesos(v.reduce((t, x) => t + (Number(x.total) || 0), 0))}`)); }
      const al = alertasDesvios(hoy).lineas.filter((l) => l.nivel !== 'ok');
      lineas.push(al.length ? linea('warn', `⚠️ ${al.length} alerta(s): ${al.slice(0, 3).map((l) => l.texto.replace(/\*/g, '')).join(' · ')}`) : linea('ok', '✅ Sin alertas.'));
      return resultado('📋 Resumen del día', lineas);
    }

    function alertasDesvios(hoy) {
      const h = hoyIso(hoy);
      const lineas = [];
      (d.calc.buildLots(s().animals || [], h) || []).filter((l) => l.alerta).forEach((l) => lineas.push(linea('risk', `🚨 Lote *${l.lote}*: mortalidad diaria ${num(l.pctDiario, 2)}% / acumulada ${num(l.pctAcumulado, 2)}% (máx. ${l.rule.diaria}% / ${l.rule.acumulada}%)`)));
      if (veDato('stock')) (d.calc.stockAutonomy(s().inventory || [], s().feeding || [], h, s().health || [], s().treatments || []) || []).filter((i) => i.dias < 7).forEach((i) => lineas.push(linea(i.dias < 2 ? 'risk' : 'warn', `🌾 *${i.item}* alcanza para ${num(Math.max(0, i.dias), 1)} días`)));
      (s().treatments || []).filter((t) => t.fechaLiberacion > h).forEach((t) => lineas.push(linea('warn', `💉 Lote *${t.lote}* en carencia hasta el ${fechaCorta(t.fechaLiberacion)}: no enviar a faena`)));
      const san = d.calc.evaluarSanidad ? d.calc.evaluarSanidad() : null;
      if (san?.block) lineas.push(linea('risk', `🩺 ${san.block}`));
      (san?.warnings || []).slice(0, 3).forEach((w) => lineas.push(linea('warn', `🩺 ${w}`)));
      return resultado('⚠️ Alertas de desvíos', lineas.length ? lineas : [linea('ok', 'Sin desvíos: mortalidad dentro de los umbrales, stock suficiente y sin bloqueos sanitarios.')]);
    }

    function existenciasPorCategoria(hoy) {
      const h = hoyIso(hoy);
      const cab = existencias(h);
      const mes = enPeriodo(s().animals, `${h.slice(0, 7)}-01`, h);
      const altas = mes.filter((r) => ['Alta / ingreso', 'Destete'].includes(r.tipo)).reduce((t, r) => t + (Number(r.cantidad) || 0), 0);
      const bajas = mes.filter((r) => ['Mortalidad', 'Venta', 'Baja'].includes(r.tipo)).reduce((t, r) => t + (Number(r.cantidad) || 0), 0);
      const madres = ['Madres gestantes', 'Madres lactantes', 'Cachorras de reposición'].reduce((t, c) => t + Math.max(0, cab[c] || 0), 0);
      const filas = Object.entries(cab).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c, v]) => linea('ok', `• ${c}: *${num(v)}*`));
      return resultado('🐖 Existencias', [linea('ok', `Total *${num(total(cab))}* cabezas · madres ${num(madres)}`), ...filas, linea('ok', `Este mes: ${num(altas)} altas/destetes y ${num(bajas)} bajas (muertes, ventas y bajas).`)]);
    }

    // ─── Profesional ─────────────────────────────────────────────────────────────────────
    function proyeccionStock(hoy) {
      const items = d.calc.stockAutonomy(s().inventory || [], s().feeding || [], hoyIso(hoy), s().health || [], s().treatments || []) || [];
      if (!items.length) return resultado('🌾 Proyección de alimento e insumos', [linea('warn', 'Sin consumos en los últimos 14 días para proyectar. Cargá la alimentación diaria.')]);
      return resultado('🌾 Proyección de alimento e insumos', items.sort((a, b) => a.dias - b.dias).map((i) => linea(i.dias < 7 ? 'warn' : 'ok', `• *${i.item}*: ${num(Math.max(0, i.stock))} ${i.unidad || ''} · consumo ${num(i.diario, 1)}/día · alcanza ${num(Math.max(0, i.dias), 0)} días`)));
    }

    function resumenCostos12(hoy) {
      const h = hoyIso(hoy);
      return d.calc.costSummary(s(), sumarDias(h, -365), h);
    }

    function costoPorCabeza(hoy) {
      const h = hoyIso(hoy);
      const c = resumenCostos12(hoy);
      const cab = total(existencias(h));
      const ventas = enPeriodo(s().sales, sumarDias(h, -365), h);
      const kg = ventas.reduce((t, v) => t + (Number(v.kg) || 0), 0);
      const vendidas = ventas.reduce((t, v) => t + (Number(v.cantidad) || 0), 0);
      if (!c.total) return resultado('🧮 Costo por cabeza y por kg', [linea('warn', 'Sin costos cargados en los últimos 12 meses.')]);
      const top = Object.entries(c.porOrigen).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(v / c.total * 100)}%`).join(' · ');
      return resultado('🧮 Costo por cabeza y por kg (12 meses)', [
        linea('ok', `Costo total *${pesos(c.total)}*`),
        linea('ok', cab ? `Por cabeza en stock (${num(cab)}): *${pesos(c.total / cab)}*` : 'Sin cabezas en stock para repartir el costo.'),
        linea(kg ? 'ok' : 'warn', kg ? `Por kg vendido (${num(kg)} kg): *${pesos(c.total / kg)}* · por cabeza vendida (${num(vendidas)}): ${pesos(vendidas ? c.total / vendidas : 0)}` : 'Sin kilos vendidos en 12 meses: no se puede calcular el costo por kg.'),
        linea('ok', `En qué se va: ${top}`),
      ]);
    }

    function equiposYMantenimiento(hoy) {
      const h = hoyIso(hoy);
      const mant = enPeriodo(s().machineMaintenance, sumarDias(h, -365), h);
      const porEquipo = {};
      mant.forEach((m) => { porEquipo[m.equipo || 'Equipo'] = (porEquipo[m.equipo || 'Equipo'] || 0) + (Number(m.costo) || 0); });
      const proximos = (s().machineMaintenance || []).filter((m) => m.proximo && m.proximo <= sumarDias(h, 30));
      const lineas = Object.entries(porEquipo).sort((a, b) => b[1] - a[1]).map(([e, v]) => linea('ok', `• ${e}: ${pesos(v)}`));
      proximos.forEach((m) => lineas.push(linea(m.proximo < h ? 'risk' : 'warn', `🔧 ${m.equipo}: próximo service ${m.proximo < h ? 'VENCIDO el' : 'el'} ${fechaCorta(m.proximo)}`)));
      return resultado('🔧 Equipos y mantenimiento (12 meses)', lineas.length ? lineas : [linea('ok', 'Sin mantenimientos cargados ni services próximos.')]);
    }

    // ─── Premium ─────────────────────────────────────────────────────────────────────────
    function rentabilidad(hoy) {
      const h = hoyIso(hoy);
      const c = resumenCostos12(hoy);
      const ventas = enPeriodo(s().sales, sumarDias(h, -365), h);
      const ingreso = ventas.reduce((t, v) => t + (Number(v.total) || 0), 0);
      const kg = ventas.reduce((t, v) => t + (Number(v.kg) || 0), 0);
      const vendidas = ventas.reduce((t, v) => t + (Number(v.cantidad) || 0), 0);
      if (!ingreso && !c.total) return resultado('📈 Rentabilidad', [linea('warn', 'Sin ventas ni costos en los últimos 12 meses.')]);
      const margen = ingreso - c.total;
      const porTipo = {};
      ventas.forEach((v) => { porTipo[v.tipo || 'Otros'] = (porTipo[v.tipo || 'Otros'] || 0) + (Number(v.total) || 0); });
      return resultado('📈 Rentabilidad (12 meses)', [
        linea('ok', `Ventas *${pesos(ingreso)}* · costos *${pesos(c.total)}*`),
        linea(margen < 0 ? 'risk' : 'ok', `Margen *${pesos(margen)}*${ingreso ? ` (${num(margen / ingreso * 100, 1)}% de las ventas)` : ''}`),
        ...(kg ? [linea('ok', `Por kg: precio ${pesos(ingreso / kg)} · costo ${pesos(c.total / kg)} · margen ${pesos(margen / kg)}`)] : []),
        ...(vendidas ? [linea('ok', `Por cabeza vendida: margen ${pesos(margen / vendidas)}`)] : []),
        linea('ok', `Ventas por categoría: ${Object.entries(porTipo).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t} ${pesos(v)}`).join(' · ') || '-'}`),
      ]);
    }

    function cumplimiento(hoy) {
      const h = hoyIso(hoy);
      // Lo sanitario lo ve quien tiene Sanidad/SENASA; el IVA, quien tiene ARCA.
      if (!veDato('sanidad') && !veDato('fiscal') && !veDato('residuos')) return sinAcceso('🩺 Cumplimiento SENASA y fiscal');
      const lineas = [];
      const san = veDato('sanidad') && d.calc.evaluarSanidad ? d.calc.evaluarSanidad() : null;
      if (san) {
        lineas.push(linea(san.block ? 'risk' : 'ok', san.block ? `🩺 ${san.block}` : `🩺 Plan sanitario: ${san.estadoTexto || 'sin bloqueos'}`));
        (san.warnings || []).forEach((w) => lineas.push(linea('warn', `🩺 ${w}`)));
      }
      const dtes = veDato('sanidad') ? (s().dteRegistry || []).filter((x) => x.estado === 'Emitido') : [];
      if (dtes.length) lineas.push(linea('warn', `🚚 ${dtes.length} DT-e emitido(s) sin cierre en destino.`));
      (veDato('sanidad') ? s().renspaControl || [] : []).forEach((r) => { if (r.proximaAct && r.proximaAct <= sumarDias(h, 30)) lineas.push(linea(r.proximaAct < h ? 'risk' : 'warn', `📇 RENSPA ${r.numero || ''}: actualización ${r.proximaAct < h ? 'vencida' : 'el'} ${fechaCorta(r.proximaAct)}`)); });
      if (veDato('fiscal') && d.calc.ivaLiquidation) {
        const r = d.calc.ivaLiquidation({ ops: s().arcaOperations || [], invoices: s().arcaInvoices || [], costs: s().costs || [], pagosCuenta: s().ivaPagosCuenta || [] }, h.slice(0, 7));
        lineas.push(linea(r.pagar > 0 ? 'warn' : 'ok', `🧾 IVA ${h.slice(0, 7)}: débito ${pesos(r.debito)} · crédito ${pesos(r.credito)} · ${r.pagar > 0 ? `a pagar *${pesos(r.pagar)}*` : `a favor ${pesos(r.tecnicoFavor + r.libre)}`}`));
      }
      // Residuos y efluentes (módulo Premium): permisos, análisis, dosis de purín, mortandad y envases.
      const res = veDato('residuos') && d.calc.residuos ? d.calc.residuos() : null;
      (res?.alertas || []).forEach((a) => lineas.push(linea(a.nivel === 'risk' ? 'risk' : 'warn', `♻️ ${a.titulo}: ${a.detalle}`)));
      return resultado('🩺 Cumplimiento SENASA y fiscal', lineas.length ? lineas : [linea('ok', 'Sin pendientes sanitarios ni fiscales.')]);
    }

    function cajaA90Dias(hoy) {
      const h = hoyIso(hoy);
      const hasta = sumarDias(h, 90);
      const p = saldos();
      const fin = s().finances || [];
      const cheques = fin.filter((r) => r.componente === 'Cheques' && !['Pagado', 'Cobrado', 'Cancelado'].includes(r.estado) && r.vencimiento && r.vencimiento <= hasta);
      const chequesNeto = cheques.reduce((t, r) => t + (['Cobro', 'Ingreso'].includes(r.tipo) ? 1 : -1) * (Number(r.importe) || 0), 0);
      const cuotas = fin.filter((r) => r.componente === 'Créditos' && r.tipo === 'Pago cuota' && r.estado === 'Pendiente' && r.vencimiento && r.vencimiento <= hasta).reduce((t, r) => t + (Number(r.importe) || 0), 0);
      const sueldos3 = d.calc.costSummary(s(), h, hasta).porOrigen['Mano de obra'] || 0;
      const proyectado = p.caja + p.bancos + chequesNeto - cuotas - sueldos3;
      return resultado('💵 Caja a 90 días', [
        linea('ok', `Hoy: caja ${pesos(p.caja)} + bancos ${pesos(p.bancos)} = *${pesos(p.caja + p.bancos)}*`),
        linea('ok', `Cheques que vencen: ${pesos(chequesNeto)} (${cheques.length})`),
        linea(cuotas ? 'warn' : 'ok', `Cuotas de créditos pendientes: -${pesos(cuotas)}`),
        linea('ok', `Sueldos (RRHH): -${pesos(sueldos3)}`),
        linea(proyectado < 0 ? 'risk' : 'ok', `Saldo proyectado al ${fechaCorta(hasta)}: *${pesos(proyectado)}*`),
        linea('ok', '_No incluye ventas ni compras futuras que todavía no estén cargadas._'),
      ]);
    }

    // ─── Ejecución ───────────────────────────────────────────────────────────────────────
    const FUNCIONES = { resumen: resumenDiario, alertas: alertasDesvios, existencias: existenciasPorCategoria, stock: proyeccionStock, costoCabeza: costoPorCabeza, mantenimiento: equiposYMantenimiento, rentabilidad, cumplimiento, caja90: cajaA90Dias };
    function ejecutarConRol(id, hoy) {
      if (!capacidad(id)) return ayuda();
      if (!puede(id)) return bloqueado(id);
      if (!ve(DATOS_CAPACIDAD[id])) return sinAcceso(capacidad(id).titulo);
      try { return FUNCIONES[id](hoy); } catch (error) { return resultado(`${capacidad(id).icono} ${capacidad(id).titulo}`, [linea('warn', `No se pudo calcular: ${error.message}`)]); }
    }
    const ejecutar = (id, opciones = {}) => conRol(opciones, () => ejecutarConRol(id, opciones.hoy));
    // Botones del panel (empresa, operación, finanzas, riesgos) de pampaia-source.js: diagnóstico por
    // área, igual que en PampaGanaderia; respeta el rol, no el plan.
    const analizar = (tipo, opciones = {}) => conRol(opciones, () => analizarConRol(tipo, opciones.hoy));
    function analizarConRol(tipo, hoy) {
      const h = hoyIso(hoy);
      if (tipo === 'finanzas') {
        if (!veDato('plata')) return sinAcceso('💰 Análisis financiero');
        const p = saldos();
        const fin = s().finances || [];
        const pend = fin.filter((r) => r.componente === 'Cheques' && !['Pagado', 'Cobrado', 'Cancelado'].includes(r.estado));
        const cobrar = pend.filter((r) => ['Cobro', 'Ingreso'].includes(r.tipo)).reduce((t, r) => t + (Number(r.importe) || 0), 0);
        const pagar = pend.filter((r) => !['Cobro', 'Ingreso'].includes(r.tipo)).reduce((t, r) => t + (Number(r.importe) || 0), 0);
        const gastoMes = veDato('costos') ? d.calc.costSummary(s(), `${h.slice(0, 7)}-01`, h).total : null;
        return resultado('💰 Análisis financiero', [
          linea('ok', `Caja *${pesos(p.caja)}* · Bancos *${pesos(p.bancos)}* · Total *${pesos(p.caja + p.bancos)}*`),
          linea(pagar > cobrar + p.caja + p.bancos ? 'risk' : pagar > cobrar ? 'warn' : 'ok', `Cheques por cobrar ${pesos(cobrar)} · por pagar ${pesos(pagar)}`),
          gastoMes === null ? null : linea('ok', `Costos del mes: ${pesos(gastoMes)}`),
        ].filter(Boolean));
      }
      if (tipo === 'operacion') {
        const cab = existencias(h);
        const stock = veDato('stock') ? (d.calc.stockAutonomy(s().inventory || [], s().feeding || [], h, s().health || [], s().treatments || []) || []).filter((i) => i.dias < 7) : [];
        const proximos = (s().machineMaintenance || []).filter((m) => m.proximo && m.proximo <= sumarDias(h, 15));
        const lineas = [
          linea('ok', `🐖 ${num(total(cab))} cabezas · ${(s().feeding || []).length} registros de alimentación · ${(s().health || []).length} registros sanitarios`),
          veDato('stock') ? linea(stock.length ? 'warn' : 'ok', stock.length ? `Stock para menos de 7 días: ${stock.map((i) => i.item).join(', ')}` : 'Alimentos e insumos con stock para más de una semana.') : null,
          veDato('mantenimiento') ? linea(proximos.length ? 'warn' : 'ok', proximos.length ? `Services próximos o vencidos: ${proximos.map((m) => m.equipo).join(', ')}` : 'Sin services próximos.') : null,
        ].filter(Boolean);
        return resultado('🚜 Análisis operativo', lineas);
      }
      if (tipo === 'riesgos' || tipo === 'alertas') return alertasDesvios(hoy);
      const cab = existencias(h);
      const empresa = s().empresa || {};
      return resultado('🏢 Análisis de la empresa', [
        linea('ok', `${empresa.nombre ? `*${empresa.nombre}* · ` : ''}${num(total(cab))} cabezas · ${(s().machinery || []).length} equipos · ${(s().hr || []).filter((r) => r.estado !== 'Baja').length} empleados`),
        ...alertasDesvios(hoy).lineas.slice(0, 3),
        linea('ok', `Versión ${NOMBRE_PLAN[plan()]}: ${capacidades().filter((c) => c.habilitada).length} de ${CAPACIDADES.length} funciones de PampaIA habilitadas.`),
      ]);
    }

    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    function periodoDe(t, hoy) {
      const h = hoyIso(hoy);
      if (/\bhoy\b/.test(t)) return { desde: h, hasta: h, nombre: 'hoy' };
      if (/\bayer\b/.test(t)) { const a = sumarDias(h, -1); return { desde: a, hasta: a, nombre: 'ayer' }; }
      if (/\bsemana\b/.test(t)) return { desde: sumarDias(h, -6), hasta: h, nombre: 'los últimos 7 días' };
      if (/mes pasado|mes anterior/.test(t)) {
        const [y, m] = h.split('-').map(Number);
        const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
        return { desde: `${py}-${String(pm).padStart(2, '0')}-01`, hasta: `${py}-${String(pm).padStart(2, '0')}-${new Date(py, pm, 0).getDate()}`, nombre: `${MESES[pm - 1]} ${py}` };
      }
      if (/\b(este ano|en el ano|anual|del ano)\b/.test(t)) return { desde: `${h.slice(0, 4)}-01-01`, hasta: h, nombre: `el año ${h.slice(0, 4)}` };
      const mes = MESES.findIndex((m) => t.includes(m));
      if (mes >= 0) {
        let y = Number(h.slice(0, 4));
        if (mes + 1 > Number(h.slice(5, 7))) y -= 1;
        return { desde: `${y}-${String(mes + 1).padStart(2, '0')}-01`, hasta: `${y}-${String(mes + 1).padStart(2, '0')}-${new Date(y, mes + 1, 0).getDate()}`, nombre: `${MESES[mes]} ${y}` };
      }
      return { desde: `${h.slice(0, 7)}-01`, hasta: h, nombre: 'este mes' };
    }
    function consultaGastos(t, hoy) {
      if (!veDato('costos')) return sinAcceso('📊 Gastos');
      const p = periodoDe(t, hoy);
      const c = d.calc.costSummary(s(), p.desde, p.hasta);
      return resultado(`📊 Gastos de ${p.nombre}`, [linea('ok', `Total *${pesos(c.total)}*`), ...Object.entries(c.porOrigen).sort((a, b) => b[1] - a[1]).map(([k, v]) => linea('ok', `• ${k}: ${pesos(v)}`))]);
    }
    function consultaVentas(t, hoy) {
      if (!veDato('ventas')) return sinAcceso('🧾 Ventas');
      const p = periodoDe(t, hoy);
      const v = enPeriodo(s().sales, p.desde, p.hasta);
      return resultado(`🧾 Ventas de ${p.nombre}`, [linea('ok', `${num(v.reduce((a, x) => a + (Number(x.cantidad) || 0), 0))} cabezas · ${num(v.reduce((a, x) => a + (Number(x.kg) || 0), 0))} kg · *${pesos(v.reduce((a, x) => a + (Number(x.total) || 0), 0))}*`), ...v.slice(-5).map((x) => linea('ok', `• ${fechaCorta(fechaIso(x.fecha))} ${x.cliente || ''}: ${num(x.cantidad)} ${x.tipo || ''} ${pesos(x.total)}`))]);
    }
    function consultaPlata() {
      if (!veDato('plata')) return sinAcceso('💰 Plata');
      const p = saldos();
      return resultado('💰 Caja y bancos', [linea('ok', `Caja ${pesos(p.caja)} · Bancos ${pesos(p.bancos)} · Total *${pesos(p.caja + p.bancos)}*`)]);
    }
    const RUTAS = [
      { id: 'caja90', patron: /\b(90 dias|tres meses|proyecc\w* de caja|flujo|me alcanza)\b/ },
      { id: 'rentabilidad', patron: /\b(rentab\w*|margen|ganancia|gano|ganamos)\b/ },
      { id: 'costoCabeza', patron: /\b(costo por (cabeza|kg|kilo)|cuanto me cuesta)\b/ },
      { id: 'cumplimiento', patron: /\b(senasa|aujeszky|dt-?e|renspa|iva|fiscal|cumplimiento|vencimientos)\b/ },
      { id: 'mantenimiento', patron: /\b(manten\w*|service|equipo|equipos|maquina\w*|reparac\w*)\b/ },
      { id: 'stock', patron: /\b(alimento|balanceado|insumo\w*|stock|se acaba|cuantos dias)\b/ },
      { id: 'existencias', patron: /\b(cuant[oa]s (cerdos|animales|cabezas|madres|capones|lechones)|existencias|plantel)\b/ },
      { id: 'resumen', patron: /\b(resumen|como estamos|como esta todo|que paso hoy|novedades)\b/ },
      { id: 'alertas', patron: /\b(alerta\w*|desvio\w*|riesgo\w*|problema\w*|mortalidad|murieron|muertes)\b/ },
    ];
    function ayuda() {
      const lineas = [linea('ok', 'Probá preguntarme, por ejemplo:'), linea('ok', '• 📊 _"¿Cuánto gasté este mes?"_ · 💰 _"¿Cuánta plata hay en caja?"_'), linea('ok', '• 🐖 _"¿Cuántas madres tengo?"_ · _"¿Cuánto vendí en agosto?"_ · 🌾 _"¿Cuántos días de alimento me quedan?"_')];
      capacidades().forEach((c) => lineas.push(linea(c.habilitada ? 'ok' : 'warn', `• ${c.icono} ${c.titulo}${c.habilitada ? '' : c.porRol ? ' 🔒 _sin acceso para tu usuario_' : ` 🔒 _versión ${c.requiere}_`}`)));
      return resultado('🤔 No entendí la consulta', lineas);
    }
    const responder = (pregunta, opciones = {}) => conRol(opciones, () => {
      const t = normalizar(pregunta);
      const hoy = opciones.hoy || new Date();
      if (!t.trim()) return ayuda();
      if (/\b(gaste|gastamos|gasto|gastos)\b/.test(t) && !/por (cabeza|kg)/.test(t)) return consultaGastos(t, hoy);
      if (/\b(vendi|vendimos|ventas|cuanto se vendio)\b/.test(t)) return consultaVentas(t, hoy);
      if (/\b(caja|bancos?|plata|saldo|efectivo)\b/.test(t) && !/90|proyecc|flujo|alcanza/.test(t)) return consultaPlata();
      const ruta = RUTAS.find((r) => r.patron.test(t));
      return ruta ? ejecutarConRol(ruta.id, hoy) : ayuda();
    });

    function capacidades(opciones) {
      return conRol(opciones, () => CAPACIDADES.map((c) => {
        const porPlan = puede(c.id);
        const porRol = !ve(DATOS_CAPACIDAD[c.id]);
        return { ...c, habilitada: porPlan && !porRol, porRol: porPlan && porRol, requiere: planMinimo(c.nivel) };
      }));
    }

    return { plan, puede, capacidades, ejecutar, analizar, responder, esConsulta, resumenDiario, alertasDesvios, existenciasPorCategoria, proyeccionStock, costoPorCabeza, equiposYMantenimiento, rentabilidad, cumplimiento, cajaA90Dias, existencias, saldos };
  }

  // ─── Presentación en el panel (navegador) ─────────────────────────────────────────────
  function escapar(t) {
    return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function aHtml(texto) {
    return escapar(texto).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_/g, '$1<i>$2</i>').replace(/\n/g, '<br>');
  }
  function montarCapacidades(contenedor, asistente, alMostrar) {
    if (!contenedor || !asistente) return null;
    const doc = contenedor.ownerDocument;
    let caja = doc.getElementById('pampaIAPlanCapabilities');
    if (!caja) {
      caja = doc.createElement('section');
      caja.id = 'pampaIAPlanCapabilities';
      caja.style.cssText = 'position:relative;z-index:1;margin-top:14px;padding:14px;border:1px solid rgba(159,192,173,.35);border-radius:10px;background:rgba(0,0,0,.14);';
      contenedor.appendChild(caja);
    }
    const plan = asistente.plan();
    const niveles = [[1, 'SMALL · Básica'], [2, 'MEDIUM · Profesional'], [3, 'LARGE · Premium']];
    const caps = asistente.capacidades();
    caja.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div style="font-size:10px;color:#9fc0ad;letter-spacing:.9px;text-transform:uppercase">Capacidades de IA por versión</div><span style="font-size:11px;color:#fbbf24">Plan actual: ${escapar(NOMBRE_PLAN[plan] || plan)}</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:10px">${niveles.map(([nivel, titulo]) => `<article style="padding:12px;border-radius:8px;background:rgba(255,255,255,.04)"><strong style="color:#fff">${titulo}</strong><div style="display:grid;gap:6px;margin-top:8px">${caps.filter((c) => c.nivel === nivel).map((c) => `<button type="button" class="pampaia-btn" data-pampaia-capacidad="${c.id}" title="${escapar(c.detalle)}" style="text-align:left">${c.habilitada ? '' : '🔒 '}${c.icono} ${escapar(c.titulo)}</button>`).join('')}</div><small style="display:block;margin-top:8px;color:#9fc0ad">${plan === 'trial' ? 'Incluido en el trial' : caps.some((c) => c.nivel === nivel && (c.habilitada || c.porRol)) ? 'Incluido en tu plan' : `Requiere ${niveles[nivel - 1][1].split('· ')[1]}`}</small></article>`).join('')}</div>
      <p style="margin:10px 0 0;color:#9fc0ad;font-size:11px">Todo se calcula con los datos cargados en este equipo; si falta historial, PampaIA lo avisa en vez de inventar.</p>`;
    caja.querySelectorAll('[data-pampaia-capacidad]').forEach((boton) => boton.addEventListener('click', () => alMostrar(asistente.ejecutar(boton.dataset.pampaiaCapacidad))));
    return caja;
  }
  const NIVEL_A_CLASE = { ok: '', warn: 'warn', risk: 'risk' };
  function insightsHtml(lineas) {
    return lineas.map((l) => `<div class="pampaia-insight"><span class="pampaia-dot ${NIVEL_A_CLASE[l.nivel] || ''}"></span><span>${aHtml(l.texto)}</span></div>`).join('');
  }

  return { NIVEL_PLAN, CAPACIDADES, ROLES, crearAsistente, esConsulta, aHtml, escapar, montarCapacidades, insightsHtml, fechaIso };
});
