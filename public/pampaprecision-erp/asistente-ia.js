/* PampaIA de PampaPrecisión: las capacidades de cada versión, calculadas con los datos del ERP.
 *
 *   SMALL · Básica       (descriptiva: ¿qué pasó?)        consulta de stock, resumen del día, alertas de desvíos
 *   MEDIUM · Profesional (predictiva: ¿qué va a pasar?)   quiebre de stock, costo y margen proyectado por lote,
 *                                                          mantenimiento de maquinaria
 *   LARGE · Premium      (prescriptiva: ¿cómo optimizo?)  zonificación por mapa de rinde, prescripción variable,
 *                                                          análisis multi-campo gerencial
 *
 * Ningún número sale de un modelo de lenguaje: todo se calcula con los registros cargados, con las mismas
 * funciones del núcleo agrícola (agro-core.js) que usan Granos, Costos, Fiscal y SENASA. Si falta
 * historial, se dice. El texto usa el formato de WhatsApp (*negrita*, _cursiva_) para que el mismo
 * resultado sirva en el panel, en la nota de voz y en el WhatsApp. Mismo criterio que Tambo y Ganadería.
 *
 * UMD: navegador (window.PampaAsistenteIA) y Node (tests).
 */
(function (raiz, fabrica) {
  const api = fabrica(raiz && raiz.PampaAgroCore ? raiz.PampaAgroCore : typeof require === 'function' ? require('./agro-core.js') : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) raiz.PampaAsistenteIA = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (A) {
  'use strict';

  const NIVEL_PLAN = { basica: 1, profesional: 2, premium: 3, trial: 3 };
  const NOMBRE_PLAN = { basica: 'Básica', profesional: 'Profesional', premium: 'Premium', trial: 'Trial completo' };

  const CAPACIDADES = [
    { id: 'stock', nivel: 1, icono: '📦', titulo: 'Consulta de stock', detalle: 'Granos en silobolsas y celdas, e insumos del galpón (también por pregunta: "¿cuánto glifosato me queda?").' },
    { id: 'resumen', nivel: 1, icono: '📋', titulo: 'Resumen del día', detalle: 'Labores de hoy y ayer, horas pendientes de lo planificado, ventas, compras y alertas: listo para WhatsApp.' },
    { id: 'alertas', nivel: 1, icono: '⚠️', titulo: 'Alertas de desvíos', detalle: 'Precio de un insumo o rinde de un lote fuera del promedio histórico, y alertas agrícolas y fiscales.' },
    { id: 'quiebre', nivel: 2, icono: '📉', titulo: 'Predicción de quiebre de stock', detalle: 'Al ritmo real de siembra y aplicaciones, en cuántos días se acaba cada insumo y qué falta para lo planificado.' },
    { id: 'costos', nivel: 2, icono: '🧮', titulo: 'Costo y margen proyectado por lote', detalle: 'Costos hechos + labores planificadas contra el rinde histórico y el último precio: qué lotes pierden margen antes de cosechar.' },
    { id: 'mantenimiento', nivel: 2, icono: '🔧', titulo: 'Mantenimiento de maquinaria', detalle: 'Cuándo le toca service a cada equipo según las horas acumuladas y el tipo de labor.' },
    { id: 'zonas', nivel: 3, icono: '🗺️', titulo: 'Zonificación por mapa de rinde', detalle: 'Divide el lote en zonas de alto, medio y bajo potencial agrupando los puntos del mapa de cosecha.' },
    { id: 'prescripcion', nivel: 3, icono: '🎯', titulo: 'Prescripción variable', detalle: 'Dosis de semilla o fertilizante por zona y ahorro contra la dosis fija; se exporta para el monitor.' },
    { id: 'multicampo', nivel: 3, icono: '🏢', titulo: 'Análisis multi-campo gerencial', detalle: 'Rinde, costo y resultado por hectárea de cada campo, y patrones por equipo y operador.' },
  ];

  // Qué ve cada rol (Precisión no tiene permisos por módulo: PampaIA aplica el mismo criterio que las otras
  // apps). Propietario y administrador general: todo.
  const MODULOS_REQUERIDOS = {
    stock: ['granos', 'insumos'], resumen: ['labores'], alertas: ['labores'],
    quiebre: ['insumos'], costos: ['costos'], mantenimiento: ['maquinaria'],
    zonas: ['precision'], prescripcion: ['precision'], multicampo: ['costos'],
    finanzas: ['finanzas'], fiscal: ['fiscal'],
  };
  const MODULOS_ROL = [
    { patron: /propiet|responsable|general|due/, modulos: null },
    { patron: /administ/, modulos: ['granos', 'insumos', 'labores', 'costos', 'finanzas', 'fiscal', 'maquinaria'] },
    { patron: /ingenier|agronom|precisi|consult|audit/, modulos: ['granos', 'insumos', 'labores', 'costos', 'maquinaria', 'precision'] },
    { patron: /inventar/, modulos: ['granos', 'insumos', 'labores'] },
    { patron: /tecnic|equipo/, modulos: ['maquinaria', 'labores', 'insumos'] },
    { patron: /operari|operador|encargad|campo/, modulos: ['granos', 'insumos', 'labores', 'maquinaria'] },
  ];
  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function accesoPorRol(rol, modulo) {
    if (!rol) return true;
    const def = MODULOS_ROL.find((r) => r.patron.test(normalizar(rol)));
    return !def || def.modulos === null || def.modulos.includes(modulo);
  }

  const pesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
  const num = (n, dec = 0) => (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: dec });
  const tn = (kg) => `${num((Number(kg) || 0) / 1000, 1)} t`;
  const nombreGrano = (g) => (A.CULTIVOS[g] ? A.CULTIVOS[g].nombre : g);
  const capitalizar = (t) => String(t || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  const iso = (fecha) => new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const sumarDias = (fechaIso, dias) => { const d = new Date(`${fechaIso}T12:00:00`); d.setDate(d.getDate() + dias); return iso(d); };
  const fechaCorta = (f) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : ''; };

  // Pregunta o parte: "¿cuánto glifosato me queda?" pregunta; "aplicamos el lote 2" cuenta algo que se hizo.
  const PALABRAS_PREGUNTA = /^(cuanto|cuanta|cuantos|cuantas|que|como|cual|cuales|donde|cuando|decime|pasame|mostrame|mandame|dame|contame|necesito saber|quiero saber)\b/;
  function esConsulta(texto) {
    const crudo = String(texto || '');
    const t = normalizar(crudo).trim();
    if (!t) return false;
    if (/[¿?]/.test(crudo) || PALABRAS_PREGUNTA.test(t)) return true;
    return /\b(margen|rentabilidad|stock|reporte|resumen|zonas?|prescripcion|service)\b/.test(t) &&
      !/\b(aplique|aplicamos|sembre|sembramos|cosechamos|compre|compramos|cargue|cargamos|vendi|vendimos|fertilizamos|pulverizamos)\b/.test(t);
  }

  /**
   * @param {object} d { datos(): { E, r, hoy, tipoCambio }, plan(), rol(), acceso?(rol, modulo), nombreRol?(rol) }
   *   E: estado de la base local (PampaAgroDB.todoElEstado + condicionIva); r: resumen del tablero (agro-ui).
   */
  function crearAsistente(d) {
    const plan = () => (NIVEL_PLAN[d.plan()] ? d.plan() : 'basica');
    const capacidad = (id) => CAPACIDADES.find((c) => c.id === id);
    const planMinimo = (nivel) => ({ 1: 'Básica', 2: 'Profesional', 3: 'Premium' })[nivel];
    const puede = (id) => NIVEL_PLAN[plan()] >= capacidad(id).nivel;
    let rolConsulta;
    const rolActual = () => (rolConsulta !== undefined ? rolConsulta : d.rol ? d.rol() : null);
    const acceso = d.acceso || accesoPorRol;
    const ve = (modulos) => rolActual() === null || !modulos || !modulos.length || modulos.some((m) => acceso(rolActual(), m));
    function conRol(opciones, fn) {
      const previo = rolConsulta;
      if (opciones && opciones.rol !== undefined) rolConsulta = opciones.rol;
      try { return fn(); } finally { rolConsulta = previo; }
    }
    const resultado = (titulo, lineas, extra = {}) => ({ titulo, lineas, texto: [`*${titulo}*`, '', ...lineas.map((l) => l.texto)].join('\n'), ...extra });
    const linea = (nivel, texto) => ({ nivel, texto });
    function bloqueado(id) {
      const c = capacidad(id);
      return resultado(`🔒 ${c.titulo}`, [linea('warn', `Esta función es de la versión *${planMinimo(c.nivel)}*. Tu plan actual es ${NOMBRE_PLAN[plan()]}.`), linea('ok', `_${c.detalle}_`)], { bloqueado: true, requiere: planMinimo(c.nivel) });
    }
    function sinAcceso(titulo) {
      const rol = rolActual();
      const nombre = (d.nombreRol && d.nombreRol(rol)) || rol || 'sin rol';
      return resultado(`🔒 ${titulo}`, [linea('warn', `Tu usuario (*${nombre}*) no tiene acceso a esta información. Pedísela al propietario o a quien tenga ese módulo.`)], { bloqueado: true, porRol: true });
    }

    // ─── Datos base ──────────────────────────────────────────────────────────────────────
    const X = () => d.datos();
    const E = () => X().E;
    const hoyDe = (hoyFecha) => (hoyFecha ? iso(hoyFecha) : X().hoy || iso(new Date()));
    const datosCostos = () => { const e = E(); return { condicionIva: e.condicionIva, compras: e.compras, labores: e.labores, equipos: e.equipos, empleados: e.empleados, lotes: e.lotes, lotesCampania: e.lotesCampania, lpg: e.lpg, contratos: e.contratosArrendamiento, movimientosGrano: e.movimientosGrano }; };
    const lote = (id) => (E().lotes || []).find((l) => l.id === id);
    const equipo = (id) => (E().equipos || []).find((x) => x.id === id);
    // Campaña con resultado: la última con ventas (LPG); si no hay, la última con lotes.
    function campaniaResultados() {
      const camps = [...new Set((E().lotesCampania || []).map((v) => v.campania))].sort().reverse();
      return camps.find((c) => (E().lpg || []).some((l) => l.calculo && l.calculo.campania === c)) || camps[0] || null;
    }
    // Campaña en curso (la última con lotes sembrados o planificados).
    const campaniaActual = () => [...new Set((E().lotesCampania || []).map((v) => v.campania))].sort().pop() || null;
    const stockInsumos = () => A.stockInsumos(E().compras, E().labores, E().ajustesInsumo, E().condicionIva);
    const valorInsumo = (insumo, hoy) => A.precioInsumo(A.ingresosInsumo(E().compras, E().condicionIva), insumo, hoy);

    // ─── Básica ──────────────────────────────────────────────────────────────────────────
    function consultaStock(hoyFecha, filtro) {
      const hoy = hoyDe(hoyFecha);
      const e = E();
      const lineas = [];
      const t = normalizar(filtro || '');
      const porGrano = A.stockPorGrano(e.movimientosGrano || []).porGrano;
      const st = A.stockPorUbicacion(e.movimientosGrano || []);
      const insumos = Object.values(stockInsumos());
      // Pregunta puntual: un insumo o un grano.
      const granoPedido = Object.keys(A.CULTIVOS).find((g) => t.includes(normalizar(A.CULTIVOS[g].nombre)));
      // "¿cuánta soja hay?" es grano; "¿cuánta semilla de soja?" es insumo.
      const insumoPedido = granoPedido && !/semilla|fertiliz|curasemill/.test(t) ? [] : insumos.filter((x) => t && normalizar(x.insumo).split(/\s+/).some((p) => p.length > 3 && t.includes(p)));
      if (insumoPedido.length && ve(['insumos'])) {
        insumoPedido.forEach((x) => {
          const precio = valorInsumo(x.insumo, hoy);
          lineas.push(linea(x.cantidad <= 0 ? 'risk' : 'ok', `🧪 *${capitalizar(x.insumo)}*: ${num(x.cantidad, 1)} ${x.unidad}${precio && x.cantidad > 0 && ve(['costos']) ? ` · valor ${pesos(x.cantidad * precio)}` : ''}${x.cantidad < 0 ? ' _(se usó más de lo comprado: falta cargar una compra o un ajuste)_' : ''}`));
        });
        return resultado('📦 Stock de insumos', lineas);
      }
      if (granoPedido && ve(['granos'])) {
        lineas.push(linea('ok', `🌾 *${nombreGrano(granoPedido)}*: ${tn(porGrano[granoPedido] || 0)} en stock`));
        (e.ubicaciones || []).filter((u) => st.stock[u.id]?.grano === granoPedido && st.stock[u.id].kg > 0).forEach((u) => lineas.push(linea('ok', `• ${u.tipo === 'CELDA' ? 'Celda' : 'Silobolsa'} ${u.nombre || u.codigo || ''}: ${tn(st.stock[u.id].kg)}`)));
        return resultado(`📦 Stock de ${nombreGrano(granoPedido)}`, lineas);
      }
      if (ve(['granos'])) {
        const total = Object.values(porGrano).reduce((s, v) => s + v, 0);
        const cap = (e.ubicaciones || []).reduce((s, u) => s + (Number(u.capacidadTn) || 0) * 1000, 0);
        lineas.push(linea('ok', `🌾 Granos: *${tn(total)}*${cap ? ` · ocupación ${num(total / cap * 100)} % de ${tn(cap)}` : ''}`));
        Object.entries(porGrano).filter(([, v]) => v).forEach(([g, v]) => lineas.push(linea('ok', `• ${nombreGrano(g)}: ${tn(v)}`)));
        st.avisos.slice(-2).forEach((a) => lineas.push(linea('risk', `• ${a}`)));
      }
      if (ve(['insumos'])) {
        const con = insumos.filter((x) => x.cantidad > 0).sort((a, b) => a.insumo.localeCompare(b.insumo));
        const valor = con.reduce((s, x) => s + x.cantidad * (valorInsumo(x.insumo, hoy) || 0), 0);
        lineas.push(linea('ok', `🧪 Insumos en el galpón: ${con.length}${valor && ve(['costos']) ? ` · valor ${pesos(valor)}` : ''}`));
        con.slice(0, 8).forEach((x) => lineas.push(linea('ok', `• ${capitalizar(x.insumo)}: ${num(x.cantidad, 1)} ${x.unidad}`)));
        insumos.filter((x) => x.cantidad < 0).forEach((x) => lineas.push(linea('risk', `• ${capitalizar(x.insumo)}: ${num(x.cantidad, 1)} ${x.unidad} (falta cargar una compra)`)));
      }
      if (!lineas.length) lineas.push(linea('ok', 'Todavía no hay granos ni insumos cargados.'));
      return resultado('📦 Consulta de stock', lineas);
    }

    function resumenDiario(hoyFecha) {
      const hoy = hoyDe(hoyFecha);
      const ayer = sumarDias(hoy, -1);
      const e = E();
      const lineas = [];
      for (const [dia, etiqueta] of [[hoy, 'Hoy'], [ayer, 'Ayer']]) {
        const labs = (e.labores || []).filter((l) => l.estado === 'REALIZADA' && A.fechaIso(l.fecha) === dia);
        labs.forEach((l) => lineas.push(linea('ok', `• *${etiqueta}:* ${l.tipo} en ${lote(l.loteId)?.codigo || 'lote'} (${num(l.ha, 1)} ha${Number(l.horas) ? ` · ${num(l.horas, 1)} h` : ''}${l.operador ? ` · ${l.operador}` : ''}${(l.insumos || []).length ? ` · ${(l.insumos || []).map((u) => `${u.insumo} ${num(u.cantidad, 1)} ${u.unidad || ''}`.trim()).join(', ')}` : ''})`)));
        if (ve(['granos'])) {
          const lpgs = (e.lpg || []).filter((l) => l.calculo && A.fechaIso(l.calculo.fecha) === dia);
          if (lpgs.length) lineas.push(linea('ok', `• *${etiqueta}:* ${lpgs.length} LPG por ${tn(lpgs.reduce((s, l) => s + (l.calculo.kgNetos || 0) * (l.calculo.signo || 1), 0))}${ve(['finanzas']) ? ` · neto ${pesos(lpgs.reduce((s, l) => s + (l.calculo.neto || 0), 0))}` : ''}`));
          const ingresos = (e.movimientosGrano || []).filter((m) => m.tipo === 'INGRESO_COSECHA' && A.fechaIso(m.fecha) === dia);
          if (ingresos.length) lineas.push(linea('ok', `• *${etiqueta}:* cosecha ${tn(ingresos.reduce((s, m) => s + (Number(m.kg) || 0), 0))}`));
        }
        if (ve(['insumos'])) {
          const compras = (e.compras || []).filter((c) => A.fechaIso(c.fecha) === dia);
          if (compras.length) lineas.push(linea('ok', `• *${etiqueta}:* ${compras.length} compra(s)${ve(['finanzas']) ? ` por ${pesos(compras.reduce((s, c) => s + A.costoCompra(c, e.condicionIva), 0))}` : ''}`));
        }
      }
      if (!lineas.length) lineas.push(linea('ok', 'Hoy y ayer no se cargaron labores, cosechas, ventas ni compras.'));
      const semana = sumarDias(hoy, 7);
      const plan = (e.labores || []).filter((l) => l.estado !== 'REALIZADA' && A.fechaIso(l.fecha) <= semana);
      if (plan.length) {
        const horas = plan.reduce((s, l) => s + (Number(l.horas) || 0), 0);
        const vencidas = plan.filter((l) => A.fechaIso(l.fecha) < hoy);
        lineas.push(linea(vencidas.length ? 'warn' : 'ok', `🗓️ Planificado hasta el ${fechaCorta(semana)}: ${plan.length} labor(es)${horas ? `, quedan *${num(horas, 1)} h* de máquina/operario` : ''}${vencidas.length ? ` · ${vencidas.length} atrasada(s): ${vencidas.slice(0, 3).map((l) => `${l.tipo} ${lote(l.loteId)?.codigo || ''}`.trim()).join(', ')}` : ''}`));
      }
      lotesConClima().slice(0, 2).forEach(({ l, clima, lluvia }) => {
        if (!clima) return;
        const v = A.ventanasAplicacion((clima.pronostico || []).slice(0, 8));
        lineas.push(linea('ok', `🌦️ *${l.codigo}*: ${clima.actual?.temperatura} °C, viento ${clima.actual?.vientoKmh} km/h · lluvia prevista 24 h ${v.lluviaPrevista} mm${lluvia ? ` · últimos ${lluvia.dias} días ${lluvia.mm} mm` : ''} · ${v.ventanas.length ? 'hay ventana para aplicar' : 'sin ventana para aplicar'}`));
      });
      const alertas = (X().r?.alertas || []).filter((a) => a.nivel === 'danger');
      if (alertas.length) lineas.push(linea('risk', `⚠️ ${alertas.length} alerta(s) urgente(s): ${alertas.slice(0, 2).map((a) => a.texto).join(' · ')}`));
      return resultado(`📋 Resumen del ${fechaCorta(hoy)}`, lineas);
    }

    function alertasDesvios(hoyFecha) {
      const e = E();
      const lineas = [];
      if (ve(['insumos'])) A.desviosPrecioInsumo(e.compras, e.condicionIva).forEach((x) => lineas.push(linea(Math.abs(x.desvio) >= 40 ? 'risk' : 'warn', `💲 *${capitalizar(x.insumo)}*: la compra del ${fechaCorta(x.fecha)} salió ${pesos(x.precio)}/${x.unidad || 'u'}, ${x.desvio > 0 ? '+' : ''}${num(x.desvio)} % contra el promedio de ${x.compras - 1} compra(s) anterior(es) (${pesos(x.promedio)}). ¿Está bien cargado?`)));
      if (ve(['granos'])) A.desviosRinde(A.rindesHistoricos(e)).forEach((x) => lineas.push(linea(x.desvio < 0 ? 'warn' : 'ok', `🌾 *${x.lote}* (${nombreGrano(x.cultivo)} ${x.campania}): rindió ${num(x.rindeTnHa, 2)} t/ha, ${x.desvio > 0 ? '+' : ''}${num(x.desvio)} % contra el promedio del campo ${x.campo} (${num(x.promedio, 2)} t/ha). ${x.desvio < 0 ? 'Revisá el dato o la causa.' : ''}`.trim())));
      if (ve(['precision', 'labores'])) alertasSatelite().forEach((a) => lineas.push(linea('warn', `🛰️ ${a.texto}`)));
      (X().r?.alertas || []).filter((a) => !/^(SENASA|ARCA)/.test(a.texto) || ve(['fiscal', 'precision', 'labores'])).slice(0, 8).forEach((a) => lineas.push(linea(a.nivel === 'danger' ? 'risk' : 'warn', `• ${a.texto}`)));
      if (!lineas.length) lineas.push(linea('ok', 'Sin desvíos: precios de insumos y rindes dentro del promedio histórico, y sin alertas pendientes.'));
      return resultado('⚠️ Alertas de desvíos', lineas);
    }

    // ─── Profesional ─────────────────────────────────────────────────────────────────────
    function quiebreStock(hoyFecha) {
      const hoy = hoyDe(hoyFecha);
      const e = E();
      const p = A.proyeccionInsumos({ compras: e.compras, labores: e.labores, ajustes: e.ajustesInsumo, condicionIva: e.condicionIva, hoy });
      const lineas = [];
      p.forEach((x) => {
        const nombre = capitalizar(x.insumo);
        if (x.stock <= 0 && (x.porDia || x.planificado)) lineas.push(linea('risk', `🚨 *${nombre}*: sin stock${x.planificado ? ` y hay ${num(x.planificado, 1)} ${x.unidad} planificados` : ''}. Cotizá compra ya.`));
        else if (x.dias !== null && x.dias <= 30) lineas.push(linea(x.dias <= 10 ? 'risk' : 'warn', `📉 *${nombre}*: al ritmo actual (${num(x.porDia, 1)} ${x.unidad}/día) se agota en *${x.dias} día(s)*. Se sugiere cotizar compra.`));
        else if (x.faltantePlanificado > 0) lineas.push(linea('warn', `🗓️ *${nombre}*: lo planificado necesita ${num(x.planificado, 1)} ${x.unidad} y hay ${num(x.stock, 1)}: faltan *${num(x.faltantePlanificado, 1)} ${x.unidad}*.`));
        else if (x.dias !== null) lineas.push(linea('ok', `• ${nombre}: alcanza para ~${x.dias} días (${num(x.stock, 1)} ${x.unidad}).`));
        else if (x.planificado) lineas.push(linea('ok', `• ${nombre}: hay ${num(x.stock, 1)} ${x.unidad}; lo planificado (${num(x.planificado, 1)} ${x.unidad}) está cubierto.`));
      });
      if (!lineas.length) lineas.push(linea('ok', 'No hay consumos en los últimos 60 días ni labores planificadas con insumos: sin ritmo para proyectar.'));
      lineas.push(linea('ok', '_Ritmo: insumos usados en labores realizadas de los últimos 60 días, más lo cargado en labores planificadas._'));
      return resultado('📉 Predicción de quiebre de stock', lineas);
    }

    function costosProyectados(hoyFecha) {
      const camp = campaniaActual();
      if (!camp) return resultado('🧮 Costo y margen proyectado', [linea('ok', 'Todavía no hay lotes vinculados a una campaña.')]);
      const p = A.proyeccionLotes(datosCostos(), camp, { hoy: hoyDe(hoyFecha), tipoCambio: X().tipoCambio });
      const lineas = [];
      p.lotes.sort((a, b) => (a.margenHa ?? 1e15) - (b.margenHa ?? 1e15)).forEach((x) => {
        const base = `*${x.lote}* ${nombreGrano(x.cultivo)} (${num(x.ha)} ha): costo ${pesos(x.costoHaProyectado)}/ha${x.pendiente ? ` (incluye ${pesos(x.pendiente)} planificado)` : ''}`;
        if (x.margenProyectado === null) lineas.push(linea('warn', `${base} · sin ${x.precioTn ? 'rinde histórico' : 'precio de venta (LPG)'} para proyectar el ingreso.`));
        else lineas.push(linea(x.margenProyectado < 0 ? 'risk' : x.margenHa < x.costoHaProyectado * 0.1 ? 'warn' : 'ok', `${base} · ${x.cosechado ? 'cosechado' : `rinde esperado ${num(x.rindeEsperado, 2)} t/ha (${x.fuente})`} × ${pesos(x.precioTn)}/t → margen *${pesos(x.margenHa)}/ha*${x.rindeIndiferencia ? ` · rinde de indiferencia ${num(x.rindeIndiferencia, 2)} t/ha` : ''}${x.margenProyectado < 0 ? ' ⚠️ *pierde margen*' : ''}`));
      });
      if (!lineas.length) lineas.push(linea('ok', `La campaña ${camp} no tiene lotes vinculados.`));
      lineas.push(linea('ok', `_Campaña ${camp}. Costos con el último precio de compra de cada insumo y el costo horario de los equipos; estructura repartida por hectárea. ${p.planificadas ? `${p.planificadas} labor(es) planificada(s) incluidas.` : 'Sin labores planificadas: cargalas para proyectar lo que falta.'}_`));
      return resultado('🧮 Costo y margen proyectado por lote', lineas);
    }

    function mantenimiento(hoyFecha) {
      const m = A.mantenimientoEquipos({ equipos: E().equipos, labores: E().labores, hoy: hoyDe(hoyFecha) });
      const lineas = m.map((x) => {
        const nivel = x.vencido ? 'risk' : x.restan <= x.intervalo * 0.15 || (x.dias !== null && x.dias <= 15) ? 'warn' : 'ok';
        const cuando = x.vencido ? `*service vencido* (${num(-x.restan)} h de más)` : `faltan *${num(x.restan)} h*${x.dias !== null ? ` · ~${x.dias} día(s) al ritmo actual` : ''}`;
        return linea(nivel, `🔧 *${x.nombre}*: ${num(x.horometro)} h de horómetro · ${num(x.desdeService)} h equivalentes desde el último service (cada ${num(x.intervalo)} h${x.intervaloDefecto ? ', por defecto' : ''}) · ${cuando}`);
      });
      if (!lineas.length) lineas.push(linea('ok', 'No hay equipos propios cargados (Granos, costos y fiscal → Costos → Equipos).'));
      if (m.some((x) => x.intervaloDefecto)) lineas.push(linea('ok', '_Cargá en cada equipo el horómetro, cada cuántas horas lleva service y las horas del último, para afinar la predicción._'));
      lineas.push(linea('ok', '_Horas equivalentes: cosecha ×1,25, labranza ×1,2 y siembra ×1,15 (más desgaste); aplicaciones y fertilización ×1._'));
      return resultado('🔧 Mantenimiento de maquinaria', lineas);
    }

    // ─── Premium ─────────────────────────────────────────────────────────────────────────
    function ultimoMapa(loteId) {
      const mapas = (E().mapasRinde || []).filter((m) => !loteId || m.loteId === loteId).sort((a, b) => String(b.fecha || b.createdAt).localeCompare(String(a.fecha || a.createdAt)));
      return mapas[0] || null;
    }
    function zonasDe(mapa) {
      const limpio = A.limpiarMapaRinde(mapa.puntos || []);
      return { limpio, z: A.zonificar(limpio.validos) };
    }
    const sinMapa = (titulo) => resultado(titulo, [linea('warn', 'Todavía no hay mapas de rinde cargados.'), linea('ok', 'Cargá el mapa de cosecha del monitor en *Precisión → Cargar mapa de rinde* (CSV con latitud, longitud y rinde en t/ha o kg/ha).')]);
    function zonificacion() {
      const mapa = ultimoMapa();
      if (!mapa) return sinMapa('🗺️ Zonificación por mapa de rinde');
      const { limpio, z } = zonasDe(mapa);
      const l = lote(mapa.loteId);
      if (!z) return resultado('🗺️ Zonificación por mapa de rinde', [linea('warn', `El mapa de ${l?.codigo || 'el lote'} tiene ${limpio.validos.length} punto(s) válidos: hacen falta al menos 9 para zonificar.`)]);
      const lineas = [linea('ok', `*${l?.codigo || 'Lote'}* ${nombreGrano(mapa.cultivo) || ''} ${mapa.campania || ''} · ${num(limpio.validos.length)} puntos válidos (${num(limpio.pctValidos, 1)} %, ${num(limpio.descartados)} descartados por rinde nulo o fuera de rango) · rinde medio ${num(z.rindeGeneral, 2)} t/ha`)];
      z.zonas.slice().reverse().forEach((x) => lineas.push(linea(x.zona === 1 ? 'warn' : 'ok', `${x.zona === 3 ? '🟢' : x.zona === 2 ? '🟡' : '🔴'} *${x.nombre}*: ${num(x.pct)} % del lote · ${num(x.rindeMedio, 2)} t/ha (${num(x.min, 2)}–${num(x.max, 2)}) · índice ${num(x.indice, 2)}`)));
      lineas.push(linea('ok', '_Agrupamiento k-medias del rinde en 3 zonas. Con varios mapas del mismo lote, las zonas que se repiten campaña tras campaña son las más confiables._'));
      return resultado('🗺️ Zonificación por mapa de rinde', lineas);
    }
    function prescripcion() {
      const mapa = ultimoMapa();
      if (!mapa) return sinMapa('🎯 Prescripción variable');
      const { z } = zonasDe(mapa);
      const l = lote(mapa.loteId);
      if (!z) return zonificacion();
      const guardada = (E().prescripciones || []).filter((p) => p.mapaId === mapa.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
      const params = guardada || { operacion: 'Fertilización', insumo: 'Fertilizante', objetivo: 100, minimo: 70, maximo: 130, unidad: 'kg/ha' };
      const ha = Number(l?.superficieHa) || 0;
      const p = A.prescripcionPorZonas(z, { ...params, ha });
      const lineas = [linea('ok', `*${l?.codigo || 'Lote'}* · ${params.operacion}${params.insumo ? ` de ${params.insumo}` : ''} · dosis objetivo ${num(params.objetivo, 1)} ${params.unidad} (mín ${num(params.minimo, 1)}, máx ${num(params.maximo, 1)})${guardada ? '' : ' _(ejemplo: definí la tuya en Precisión → Nueva prescripción)_'}`)];
      p.zonas.slice().reverse().forEach((x) => lineas.push(linea('ok', `${x.zona === 3 ? '🟢' : x.zona === 2 ? '🟡' : '🔴'} ${x.nombre}: *${num(x.dosis, 1)} ${params.unidad}*${ha ? ` en ${num(x.ha, 1)} ha = ${num(x.total)} ${String(params.unidad).split('/')[0]}` : ''}`)));
      if (ha) lineas.push(linea(p.ahorro > 0 ? 'ok' : 'warn', `Total ${num(p.total)} ${String(params.unidad).split('/')[0]} contra ${num(p.totalUniforme)} con dosis fija: ${p.ahorro >= 0 ? `ahorrás *${num(p.ahorro)}*` : `usás *${num(-p.ahorro)}* más`} y lo ponés donde rinde.`));
      lineas.push(linea('ok', '_Dosis proporcional al potencial de cada zona (rinde de la zona ÷ rinde medio), dentro del mínimo y el máximo. Revisala con tu agrónomo. El archivo para el monitor se exporta en Precisión → Nueva prescripción (GeoJSON)._'));
      return resultado('🎯 Prescripción variable', lineas);
    }
    function multiCampo() {
      const camp = campaniaResultados();
      if (!camp) return resultado('🏢 Análisis multi-campo', [linea('ok', 'Todavía no hay campañas con lotes.')]);
      const m = A.analisisMultiCampo(datosCostos(), camp, { tipoCambio: X().tipoCambio });
      const lineas = m.campos.map((c, i) => linea(c.resultadoHa < 0 ? 'risk' : i === 0 && m.campos.length > 1 ? 'ok' : 'ok', `${i === 0 && m.campos.length > 1 ? '🏆 ' : '• '}*${c.campo}*: ${num(c.ha)} ha en ${c.lotes} lote(s) · costo ${pesos(c.costoHa)}/ha · resultado *${pesos(c.resultadoHa)}/ha*${Object.keys(c.rindes).length ? ` · rinde ${Object.entries(c.rindes).map(([g, r]) => `${nombreGrano(g)} ${num(r, 2)} t/ha`).join(', ')}` : ''}`));
      if (m.campos.length > 1) {
        const mejor = m.campos[0], peor = m.campos[m.campos.length - 1];
        lineas.push(linea('ok', `Diferencia entre *${mejor.campo}* y *${peor.campo}*: ${pesos(mejor.resultadoHa - peor.resultadoHa)}/ha.`));
      }
      m.patrones.forEach((p) => {
        const top = p.grupos[0], ult = p.grupos[p.grupos.length - 1];
        lineas.push(linea('ok', `🔎 ${p.etiqueta}: los lotes de *${top.nombre}* rindieron ${top.difPct >= 0 ? '+' : ''}${num(top.difPct, 1)} % contra el promedio del cultivo y los de *${ult.nombre}* ${ult.difPct >= 0 ? '+' : ''}${num(ult.difPct, 1)} %.`));
      });
      if (!m.patrones.length) lineas.push(linea('ok', '_Para comparar equipos y operadores, cargá en cada labor el equipo y el operador: hacen falta al menos dos de cada uno con lotes cosechados._'));
      lineas.push(linea('ok', `_Campaña ${camp}: producción valuada (LPG + grano sin vender), costos directos y estructura repartida por hectárea, como en Costos y resultados._`));
      return resultado(`🏢 Análisis multi-campo · ${camp}`, lineas);
    }

    // ─── Datos externos: dólar (DolarAPI) y clima (Agromonitoring) ───────────────────────────
    const externo = (clave) => (E().datosExternos || []).find((x) => x.clave === clave);
    const horaCorta = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')} h`; };
    function consultaDolar(hoyFecha) {
      const dol = externo('dolar')?.valor;
      if (!dol?.cotizaciones?.length) return resultado('💵 Dólar', [linea('warn', 'Todavía no hay cotización guardada: se trae sola cuando hay conexión.')]);
      const lineas = ['bolsa', 'oficial', 'blue', 'contadoconliqui', 'mayorista'].map((c) => dol.cotizaciones.find((x) => x.casa === c)).filter(Boolean).map((x) => linea('ok', `• *${x.nombre}*: compra ${pesos(x.compra)} · venta *${pesos(x.venta)}*`));
      const mep = dol.cotizaciones.find((x) => x.casa === 'bolsa');
      const dias = A.diasDesde(mep?.fecha, hoyDe(hoyFecha));
      lineas.push(linea(dias > 2 ? 'warn' : 'ok', `_${dol.fuente || 'DolarAPI'} · actualizado ${horaCorta(mep?.fecha)}${dias > 2 ? ` (hace ${dias} días: puede estar desactualizado)` : ''}._`));
      const tc = (E().tiposCambio || []).find((t) => t.mes === hoyDe(hoyFecha).slice(0, 7));
      if (ve(['costos'])) lineas.push(linea('ok', tc ? `Tipo de cambio informativo de ${tc.mes} en Costos: ${pesos(tc.ars)}.` : 'Este mes todavía no tiene tipo de cambio informativo en Costos: podés usar el MEP con un toque (Costos → Costos por lote y campaña).'));
      return resultado('💵 Dólar hoy', lineas);
    }
    function consultaPizarra(t = '') {
      const p = externo('pizarra')?.valor;
      if (!p?.precios || !Object.keys(p.precios).length) return resultado('🌾 Pizarra Rosario', [linea('warn', 'Todavía no hay pizarra guardada: se trae sola cuando hay conexión. Todos los datos del mercado actualizados están en GRANOS.AR (granos.ar).')]);
      const pedidos = Object.keys(A.CULTIVOS).filter((g) => t.includes(normalizar(A.CULTIVOS[g].nombre)));
      const porGrano = A.stockPorGrano(E().movimientosGrano || []).porGrano;
      const lineas = (pedidos.length ? pedidos : Object.keys(A.CULTIVOS)).filter((g) => p.precios[g]).map((g) => {
        const x = p.precios[g];
        const kg = porGrano[g] || 0;
        return linea('ok', `• *${A.CULTIVOS[g].nombre}*: *${pesos(x.pesos)}/t*${x.usd ? ` (US$ ${num(x.usd, 2)})` : ''}${x.estimado ? ' _estimado_' : ''}${x.tendencia === 'sube' ? ' ▲' : x.tendencia === 'baja' ? ' ▼' : ''}${kg && ve(['granos']) ? ` · tu stock ${tn(kg)} ≈ ${pesos(kg / 1000 * x.pesos)}` : ''}`);
      });
      lineas.push(linea('ok', `_Pizarra del ${p.fecha || '-'} · Cámara Arbitral de Cereales de la Bolsa de Comercio de Rosario. Todos los datos del mercado actualizados al momento: GRANOS.AR (granos.ar)._`));
      return resultado(`🌾 Pizarra Rosario${p.fecha ? ` · ${p.fecha}` : ''}`, lineas);
    }
    function lotesConClima() { return (E().lotes || []).map((l) => ({ l, clima: externo(`clima:${l.id}`)?.valor, lluvia: externo(`lluvia:${l.id}`)?.valor, ndvi: externo(`ndvi:${l.id}`)?.valor })).filter((x) => x.clima || x.ndvi); }
    function consultaClima(t) {
      const todos = lotesConClima();
      if (!todos.length) return resultado('🌦️ Clima', [linea('warn', 'Todavía no hay clima de ningún lote: cargá la ubicación o el polígono del lote en *Clima y satélite*.')]);
      const pedidos = todos.filter(({ l }) => t.includes(normalizar(l.codigo)) || (l.campo && t.includes(normalizar(l.campo))));
      const lineas = [];
      (pedidos.length ? pedidos : todos.slice(0, 3)).forEach(({ l, clima, lluvia }) => {
        if (!clima) return;
        const a = clima.actual || {};
        const ahora = A.evaluarCondicion(a);
        const v = A.ventanasAplicacion((clima.pronostico || []).slice(0, 16));
        lineas.push(linea(ahora.apta ? 'ok' : 'warn', `*${l.codigo}*: ahora ${a.temperatura} °C, humedad ${a.humedad} %, viento ${a.vientoKmh} km/h · ${ahora.apta ? '*apto para aplicar*' : `*no conviene aplicar* (${ahora.motivos.join(', ')})`}`));
        lineas.push(linea('ok', `  Ventanas aptas próximas 48 h: ${v.ventanas.slice(0, 3).map((w) => `${horaCorta(w.desde)} a ${horaCorta(new Date(Date.parse(w.hasta) + 3 * 3600 * 1000).toISOString())}`).join(' · ') || 'ninguna'} · lluvia prevista ${v.lluviaPrevista} mm${lluvia ? ` · llovieron ${lluvia.mm} mm en ${lluvia.dias} días` : ''}`));
        A.alertasClima({ clima, lote: l.codigo }).forEach((x) => lineas.push(linea(x.nivel === 'danger' ? 'risk' : 'warn', `  ${x.texto}`)));
      });
      lineas.push(linea('ok', `_Condiciones de la receta: viento ${A.CONDICIONES_APLICACION.vientoMin}–${A.CONDICIONES_APLICACION.vientoMax} km/h, hasta ${A.CONDICIONES_APLICACION.temperaturaMax} °C, humedad desde ${A.CONDICIONES_APLICACION.humedadMin} % y sin lluvia. Fuente: Agromonitoring._`));
      return resultado('🌦️ Clima y aplicación', lineas);
    }
    function alertasSatelite() {
      return lotesConClima().flatMap(({ l, ndvi }) => {
        if (!ndvi?.serie) return [];
        const mapa = (E().mapasRinde || []).filter((m) => m.loteId === l.id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
        const z = mapa ? A.zonificar(A.limpiarMapaRinde(mapa.puntos).validos) : null;
        return A.alertasNdvi({ serie: ndvi.serie, lote: l.codigo, bajoPotencialPct: z ? z.zonas[0].pct : null });
      });
    }

    const EJECUTAR = { stock: (h) => consultaStock(h), resumen: resumenDiario, alertas: alertasDesvios, quiebre: quiebreStock, costos: costosProyectados, mantenimiento, zonas: zonificacion, prescripcion, multicampo: multiCampo };
    // Primero el plan (qué compró la empresa) y después el rol (qué puede ver este usuario).
    function ejecutarConRol(id, hoy) {
      if (!EJECUTAR[id]) throw new Error(`Capacidad desconocida: ${id}`);
      if (!puede(id)) return bloqueado(id);
      if (!ve(MODULOS_REQUERIDOS[id])) return sinAcceso(capacidad(id).titulo);
      return EJECUTAR[id](hoy);
    }
    const ejecutar = (id, hoy, opciones) => conRol(opciones, () => ejecutarConRol(id, hoy));

    // Botones del panel: diagnóstico por área.
    const analizar = (tipo, hoyFecha, opciones) => conRol(opciones, () => analizarConRol(tipo, hoyFecha));
    function analizarConRol(tipo, hoyFecha) {
      const e = E();
      const r = X().r || {};
      const hoy = hoyDe(hoyFecha);
      if (tipo === 'finanzas') {
        if (!ve(MODULOS_REQUERIDOS.finanzas)) return sinAcceso('💰 Análisis financiero');
        const lineas = [linea('ok', `LPG últimos 30 días: ${tn(r.kgMes)} · neto cobrado *${pesos(r.netoMes)}*`)];
        lineas.push(linea(r.retIvaMes + r.retGanMes > 0 ? 'warn' : 'ok', `Retenciones sufridas: IVA ${pesos(r.retIvaMes)} · Ganancias ${pesos(r.retGanMes)}${r.reintegroPendTotal ? ` · reintegro de IVA pendiente *${pesos(r.reintegroPendTotal)}*` : ''}`));
        const pos = A.posicionIva(e.comprobantesIva || [], hoy.slice(0, 7)) || {};
        if (ve(MODULOS_REQUERIDOS.fiscal) && e.condicionIva !== 'MONOTRIBUTO') lineas.push(linea(pos.aPagar ? 'warn' : 'ok', `IVA ${hoy.slice(0, 7)}: débito ${pesos(pos.debito)} · crédito ${pesos(pos.credito)} · retenciones ${pesos(pos.retIva)}${pos.aPagar ? ` · a pagar *${pesos(pos.aPagar)}*` : ` · saldo a favor ${pesos((pos.favorTecnico || 0) + (pos.favorLibre || 0))}`}`));
        const camp = campaniaResultados();
        if (camp) { const t = A.resultadoCampania(datosCostos(), camp, { tipoCambio: X().tipoCambio }).totales; lineas.push(linea(t.resultado < 0 ? 'risk' : 'ok', `Campaña ${camp}: producción ${pesos(t.ingresos)} · costos ${pesos(t.directos + t.estructura)} · resultado *${pesos(t.resultado)}*`)); }
        return resultado('💰 Análisis financiero', lineas);
      }
      if (tipo === 'operacion') {
        const lineas = [];
        if (ve(['granos'])) lineas.push(linea(r.ocupacion > 90 ? 'warn' : 'ok', `Granos ${tn(r.totalKg)} · ocupación de almacenaje ${num(r.ocupacion)} %`));
        const plan = (e.labores || []).filter((l) => l.estado !== 'REALIZADA');
        lineas.push(linea(plan.some((l) => A.fechaIso(l.fecha) < hoy) ? 'warn' : 'ok', `${plan.length} labor(es) planificada(s)${plan.some((l) => A.fechaIso(l.fecha) < hoy) ? `, ${plan.filter((l) => A.fechaIso(l.fecha) < hoy).length} atrasada(s)` : ''}`));
        if (ve(['insumos'])) { const neg = Object.values(stockInsumos()).filter((x) => x.cantidad <= 0); lineas.push(linea(neg.length ? 'warn' : 'ok', neg.length ? `Insumos sin stock: ${neg.map((x) => capitalizar(x.insumo)).join(', ')}` : 'Insumos con stock.')); }
        if (ve(['maquinaria'])) { const venc = A.mantenimientoEquipos({ equipos: e.equipos, labores: e.labores, hoy }).filter((x) => x.vencido); lineas.push(linea(venc.length ? 'warn' : 'ok', venc.length ? `Service vencido: ${venc.map((x) => x.nombre).join(', ')}` : 'Equipos sin service vencido.')); }
        return resultado('🚜 Análisis operativo', lineas);
      }
      if (tipo === 'riesgos') return alertasDesvios(hoyFecha);
      const ha = (e.lotes || []).reduce((s, l) => s + (Number(l.superficieHa) || 0), 0);
      const campos = new Set((e.lotes || []).map((l) => l.campo).filter(Boolean)).size;
      return resultado('🏢 Diagnóstico general', [
        linea('ok', `${campos} campo(s) · ${(e.lotes || []).length} lote(s) · ${num(ha)} ha · ${(e.ubicaciones || []).length} silobolsa(s)/celda(s) · ${(e.equipos || []).length} equipo(s) · ${(e.empleados || []).length} empleado(s)`),
        linea('ok', `Campaña fina ${r.campania?.fina || '-'}: ${num(r.haFina)} ha · gruesa ${r.campania?.gruesa || '-'}: ${num(r.haGruesa)} ha`),
        linea((r.alertas || []).length ? 'warn' : 'ok', `${(r.alertas || []).length} alerta(s) agrícola(s) y fiscal(es) pendiente(s)`),
        linea('ok', `Plan de IA: *${NOMBRE_PLAN[plan()]}* · ${capacidades().filter((c) => c.habilitada).length} de ${CAPACIDADES.length} funciones habilitadas para tu usuario`),
      ]);
    }

    // ─── Consultas en texto libre (panel, nota de voz, WhatsApp) ───────────────────────────
    const RUTAS_EXTERNAS = [
      { patron: /\b(dolar|dolares|mep|blue|ccl|contado con liqui|cotizacion|tipo de cambio)\b/, fn: (t, hoy) => consultaDolar(hoy) },
      { patron: /\b(pizarra|rosario|precio (de la |del |de )?(soja|maiz|trigo|girasol)|cuanto (vale|paga|esta|cotiza) (la |el )?(soja|maiz|trigo|girasol)|cuanto vale mi (stock|grano))/, fn: (t) => consultaPizarra(t) },
      { patron: /\b(clima|lluvia|llueve|llovio|llover|pronostico|viento|helada|temperatura|aplicar hoy|conviene aplicar|puedo aplicar|pulverizar|fumigar)\b/, fn: (t) => consultaClima(t) },
    ];
    const RUTAS = [
      { id: 'prescripcion', patron: /\b(prescripcion|dosis variable|dosis por zona|cuanto (fertilizante|semilla) (pongo|poner|tiro|tirar))/ },
      { id: 'zonas', patron: /\b(zona|zonas|zonificacion|ambiente|ambientes|mapa de rinde|potencial)\b/ },
      { id: 'multicampo', patron: /\b(multi ?campo|que campo|cual campo|campos? (rinde|rindio|anda|da)|comparar campos|estancias?|operarios?|operadores?|cosechadora)/ },
      { id: 'mantenimiento', patron: /\b(mantenimiento|service|services|tractor|mosquito|pulverizadora|cosechadora|maquina|maquinas|equipo|equipos|horometro|horas de motor)/ },
      { id: 'quiebre', patron: /\b(se acaba|se agota|agotar|quiebre|cuantos dias|alcanza|reponer|cotizar)\b/ },
      { id: 'costos', patron: /\b(costo|costos|margen|rentabilidad|gano|ganando|pierdo|perdiendo|indiferencia|proyectad\w*)\b/ },
      { id: 'resumen', patron: /\b(resumen|como estamos|como esta todo|que paso hoy|que se hizo|novedades|que tengo que (revisar|hacer))/ },
      { id: 'alertas', patron: /\b(alerta|alertas|desvio|desvios|riesgo|riesgos|problema|problemas|precio raro|caro)\b/ },
      { id: 'stock', patron: /\b(stock|me queda|queda|quedan|cuanto hay|galpon|silobolsa|silobolsas|celda|celdas|granos?|insumos?|soja|trigo|maiz|girasol)\b/ },
    ];
    function ayuda() {
      const lineas = [linea('ok', 'Probá preguntarme, por ejemplo:'), linea('ok', '• 📦 _"¿Cuánto glifosato me queda?"_ · 🌾 _"¿Cuánta soja hay en silobolsas?"_'), linea('ok', '• 📉 _"¿Cuándo se acaba la urea?"_ · 🔧 _"¿Cuándo le toca service al tractor?"_ · 🗺️ _"Mostrame las zonas del lote"_')];
      capacidades().forEach((c) => lineas.push(linea(c.habilitada ? 'ok' : 'warn', `• ${c.icono} ${c.titulo}${c.habilitada ? '' : c.porRol ? ' 🔒 _sin acceso para tu usuario_' : ` 🔒 _versión ${c.requiere}_`}`)));
      return resultado('🤔 No entendí la consulta', lineas);
    }
    const responder = (pregunta, opciones = {}) => conRol(opciones, () => responderConRol(pregunta, opciones.hoy));
    function responderConRol(pregunta, hoy) {
      const t = normalizar(pregunta);
      if (!t.trim()) return ayuda();
      const externa = RUTAS_EXTERNAS.find((r) => r.patron.test(t));
      if (externa) return externa.fn(t, hoy);
      const ruta = RUTAS.find((r) => r.patron.test(t));
      if (!ruta) {
        // Un insumo por su nombre ("¿y el glifosato?").
        const insumos = Object.values(stockInsumos());
        if (insumos.some((x) => normalizar(x.insumo).split(/\s+/).some((p) => p.length > 3 && t.includes(p)))) return ve(MODULOS_REQUERIDOS.stock) ? consultaStock(hoy, pregunta) : sinAcceso('📦 Consulta de stock');
        return ayuda();
      }
      if (ruta.id === 'stock') return ve(MODULOS_REQUERIDOS.stock) ? consultaStock(hoy, pregunta) : sinAcceso('📦 Consulta de stock');
      return ejecutarConRol(ruta.id, hoy);
    }

    // Habilitada = la incluye el plan y el rol puede ver sus datos.
    function capacidades(opciones) {
      return conRol(opciones, () => CAPACIDADES.map((c) => {
        const porPlan = puede(c.id);
        const porRol = !ve(MODULOS_REQUERIDOS[c.id]);
        return { ...c, habilitada: porPlan && !porRol, porRol: porPlan && porRol, requiere: planMinimo(c.nivel) };
      }));
    }

    // Contexto para el servidor de IA (Flowise + Ollama): los resultados ya calculados que este usuario puede
    // ver según su versión y su rol. Si la pregunta coincide con una función, va esa primero.
    const quitarFormato = (t) => String(t || '').replace(/[*_]/g, '');
    function contextoParaIA(pregunta, opciones = {}) {
      return conRol(opciones, () => {
        const partes = [];
        const directo = responderConRol(pregunta, opciones.hoy);
        // Si la pregunta coincide con una función, alcanza con esos datos (más rápido en un servidor sin GPU).
        if (directo && !/No entendí/.test(directo.titulo) && !directo.bloqueado) return quitarFormato([directo.texto, analizarConRol('empresa').texto, externo('dolar') && !/Dólar/.test(directo.titulo) ? consultaDolar(opciones.hoy).texto : ''].filter(Boolean).join('\n\n')).slice(0, 12000);
        partes.push(analizarConRol('empresa').texto);
        if (externo('dolar')) partes.push(consultaDolar(opciones.hoy).texto);
        if (externo('pizarra')) partes.push(consultaPizarra('').texto);
        if (lotesConClima().length) partes.push(consultaClima('').texto);
        CAPACIDADES.filter((c) => puede(c.id) && ve(MODULOS_REQUERIDOS[c.id])).forEach((c) => {
          try { const r = EJECUTAR[c.id](opciones.hoy); if (r && !partes.includes(r.texto)) partes.push(r.texto); } catch (e) { /* una función sin datos no frena el resto */ }
        });
        const bloqueadas = CAPACIDADES.filter((c) => !puede(c.id)).map((c) => `${c.titulo} (versión ${planMinimo(c.nivel)})`);
        if (bloqueadas.length) partes.push(`Funciones no incluidas en la versión ${NOMBRE_PLAN[plan()]}: ${bloqueadas.join(', ')}.`);
        return quitarFormato(partes.join('\n\n')).slice(0, 12000);
      });
    }

    return { plan, puede, capacidades, ejecutar, analizar, responder, esConsulta, contextoParaIA, consultaDolar, consultaClima, consultaPizarra, consultaStock, resumenDiario, alertasDesvios, quiebreStock, costosProyectados, mantenimiento, zonificacion, prescripcion, multiCampo };
  }

  // ─── Presentación en el panel (navegador) ─────────────────────────────────────────────
  function escapar(t) {
    return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  // Texto con formato de WhatsApp → HTML seguro.
  function aHtml(texto) {
    return escapar(texto).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_/g, '$1<i>$2</i>').replace(/\n/g, '<br>');
  }
  // Tarjetas de las tres versiones con un botón por función. Las que no incluye el plan quedan con
  // candado y, al tocarlas, explican qué versión las trae.
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

  return { NIVEL_PLAN, NOMBRE_PLAN, CAPACIDADES, crearAsistente, accesoPorRol, esConsulta, aHtml, escapar, montarCapacidades, insightsHtml };
});
