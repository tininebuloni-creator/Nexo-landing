/* Motor de consultas por nota de voz (WhatsApp / "Compartir" / audio) de PampaAgropecuario.
 *
 * Regla de oro: la IA NO calcula nada. Solo transcribe el audio. A partir del texto:
 *   1. enrutarConsulta()   decide carril (agrícola / ganadero / mixto), intención, lote y período con
 *                          un diccionario RÍGIDO, antes de tocar los datos.
 *   2. crearMotorConsultas() calcula los números con las MISMAS funciones de costos que usan Costos,
 *                          Rentabilidad y el Estado de Resultados (se inyectan desde la app), y
 *                          siempre devuelve los carriles por separado: nunca un número mezclado.
 *   3. plantillas*()       arman el mensaje para WhatsApp (negritas, viñetas, 🌾 🐂 💰).
 *
 * Mismo archivo en js/ (escritorio y servidor local) y public/js/ (web/PWA). UMD: navegador y Node.
 */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) raiz.PampaConsultasVoz = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CARRIL = {
    AGRICOLA: 'CC_AGRICOLA',
    GANADERO: 'CC_GANADERO',
    MIXTO: 'CC_MIXTO',
    NINGUNO: 'CC_NINGUNO',
  };
  const ACTIVIDAD_POR_CARRIL = { CC_AGRICOLA: 'Agrícola', CC_GANADERO: 'Ganadera' };

  // ─── 1. DICCIONARIO DE ENRUTAMIENTO CONTABLE (reglas rígidas) ───────────────────────────────
  // Palabras sin tildes y en minúscula (el texto se normaliza igual). Frases de varias palabras
  // permitidas. "hectárea", "costo", "lote" NO están: sirven para los dos carriles.
  const DICCIONARIO_CARRIL = {
    CC_AGRICOLA: [
      'rinde', 'rindes', 'rindio', 'rendimiento', 'soja', 'maiz', 'trigo', 'girasol', 'sorgo', 'cebada',
      'cultivo', 'cultivos', 'cosecha', 'cosechadora', 'cosechamos', 'siembra', 'sembradora', 'sembramos',
      'acopio', 'acopiador', 'lpg', 'liquidacion primaria', 'carta de porte', 'cartas de porte', 'cpe', 'ctg',
      'quintal', 'quintales', 'qq', 'silo bolsa', 'silobolsa', 'granos', 'grano', 'cereal', 'cereales',
      'glifosato', 'herbicida', 'fungicida', 'insecticida', 'fertilizante', 'fertilizacion', 'urea', 'fosfato',
      'pulverizacion', 'pulverizadora', 'fumigacion', 'fumigue', 'agricola', 'agricultura',
    ],
    CC_GANADERO: [
      'vaca', 'vacas', 'novillo', 'novillos', 'novillito', 'novillitos', 'ternero', 'terneros', 'ternera',
      'terneras', 'vaquillona', 'vaquillonas', 'toro', 'toros', 'hacienda', 'rodeo', 'rodeos', 'ganado',
      'ganadero', 'ganadera', 'ganaderia', 'vacuna', 'vacunas', 'vacunacion', 'vacune', 'aftosa', 'brucelosis',
      'does', 'tuberculosis', 'ivermectina', 'dut', 'dte', 'dt-e', 'senasa', 'renspa', 'sigsa', 'caravana',
      'caravanas', 'feedlot', 'corral', 'corrales', 'balanceado', 'racion', 'rollo', 'rollos', 'pastura',
      'potrero', 'potreros', 'invernada', 'cria', 'recria', 'destete', 'kilos vivos', 'frigorifico',
      'consignataria', 'remate', 'carne',
    ],
  };

  // Intención (qué quiere saber). Se evalúan en este orden: la primera que coincide gana.
  const INTENCIONES = [
    { id: 'margen_lote', patron: /\b(margen|rentabilidad|rentable|cuanto (me )?(deja|dejo|dio)|como (viene|vino|va) el (lote|potrero)|resultado del (lote|potrero))\b/ },
    { id: 'caja_bancos', patron: /\b(caja|banco|bancos|plata|efectivo|saldo|saldos|dinero|entro|entraron|ingreso|ingresaron|cobre|cobramos|cobraron|cuenta corriente)\b/ },
    { id: 'gastos_periodo', patron: /\b(gaste|gastamos|gastaron|gasto|gastos|gastando|gastar|gastado|costo|costos|egreso|egresos|pague|pagamos|pagaron|salio|salieron)\b/ },
    { id: 'movimientos_lote', patron: /\b(movimiento|movimientos|que (hay|paso|se hizo|hicimos)|registros|novedades)\b/ },
  ];

  const PALABRAS_PREGUNTA = /^(cuanto|cuanta|cuantos|cuantas|que|como|cual|cuales|donde|decime|pasame|mostrame|dame|contame|necesito saber|quiero saber)\b/;

  function normalizar(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[¿?¡!.,;:()"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function contiene(textoNormalizado, frase) {
    const escapada = frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escapada}($|[^a-z0-9])`).test(textoNormalizado);
  }

  // ¿El audio es una pregunta (consulta) y no un parte de trabajo?
  function esConsulta(texto) {
    const crudo = String(texto || '');
    const t = normalizar(crudo);
    if (!t) return false;
    if (/[¿?]/.test(crudo)) return true;
    if (PALABRAS_PREGUNTA.test(t)) return true;
    // Sin signo ni palabra de pregunta ("margen del lote 2", "saldo de caja"): solo si pide un
    // reporte y no cuenta algo que se hizo ("cobramos la soja" o "pagué el gasoil" son partes).
    return /\b(margen|rentabilidad|saldo|saldos|reporte|resumen)\b/.test(t) &&
      !/\b(pague|pagamos|compre|compramos|cargue|cargamos|vacune|vacunamos|sembre|sembramos|aplique|aplicamos|cobre|cobramos|vendi|vendimos)\b/.test(t);
  }

  function detectarLote(t, lotes) {
    const numero = t.match(/\b(lote|potrero|cuadro|parcela)\s*(n(ro|o)?\s*)?(\d{1,3})\b/);
    const lista = Array.isArray(lotes) ? lotes : [];
    if (numero) {
      const n = Number(numero[4]);
      const porCodigo = lista.find((l) => Number(String(l.codigo || '').replace(/\D/g, '')) === n);
      if (porCodigo) return porCodigo;
      const porNombre = lista.find((l) => contiene(normalizar(l.nombre), `${numero[1]} ${n}`));
      if (porNombre) return porNombre;
      return { codigo: null, buscado: `${numero[1]} ${n}` };
    }
    return lista.find((l) => l.codigo && contiene(t, normalizar(l.codigo))) || null;
  }

  function inicioDelDia(fecha) {
    return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  }
  function iso(fecha) {
    const d = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // Período pedido. Sin mención: el que corresponde a la intención (ver enrutarConsulta).
  function detectarPeriodo(t, hoy = new Date()) {
    const h = inicioDelDia(hoy);
    const rango = (desde, hasta, etiqueta) => ({ desde: iso(desde), hasta: iso(hasta), etiqueta });
    if (/\bhoy\b/.test(t)) return rango(h, h, 'hoy');
    if (/\bayer\b/.test(t)) { const a = new Date(h); a.setDate(a.getDate() - 1); return rango(a, a, 'ayer'); }
    if (/\bsemana pasada\b/.test(t)) {
      const fin = new Date(h); fin.setDate(fin.getDate() - ((fin.getDay() + 6) % 7) - 1);
      const ini = new Date(fin); ini.setDate(ini.getDate() - 6);
      return rango(ini, fin, 'la semana pasada');
    }
    if (/\b(esta semana|la semana|semana)\b/.test(t)) {
      const ini = new Date(h); ini.setDate(ini.getDate() - ((ini.getDay() + 6) % 7));
      return rango(ini, h, 'esta semana');
    }
    if (/\bmes pasado\b/.test(t)) {
      const ini = new Date(h.getFullYear(), h.getMonth() - 1, 1);
      return rango(ini, new Date(h.getFullYear(), h.getMonth(), 0), `${MESES[ini.getMonth()]} ${ini.getFullYear()}`);
    }
    if (/\b(este ano|el ano|en el ano)\b/.test(t)) return rango(new Date(h.getFullYear(), 0, 1), h, `${h.getFullYear()}`);
    if (/\b(campana|todo|desde siempre|historico)\b/.test(t)) return { desde: null, hasta: null, etiqueta: 'todo el registro' };
    if (/\b(este mes|el mes|en el mes|mes)\b/.test(t)) return rango(new Date(h.getFullYear(), h.getMonth(), 1), h, `${MESES[h.getMonth()]} ${h.getFullYear()}`);
    return null;
  }

  function periodoPorDefecto(intencion, hoy = new Date()) {
    const h = inicioDelDia(hoy);
    if (intencion === 'gastos_periodo') return { desde: iso(new Date(h.getFullYear(), h.getMonth(), 1)), hasta: iso(h), etiqueta: `${MESES[h.getMonth()]} ${h.getFullYear()}` };
    if (intencion === 'caja_bancos') { const ini = new Date(h); ini.setDate(ini.getDate() - ((ini.getDay() + 6) % 7)); return { desde: iso(ini), hasta: iso(h), etiqueta: 'esta semana' }; }
    return { desde: null, hasta: null, etiqueta: 'todo el registro' };
  }

  /**
   * Clasifica la consulta ANTES de tocar los datos.
   * @returns {{ intencion, carril, lote, periodo, palabras:{agricola:string[],ganadero:string[]}, requiereAclaracion:boolean, motivo:string|null }}
   */
  function enrutarConsulta(texto, { lotes = [], hoy = new Date() } = {}) {
    const t = normalizar(texto);
    const palabras = {
      agricola: DICCIONARIO_CARRIL.CC_AGRICOLA.filter((p) => contiene(t, p)),
      ganadero: DICCIONARIO_CARRIL.CC_GANADERO.filter((p) => contiene(t, p)),
    };
    const lote = detectarLote(t, lotes);
    let intencion = (INTENCIONES.find((i) => i.patron.test(t)) || {}).id || null;
    if (!intencion && lote) intencion = 'movimientos_lote';

    // Carril: manda lo que dijo el productor. Si no dijo nada, el uso del lote.
    let carril = CARRIL.NINGUNO;
    if (palabras.agricola.length && palabras.ganadero.length) carril = CARRIL.MIXTO;
    else if (palabras.agricola.length) carril = CARRIL.AGRICOLA;
    else if (palabras.ganadero.length) carril = CARRIL.GANADERO;
    else if (lote && lote.codigo) {
      const uso = String(lote.uso || '');
      carril = /^agr/i.test(uso) ? CARRIL.AGRICOLA : /^gan/i.test(uso) ? CARRIL.GANADERO : /^mix/i.test(uso) ? CARRIL.MIXTO : CARRIL.NINGUNO;
    }

    const periodo = detectarPeriodo(t, hoy) || periodoPorDefecto(intencion, hoy);
    let motivo = null;
    if (!intencion) motivo = 'no_entendida';
    else if ((intencion === 'margen_lote' || intencion === 'movimientos_lote') && lote && !lote.codigo) motivo = 'lote_inexistente';
    else if (intencion === 'margen_lote' && lote && carril === CARRIL.MIXTO) motivo = 'lote_mixto';
    else if (intencion === 'margen_lote' && lote && carril === CARRIL.NINGUNO) motivo = 'falta_carril';
    return { texto: String(texto || ''), intencion, carril, lote, periodo, palabras, requiereAclaracion: Boolean(motivo), motivo };
  }

  // ─── 2. CONSULTAS SEGURAS SOBRE LOS DATOS (siempre separadas por carril) ───────────────────────
  /**
   * @param {object} d  funciones de la app (las mismas que usan Costos/Rentabilidad/Resultados):
   *   estado(), parseMonto, montoDeActividad, actividadDeRegistro, loteExiste, partesDeCosto,
   *   costoAlimentacion, esCostoBancario, calcularCostoTotalEmpleados, fechaMovimientoISO,
   *   saldoMovimientosFondos, saldoTotalBancos, normalizarActividad
   */
  function crearMotorConsultas(d) {
    const numero = (v) => { const n = d.parseMonto(v); return Number.isFinite(n) ? n : 0; };
    const fechaDe = (r) => d.fechaMovimientoISO(r && r.fecha) || null;

    // Libro de costos: cada costo de la app UNA vez, con su actividad y (si tiene) su lote. Replica
    // exactamente las reglas de obtenerCostosPorCultivo + obtenerCostosGanaderos +
    // obtenerCostosEstructura (una prueba verifica que los totales coincidan).
    function libroDeCostos() {
      const s = d.estado();
      const items = [];
      const add = (actividad, monto, r, origen, extra = {}) => {
        if (!monto) return;
        items.push({ actividad, monto, fecha: fechaDe(r), lote: extra.lote || (r && r.lote) || null, concepto: extra.concepto || (r && (r.concepto || r.tipo || r.producto)) || origen, origen });
      };
      (s.siembra || []).forEach((r) => add('Agrícola', numero(r.costo), r, 'Siembra', { concepto: `Siembra ${r.cultivo || ''}`.trim() }));
      (s.cosecha || []).forEach((r) => add('Agrícola', numero(r.costo), r, 'Cosecha', { concepto: `Cosecha ${r.cultivo || ''}`.trim() }));
      // Costos: el mismo reparto por actividad y lote que usan Costos y Rentabilidad (partesDeCosto;
      // un costo a nivel campo se reparte entre sus lotes y cada parte según el uso del lote).
      (s.costos || []).forEach((r) => {
        const monto = numero(r.monto ?? r.importe ?? r.costo);
        d.partesDeCosto(r, monto).forEach((p) => add(p.actividad, p.monto, r, 'Costos', { lote: p.lote }));
      });
      (s.aplicaciones || []).forEach((r) => {
        const monto = numero(r.costo);
        add('Agrícola', d.montoDeActividad(r, monto, 'Agrícola'), r, 'Aplicaciones', { concepto: `Aplicación ${r.tipo || ''}`.trim() });
        if (d.loteExiste(r.lote)) add('Ganadera', d.montoDeActividad(r, monto, 'Ganadera'), r, 'Aplicaciones', { concepto: `Aplicación ${r.tipo || ''}`.trim() });
      });
      [['costosOperativos', 'Costos operativos'], ['mantenimiento', 'Mantenimiento']].forEach(([coleccion, origen]) =>
        (s[coleccion] || []).forEach((r) => {
          const monto = numero(r.costo);
          if (d.loteExiste(r.lote)) {
            add('Agrícola', d.montoDeActividad(r, monto, 'Agrícola'), r, origen, { concepto: r.descripcion || r.tipoCosto || origen });
            add('Ganadera', d.montoDeActividad(r, monto, 'Ganadera'), r, origen, { concepto: r.descripcion || r.tipoCosto || origen });
          } else add('Estructura', monto, r, origen, { concepto: r.descripcion || r.tipoCosto || origen });
        }),
      );
      (s.hacienda || []).forEach((r) => {
        if (['Compra', 'Vacunación'].includes(r.tipo))
          add('Ganadera', numero(r.valor), r, 'Hacienda', { lote: r.destino && d.loteExiste(r.destino) ? r.destino : null, concepto: r.tipo === 'Compra' ? 'Compra de hacienda' : 'Sanidad ganadera' });
      });
      (s.alimentacion || []).forEach((r) => add('Ganadera', d.costoAlimentacion(r), r, 'Alimentación', { concepto: 'Alimentación ganadera' }));
      (s.eventosSanitarios || []).forEach((r) => add('Ganadera', numero(r.costo), r, 'Eventos sanitarios', { concepto: r.tipoVacunaMedicamento || 'Evento sanitario' }));
      (s.caja || []).forEach((r) => {
        if (r.tipo === 'Egreso' && r.pagoDeCostoRegistrado !== 'Sí' && d.actividadDeRegistro(r) === 'Ganadera') add('Ganadera', numero(r.importe), r, 'Caja');
      });
      (s.cargacombustible || []).forEach((r) => add('Estructura', numero(r.costoTotal), r, 'Combustible', { concepto: 'Combustible' }));
      (s.bancos || []).forEach((r) => { if (d.esCostoBancario(r)) add('Estructura', numero(r.importe), r, 'Bancos', { concepto: r.concepto || 'Gastos bancarios' }); });
      return items;
    }

    const enPeriodo = (fecha, p) => !p || !p.desde || (fecha && fecha >= p.desde && fecha <= p.hasta);

    // Sueldos + cargas: costo mensual de estructura. En un período se toma proporcional a sus días.
    function sueldosDelPeriodo(p) {
      const mensual = numero(d.calcularCostoTotalEmpleados(p && p.hasta ? new Date(`${p.hasta}T12:00:00`) : undefined));
      if (!p || !p.desde) return mensual;
      const dias = Math.round((new Date(`${p.hasta}T12:00:00`) - new Date(`${p.desde}T12:00:00`)) / 86400000) + 1;
      return dias >= 28 ? mensual * Math.round(dias / 30.4) || mensual : (mensual * dias) / 30.4;
    }

    function topConceptos(items, cantidad = 3) {
      const grupos = {};
      items.forEach((i) => { grupos[i.concepto] = (grupos[i.concepto] || 0) + i.monto; });
      return Object.entries(grupos).map(([concepto, monto]) => ({ concepto, monto })).sort((a, b) => b.monto - a.monto).slice(0, cantidad);
    }

    // "¿Cuánto gasté este mes?" → { gastosAgricolas, gastosGanaderos, gastosEstructura }, nunca un único número.
    function gastosPorCarril(periodo) {
      const items = libroDeCostos();
      const del = (actividad) => items.filter((i) => i.actividad === actividad && enPeriodo(i.fecha, periodo));
      const sinFecha = periodo && periodo.desde ? items.filter((i) => !i.fecha).length : 0;
      const suma = (lista) => lista.reduce((t, i) => t + i.monto, 0);
      const agricola = del('Agrícola');
      const ganadera = del('Ganadera');
      const estructura = del('Estructura');
      const sueldos = sueldosDelPeriodo(periodo);
      return {
        periodo,
        gastosAgricolas: suma(agricola),
        gastosGanaderos: suma(ganadera),
        gastosEstructura: suma(estructura) + sueldos,
        detalle: {
          agricola: topConceptos(agricola),
          ganadera: topConceptos(ganadera),
          estructura: topConceptos([...estructura, ...(sueldos ? [{ concepto: 'Sueldos y cargas', monto: sueldos }] : [])]),
        },
        registrosSinFecha: sinFecha,
      };
    }

    // "¿Qué movimientos hay en el Lote 2?" → agrícola y ganadero del lote por separado.
    function movimientosDelLote(codigo, periodo) {
      const items = libroDeCostos().filter((i) => i.lote === codigo && enPeriodo(i.fecha, periodo));
      const de = (actividad) => {
        const lista = items.filter((i) => i.actividad === actividad).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
        return { total: lista.reduce((t, i) => t + i.monto, 0), items: lista };
      };
      return { lote: codigo, periodo, agricola: de('Agrícola'), ganadero: de('Ganadera') };
    }

    // Margen directo de UN carril del lote (sin estructura, que no es de ningún lote).
    function margenDelLote(codigo, carril, periodo) {
      const s = d.estado();
      const lote = (s.lotes || []).find((l) => l.codigo === codigo) || { codigo };
      const actividad = ACTIVIDAD_POR_CARRIL[carril];
      const costos = libroDeCostos().filter((i) => i.lote === codigo && i.actividad === actividad && enPeriodo(i.fecha, periodo));
      const costoTotal = costos.reduce((t, i) => t + i.monto, 0);
      const ha = numero(lote.superficie);
      if (carril === CARRIL.GANADERO) {
        // Las ventas de hacienda no se registran por lote: no se inventa un ingreso del potrero.
        return { lote, carril, periodo, costos: costoTotal, detalle: topConceptos(costos), ingresos: null, margen: null, hectareas: ha, costoPorHa: ha ? costoTotal / ha : null };
      }
      const ventas = (s.ventasCereal || []).filter((v) => v.lote === codigo && enPeriodo(fechaDe(v), periodo));
      const ingresos = ventas.reduce((t, v) => t + numero(v.cantidadKg) * numero(v.precioKg), 0);
      const kgCosechados = (s.cosecha || []).filter((c) => c.lote === codigo && enPeriodo(fechaDe(c), periodo)).reduce((t, c) => t + numero(c.totalKg), 0);
      const kgVendidos = ventas.reduce((t, v) => t + numero(v.cantidadKg), 0);
      const cultivo = ((s.siembra || []).find((x) => x.lote === codigo) || {}).cultivo || '';
      const margen = ingresos - costoTotal;
      return {
        lote, carril, periodo, cultivo, ingresos, costos: costoTotal, detalle: topConceptos(costos), margen,
        margenPorcentaje: ingresos ? (margen / ingresos) * 100 : null,
        hectareas: ha, margenPorHa: ha ? margen / ha : null,
        kgSinVender: Math.max(0, kgCosechados - kgVendidos),
      };
    }

    // "¿Cuánta plata hay?" / "¿Qué entró esta semana?": saldos + entradas y salidas por carril.
    function cajaYBancos(periodo) {
      const s = d.estado();
      const flujo = { ingresos: { 'Agrícola': 0, 'Ganadera': 0, 'Estructura': 0, 'Sin asignar': 0 }, egresos: { 'Agrícola': 0, 'Ganadera': 0, 'Estructura': 0, 'Sin asignar': 0 } };
      [...(s.caja || []), ...(s.bancos || [])].forEach((m) => {
        if (m.tipo !== 'Ingreso' && m.tipo !== 'Egreso') return; // transferencias entre cuentas no son entradas ni salidas
        if (!enPeriodo(fechaDe(m), periodo)) return;
        const actividad = d.normalizarActividad(m.actividad) || 'Sin asignar';
        flujo[m.tipo === 'Ingreso' ? 'ingresos' : 'egresos'][actividad] += numero(m.importe);
      });
      return { periodo, saldoCaja: d.saldoMovimientosFondos(s.caja || []), saldoBancos: d.saldoTotalBancos(), ...flujo };
    }

    // Punto de entrada: texto transcripto → { tipo, mensaje, datos, ruta }.
    function responderConsulta(texto, { hoy = new Date() } = {}) {
      const ruta = enrutarConsulta(texto, { lotes: d.estado().lotes || [], hoy });
      if (ruta.requiereAclaracion) return { tipo: 'aclaracion', ruta, mensaje: plantillaAclaracion(ruta) };
      if (ruta.intencion === 'caja_bancos') { const datos = cajaYBancos(ruta.periodo); return { tipo: 'caja', ruta, datos, mensaje: plantillaCaja(datos, hoy) }; }
      if (ruta.intencion === 'gastos_periodo') { const datos = gastosPorCarril(ruta.periodo); return { tipo: 'gastos', ruta, datos, mensaje: plantillaGastos(datos, ruta) }; }
      if (ruta.intencion === 'movimientos_lote' && ruta.lote) { const datos = movimientosDelLote(ruta.lote.codigo, ruta.periodo.desde ? ruta.periodo : null); return { tipo: 'movimientos', ruta, datos, mensaje: plantillaMovimientos(datos, ruta) }; }
      if (ruta.intencion === 'margen_lote' && ruta.lote) { const datos = margenDelLote(ruta.lote.codigo, ruta.carril, ruta.periodo); return { tipo: 'margen', ruta, datos, mensaje: plantillaMargen(datos) }; }
      if (ruta.intencion === 'margen_lote') {
        // Margen general sin lote: cada carril por su lado (el Estado de Resultados separa igual).
        const datos = gastosPorCarril(ruta.periodo);
        return { tipo: 'gastos', ruta, datos, mensaje: plantillaGastos(datos, ruta) };
      }
      return { tipo: 'aclaracion', ruta: { ...ruta, motivo: 'no_entendida' }, mensaje: plantillaAclaracion({ ...ruta, motivo: 'no_entendida' }) };
    }

    return { libroDeCostos, gastosPorCarril, movimientosDelLote, margenDelLote, cajaYBancos, responderConsulta };
  }

  // ─── 3. PLANTILLAS PARA WHATSAPP ───────────────────────────────────────────────────────────
  // *negrita*, _cursiva_, viñetas "•" y emojis funcionales. Montos redondeados, formato es-AR.
  const pesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
  const nombreLote = (lote) => (lote ? `${lote.nombre || lote.codigo}` : 'el lote');
  const fechaCorta = (f) => { const [a, m, dd] = String(f || '').split('-'); return dd ? `${dd}/${m}` : ''; };
  const lineaDetalle = (lista) => lista.map((x) => `   ◦ ${x.concepto}: ${pesos(x.monto)}`).join('\n');

  // A) Reporte de Margen Express.
  function plantillaMargen(r) {
    if (r.carril === CARRIL.GANADERO) {
      return [
        `🐂 *Costos ganaderos · ${nombreLote(r.lote)}*`,
        `_${r.periodo.etiqueta} · carril ganadero_`,
        '',
        `• Costos directos del potrero: *${pesos(r.costos)}*`,
        r.detalle.length ? lineaDetalle(r.detalle) : '   ◦ Sin costos cargados en este lote',
        r.costoPorHa !== null ? `• Por hectárea: ${pesos(r.costoPorHa)}/ha (${r.hectareas} ha)` : null,
        '',
        'ℹ️ Las ventas de hacienda no se cargan por lote, así que no hay margen por potrero. Pedime *"gastos de hacienda del mes"* para ver el carril ganadero completo.',
      ].filter((l) => l !== null).join('\n');
    }
    return [
      `🌾 *Margen express · ${nombreLote(r.lote)}${r.cultivo ? ` (${r.cultivo})` : ''}*`,
      `_${r.periodo.etiqueta} · carril agrícola_`,
      '',
      `• Ingresos por ventas: *${pesos(r.ingresos)}*`,
      `• Costos directos del lote: *${pesos(r.costos)}*`,
      r.detalle.length ? lineaDetalle(r.detalle) : '   ◦ Sin costos cargados en este lote',
      `• *Margen directo: ${pesos(r.margen)}*${r.margenPorcentaje !== null ? ` (${Math.round(r.margenPorcentaje)} %)` : ''}`,
      r.margenPorHa !== null ? `• Por hectárea: *${pesos(r.margenPorHa)}/ha* (${r.hectareas} ha)` : null,
      r.kgSinVender ? `• Grano sin vender: ${Math.round(r.kgSinVender).toLocaleString('es-AR')} kg (no suma al margen)` : null,
      '',
      '⚠️ Margen directo: no incluye estructura (sueldos, combustible, bancos) ni costos de hacienda.',
    ].filter((l) => l !== null).join('\n');
  }

  // B) Reporte de Caja/Bancos.
  function plantillaCaja(r, hoy = new Date()) {
    const carriles = (grupo) => [
      `   🌾 Agrícola: ${pesos(grupo['Agrícola'])}`,
      `   🐂 Ganadera: ${pesos(grupo['Ganadera'])}`,
      `   🏢 Estructura: ${pesos(grupo['Estructura'])}`,
      grupo['Sin asignar'] ? `   ❔ Sin asignar: ${pesos(grupo['Sin asignar'])}` : null,
    ].filter(Boolean).join('\n');
    const total = (grupo) => Object.values(grupo).reduce((t, v) => t + v, 0);
    return [
      `💰 *Caja y Bancos · al ${fechaCorta(iso(hoy))}*`,
      '',
      `• Caja: *${pesos(r.saldoCaja)}*`,
      `• Bancos: *${pesos(r.saldoBancos)}*`,
      '',
      `*${r.periodo.etiqueta.charAt(0).toUpperCase()}${r.periodo.etiqueta.slice(1)}*${r.periodo.desde ? ` (${fechaCorta(r.periodo.desde)} al ${fechaCorta(r.periodo.hasta)})` : ''}`,
      `⬆️ Entró: *${pesos(total(r.ingresos))}*`,
      carriles(r.ingresos),
      `⬇️ Salió: *${pesos(total(r.egresos))}*`,
      carriles(r.egresos),
      '',
      '_Las transferencias entre tus cuentas no cuentan como entradas ni salidas._',
    ].join('\n');
  }

  function plantillaGastos(r, ruta) {
    const bloque = (emoji, titulo, monto, detalle) => [`${emoji} ${titulo}: *${pesos(monto)}*`, detalle.length ? lineaDetalle(detalle) : null].filter(Boolean).join('\n');
    const soloUno = ruta && (ruta.carril === CARRIL.AGRICOLA || ruta.carril === CARRIL.GANADERO);
    return [
      `📊 *Gastos · ${r.periodo.etiqueta}*`,
      '',
      !soloUno || ruta.carril === CARRIL.AGRICOLA ? bloque('🌾', 'Agrícola', r.gastosAgricolas, r.detalle.agricola) : null,
      !soloUno || ruta.carril === CARRIL.GANADERO ? bloque('🐂', 'Ganadera', r.gastosGanaderos, r.detalle.ganadera) : null,
      !soloUno ? bloque('🏢', 'Estructura', r.gastosEstructura, r.detalle.estructura) : null,
      '',
      '_Cada carril se calcula por separado: los gastos agrícolas y ganaderos no se mezclan._',
      r.registrosSinFecha ? `⚠️ ${r.registrosSinFecha} registro(s) sin fecha no entran en el período.` : null,
    ].filter((l) => l !== null).join('\n');
  }

  function plantillaMovimientos(r, ruta) {
    const lista = (items) => items.slice(0, 5).map((i) => `   ◦ ${fechaCorta(i.fecha) || 's/f'} · ${i.concepto}: ${pesos(i.monto)}`).join('\n');
    const bloque = (emoji, titulo, grupo) => [`${emoji} *${titulo}: ${pesos(grupo.total)}*`, grupo.items.length ? lista(grupo.items) : '   ◦ Sin movimientos', grupo.items.length > 5 ? `   ◦ … y ${grupo.items.length - 5} más` : null].filter(Boolean).join('\n');
    return [
      `📍 *Movimientos · ${nombreLote(ruta.lote)}*`,
      `_${ruta.periodo.desde ? ruta.periodo.etiqueta : 'todo el registro'}${ruta.lote && ruta.lote.uso ? ` · uso ${String(ruta.lote.uso).toLowerCase()}` : ''}_`,
      '',
      ruta.carril !== CARRIL.GANADERO ? bloque('🌾', 'Agrícola', r.agricola) : null,
      ruta.carril !== CARRIL.AGRICOLA ? bloque('🐂', 'Ganadero', r.ganadero) : null,
      '',
      '_Los montos de cada carril se muestran por separado._',
    ].filter((l) => l !== null).join('\n');
  }

  // C) Alerta de falla o ambigüedad.
  function plantillaAclaracion(ruta) {
    if (ruta.motivo === 'lote_mixto' || ruta.motivo === 'falta_carril') {
      const lote = nombreLote(ruta.lote);
      return [
        '⚠️ *Necesito que me aclares*',
        '',
        ruta.motivo === 'lote_mixto'
          ? `*${lote}* es de uso *mixto* (agrícola y ganadero). ¿Me preguntás por:`
          : `No sé si *${lote}* es agrícola o ganadero. ¿Me preguntás por:`,
        '1️⃣ 🌾 la parte *agrícola* (cultivo, cosecha, ventas de granos)',
        '2️⃣ 🐂 la parte *ganadera* (hacienda, sanidad, alimentación)',
        '',
        `Mandame otro audio diciendo, por ejemplo: _"margen de ${lote.toLowerCase()} soja"_ o _"margen de ${lote.toLowerCase()} hacienda"_.`,
      ].join('\n');
    }
    if (ruta.motivo === 'lote_inexistente') {
      return [
        '⚠️ *No encontré ese lote*',
        '',
        `No hay ningún lote cargado como _${ruta.lote && ruta.lote.buscado}_. Revisá el número o decime el nombre del lote como está en PampaAgro.`,
      ].join('\n');
    }
    return [
      '🤔 *No entendí la consulta*',
      '',
      'Probá preguntarme, por ejemplo:',
      '• 🌾 _"¿Cómo viene el margen del lote 2 de soja?"_',
      '• 📊 _"¿Cuánto gasté este mes?"_',
      '• 💰 _"¿Cuánta plata hay en caja y bancos?"_',
      '• 📍 _"¿Qué movimientos hay en el lote 3?"_',
    ].join('\n');
  }

  return {
    CARRIL, DICCIONARIO_CARRIL, normalizar, esConsulta, enrutarConsulta, detectarPeriodo, crearMotorConsultas,
    plantillaMargen, plantillaCaja, plantillaGastos, plantillaMovimientos, plantillaAclaracion,
  };
});
