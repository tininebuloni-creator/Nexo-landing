/* PampaIA de PampaGanaderia: las capacidades de cada versión, calculadas con los datos del ERP.
 *
 *   SMALL · Básica       consultas sobre los datos, resumen del día, alertas de desvíos, existencias
 *   MEDIUM · Profesional proyección de alimento e insumos, costo por cabeza, equipos y mantenimiento
 *   LARGE · Premium      rentabilidad por categoría, cumplimiento SENASA y fiscal, caja a 90 días
 *
 * Ningún número sale de un modelo de lenguaje: todo se calcula con los registros cargados (con los
 * mismos cálculos de Costos, Rentabilidad y Control sanitario) y, si falta historial, se dice. El
 * texto usa el formato de WhatsApp (*negrita*, _cursiva_) para que el mismo resultado sirva en el
 * panel, en la nota de voz y en el WhatsApp.
 *
 * Mismo archivo en la raíz (escritorio) y en public/ (web/PWA). UMD: navegador y Node.
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
    { id: 'resumen', nivel: 1, icono: '📋', titulo: 'Resumen del día', detalle: 'Plata, movimientos de hacienda de hoy y ayer, cheques, faltantes y alertas sanitarias.' },
    { id: 'alertas', nivel: 1, icono: '⚠️', titulo: 'Alertas de desvíos', detalle: 'Precio de venta por categoría, mortandad, stock bajo el mínimo e incumplimientos SENASA.' },
    { id: 'existencias', nivel: 1, icono: '🐄', titulo: 'Existencias por categoría', detalle: 'Cabezas de cada categoría, altas y bajas del mes y animales con RFID.' },
    { id: 'stock', nivel: 2, icono: '🌾', titulo: 'Proyección de alimento e insumos', detalle: 'En cuántos días se acaba cada alimento o insumo según el consumo real.' },
    { id: 'costoCabeza', nivel: 2, icono: '🧮', titulo: 'Costo por cabeza', detalle: 'Costo, venta y margen por cabeza vendida de cada categoría (12 meses).' },
    { id: 'mantenimiento', nivel: 2, icono: '🔧', titulo: 'Equipos y mantenimiento', detalle: 'Órdenes pendientes, gasto en reparaciones y combustible por equipo.' },
    { id: 'rentabilidad', nivel: 3, icono: '📈', titulo: 'Rentabilidad por categoría', detalle: 'Ingreso, costo y margen de cada categoría y en qué se va la plata.' },
    { id: 'cumplimiento', nivel: 3, icono: '🩺', titulo: 'Cumplimiento SENASA, fiscal y ambiente', detalle: 'Sanidad, DUT sin cerrar, boletos de marca, saldo de IVA y residuos.' },
    { id: 'caja90', nivel: 3, icono: '💵', titulo: 'Caja a 90 días', detalle: 'Saldo proyectado con cheques, cuotas de créditos y sueldos.' },
  ];

  const UMBRAL = { precio: 0.1, mortandad: 1.5, diasStock: 30, ventanaConsumoDias: 90 };
  const CATEGORIAS = ['Terneros', 'Novillos', 'Vaquillonas', 'Toros', 'Vacas'];

  // Módulos que tiene que poder abrir el usuario para ver cada respuesta (alcanza con uno).
  const MODULOS_REQUERIDOS = {
    existencias: ['hacienda'],
    stock: ['inventario', 'alimentacion'],
    costoCabeza: ['costos', 'rentabilidad'],
    mantenimiento: ['mantenimiento', 'equipos'],
    rentabilidad: ['rentabilidad'],
    cumplimiento: ['fiscal', 'hacienda'],
    caja90: ['flujo', 'caja', 'bancos'],
    plata: ['caja', 'bancos'],
    gastos: ['costos'],
    ventas: ['hacienda'],
    cheques: ['cheques', 'caja', 'bancos'],
    sanidad: ['hacienda'],
  };
  const MODULOS_DATO = {
    plata: ['caja', 'bancos'],
    costos: ['costos'],
    cheques: ['cheques', 'caja', 'bancos'],
    stock: ['inventario', 'alimentacion'],
    services: ['mantenimiento', 'equipos'],
    hacienda: ['hacienda'],
    fiscal: ['fiscal'],
    ambiente: ['residuos'],
  };

  const pesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
  const num = (n, dec = 0) => (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: dec });
  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const iso = (fecha) => new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const sumarDias = (fechaIso, dias) => { const d = new Date(`${fechaIso}T12:00:00`); d.setDate(d.getDate() + dias); return iso(d); };
  const fechaCorta = (f) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : ''; };
  // "2026-09-29", "29/09/2026" o "29/9/2026 10:00" → "2026-09-29"
  function fechaIso(f) {
    if (!f) return '';
    const t = String(f).trim();
    const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
  }
  // Categoría de hacienda normalizada ("novillo", "Novillos" → "Novillos").
  function categoria(c) {
    const t = normalizar(c).replace(/s$/, '');
    return CATEGORIAS.find((x) => t && normalizar(x).startsWith(t.slice(0, 5))) || (c ? String(c) : 'Sin categoría');
  }

  // Pregunta o parte: "¿cuánto gasté?" pregunta; "gasté 80 mil en gasoil" o "vacuné 40 terneros"
  // cuentan algo que se hizo (mismo criterio que PampaAgro).
  const PALABRAS_PREGUNTA = /^(cuanto|cuanta|cuantos|cuantas|que|como|cual|cuales|donde|cuando|decime|pasame|mostrame|mandame|dame|contame|necesito saber|quiero saber)\b/;
  function esConsulta(texto) {
    const crudo = String(texto || '');
    const t = normalizar(crudo).trim();
    if (!t) return false;
    if (/[¿?]/.test(crudo) || PALABRAS_PREGUNTA.test(t)) return true;
    return /\b(margen|rentabilidad|saldo|saldos|reporte|resumen|existencias)\b/.test(t) &&
      !/\b(pague|pagamos|compre|compramos|cargue|cargamos|vacune|vacunamos|vendi|vendimos|cobre|cobramos|gaste|gastamos|nacieron|murio|murieron)\b/.test(t);
  }

  /**
   * @param {object} d  { estado(), plan(), rol(), acceso(rol, modulo), nombreRol(rol), parseMonto,
   *                      costosDelPeriodo(desde, hasta), rangoDePeriodo(p), costoPorCategoriaVendida(desde, hasta, items),
   *                      evaluarSanidad(), calcularCostoTotalEmpleados(fecha) }
   */
  function crearAsistente(d) {
    const numero = (v) => { const n = d.parseMonto(v); return Number.isFinite(n) ? n : 0; };
    const plan = () => (NIVEL_PLAN[d.plan()] ? d.plan() : 'basica');
    const capacidad = (id) => CAPACIDADES.find((c) => c.id === id);
    const planMinimo = (nivel) => ({ 1: 'Básica', 2: 'Profesional', 3: 'Premium' })[nivel];
    const puede = (id) => NIVEL_PLAN[plan()] >= capacidad(id).nivel;
    // Rol de quien pregunta: el de la sesión, o el de quien recibe el WhatsApp / manda el audio.
    let rolConsulta;
    const rolActual = () => (rolConsulta !== undefined ? rolConsulta : d.rol ? d.rol() : null);
    const ve = (modulos) => !d.acceso || rolActual() === null || !modulos || !modulos.length || modulos.some((m) => d.acceso(rolActual(), m));
    const veDato = (dato) => ve(MODULOS_DATO[dato]);
    function conRol(opciones, fn) {
      const previo = rolConsulta;
      if (opciones && opciones.rol !== undefined) rolConsulta = opciones.rol;
      try { return fn(); } finally { rolConsulta = previo; }
    }
    // Nombre del equipo (en Mantenimiento y Combustible se guarda el código).
    const nombreEquipo = (ref) => { const e = (d.estado().equipos || []).find((x) => x.codigo === ref || x.equipo === ref); return (e && (e.equipo || e.codigo)) || ref || 'Equipo'; };
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
    function saldos() {
      const s = d.estado();
      const neto = (lista) => (lista || []).reduce((t, m) => t + (m.tipo === 'Ingreso' ? numero(m.importe) : m.tipo === 'Egreso' ? -numero(m.importe) : 0), 0);
      const iniciales = {};
      (s.bancosLista || []).forEach((c) => { iniciales[c.nombre] = numero(c.saldoInicial); });
      Object.entries(s.saldosIniciales || {}).forEach(([banco, v]) => { if (!iniciales[banco]) iniciales[banco] = numero(v); });
      return { caja: neto(s.caja), bancos: Object.values(iniciales).reduce((t, v) => t + v, 0) + neto(s.bancos) };
    }
    const pendiente = (c) => !/cobrad|pagad|rechaz|anulad|depositad/i.test(String(c.estado || ''));

    // Existencias por categoría: +Nacimiento/Compra, −Venta/Muerte/Faena (igual que Hacienda).
    function existencias(hasta) {
      const cab = Object.fromEntries(CATEGORIAS.map((c) => [c, 0]));
      (d.estado().hacienda || []).forEach((m) => {
        const f = fechaIso(m.fecha);
        if (hasta && f && f > hasta) return;
        const cant = parseInt(m.cantidad, 10) || 0;
        const cat = categoria(m.categoria);
        if (!(cat in cab)) cab[cat] = 0;
        if (m.tipo === 'Nacimiento' || m.tipo === 'Compra') cab[cat] += cant;
        else if (['Venta', 'Muerte', 'Faena'].includes(m.tipo)) cab[cat] -= cant;
      });
      return cab;
    }
    const totalCabezas = (cab) => Object.values(cab).reduce((t, v) => t + v, 0);

    function stockBajoMinimo() {
      return (d.estado().inventario || [])
        .filter((i) => Number(i.stock) <= Number(i.stockMinimo || 0) && (Number(i.stockMinimo) > 0 || /aliment|insumo|combust|sanidad|ganader/i.test(`${i.categoria || ''}`)))
        .map((i) => ({ producto: i.producto || i.codigo, stock: Number(i.stock) || 0, minimo: Number(i.stockMinimo) || 0, unidad: i.unidad || '' }));
    }

    function costosDelDia(dia) {
      return d.costosDelPeriodo(dia, dia).filter((i) => i.rubro !== 'Agrícola' && i.origen !== 'RRHH').reduce((t, i) => t + i.importe, 0);
    }

    // ─── Básica ──────────────────────────────────────────────────────────────────────────
    function resumenDiario(hoyFecha = new Date()) {
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const ayer = sumarDias(hoy, -1);
      const lineas = [];
      const plata = veDato('plata');
      if (plata) {
        const { caja, bancos } = saldos();
        lineas.push(linea('ok', `💰 Caja *${pesos(caja)}* · Bancos *${pesos(bancos)}*`));
      }
      for (const [dia, etiqueta] of [[hoy, 'Hoy'], [ayer, 'Ayer']]) {
        const partes = [];
        if (plata) {
          const movs = [...(s.caja || []), ...(s.bancos || [])].filter((m) => fechaIso(m.fecha) === dia);
          partes.push(`entró ${pesos(movs.filter((m) => m.tipo === 'Ingreso').reduce((t, m) => t + numero(m.importe), 0))}, salió ${pesos(movs.filter((m) => m.tipo === 'Egreso').reduce((t, m) => t + numero(m.importe), 0))}`);
        }
        if (veDato('costos')) partes.push(`costos ${pesos(costosDelDia(dia))}`);
        if (veDato('hacienda')) {
          const mov = (s.hacienda || []).filter((m) => fechaIso(m.fecha) === dia);
          const porTipo = {};
          mov.forEach((m) => { porTipo[m.tipo] = (porTipo[m.tipo] || 0) + (parseInt(m.cantidad, 10) || 0); });
          if (Object.keys(porTipo).length) partes.push(`🐄 ${Object.entries(porTipo).map(([t, c]) => `${t.toLowerCase()} ${c}`).join(', ')}`);
        }
        if (partes.length) lineas.push(linea('ok', `• *${etiqueta}:* ${partes.join(' · ')}`));
      }
      const informativas = lineas.length;
      const semana = sumarDias(hoy, 7);
      if (veDato('cheques')) {
        const aPagar = (s.chequesCubrir || []).filter((c) => pendiente(c) && fechaIso(c.vencimiento) && fechaIso(c.vencimiento) <= semana);
        if (aPagar.length) lineas.push(linea(aPagar.some((c) => fechaIso(c.vencimiento) < hoy) ? 'risk' : 'warn', `• 🧾 Cheques a pagar en 7 días: ${aPagar.length} por ${pesos(aPagar.reduce((t, c) => t + numero(c.importe), 0))}`));
        const aCobrar = (s.chequesCobrar || []).filter((c) => pendiente(c) && fechaIso(c.vencimiento) && fechaIso(c.vencimiento) <= semana);
        if (aCobrar.length) lineas.push(linea('ok', `• 🧾 Cheques a cobrar en 7 días: ${aCobrar.length} por ${pesos(aCobrar.reduce((t, c) => t + numero(c.importe), 0))}`));
      }
      const bajos = veDato('stock') ? stockBajoMinimo() : [];
      if (bajos.length) lineas.push(linea('warn', `• 🌾 Bajo el mínimo: ${bajos.map((b) => b.producto).join(', ')}`));
      if (veDato('hacienda') && d.evaluarSanidad) {
        const san = d.evaluarSanidad();
        const rojas = san.alertas.filter((a) => a.nivel === 'rojo');
        if (rojas.length) lineas.push(linea('risk', `• 🩺 SENASA: ${rojas.map((a) => a.texto).join(' ')}`));
        if (san.carencias && san.carencias.length) lineas.push(linea('warn', `• 💉 ${san.carencias.length} animal(es) en carencia: no enviar a faena.`));
      }
      if (veDato('services')) {
        const pend = (s.mantenimiento || []).filter((o) => o.estado === 'Pendiente' || o.estado === 'En curso');
        if (pend.length) lineas.push(linea('warn', `• 🔧 Órdenes de mantenimiento abiertas: ${pend.map((o) => nombreEquipo(o.equipo) || o.numero).join(', ')}`));
      }
      if (lineas.length === informativas) lineas.push(linea('ok', '• Sin vencimientos, faltantes ni alertas pendientes.'));
      return resultado(`📋 Resumen del día · ${fechaCorta(hoy)}`, lineas);
    }

    // Precio por cabeza de cada venta ($ del movimiento ÷ cabezas).
    function ventasPorCategoria() {
      const por = {};
      (d.estado().hacienda || []).filter((m) => m.tipo === 'Venta' && numero(m.valor) > 0 && (parseInt(m.cantidad, 10) || 0) > 0).forEach((m) => {
        (por[categoria(m.categoria)] ||= []).push({ fecha: fechaIso(m.fecha), porCabeza: numero(m.valor) / parseInt(m.cantidad, 10), cabezas: parseInt(m.cantidad, 10), valor: numero(m.valor) });
      });
      Object.values(por).forEach((l) => l.sort((a, b) => a.fecha.localeCompare(b.fecha)));
      return por;
    }

    function alertasDesvios(hoyFecha = new Date()) {
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const lineas = [];
      if (veDato('stock')) stockBajoMinimo().forEach((b) =>
        lineas.push(linea(b.stock <= 0 ? 'risk' : 'warn', b.stock <= 0 ? `🌾 *${b.producto}*: *sin stock*` : `🌾 *${b.producto}*: quedan ${num(b.stock)} ${b.unidad} (mínimo ${num(b.minimo)})`)));
      let sinBase = true;
      if (veDato('hacienda')) {
        Object.entries(ventasPorCategoria()).forEach(([cat, ventas]) => {
          if (ventas.length < 2) return;
          sinBase = false;
          const ultima = ventas[ventas.length - 1];
          const previas = ventas.slice(0, -1);
          const promedio = previas.reduce((t, v) => t + v.porCabeza, 0) / previas.length;
          const desvio = (ultima.porCabeza - promedio) / promedio;
          if (Math.abs(desvio) >= UMBRAL.precio)
            lineas.push(linea(desvio < 0 ? 'warn' : 'ok', `💲 *${cat}*: la última venta (${fechaCorta(ultima.fecha)}) fue a ${pesos(ultima.porCabeza)} por cabeza, ${desvio < 0 ? '' : '+'}${Math.round(desvio * 100)} % contra el promedio de tus ventas anteriores (${pesos(promedio)})`));
        });
        // Mortandad de los últimos 30 días contra el promedio mensual de los 12 meses anteriores.
        const muertes = (desde, hasta) => (s.hacienda || []).filter((m) => m.tipo === 'Muerte' && fechaIso(m.fecha) > desde && fechaIso(m.fecha) <= hasta).reduce((t, m) => t + (parseInt(m.cantidad, 10) || 0), 0);
        const recientes = muertes(sumarDias(hoy, -30), hoy);
        const previasAnio = muertes(sumarDias(hoy, -395), sumarDias(hoy, -30));
        const promedioMes = previasAnio / 12;
        const stock = totalCabezas(existencias(hoy));
        if (recientes > 0 && recientes > Math.max(1, promedioMes * UMBRAL.mortandad))
          lineas.push(linea('risk', `💀 Mortandad: ${recientes} muerte(s) en los últimos 30 días${promedioMes ? ` contra un promedio de ${num(promedioMes, 1)} por mes` : ''}${stock > 0 ? ` (${num((recientes / (stock + recientes)) * 100, 1)} % del rodeo)` : ''}. Revisá la causa con el veterinario.`));
        if (d.evaluarSanidad) d.evaluarSanidad().alertas.filter((a) => a.nivel === 'rojo').forEach((a) => lineas.push(linea('risk', `🩺 ${a.texto}`)));
      }
      if (!lineas.length) lineas.push(linea('ok', 'Sin desvíos: stock sobre los mínimos, precios y mortandad dentro de lo normal y sanidad al día.'));
      if (sinBase && veDato('hacienda')) lineas.push(linea('ok', '_Para comparar precios hacen falta al menos dos ventas de la misma categoría._'));
      return resultado('⚠️ Alertas de desvíos', lineas);
    }

    function existenciasPorCategoria(hoyFecha = new Date()) {
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const cab = existencias(hoy);
      const mes = hoy.slice(0, 7);
      const delMes = (tipos) => (s.hacienda || []).filter((m) => tipos.includes(m.tipo) && fechaIso(m.fecha).slice(0, 7) === mes).reduce((t, m) => t + (parseInt(m.cantidad, 10) || 0), 0);
      const lineas = Object.entries(cab).filter(([, v]) => v !== 0).map(([c, v]) => linea(v < 0 ? 'risk' : 'ok', `• *${c}*: ${num(v)} cabezas${v < 0 ? ' _(salieron más de las que entraron: revisá los movimientos)_' : ''}`));
      if (!lineas.length) lineas.push(linea('ok', 'No hay movimientos de hacienda cargados.'));
      lineas.unshift(linea('ok', `🐄 Total: *${num(totalCabezas(cab))} cabezas*`));
      lineas.push(linea('ok', `Este mes: +${delMes(['Nacimiento'])} nacimientos · +${delMes(['Compra'])} compras · −${delMes(['Venta'])} ventas · −${delMes(['Muerte'])} muertes`));
      const trazados = s.animalesTrazabilidad || [];
      if (trazados.length) {
        const conRfid = trazados.filter((a) => /^\d{15}$/.test(String(a.rfidTag || '').replace(/\s+/g, ''))).length;
        lineas.push(linea(conRfid < trazados.length ? 'warn' : 'ok', `🆔 ${conRfid} de ${trazados.length} animales trazados con RFID oficial de 15 dígitos.`));
      }
      return resultado('🐄 Existencias por categoría', lineas, { datos: cab });
    }

    // ─── Profesional ─────────────────────────────────────────────────────────────────────
    function proyeccionStock(hoyFecha = new Date()) {
      if (!puede('stock')) return bloqueado('stock');
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const desde = sumarDias(hoy, -UMBRAL.ventanaConsumoDias);
      const consumo = {};
      // La alimentación y los consumos dejan su salida en Movimientos de stock: esa es la fuente.
      (s.movimientoStock || []).forEach((m) => {
        const f = fechaIso(m.fecha);
        if (m.tipo !== 'Salida' || !f || f < desde || f > hoy || /venta|devoluc/i.test(m.motivo || '')) return;
        consumo[m.producto] = (consumo[m.producto] || 0) + numero(m.cantidad);
      });
      const filas = (s.inventario || [])
        .map((i) => {
          const usado = consumo[i.codigo] || consumo[i.producto] || 0;
          const porDia = usado / UMBRAL.ventanaConsumoDias;
          const stock = Number(i.stock) || 0;
          const minimo = Number(i.stockMinimo) || 0;
          return { producto: i.producto || i.codigo, unidad: i.unidad || '', stock, porDia, diasAlMinimo: porDia > 0 ? Math.max(0, (stock - minimo) / porDia) : null, diasACero: porDia > 0 ? stock / porDia : null };
        })
        .filter((f) => f.porDia > 0)
        .sort((a, b) => a.diasAlMinimo - b.diasAlMinimo);
      const lineas = filas.map((f) => {
        const nivel = f.diasAlMinimo <= 0 ? 'risk' : f.diasAlMinimo <= UMBRAL.diasStock ? 'warn' : 'ok';
        const cuando = f.diasAlMinimo <= 0 ? '*ya está bajo el mínimo*' : `llega al mínimo en *${Math.round(f.diasAlMinimo)} días* (${fechaCorta(sumarDias(hoy, Math.round(f.diasAlMinimo)))})`;
        return linea(nivel, `🌾 *${f.producto}*: ${num(f.stock)} ${f.unidad}, se usan ${num(f.porDia, 1)} ${f.unidad}/día → ${cuando}; se acaba en ${Math.round(f.diasACero)} días`);
      });
      if (!filas.length) lineas.push(linea('ok', `No hay consumos de alimento ni de insumos en los últimos ${UMBRAL.ventanaConsumoDias} días para proyectar.`));
      return resultado('🌾 Proyección de alimento e insumos', lineas, { datos: filas });
    }

    function costoPorCabeza(hoyFecha = new Date()) {
      if (!puede('costoCabeza')) return bloqueado('costoCabeza');
      const { desde, hasta } = d.rangoDePeriodo('12m');
      const items = d.costosDelPeriodo(desde, hasta).filter((i) => i.rubro !== 'Agrícola');
      const { filas, total, cabezasTotal } = d.costoPorCategoriaVendida(desde, hasta, items);
      const lineas = filas.map((f) => linea(f.margen < 0 ? 'risk' : 'ok', `• *${f.cat}* (${num(f.cabezas)} vendidas): costo ${pesos(f.costo / f.cabezas)} · venta ${pesos(f.ventas / f.cabezas)} · margen *${pesos(f.margen / f.cabezas)}* por cabeza`));
      if (!filas.length) lineas.push(linea('ok', 'No hay ventas de hacienda en los últimos 12 meses para calcular el costo por cabeza.'));
      else lineas.unshift(linea('ok', `Costo ganadero de 12 meses: *${pesos(total)}* · ${num(cabezasTotal)} cabezas vendidas`));
      lineas.push(linea('ok', '_La compra de hacienda va a su categoría, el alimento al que la consumió y el resto por cabezas vendidas._'));
      return resultado('🧮 Costo por cabeza (12 meses)', lineas, { datos: filas });
    }

    function equiposYMantenimiento(hoyFecha = new Date()) {
      if (!puede('mantenimiento')) return bloqueado('mantenimiento');
      const s = d.estado();
      const desde = sumarDias(iso(hoyFecha), -365);
      const lineas = [];
      const abiertas = (s.mantenimiento || []).filter((o) => o.estado === 'Pendiente' || o.estado === 'En curso');
      abiertas.forEach((o) => lineas.push(linea(o.estado === 'Pendiente' ? 'warn' : 'ok', `🔧 *${nombreEquipo(o.equipo)}* · ${o.tipo || ''} ${o.descripcion || ''}: ${o.estado.toLowerCase()} (${pesos(numero(o.costo))})`)));
      (s.equipos || []).forEach((e) => {
        const es = (r) => r.equipo === e.codigo || r.equipo === e.equipo;
        const gasto = (s.mantenimiento || []).filter((o) => es(o) && o.estado === 'Completado' && fechaIso(o.fecha) >= desde).reduce((t, o) => t + numero(o.costo), 0);
        const cargas = (s.cargacombustible || []).filter((c) => es(c) && fechaIso(c.fecha) >= desde);
        const litros = cargas.reduce((t, c) => t + numero(c.cantidad), 0);
        const combustible = cargas.reduce((t, c) => t + (numero(c.costoTotal) || numero(c.cantidad) * numero(c.costoUnitario)), 0);
        lineas.push(linea('ok', `🚜 *${e.equipo || e.codigo}*: reparaciones ${pesos(gasto)} · combustible ${num(litros)} L (${pesos(combustible)}) en 12 meses`));
      });
      if (!lineas.length) lineas.push(linea('ok', 'No hay equipos ni órdenes de mantenimiento cargadas.'));
      return resultado('🔧 Equipos y mantenimiento', lineas);
    }

    // ─── Premium ─────────────────────────────────────────────────────────────────────────
    function rentabilidadPorCategoria() {
      if (!puede('rentabilidad')) return bloqueado('rentabilidad');
      const { desde, hasta } = d.rangoDePeriodo('12m');
      const items = d.costosDelPeriodo(desde, hasta).filter((i) => i.rubro !== 'Agrícola');
      const { filas, total } = d.costoPorCategoriaVendida(desde, hasta, items);
      const ingreso = filas.reduce((t, f) => t + f.ventas, 0);
      const margen = ingreso - total;
      const lineas = [linea(margen < 0 ? 'risk' : 'ok', `Ingresos *${pesos(ingreso)}* · Costo *${pesos(total)}* · Margen *${pesos(margen)}*${ingreso ? ` (${num((margen / ingreso) * 100, 1)} %)` : ''}`)];
      filas.forEach((f) => lineas.push(linea(f.margen < 0 ? 'risk' : 'ok', `• *${f.cat}*: ventas ${pesos(f.ventas)} · costo ${pesos(f.costo)} · margen ${pesos(f.margen)}${f.ventas ? ` (${num((f.margen / f.ventas) * 100, 1)} %)` : ''}`)));
      const grupos = {};
      items.forEach((i) => { grupos[i.grupo] = (grupos[i.grupo] || 0) + i.importe; });
      const orden = Object.entries(grupos).sort((a, b) => b[1] - a[1]);
      if (orden.length) lineas.push(linea('ok', `En qué se va la plata: ${orden.slice(0, 4).map(([g, v]) => `${g} ${total ? Math.round((v / total) * 100) : 0} %`).join(' · ')}`));
      const perdida = filas.filter((f) => f.margen < 0);
      if (perdida.length) lineas.push(linea('warn', `Categorías que pierden plata: ${perdida.map((f) => f.cat).join(', ')}. Revisá precio de venta y alimento asignado.`));
      if (!filas.length) lineas.push(linea('ok', 'Sin ventas de hacienda en los últimos 12 meses.'));
      return resultado('📈 Rentabilidad por categoría (12 meses)', lineas, { datos: filas });
    }

    function cumplimiento(hoyFecha = new Date()) {
      if (!puede('cumplimiento')) return bloqueado('cumplimiento');
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const lineas = [];
      if (veDato('hacienda') && d.evaluarSanidad) {
        const san = d.evaluarSanidad();
        san.alertas.forEach((a) => lineas.push(linea(a.nivel === 'rojo' ? 'risk' : 'warn', `🩺 ${a.texto}`)));
        if (!san.alertas.length) lineas.push(linea('ok', '🩺 Sanidad SENASA al día.'));
      }
      if (veDato('fiscal')) {
        const cola = s.fiscalDutQueue || [];
        const sinNumero = cola.filter((x) => x.estado === 'Listo para SIGSA');
        const pend = cola.filter((x) => x.estado === 'Pendiente' || x.estado === 'Rechazado');
        const abiertos = cola.filter((x) => String(x.estado || '').startsWith('Emitido'));
        if (sinNumero.length) lineas.push(linea('warn', `🚚 ${sinNumero.length} DUT listos para SIGSA sin número oficial cargado.`));
        if (pend.length) lineas.push(linea('warn', `🚚 ${pend.length} DUT pendientes o rechazados en la cola.`));
        if (abiertos.length) lineas.push(linea('warn', `🚚 ${abiertos.length} DUT emitidos sin cerrar en destino.`));
        const boletos = (s.boletosMarca || []).filter((b) => fechaIso(b.fechaVencimiento) && fechaIso(b.fechaVencimiento) <= sumarDias(hoy, 30));
        boletos.forEach((b) => lineas.push(linea(fechaIso(b.fechaVencimiento) < hoy ? 'risk' : 'warn', `🔖 Boleto de marca ${b.nroBoleto || ''} ${fechaIso(b.fechaVencimiento) < hoy ? 'vencido' : 'vence'} el ${fechaCorta(fechaIso(b.fechaVencimiento))}`)));
        const mes = hoy.slice(0, 7);
        const comp = (s.comprobantesArca || []).filter((c) => fechaIso(c.fecha).slice(0, 7) === mes);
        const suma = (tipo, campo) => comp.filter((c) => c.tipo_fiscal === tipo || tipo === '*').reduce((t, c) => t + numero(c[campo]), 0);
        // Misma posición que la pantalla de Fiscal (con los saldos a favor de meses anteriores).
        const p = d.posicionIva ? d.posicionIva() : null;
        if (p) lineas.push(linea(p.aPagar > 0 ? 'warn' : 'ok', `🧾 IVA del mes: ${p.aPagar > 0 ? `*${pesos(p.aPagar)} a pagar*` : `${pesos(p.favorTecnico + p.favorLibre)} a favor`} (débito ${pesos(p.debito)} − crédito ${pesos(p.credito)}${p.favorTecnicoAnterior ? ` − a favor anterior ${pesos(p.favorTecnicoAnterior)}` : ''} − ret./perc. ${pesos(p.retIva + p.favorLibreAnterior)})`));
        else {
          const saldoIva = suma('DEBITO_FISCAL', 'iva') - suma('CREDITO_FISCAL', 'iva') - suma('*', 'ivaRetenido');
          lineas.push(linea(saldoIva > 0 ? 'warn' : 'ok', `🧾 IVA del mes: ${saldoIva >= 0 ? `*${pesos(saldoIva)} a pagar*` : `${pesos(-saldoIva)} a favor`} (débito − crédito − retenciones/percepciones)`));
        }
      }
      if (veDato('ambiente') && d.residuos) {
        const amb = d.residuos().alertas;
        amb.forEach((a) => lineas.push(linea(a.nivel === 'rojo' ? 'risk' : 'warn', `♻️ ${a.texto}`)));
        if (!amb.length) lineas.push(linea('ok', '♻️ Residuos y efluentes sin alertas.'));
      }
      if (!lineas.length) lineas.push(linea('ok', 'Sin datos de sanidad, fiscales ni ambientales para revisar.'));
      return resultado('🩺 Cumplimiento SENASA y fiscal', lineas);
    }

    function cajaA90Dias(hoyFecha = new Date()) {
      if (!puede('caja90')) return bloqueado('caja90');
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const { caja, bancos } = saldos();
      const tramos = [30, 60, 90].map((dias) => ({ dias, hasta: sumarDias(hoy, dias), entra: 0, sale: 0 }));
      const sumar = (fecha, importe, tipo) => {
        const f = fechaIso(fecha);
        if (!f || f < hoy) return;
        const tramo = tramos.find((t) => f <= t.hasta);
        if (tramo) tramo[tipo] += importe;
      };
      (s.chequesCobrar || []).filter(pendiente).forEach((c) => sumar(c.vencimiento, numero(c.importe), 'entra'));
      (s.chequesCubrir || []).filter(pendiente).forEach((c) => sumar(c.vencimiento, numero(c.importe), 'sale'));
      (s.creditos || []).forEach((cr) => (cr.cuotas || []).forEach((q) => {
        if ((Number(q.numero) || 0) < (Number(cr.cuotaActual) || 1)) return;
        sumar(q.fecha, numero(q.cuota), 'sale');
      }));
      const sueldo = d.calcularCostoTotalEmpleados ? d.calcularCostoTotalEmpleados(hoy) : 0;
      tramos.forEach((t) => { t.sale += sueldo; });
      let saldo = caja + bancos;
      const lineas = [linea('ok', `Hoy: Caja + Bancos *${pesos(saldo)}*`)];
      let primerNegativo = null;
      tramos.forEach((t) => {
        saldo += t.entra - t.sale;
        if (saldo < 0 && !primerNegativo) primerNegativo = t.dias;
        lineas.push(linea(saldo < 0 ? 'risk' : 'ok', `• A ${t.dias} días (${fechaCorta(t.hasta)}): *${pesos(saldo)}* · entra ${pesos(t.entra)} · sale ${pesos(t.sale)}`));
      });
      if (primerNegativo) lineas.push(linea('risk', `⚠️ La caja queda en negativo antes de los ${primerNegativo} días: adelantá cobros o reprogramá pagos.`));
      lineas.push(linea('ok', `_Incluye cheques pendientes, cuotas de créditos y sueldos + cargas (${pesos(sueldo)}/mes). No incluye ventas de hacienda futuras._`));
      return resultado('💵 Caja a 90 días', lineas);
    }

    const EJECUTAR = { resumen: resumenDiario, alertas: alertasDesvios, existencias: existenciasPorCategoria, stock: proyeccionStock, costoCabeza: costoPorCabeza, mantenimiento: equiposYMantenimiento, rentabilidad: rentabilidadPorCategoria, cumplimiento, caja90: cajaA90Dias };
    // Primero el plan (qué compró la empresa) y después el rol (qué puede ver este usuario).
    function ejecutarConRol(id, hoy) {
      if (!EJECUTAR[id]) throw new Error(`Capacidad desconocida: ${id}`);
      if (!puede(id)) return bloqueado(id);
      if (!ve(MODULOS_REQUERIDOS[id])) return sinAcceso(capacidad(id).titulo);
      return EJECUTAR[id](hoy || new Date());
    }
    const ejecutar = (id, hoy, opciones) => conRol(opciones, () => ejecutarConRol(id, hoy));

    // Botones del panel: diagnóstico por área.
    const analizar = (tipo, hoyFecha = new Date(), opciones) => conRol(opciones, () => analizarConRol(tipo, hoyFecha));
    function analizarConRol(tipo, hoyFecha) {
      const s = d.estado();
      if (tipo === 'finanzas') {
        if (!ve(MODULOS_REQUERIDOS.plata)) return sinAcceso('💰 Análisis financiero');
        const { caja, bancos } = saldos();
        const cobrar = (s.chequesCobrar || []).filter(pendiente).reduce((t, c) => t + numero(c.importe), 0);
        const pagar = (s.chequesCubrir || []).filter(pendiente).reduce((t, c) => t + numero(c.importe), 0);
        const { desde, hasta } = d.rangoDePeriodo('mes');
        const gastoMes = veDato('costos') ? d.costosDelPeriodo(desde, hasta).reduce((t, i) => t + i.importe, 0) : null;
        return resultado('💰 Análisis financiero', [
          linea('ok', `Caja *${pesos(caja)}* · Bancos *${pesos(bancos)}* · Total *${pesos(caja + bancos)}*`),
          linea(pagar > cobrar + caja + bancos ? 'risk' : pagar > cobrar ? 'warn' : 'ok', `Cheques por cobrar ${pesos(cobrar)} · por pagar ${pesos(pagar)}`),
          gastoMes === null ? null : linea('ok', `Costos del mes: ${pesos(gastoMes)}`),
        ].filter(Boolean));
      }
      if (tipo === 'operacion') {
        const cab = existencias(iso(hoyFecha));
        const bajos = stockBajoMinimo();
        const abiertas = (s.mantenimiento || []).filter((o) => o.estado === 'Pendiente' || o.estado === 'En curso');
        const lineas = [
          veDato('hacienda') ? linea('ok', `🐄 ${num(totalCabezas(cab))} cabezas · ${(s.alimentacion || []).length} registros de alimentación · ${(s.eventosSanitarios || []).length} eventos sanitarios`) : null,
          veDato('stock') ? linea(bajos.length ? 'warn' : 'ok', bajos.length ? `Bajo el mínimo: ${bajos.map((b) => b.producto).join(', ')}` : 'Alimentos e insumos sobre el stock mínimo.') : null,
          veDato('services') ? linea(abiertas.length ? 'warn' : 'ok', abiertas.length ? `Mantenimiento abierto: ${abiertas.map((o) => nombreEquipo(o.equipo) || o.numero).join(', ')}` : 'Sin órdenes de mantenimiento abiertas.') : null,
        ].filter(Boolean);
        return resultado('🚜 Análisis operativo', lineas.length ? lineas : [linea('warn', 'Tu usuario no tiene acceso a los módulos operativos.')]);
      }
      if (tipo === 'riesgos') return alertasDesvios(hoyFecha);
      const cab = existencias(iso(hoyFecha));
      return resultado('🏢 Diagnóstico general', [
        linea('ok', `${(s.campos || []).length} campo(s) · ${(s.lotes || []).length} lotes/potreros · ${veDato('hacienda') ? `${num(totalCabezas(cab))} cabezas · ` : ''}${(s.equipos || []).length} equipos · ${(s.empleados || []).length} empleados`),
        ...(veDato('plata') ? resumenDiario(hoyFecha).lineas.slice(0, 1) : []),
        linea('ok', `Plan de IA: *${NOMBRE_PLAN[plan()]}* · ${capacidades().filter((c) => c.habilitada).length} de ${CAPACIDADES.length} funciones habilitadas para tu usuario`),
      ]);
    }

    // ─── Consultas en texto libre (panel, nota de voz, WhatsApp) ───────────────────────────
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    // Período de la pregunta: hoy, ayer, esta semana, este mes (default), mes pasado, este año, "en agosto".
    function periodoDe(t, hoyFecha) {
      const hoy = iso(hoyFecha);
      if (/\bhoy\b/.test(t)) return { desde: hoy, hasta: hoy, nombre: 'hoy' };
      if (/\bayer\b/.test(t)) { const a = sumarDias(hoy, -1); return { desde: a, hasta: a, nombre: 'ayer' }; }
      if (/\bsemana\b/.test(t)) return { desde: sumarDias(hoy, -6), hasta: hoy, nombre: 'los últimos 7 días' };
      if (/mes pasado|mes anterior/.test(t)) {
        const [y, m] = hoy.split('-').map(Number);
        const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
        const fin = new Date(py, pm, 0).getDate();
        return { desde: `${py}-${String(pm).padStart(2, '0')}-01`, hasta: `${py}-${String(pm).padStart(2, '0')}-${fin}`, nombre: `${MESES[pm - 1]} ${py}` };
      }
      if (/\b(este ano|en el ano|anual|del ano)\b/.test(t)) return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy, nombre: `el año ${hoy.slice(0, 4)}` };
      const mes = MESES.findIndex((m) => t.includes(m));
      if (mes >= 0) {
        let y = Number(hoy.slice(0, 4));
        if (mes + 1 > Number(hoy.slice(5, 7))) y -= 1;
        const fin = new Date(y, mes + 1, 0).getDate();
        return { desde: `${y}-${String(mes + 1).padStart(2, '0')}-01`, hasta: `${y}-${String(mes + 1).padStart(2, '0')}-${fin}`, nombre: `${MESES[mes]} ${y}` };
      }
      return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy, nombre: 'este mes' };
    }

    function consultaGastos(t, hoyFecha) {
      if (!ve(MODULOS_REQUERIDOS.gastos)) return sinAcceso('📊 Gastos');
      const p = periodoDe(t, hoyFecha);
      const items = d.costosDelPeriodo(p.desde, p.hasta);
      const total = items.reduce((a, i) => a + i.importe, 0);
      const grupos = {};
      items.forEach((i) => { grupos[i.grupo] = (grupos[i.grupo] || 0) + i.importe; });
      const lineas = [linea('ok', `Total: *${pesos(total)}*`), ...Object.entries(grupos).sort((a, b) => b[1] - a[1]).map(([g, v]) => linea('ok', `• ${g}: ${pesos(v)}`))];
      if (!items.length) lineas.push(linea('ok', 'No hay costos registrados en ese período.'));
      return resultado(`📊 Gastos de ${p.nombre}`, lineas);
    }

    function consultaVentas(t, hoyFecha) {
      if (!ve(MODULOS_REQUERIDOS.ventas)) return sinAcceso('🐄 Ventas');
      const p = periodoDe(t, hoyFecha);
      const ventas = (d.estado().hacienda || []).filter((m) => m.tipo === 'Venta' && fechaIso(m.fecha) >= p.desde && fechaIso(m.fecha) <= p.hasta);
      const por = {};
      ventas.forEach((m) => { const c = categoria(m.categoria); por[c] ||= { cab: 0, valor: 0 }; por[c].cab += parseInt(m.cantidad, 10) || 0; por[c].valor += numero(m.valor); });
      const total = Object.values(por).reduce((a, x) => a + x.valor, 0);
      const lineas = [linea('ok', `Total: *${pesos(total)}* · ${num(Object.values(por).reduce((a, x) => a + x.cab, 0))} cabezas`), ...Object.entries(por).map(([c, x]) => linea('ok', `• ${c}: ${num(x.cab)} cabezas · ${pesos(x.valor)}${x.cab ? ` (${pesos(x.valor / x.cab)} por cabeza)` : ''}`))];
      if (!ventas.length) lineas.push(linea('ok', 'No hay ventas de hacienda en ese período.'));
      return resultado(`🐄 Ventas de ${p.nombre}`, lineas);
    }

    function consultaPlata() {
      if (!ve(MODULOS_REQUERIDOS.plata)) return sinAcceso('💰 Caja y Bancos');
      const { caja, bancos } = saldos();
      return resultado('💰 Caja y Bancos', [linea('ok', `Caja *${pesos(caja)}* · Bancos *${pesos(bancos)}* · Total *${pesos(caja + bancos)}*`)]);
    }

    function consultaCheques(hoyFecha) {
      if (!ve(MODULOS_REQUERIDOS.cheques)) return sinAcceso('🧾 Cheques');
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const fila = (c, sentido) => linea(fechaIso(c.vencimiento) && fechaIso(c.vencimiento) < hoy ? 'risk' : 'ok', `• ${sentido} ${c.numero || ''} · ${pesos(numero(c.importe))} · vence ${c.vencimiento || '-'}`);
      const cobrar = (s.chequesCobrar || []).filter(pendiente);
      const pagar = (s.chequesCubrir || []).filter(pendiente);
      const lineas = [...cobrar.map((c) => fila(c, 'A cobrar')), ...pagar.map((c) => fila(c, 'A pagar'))];
      if (!lineas.length) lineas.push(linea('ok', 'No hay cheques pendientes.'));
      return resultado('🧾 Cheques pendientes', lineas);
    }

    function consultaSanidad() {
      if (!ve(MODULOS_REQUERIDOS.sanidad)) return sinAcceso('🩺 Sanidad');
      const san = d.evaluarSanidad ? d.evaluarSanidad() : { alertas: [] };
      const lineas = san.alertas.map((a) => linea(a.nivel === 'rojo' ? 'risk' : 'warn', `• ${a.texto}`));
      if (!lineas.length) lineas.push(linea('ok', 'Sanidad al día: campañas, estatus y carencias sin alertas.'));
      return resultado('🩺 Sanidad SENASA', lineas);
    }

    const RUTAS = [
      { id: 'caja90', patron: /\b(caja a 90|proyecc\w* de caja|flujo de caja|me alcanza la plata|vamos a estar en rojo)/ },
      { id: 'rentabilidad', patron: /\b(rentabilidad|margen|gano|ganando|pierdo|perdiendo|negocio)\b/ },
      { id: 'costoCabeza', patron: /\b(costo por cabeza|cuanto me cuesta (cada|un) (animal|novillo|ternero|cabeza)|costo por animal)/ },
      { id: 'cumplimiento', patron: /\b(dut|dt-?e|sigsa|iva|arca|fiscal|boleto de marca|cumplimiento)/ },
      { id: 'mantenimiento', patron: /\b(mantenimiento|service|services|tractor|maquina|maquinas|equipo|equipos|repar|combustible|gasoil)/ },
      { id: 'stock', patron: /\b(alimento|alimentos|racion|raciones|balanceado|rollo|rollos|silo|maiz|stock|insumos?|se acaba|faltante|reponer|inventario)\b/ },
      { id: 'existencias', patron: /\b(cuantas cabezas|cuantos animales|cuantos (novillos|terneros|vaquillonas|toros|vacas)|existencias|rodeo|stock de hacienda|hacienda tengo)/ },
      { id: 'resumen', patron: /\b(resumen|como estamos|como esta todo|que paso hoy|novedades|que tengo que (revisar|hacer)|que deberia revisar)/ },
      { id: 'alertas', patron: /\b(alerta|alertas|desvio|desvios|riesgo|riesgos|problema|problemas|mortandad|murieron|muertes)\b/ },
    ];

    function ayuda() {
      const lineas = [linea('ok', 'Probá preguntarme, por ejemplo:'), linea('ok', '• 📊 _"¿Cuánto gasté este mes?"_ · 💰 _"¿Cuánta plata hay en caja y bancos?"_'), linea('ok', '• 🐄 _"¿Cuántas cabezas tengo?"_ · _"¿Cuánto vendí en agosto?"_ · 🩺 _"¿Cómo está la sanidad?"_')];
      capacidades().forEach((c) => lineas.push(linea(c.habilitada ? 'ok' : 'warn', `• ${c.icono} ${c.titulo}${c.habilitada ? '' : c.porRol ? ' 🔒 _sin acceso para tu usuario_' : ` 🔒 _versión ${c.requiere}_`}`)));
      return resultado('🤔 No entendí la consulta', lineas);
    }

    const responder = (pregunta, opciones = {}) => conRol(opciones, () => responderConRol(pregunta, opciones.hoy || new Date()));
    function responderConRol(pregunta, hoy) {
      const t = normalizar(pregunta);
      if (!t.trim()) return ayuda();
      if (/\b(gaste|gastamos|gasto|gastos|costos? de|cuanto se fue)\b/.test(t) && !/por cabeza/.test(t)) return consultaGastos(t, hoy);
      if (/\b(vendi|vendimos|ventas|cuanto se vendio)\b/.test(t)) return consultaVentas(t, hoy);
      if (/\b(caja|bancos?|plata|saldo|efectivo)\b/.test(t) && !/90|proyecc|flujo|alcanza/.test(t)) return consultaPlata();
      if (/\bcheques?\b/.test(t)) return consultaCheques(hoy);
      if (/\b(sanidad|vacuna\w*|aftosa|brucelosis|tuberculosis|garrapata|carencia|senasa|csm|rfid|caravana)\b/.test(t) && !/\b(dut|dt-?e|sigsa|iva)\b/.test(t)) return consultaSanidad();
      const ruta = RUTAS.find((r) => r.patron.test(t));
      if (ruta) {
        // "alimento/stock" en Básica: lo que está bajo el mínimo; la proyección es de Profesional.
        if (ruta.id === 'stock' && !puede('stock')) {
          if (!ve(MODULOS_REQUERIDOS.stock)) return sinAcceso('🌾 Stock');
          const bajos = stockBajoMinimo();
          return resultado('🌾 Stock', bajos.length ? bajos.map((b) => linea('warn', `🌾 *${b.producto}*: ${num(b.stock)} ${b.unidad} (mínimo ${num(b.minimo)})`)) : [linea('ok', 'Alimentos e insumos sobre el stock mínimo.')], { nota: bloqueado('stock').texto });
        }
        return ejecutarConRol(ruta.id, hoy);
      }
      return ayuda();
    }

    // Habilitada = la incluye el plan y el rol puede ver sus datos.
    function capacidades(opciones) {
      return conRol(opciones, () => CAPACIDADES.map((c) => {
        const porPlan = puede(c.id);
        const porRol = !ve(MODULOS_REQUERIDOS[c.id]);
        return { ...c, habilitada: porPlan && !porRol, porRol: porPlan && porRol, requiere: planMinimo(c.nivel) };
      }));
    }

    // Datos para el servidor de IA propio de Pampa (Flowise + Ollama): lo que el rol y la versión pueden ver,
    // calculado por la app. El servidor solo redacta la respuesta; nunca recibe datos que el usuario no ve.
    const quitarFormato = (t) => String(t || '').replace(/[*_]/g, '');
    function contextoParaIA(pregunta, opciones = {}) {
      return conRol(opciones, () => {
        const hoy = opciones.hoy || new Date();
        const util = (r) => r && !r.bloqueado && !/No entendí/.test(r.titulo || '');
        const directo = responderConRol(pregunta, hoy);
        const empresa = analizarConRol('empresa', hoy);
        // Si la pregunta coincide con una función, alcanza con esos datos (más rápido en un servidor sin GPU).
        if (util(directo)) return quitarFormato([directo.texto, util(empresa) ? empresa.texto : ''].filter(Boolean).join('\n\n')).slice(0, 12000);
        const partes = util(empresa) ? [empresa.texto] : [];
        CAPACIDADES.forEach((c) => {
          try { const r = ejecutarConRol(c.id, hoy); if (util(r) && !partes.includes(r.texto)) partes.push(r.texto); } catch (e) { /* una función sin datos no frena el resto */ }
        });
        const bloqueadas = CAPACIDADES.filter((c) => !puede(c.id)).map((c) => `${c.titulo} (versión ${planMinimo(c.nivel)})`);
        if (bloqueadas.length) partes.push(`Funciones no incluidas en la versión ${NOMBRE_PLAN[plan()]}: ${bloqueadas.join(', ')}.`);
        return quitarFormato(partes.join('\n\n')).slice(0, 12000);
      });
    }

    return { plan, puede, capacidades, ejecutar, analizar, responder, esConsulta, contextoParaIA, resumenDiario, alertasDesvios, existenciasPorCategoria, proyeccionStock, costoPorCabeza, equiposYMantenimiento, rentabilidadPorCategoria, cumplimiento, cajaA90Dias, existencias, saldos };
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

  return { NIVEL_PLAN, CAPACIDADES, UMBRAL, crearAsistente, esConsulta, aHtml, escapar, montarCapacidades, insightsHtml, fechaIso, categoria };
});
