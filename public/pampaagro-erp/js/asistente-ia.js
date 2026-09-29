/* PampaIA de PampaAgropecuario: las capacidades de cada versión, calculadas con los datos del ERP.
 *
 *   SMALL · Básica       consultas sobre los datos, resumen del día, alertas de desvíos (stock, precio, rinde)
 *   MEDIUM · Profesional proyección de faltantes de stock, costos por lote, mantenimiento por horas
 *   LARGE · Premium      zonificación por ambientes, prescripción variable, comparativa entre establecimientos
 *
 * Igual que el motor de consultas por voz (js/consultas-voz.js), ningún número sale de un modelo de
 * lenguaje: todo se calcula con los registros cargados y, si falta historial, se dice. El texto usa el
 * formato de WhatsApp (*negrita*, _cursiva_, viñetas) para que el mismo resultado sirva en el panel,
 * en la nota de voz y en el WhatsApp vinculado.
 *
 * Mismo archivo en js/ (escritorio) y public/js/ (web/PWA). UMD: navegador y Node.
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
    { id: 'resumen', nivel: 1, icono: '📋', titulo: 'Resumen del día', detalle: 'Movimientos de hoy y ayer, saldos y lo que hay que atender.' },
    { id: 'alertas', nivel: 1, icono: '⚠️', titulo: 'Alertas de desvíos', detalle: 'Stock bajo el mínimo, precios de venta y rindes fuera de lo normal.' },
    { id: 'stock', nivel: 2, icono: '📦', titulo: 'Proyección de stock', detalle: 'En cuántos días se acaba cada insumo según su consumo real.' },
    { id: 'costosLote', nivel: 2, icono: '🧮', titulo: 'Costos por lote', detalle: 'Costo y margen por hectárea de cada lote, agrícola y ganadero por separado.' },
    { id: 'mantenimiento', nivel: 2, icono: '🔧', titulo: 'Mantenimiento por horas', detalle: 'Services vencidos o próximos según las horas de cada equipo.' },
    { id: 'zonificacion', nivel: 3, icono: '🗺️', titulo: 'Zonificación', detalle: 'Ambientes alto, medio y bajo según el rinde histórico de cada lote.' },
    { id: 'prescripcion', nivel: 3, icono: '🎯', titulo: 'Prescripción variable', detalle: 'Dosis propuesta por ambiente a partir de las dosis que ya usás.' },
    { id: 'comparativa', nivel: 3, icono: '🏢', titulo: 'Comparar establecimientos', detalle: 'Costos, rindes y márgenes por hectárea de cada campo.' },
  ];

  // Factores de la prescripción por ambiente. Solo semilla y fertilizantes: los fitosanitarios se
  // aplican a dosis de marbete, no se varían por ambiente.
  const FACTOR_AMBIENTE = { Alto: 1.1, Medio: 1, Bajo: 0.85 };
  const UMBRAL = { rinde: 0.15, precio: 0.1, ambienteAlto: 1.1, ambienteBajo: 0.9, diasStock: 30, horasAviso: 50, ventanaConsumoDias: 90 };

  const pesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
  const num = (n, dec = 0) => (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: dec });
  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const iso = (fecha) => new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const sumarDias = (fechaIso, dias) => { const d = new Date(`${fechaIso}T12:00:00`); d.setDate(d.getDate() + dias); return iso(d); };
  const diasEntre = (desde, hasta) => Math.round((new Date(`${hasta}T12:00:00`) - new Date(`${desde}T12:00:00`)) / 86400000);
  const fechaCorta = (f) => { const [a, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : ''; };

  // "70 kg/ha", "2,5 L/ha", "1.200 semillas/m2" → { valor, unidad }
  function leerDosis(texto) {
    const m = String(texto || '').match(/([\d.,]+)\s*([^\d\s][^/]*\/\s*\S+)?/);
    if (!m) return null;
    const crudo = m[1];
    const valor = Number(/,\d{1,3}$/.test(crudo) || /^\d{1,3}(\.\d{3})+$/.test(crudo) ? crudo.replace(/\./g, '').replace(',', '.') : crudo.replace(/,/g, ''));
    return Number.isFinite(valor) && valor > 0 ? { valor, unidad: (m[2] || '').trim() } : null;
  }

  // Módulos del ERP que tiene que poder abrir el usuario para ver cada respuesta (alcanza con uno).
  // Así la IA, la nota de voz y el WhatsApp respetan los permisos del rol igual que el menú.
  const MODULOS_REQUERIDOS = {
    stock: ['inventario'],
    costosLote: ['costos', 'rentabilidad'],
    mantenimiento: ['mantenimiento', 'maquinarias'],
    zonificacion: ['lotes', 'cosecha'],
    prescripcion: ['siembra', 'aplicaciones'],
    comparativa: ['costos', 'rentabilidad'],
    rinde: ['cosecha'],
    finanzas: ['caja', 'bancos'],
    caja_bancos: ['caja', 'bancos'],
    gastos_periodo: ['costos'],
    margen_lote: ['costos', 'rentabilidad'],
    movimientos_lote: ['costos'],
  };
  const MODULOS_DATO = {
    plata: ['caja', 'bancos'],
    costos: ['costos'],
    cheques: ['cheques', 'caja', 'bancos'],
    stock: ['inventario'],
    services: ['mantenimiento', 'maquinarias'],
    precios: ['rentabilidad', 'costos'],
    rindes: ['cosecha'],
  };

  /**
   * @param {object} d  { motor (crearMotorConsultas), estado(), plan(), parseMonto, fechaMovimientoISO,
   *                      saldoMovimientosFondos, saldoTotalBancos, usoLote,
   *                      rol() (rol activo), acceso(rol, modulo) (rol + plan), nombreRol(rol) }
   */
  function crearAsistente(d) {
    const numero = (v) => { const n = d.parseMonto(v); return Number.isFinite(n) ? n : 0; };
    const fechaDe = (r) => d.fechaMovimientoISO(r && r.fecha) || null;
    const plan = () => (NIVEL_PLAN[d.plan()] ? d.plan() : 'basica');
    const capacidad = (id) => CAPACIDADES.find((c) => c.id === id);
    const planMinimo = (nivel) => ({ 1: 'Básica', 2: 'Profesional', 3: 'Premium' })[nivel];
    const puede = (id) => NIVEL_PLAN[plan()] >= capacidad(id).nivel;
    // Rol de quien pregunta: el de la sesión, o el del teléfono en el WhatsApp vinculado.
    let rolConsulta;
    const rolActual = () => (rolConsulta !== undefined ? rolConsulta : d.rol ? d.rol() : null);
    const ve = (modulos) => !d.acceso || rolActual() === null || !modulos || !modulos.length || modulos.some((m) => d.acceso(rolActual(), m));
    const veDato = (dato) => ve(MODULOS_DATO[dato]);
    function conRol(opciones, fn) {
      const previo = rolConsulta;
      if (opciones && opciones.rol !== undefined) rolConsulta = opciones.rol;
      try { return fn(); } finally { rolConsulta = previo; }
    }
    const resultado = (titulo, lineas, extra = {}) => ({ titulo, lineas, texto: [`*${titulo}*`, '', ...lineas.map((l) => l.texto)].join('\n'), ...extra });
    const linea = (nivel, texto) => ({ nivel, texto });
    const nombreLote = (codigo) => { const l = (d.estado().lotes || []).find((x) => x.codigo === codigo); return l ? l.nombre || l.codigo : codigo || 'Sin lote'; };
    const nombreCampo = (codigo) => { const c = (d.estado().campos || []).find((x) => x.codigo === codigo || x.nombre === codigo); return c ? c.nombre || c.codigo : codigo || 'Sin campo'; };

    function bloqueado(id) {
      const c = capacidad(id);
      return resultado(`🔒 ${c.titulo}`, [linea('warn', `Esta función es de la versión *${planMinimo(c.nivel)}*. Tu plan actual es ${NOMBRE_PLAN[plan()]}.`), linea('ok', `_${c.detalle}_`)], { bloqueado: true, requiere: planMinimo(c.nivel) });
    }

    function sinAcceso(titulo) {
      const rol = rolActual();
      const nombre = (d.nombreRol && d.nombreRol(rol)) || rol || 'sin rol';
      return resultado(`🔒 ${titulo}`, [linea('warn', `Tu usuario (*${nombre}*) no tiene acceso a esta información. Pedísela al propietario o a quien tenga ese módulo.`)], { bloqueado: true, porRol: true });
    }

    // ─── Básica ──────────────────────────────────────────────────────────────────────────
    function saldos() {
      const s = d.estado();
      return { caja: d.saldoMovimientosFondos(s.caja || []), bancos: d.saldoTotalBancos() };
    }

    function chequesPendientes(lista) {
      return (lista || []).filter((c) => !/cobrad|pagad|rechaz|anulad|depositad/i.test(String(c.estado || '')));
    }

    // Igual que el módulo Inventario (stock ≤ mínimo). Un insumo sin mínimo cargado avisa al llegar
    // a cero; los granos y productos terminados en cero no son un faltante.
    function stockBajoMinimo() {
      return (d.estado().inventario || [])
        .filter((i) => Number(i.stock) <= Number(i.stockMinimo || 0) && (Number(i.stockMinimo) > 0 || /insumo|repuesto|combustible|lubric/i.test(`${i.categoria || ''}`)))
        .map((i) => ({ codigo: i.codigo, producto: i.producto, stock: Number(i.stock) || 0, minimo: Number(i.stockMinimo), unidad: i.unidad || '' }));
    }

    function alertasMantenimiento() {
      const s = d.estado();
      return (s.costosOperativos || [])
        .map((p) => {
          const equipo = (s.maquinarias || []).find((m) => m.equipo === p.equipo || m.codigo === p.equipo);
          const intervalo = Number(p.intervalo);
          const ultima = Number(p.ultimaEjecucion);
          const horas = Number(equipo && equipo.horas);
          if (!equipo || !(intervalo > 0) || String(p.ultimaEjecucion ?? '').trim() === '' || !Number.isFinite(ultima) || !Number.isFinite(horas)) return null;
          const faltan = ultima + intervalo - horas;
          return { equipo: equipo.equipo || equipo.codigo, tarea: p.tipoCosto || p.descripcion || 'Mantenimiento programado', faltan, costoPorHora: numero(p.costo) / intervalo, horasEquipo: horas };
        })
        .filter(Boolean)
        .sort((a, b) => a.faltan - b.faltan);
    }

    function resumenDiario(hoyFecha = new Date()) {
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const ayer = sumarDias(hoy, -1);
      const lineas = [];
      // Cada dato se muestra solo si el rol puede abrir el módulo de donde sale.
      const plata = veDato('plata');
      const verCostos = veDato('costos');
      if (plata) {
        const { caja, bancos } = saldos();
        lineas.push(linea('ok', `💰 Caja *${pesos(caja)}* · Bancos *${pesos(bancos)}*`));
      }
      for (const [dia, etiqueta] of plata || verCostos ? [[hoy, 'Hoy'], [ayer, 'Ayer']] : []) {
        const movs = [...(s.caja || []), ...(s.bancos || [])].filter((m) => fechaDe(m) === dia && (m.tipo === 'Ingreso' || m.tipo === 'Egreso'));
        const entro = movs.filter((m) => m.tipo === 'Ingreso').reduce((t, m) => t + numero(m.importe), 0);
        const salio = movs.filter((m) => m.tipo === 'Egreso').reduce((t, m) => t + numero(m.importe), 0);
        const costos = d.motor.libroDeCostos().filter((i) => i.fecha === dia);
        const porAct = (a) => costos.filter((i) => i.actividad === a).reduce((t, i) => t + i.monto, 0);
        const partes = [plata ? `entró ${pesos(entro)}, salió ${pesos(salio)}` : null, verCostos ? `costos 🌾 ${pesos(porAct('Agrícola'))} · 🐂 ${pesos(porAct('Ganadera'))} · 🏢 ${pesos(porAct('Estructura'))}` : null].filter(Boolean);
        lineas.push(linea('ok', `• *${etiqueta}:* ${partes.join(' · ')}`));
      }
      const informativas = lineas.length;
      const semana = sumarDias(hoy, 7);
      const aPagar = veDato('cheques') ? chequesPendientes(s.chequesCubrir).filter((c) => { const f = d.fechaMovimientoISO(c.vencimiento); return f && f <= semana; }) : [];
      if (aPagar.length) lineas.push(linea(aPagar.some((c) => d.fechaMovimientoISO(c.vencimiento) < hoy) ? 'risk' : 'warn', `• 🧾 Cheques a pagar en 7 días: ${aPagar.length} por ${pesos(aPagar.reduce((t, c) => t + numero(c.importe), 0))}`));
      const aCobrar = !veDato('cheques') ? [] : chequesPendientes(s.chequesCobrar).filter((c) => { const f = d.fechaMovimientoISO(c.vencimiento); return f && f <= semana; });
      if (aCobrar.length) lineas.push(linea('ok', `• 🧾 Cheques a cobrar en 7 días: ${aCobrar.length} por ${pesos(aCobrar.reduce((t, c) => t + numero(c.importe), 0))}`));
      const bajos = veDato('stock') ? stockBajoMinimo() : [];
      if (bajos.length) lineas.push(linea('warn', `• 📦 Insumos bajo el mínimo: ${bajos.map((b) => b.producto).join(', ')}`));
      const mant = veDato('services') ? alertasMantenimiento().filter((m) => m.faltan <= UMBRAL.horasAviso) : [];
      if (mant.length) lineas.push(linea(mant.some((m) => m.faltan <= 0) ? 'risk' : 'warn', `• 🔧 Services para hacer: ${mant.map((m) => `${m.equipo} (${m.faltan <= 0 ? `vencido ${Math.round(-m.faltan)} hs` : `en ${Math.round(m.faltan)} hs`})`).join(', ')}`));
      if (lineas.length === informativas) lineas.push(linea('ok', '• Sin vencimientos, faltantes ni services pendientes.'));
      return resultado(`📋 Resumen del día · ${fechaCorta(hoy)}`, lineas);
    }

    // Rinde de cada cosecha en kg/ha: el cargado, o total / hectáreas del lote.
    function rindes() {
      const s = d.estado();
      return (s.cosecha || [])
        .map((c) => {
          const lote = (s.lotes || []).find((l) => l.codigo === c.lote);
          const kgHa = Number(c.rendimiento) > 0 ? Number(c.rendimiento) : Number(c.totalKg) > 0 && Number(lote && lote.superficie) > 0 ? Number(c.totalKg) / Number(lote.superficie) : 0;
          return kgHa > 0 ? { lote: c.lote, campo: lote && lote.campo, cultivo: c.cultivo || 'Sin cultivo', kgHa, fecha: fechaDe(c) } : null;
        })
        .filter(Boolean);
    }

    function alertasDesvios() {
      const s = d.estado();
      const lineas = [];
      if (veDato('stock')) stockBajoMinimo().forEach((b) =>
        lineas.push(linea(b.stock <= 0 ? 'risk' : 'warn', b.stock <= 0 ? `📦 *${b.producto}*: *sin stock*` : `📦 *${b.producto}*: quedan ${num(b.stock)} ${b.unidad} (mínimo ${num(b.minimo)})`)));
      // Precio de venta: la última venta de cada cultivo contra el promedio de las anteriores.
      const porCultivo = {};
      (veDato('precios') ? s.ventasCereal || [] : []).filter((v) => numero(v.precioKg) > 0).forEach((v) => { (porCultivo[v.cultivo || 'Sin cultivo'] ||= []).push(v); });
      Object.entries(porCultivo).forEach(([cultivo, ventas]) => {
        if (ventas.length < 2) return;
        ventas.sort((a, b) => String(fechaDe(a)).localeCompare(String(fechaDe(b))));
        const ultima = ventas[ventas.length - 1];
        const previas = ventas.slice(0, -1);
        const promedio = previas.reduce((t, v) => t + numero(v.precioKg), 0) / previas.length;
        const desvio = (numero(ultima.precioKg) - promedio) / promedio;
        if (Math.abs(desvio) >= UMBRAL.precio)
          lineas.push(linea(desvio < 0 ? 'warn' : 'ok', `💲 *${cultivo}*: la última venta (${fechaCorta(fechaDe(ultima))}) fue a ${pesos(numero(ultima.precioKg))}/kg, ${desvio < 0 ? '' : '+'}${Math.round(desvio * 100)} % contra el promedio de tus ventas anteriores (${pesos(promedio)}/kg)`));
      });
      // Rinde: cada cosecha contra el promedio del mismo cultivo en las demás.
      const lista = veDato('rindes') ? rindes() : [];
      lista.forEach((r) => {
        const otros = lista.filter((x) => x !== r && x.cultivo === r.cultivo);
        if (!otros.length) return;
        const promedio = otros.reduce((t, x) => t + x.kgHa, 0) / otros.length;
        const desvio = (r.kgHa - promedio) / promedio;
        if (Math.abs(desvio) >= UMBRAL.rinde)
          lineas.push(linea(desvio < 0 ? 'warn' : 'ok', `🌾 *${nombreLote(r.lote)}* (${r.cultivo}): ${num(r.kgHa)} kg/ha, ${desvio < 0 ? '' : '+'}${Math.round(desvio * 100)} % contra el promedio de ${r.cultivo} en tus otros lotes (${num(promedio)} kg/ha)`));
      });
      if (!lineas.length) lineas.push(linea('ok', 'Sin desvíos: el stock está sobre los mínimos y los precios y rindes están dentro de lo normal.'));
      const sinBase = Object.values(porCultivo).every((v) => v.length < 2) && !lista.some((r) => lista.some((x) => x !== r && x.cultivo === r.cultivo));
      if (sinBase) lineas.push(linea('ok', `_Para comparar precios y rindes hacen falta al menos dos ventas o dos cosechas del mismo cultivo._`));
      return resultado('⚠️ Alertas de desvíos', lineas);
    }

    // ─── Profesional ─────────────────────────────────────────────────────────────────────
    function proyeccionStock(hoyFecha = new Date()) {
      if (!puede('stock')) return bloqueado('stock');
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const desde = sumarDias(hoy, -UMBRAL.ventanaConsumoDias);
      const consumo = {};
      // Las aplicaciones, siembras, alimentación y consumos descuentan stock y dejan su salida en
      // Movimientos de stock: esa es la fuente, así no se cuenta dos veces.
      (s.movimientoStock || []).forEach((m) => {
        const f = fechaDe(m);
        if (m.tipo !== 'Salida' || !f || f < desde || f > hoy || /transfer/i.test(m.motivo || '')) return;
        consumo[m.producto] = (consumo[m.producto] || 0) + numero(m.cantidad);
      });
      const filas = (s.inventario || [])
        .map((i) => {
          const usado = consumo[i.codigo] || consumo[i.producto] || 0;
          const porDia = usado / UMBRAL.ventanaConsumoDias;
          const stock = Number(i.stock) || 0;
          const minimo = Number(i.stockMinimo) || 0;
          return { producto: i.producto, unidad: i.unidad || '', stock, minimo, porDia, diasAlMinimo: porDia > 0 ? Math.max(0, (stock - minimo) / porDia) : null, diasACero: porDia > 0 ? stock / porDia : null };
        })
        .filter((f) => f.porDia > 0)
        .sort((a, b) => a.diasAlMinimo - b.diasAlMinimo);
      const lineas = filas.map((f) => {
        const nivel = f.diasAlMinimo <= 0 ? 'risk' : f.diasAlMinimo <= UMBRAL.diasStock ? 'warn' : 'ok';
        const cuando = f.diasAlMinimo <= 0 ? '*ya está bajo el mínimo*' : `llega al mínimo en *${Math.round(f.diasAlMinimo)} días* (${fechaCorta(sumarDias(hoy, Math.round(f.diasAlMinimo)))})`;
        return linea(nivel, `📦 *${f.producto}*: ${num(f.stock)} ${f.unidad}, se usan ${num(f.porDia, 1)} ${f.unidad}/día → ${cuando}; se acaba en ${Math.round(f.diasACero)} días`);
      });
      const sinConsumo = (s.inventario || []).length - filas.length;
      if (!filas.length) lineas.push(linea('ok', `No hay salidas de stock en los últimos ${UMBRAL.ventanaConsumoDias} días para proyectar.`));
      if (sinConsumo > 0) lineas.push(linea('ok', `_${sinConsumo} insumo(s) sin consumo en los últimos ${UMBRAL.ventanaConsumoDias} días: no se proyectan._`));
      return resultado('📦 Proyección de stock', lineas, { datos: filas });
    }

    function costosPorLote() {
      if (!puede('costosLote')) return bloqueado('costosLote');
      const s = d.estado();
      const libro = d.motor.libroDeCostos();
      const filas = (s.lotes || []).map((l) => {
        const del = (act) => libro.filter((i) => i.lote === l.codigo && i.actividad === act).reduce((t, i) => t + i.monto, 0);
        const ha = Number(l.superficie) || 0;
        const agricola = del('Agrícola');
        const ganadero = del('Ganadera');
        const ingresos = (s.ventasCereal || []).filter((v) => v.lote === l.codigo).reduce((t, v) => t + numero(v.cantidadKg) * numero(v.precioKg), 0);
        return { lote: l.codigo, nombre: l.nombre || l.codigo, uso: d.usoLote(l) || 'Sin definir', ha, agricola, ganadero, ingresos, costoHa: ha ? (agricola + ganadero) / ha : null, margenAgricolaHa: ha && ingresos ? (ingresos - agricola) / ha : null };
      }).sort((a, b) => (b.costoHa || 0) - (a.costoHa || 0));
      const sinLote = libro.filter((i) => !i.lote && i.actividad !== 'Estructura').reduce((t, i) => t + i.monto, 0);
      const lineas = filas.map((f) => linea('ok', [
        `📍 *${f.nombre}* (${f.uso}, ${num(f.ha)} ha): *${f.costoHa === null ? 'sin superficie' : `${pesos(f.costoHa)}/ha`}*`,
        f.agricola ? `   🌾 ${pesos(f.agricola)}` : null,
        f.ganadero ? `   🐂 ${pesos(f.ganadero)}` : null,
        f.margenAgricolaHa !== null ? `   margen agrícola directo ${pesos(f.margenAgricolaHa)}/ha` : null,
      ].filter(Boolean).join('\n')));
      if (filas.length > 1 && filas[0].costoHa) lineas.unshift(linea('warn', `El lote con más costo por hectárea es *${filas[0].nombre}* (${pesos(filas[0].costoHa)}/ha).`));
      if (sinLote) lineas.push(linea('warn', `_${pesos(sinLote)} de costos directos no tienen lote cargado y no se reparten._`));
      lineas.push(linea('ok', '_Costos directos: la estructura (sueldos, combustible, bancos) no se asigna a lotes._'));
      return resultado('🧮 Costos por lote', lineas, { datos: filas });
    }

    function mantenimientoPorHoras() {
      if (!puede('mantenimiento')) return bloqueado('mantenimiento');
      const s = d.estado();
      const planes = alertasMantenimiento();
      const lineas = planes.map((p) => linea(p.faltan <= 0 ? 'risk' : p.faltan <= UMBRAL.horasAviso ? 'warn' : 'ok',
        `🔧 *${p.equipo}* · ${p.tarea}: ${p.faltan <= 0 ? `*vencido hace ${Math.round(-p.faltan)} hs*` : `faltan *${Math.round(p.faltan)} hs*`} (equipo en ${num(p.horasEquipo)} hs; ${pesos(p.costoPorHora)}/h de este service)`));
      (s.maquinarias || []).forEach((m) => {
        const gastado = (s.mantenimiento || []).filter((o) => o.equipo === m.codigo || o.equipo === m.equipo).reduce((t, o) => t + numero(o.costo), 0);
        const litros = (s.cargacombustible || []).filter((c) => c.equipo === m.codigo || c.equipo === m.equipo).reduce((t, c) => t + numero(c.cantidad), 0);
        const sinPlan = !planes.some((p) => p.equipo === (m.equipo || m.codigo));
        lineas.push(linea(sinPlan ? 'warn' : 'ok', `🚜 *${m.equipo || m.codigo}*: ${num(m.horas)} hs · reparaciones y services ${pesos(gastado)} · gasoil ${num(litros)} L${sinPlan ? ' · _sin plan de mantenimiento por horas cargado_' : ''}`));
      });
      if (!lineas.length) lineas.push(linea('ok', 'No hay equipos ni planes de mantenimiento cargados.'));
      return resultado('🔧 Mantenimiento por horas', lineas, { datos: planes });
    }

    // ─── Premium ─────────────────────────────────────────────────────────────────────────
    // Ambiente de cada lote agrícola: el calculado por rinde (lote / promedio del cultivo en el
    // mismo campo, o en la empresa si el campo tiene un solo lote) o, sin cosechas, el declarado.
    function ambientes() {
      const s = d.estado();
      const lista = rindes();
      return (s.lotes || []).filter((l) => d.usoLote(l) !== 'Ganadero').map((l) => {
        const propios = lista.filter((r) => r.lote === l.codigo);
        const indices = propios.map((r) => {
          let pares = lista.filter((x) => x.cultivo === r.cultivo && x.campo === r.campo);
          if (new Set(pares.map((x) => x.lote)).size < 2) pares = lista.filter((x) => x.cultivo === r.cultivo);
          const promedio = pares.reduce((t, x) => t + x.kgHa, 0) / pares.length;
          return promedio ? r.kgHa / promedio : null;
        }).filter((x) => x !== null);
        const comparables = indices.length && lista.some((x) => x.lote !== l.codigo && propios.some((p) => p.cultivo === x.cultivo));
        const indice = comparables ? indices.reduce((t, x) => t + x, 0) / indices.length : null;
        const calculado = indice === null ? null : indice >= UMBRAL.ambienteAlto ? 'Alto' : indice <= UMBRAL.ambienteBajo ? 'Bajo' : 'Medio';
        const declarado = ['Alto', 'Medio', 'Bajo'].includes(l.ambiente) ? l.ambiente : null;
        return { lote: l.codigo, nombre: l.nombre || l.codigo, campo: l.campo, ha: Number(l.superficie) || 0, indice, calculado, declarado, ambiente: calculado || declarado, cosechas: propios.length };
      });
    }

    function zonificacion() {
      if (!puede('zonificacion')) return bloqueado('zonificacion');
      const filas = ambientes();
      const lineas = [];
      const porCampo = {};
      filas.forEach((f) => { (porCampo[f.campo || ''] ||= []).push(f); });
      Object.entries(porCampo).forEach(([campo, lista]) => {
        lineas.push(linea('ok', `🏡 *${nombreCampo(campo)}*`));
        lista.sort((a, b) => (b.indice || 0) - (a.indice || 0)).forEach((f) => {
          const icono = { Alto: '🟢', Medio: '🟡', Bajo: '🔴' }[f.ambiente] || '⚪';
          const base = f.calculado ? `índice de rinde ${num(f.indice, 2)} (${f.cosechas} cosecha${f.cosechas === 1 ? '' : 's'})` : f.declarado ? '_sin cosechas comparables: ambiente declarado_' : '_sin cosechas ni ambiente declarado_';
          const diferencia = f.calculado && f.declarado && f.calculado !== f.declarado;
          lineas.push(linea(diferencia || !f.ambiente ? 'warn' : 'ok', `   ${icono} ${f.nombre} (${num(f.ha)} ha): *${f.ambiente || 'sin datos'}* · ${base}${diferencia ? ` · ⚠️ cargado como ${f.declarado}` : ''}`));
        });
      });
      if (!filas.length) lineas.push(linea('ok', 'No hay lotes agrícolas cargados.'));
      lineas.push(linea('ok', `_Alto: rinde ≥ ${Math.round(UMBRAL.ambienteAlto * 100)} % del promedio del cultivo; Bajo: ≤ ${Math.round(UMBRAL.ambienteBajo * 100)} %. Es zonificación entre lotes; dentro de un lote hace falta un mapa de rinde._`));
      return resultado('🗺️ Zonificación por ambientes', lineas, { datos: filas });
    }

    function prescripcion() {
      if (!puede('prescripcion')) return bloqueado('prescripcion');
      const s = d.estado();
      const inventario = s.inventario || [];
      const productoDe = (codigo) => inventario.find((i) => i.codigo === codigo || i.producto === codigo);
      const variable = (producto, tipo) => /semilla|fertiliz|urea|fosfat|nitrog|sembr/.test(normalizar(`${tipo || ''} ${producto && producto.categoria || ''} ${producto && producto.producto || ''}`));
      // Dosis que ya usás por producto (la última registrada en siembra o aplicaciones).
      const dosis = {};
      (s.siembra || []).forEach((r) => { const v = leerDosis(r.dosis); if (v && r.producto) dosis[r.producto] = { ...v, fecha: fechaDe(r), tipo: 'Siembra', cultivo: r.cultivo }; });
      (s.aplicaciones || []).forEach((a) => (a.productos || []).forEach((p) => {
        const v = leerDosis(p.dosis);
        if (v && p.producto && (!dosis[p.producto] || String(fechaDe(a)) >= String(dosis[p.producto].fecha))) dosis[p.producto] = { ...v, fecha: fechaDe(a), tipo: a.tipo || 'Aplicación' };
      }));
      const productos = Object.entries(dosis).filter(([codigo, v]) => variable(productoDe(codigo), v.tipo));
      const zonas = ambientes().filter((z) => z.ambiente);
      const filas = [];
      zonas.forEach((z) => productos.forEach(([codigo, v]) => {
        const factor = FACTOR_AMBIENTE[z.ambiente];
        const propuesta = v.valor * factor;
        filas.push({ lote: z.lote, nombre: z.nombre, ambiente: z.ambiente, ha: z.ha, producto: (productoDe(codigo) || {}).producto || codigo, dosisActual: v.valor, dosisPropuesta: propuesta, unidad: v.unidad, total: propuesta * z.ha, factor });
      }));
      const lineas = [];
      zonas.forEach((z) => {
        const propias = filas.filter((f) => f.lote === z.lote);
        if (!propias.length) return;
        lineas.push(linea('ok', [`📍 *${z.nombre}* · ambiente ${z.ambiente} (${num(z.ha)} ha, x${num(FACTOR_AMBIENTE[z.ambiente], 2)})`,
          ...propias.map((f) => `   • ${f.producto}: ${num(f.dosisActual, 2)} → *${num(f.dosisPropuesta, 2)} ${f.unidad}* (total ${num(f.total)} ${String(f.unidad).split('/')[0].trim()})`)].join('\n')));
      });
      if (!productos.length) lineas.push(linea('warn', 'No hay dosis de semilla o fertilizante cargadas en Siembra o Aplicaciones para tomar como base.'));
      else if (!zonas.length) lineas.push(linea('warn', 'Ningún lote tiene ambiente (ni calculado por rinde ni declarado).'));
      lineas.push(linea('warn', `_Propuesta inicial para validar con el ingeniero agrónomo: semilla y fertilizantes x${FACTOR_AMBIENTE.Alto} en ambiente alto, x${FACTOR_AMBIENTE.Bajo} en bajo. Los fitosanitarios van a dosis de marbete._`));
      return resultado('🎯 Prescripción variable', lineas, { datos: filas });
    }

    function comparativaEstablecimientos() {
      if (!puede('comparativa')) return bloqueado('comparativa');
      const s = d.estado();
      const libro = d.motor.libroDeCostos();
      const loteCampo = {};
      (s.lotes || []).forEach((l) => { loteCampo[l.codigo] = l.campo; });
      const rinde = rindes();
      const filas = (s.campos || []).map((c) => {
        const codigo = c.codigo || c.nombre;
        const lotes = (s.lotes || []).filter((l) => l.campo === codigo);
        const ha = lotes.reduce((t, l) => t + (Number(l.superficie) || 0), 0) || Number(c.superficie) || 0;
        const costo = (act) => libro.filter((i) => i.actividad === act && loteCampo[i.lote] === codigo).reduce((t, i) => t + i.monto, 0);
        const ingresos = (s.ventasCereal || []).filter((v) => loteCampo[v.lote] === codigo).reduce((t, v) => t + numero(v.cantidadKg) * numero(v.precioKg), 0);
        const cultivos = {};
        rinde.filter((r) => r.campo === codigo).forEach((r) => { (cultivos[r.cultivo] ||= []).push(r.kgHa); });
        return { campo: codigo, nombre: c.nombre || codigo, ha, lotes: lotes.length, agricola: costo('Agrícola'), ganadero: costo('Ganadera'), ingresos, rindes: Object.fromEntries(Object.entries(cultivos).map(([k, v]) => [k, v.reduce((t, x) => t + x, 0) / v.length])) };
      });
      const lineas = filas.map((f) => linea('ok', [
        `🏡 *${f.nombre}* · ${num(f.ha)} ha en ${f.lotes} lote(s)`,
        `   🌾 costo ${f.ha ? `${pesos(f.agricola / f.ha)}/ha` : pesos(f.agricola)}${f.ingresos ? ` · ventas ${pesos(f.ingresos)} · margen directo ${pesos(f.ingresos - f.agricola)}` : ''}`,
        `   🐂 costo ${f.ha ? `${pesos(f.ganadero / f.ha)}/ha` : pesos(f.ganadero)}`,
        Object.keys(f.rindes).length ? `   rindes: ${Object.entries(f.rindes).map(([k, v]) => `${k} ${num(v)} kg/ha`).join(' · ')}` : '   _sin cosechas registradas_',
      ].join('\n')));
      // Mismo cultivo en más de un campo: se señala la diferencia de rinde.
      const cultivos = [...new Set(filas.flatMap((f) => Object.keys(f.rindes)))];
      cultivos.forEach((cultivo) => {
        const con = filas.filter((f) => f.rindes[cultivo]);
        if (con.length < 2) return;
        con.sort((a, b) => b.rindes[cultivo] - a.rindes[cultivo]);
        const [mejor, peor] = [con[0], con[con.length - 1]];
        lineas.push(linea('warn', `📊 *${cultivo}*: ${mejor.nombre} rinde ${Math.round((mejor.rindes[cultivo] / peor.rindes[cultivo] - 1) * 100)} % más que ${peor.nombre} (${num(mejor.rindes[cultivo])} vs ${num(peor.rindes[cultivo])} kg/ha)`));
      });
      if (filas.length < 2) lineas.push(linea('ok', '_Cargá más de un campo para comparar establecimientos._'));
      lineas.push(linea('ok', '_Costos directos por hectárea; la estructura no se reparte entre campos._'));
      return resultado('🏢 Comparativa de establecimientos', lineas, { datos: filas });
    }

    const EJECUTAR = { resumen: resumenDiario, alertas: alertasDesvios, stock: proyeccionStock, costosLote: costosPorLote, mantenimiento: mantenimientoPorHoras, zonificacion, prescripcion, comparativa: comparativaEstablecimientos };
    // Primero el plan (qué compró la empresa) y después el rol (qué puede ver este usuario).
    function ejecutarConRol(id, hoy) {
      if (!EJECUTAR[id]) throw new Error(`Capacidad desconocida: ${id}`);
      if (!puede(id)) return bloqueado(id);
      if (!ve(MODULOS_REQUERIDOS[id])) return sinAcceso(capacidad(id).titulo);
      return EJECUTAR[id](hoy);
    }
    const ejecutar = (id, hoy, opciones) => conRol(opciones, () => ejecutarConRol(id, hoy));

    // Botones del panel: diagnóstico por área con números correctos (los mismos de cada módulo).
    const analizar = (tipo, hoyFecha = new Date(), opciones) => conRol(opciones, () => analizarConRol(tipo, hoyFecha));
    function analizarConRol(tipo, hoyFecha) {
      const s = d.estado();
      if (tipo === 'finanzas') {
        if (!ve(MODULOS_REQUERIDOS.finanzas)) return sinAcceso('💰 Análisis financiero');
        const { caja, bancos } = saldos();
        const g = d.motor.gastosPorCarril(null);
        const cobrar = chequesPendientes(s.chequesCobrar).reduce((t, c) => t + numero(c.importe), 0);
        const pagar = chequesPendientes(s.chequesCubrir).reduce((t, c) => t + numero(c.importe), 0);
        return resultado('💰 Análisis financiero', [
          linea('ok', `Caja *${pesos(caja)}* · Bancos *${pesos(bancos)}* · Total *${pesos(caja + bancos)}*`),
          linea(pagar > cobrar + caja + bancos ? 'risk' : pagar > cobrar ? 'warn' : 'ok', `Cheques por cobrar ${pesos(cobrar)} · por pagar ${pesos(pagar)}`),
          veDato('costos') ? linea('ok', `Costos registrados: 🌾 ${pesos(g.gastosAgricolas)} · 🐂 ${pesos(g.gastosGanaderos)} · 🏢 ${pesos(g.gastosEstructura)}`) : null,
        ].filter(Boolean));
      }
      if (tipo === 'operacion') {
        const mant = alertasMantenimiento().filter((m) => m.faltan <= UMBRAL.horasAviso);
        const bajos = stockBajoMinimo();
        return resultado('🚜 Análisis operativo', [
          linea('ok', `${(s.lotes || []).length} lotes · ${(s.maquinarias || []).length} equipos · ${(s.inventario || []).length} insumos · ${(s.hacienda || []).length} registros de hacienda`),
          veDato('stock') ? linea(bajos.length ? 'warn' : 'ok', bajos.length ? `Bajo el mínimo: ${bajos.map((b) => b.producto).join(', ')}` : 'Todos los insumos están sobre el stock mínimo.') : null,
          !veDato('services') ? null : linea(mant.length ? (mant.some((m) => m.faltan <= 0) ? 'risk' : 'warn') : 'ok', mant.length ? `Services: ${mant.map((m) => `${m.equipo} (${m.faltan <= 0 ? 'vencido' : `${Math.round(m.faltan)} hs`})`).join(', ')}` : 'Sin services vencidos ni próximos.'),
        ].filter(Boolean));
      }
      if (tipo === 'riesgos') return alertasDesvios();
      const campos = (s.campos || []).length;
      const ha = (s.lotes || []).reduce((t, l) => t + (Number(l.superficie) || 0), 0);
      return resultado('🏢 Diagnóstico general', [
        linea('ok', `${campos} campo(s), ${(s.lotes || []).length} lotes, ${num(ha)} ha · ${(s.maquinarias || []).length} equipos · ${(s.empleados || []).length} empleados`),
        ...(veDato('plata') ? resumenDiario(hoyFecha).lineas.slice(0, 1) : []),
        linea('ok', `Plan de IA: *${NOMBRE_PLAN[plan()]}* · ${capacidades().filter((c) => c.habilitada).length} de ${CAPACIDADES.length} funciones habilitadas para tu usuario`),
      ]);
    }

    // ─── Consultas en texto libre (panel, nota de voz, WhatsApp) ───────────────────────────
    const RUTAS = [
      { id: 'prescripcion', patron: /\b(prescripci|dosis variable|dosis por ambiente|cuanta semilla|cuanto fertiliz)/ },
      { id: 'zonificacion', patron: /\b(zonific|ambientes?\b|zonas?\b)/ },
      { id: 'comparativa', patron: /\b(compar\w*|establecimientos|entre campos|cada campo|que campo)/ },
      { id: 'costosLote', patron: /\b(costos? por lote|lote mas caro|lotes mas caros|costo por hectarea|costo por ha)\b/ },
      { id: 'mantenimiento', patron: /\b(mantenimiento|service|services|horas del|tractor|maquina|maquinas|equipo|equipos|repar)/ },
      { id: 'stock', patron: /\b(stock|insumos?|se acaba|se acaban|por acabar|faltante|faltar|reponer|quiebre|inventario)\b/ },
      { id: 'resumen', patron: /\b(resumen|como estamos|como esta todo|que paso hoy|novedades|que tengo que (revisar|hacer)|que deberia revisar)/ },
      { id: 'alertas', patron: /\b(alerta|alertas|desvio|desvios|riesgo|riesgos|problema|problemas|fuera de lo normal)\b/ },
      { id: 'rinde', patron: /\b(rinde|rindes|rindio|rendimiento|cosecha)\b/ },
    ];

    function rindeConsulta(t) {
      const lista = rindes();
      const cultivo = [...new Set(lista.map((r) => r.cultivo))].find((c) => t.includes(normalizar(c)));
      const filtro = cultivo ? lista.filter((r) => r.cultivo === cultivo) : lista;
      if (!filtro.length) return resultado('🌾 Rindes', [linea('ok', cultivo ? `No hay cosechas de ${cultivo} cargadas.` : 'No hay cosechas cargadas.')]);
      return resultado(`🌾 Rindes${cultivo ? ` de ${cultivo}` : ''}`, filtro.sort((a, b) => b.kgHa - a.kgHa).map((r) => linea('ok', `• *${nombreLote(r.lote)}* · ${r.cultivo}: *${num(r.kgHa)} kg/ha* (${fechaCorta(r.fecha)})`)));
    }

    function ayuda() {
      const lineas = [linea('ok', 'Probá preguntarme, por ejemplo:'), linea('ok', '• 📊 _"¿Cuánto gasté este mes?"_ · 💰 _"¿Cuánta plata hay en caja y bancos?"_'), linea('ok', '• 🌾 _"¿Cómo viene el margen del lote 1?"_ · _"¿Qué rinde tuvo la soja?"_')];
      capacidades().forEach((c) => lineas.push(linea(c.habilitada ? 'ok' : 'warn', `• ${c.icono} ${c.titulo}${c.habilitada ? '' : c.porRol ? ' 🔒 _sin acceso para tu usuario_' : ` 🔒 _versión ${c.requiere}_`}`)));
      return resultado('🤔 No entendí la consulta', lineas);
    }

    const responder = (pregunta, opciones = {}) => conRol(opciones, () => responderConRol(pregunta, opciones.hoy || new Date()));
    function responderConRol(pregunta, hoy) {
      const t = normalizar(pregunta);
      if (!t.trim()) return ayuda();
      const ruta = RUTAS.find((r) => r.patron.test(t));
      if (ruta && ruta.id === 'rinde' && !/\b(margen|gast|costo)/.test(t)) return ve(MODULOS_REQUERIDOS.rinde) ? rindeConsulta(t) : sinAcceso('🌾 Rindes');
      if (ruta && ruta.id !== 'rinde') {
        // "stock" en Básica: lo que está bajo el mínimo; la proyección es de Profesional.
        if (ruta.id === 'stock' && !puede('stock')) {
          if (!ve(MODULOS_REQUERIDOS.stock)) return sinAcceso('📦 Stock');
          const bajos = alertasDesvios().lineas.filter((l) => l.texto.startsWith('📦'));
          return resultado('📦 Stock', bajos.length ? bajos : [linea('ok', 'Todos los insumos están sobre el stock mínimo.')], { nota: bloqueado('stock').texto });
        }
        return ejecutarConRol(ruta.id, hoy);
      }
      // Gastos, caja, margen y movimientos (motor de consultas): mismo control por rol.
      const intencion = d.enrutar ? d.enrutar(pregunta, hoy).intencion : null;
      if (intencion && !ve(MODULOS_REQUERIDOS[intencion]))
        return sinAcceso({ caja_bancos: '💰 Caja y Bancos', gastos_periodo: '📊 Gastos', margen_lote: '🌾 Margen', movimientos_lote: '📍 Movimientos del lote' }[intencion]);
      const r = d.motor.responderConsulta(pregunta, { hoy });
      if (r.tipo === 'aclaracion' && r.ruta.motivo === 'no_entendida') return ayuda();
      return { titulo: '', lineas: [], texto: r.mensaje, consulta: r };
    }

    // Habilitada = la incluye el plan y el rol puede ver sus datos.
    function capacidades(opciones) {
      return conRol(opciones, () => CAPACIDADES.map((c) => {
        const porPlan = puede(c.id);
        const porRol = !ve(MODULOS_REQUERIDOS[c.id]);
        return { ...c, habilitada: porPlan && !porRol, porRol: porPlan && porRol, requiere: planMinimo(c.nivel) };
      }));
    }

    return { plan, puede, capacidades, ejecutar, analizar, responder, resumenDiario, alertasDesvios, proyeccionStock, costosPorLote, mantenimientoPorHoras, zonificacion, prescripcion, comparativaEstablecimientos, ambientes };
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

  return { NIVEL_PLAN, CAPACIDADES, FACTOR_AMBIENTE, UMBRAL, crearAsistente, leerDosis, aHtml, escapar, montarCapacidades, insightsHtml };
});
