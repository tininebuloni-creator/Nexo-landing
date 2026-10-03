/* PampaIA de PampaTambo: las capacidades de cada versión, calculadas con los datos del ERP.
 *
 *   SMALL · Básica       consultas sobre los datos, resumen del día, alertas de desvíos, rodeo
 *   MEDIUM · Profesional proyección de alimento, costo por litro, equipos y mantenimiento
 *   LARGE · Premium      rentabilidad, cumplimiento SENASA / ARCA / ambiente, caja a 90 días
 *
 * Ningún número sale de un modelo de lenguaje: todo se calcula con los registros cargados (con los
 * mismos cálculos de Costos, Rentabilidad, ARCA y SENASA) y, si falta historial, se dice. El texto
 * usa el formato de WhatsApp (*negrita*, _cursiva_) para que el mismo resultado sirva en el panel,
 * en la nota de voz y en el WhatsApp. Mismo criterio y misma forma que PampaGanaderia.
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
    { id: 'resumen', nivel: 1, icono: '📋', titulo: 'Resumen del día', detalle: 'Plata, litros ordeñados y entregados de hoy y ayer, cheques, vacas en retiro y alertas.' },
    { id: 'alertas', nivel: 1, icono: '⚠️', titulo: 'Alertas de desvíos', detalle: 'Caída de producción, calidad de leche, diferencia ordeñe–entrega, precio del litro y sanidad.' },
    { id: 'rodeo', nivel: 1, icono: '🐄', titulo: 'Rodeo y producción', detalle: 'Vacas en ordeñe, secas y preñadas, guachera, recría y litros por vaca.' },
    { id: 'stock', nivel: 2, icono: '🌾', titulo: 'Proyección de alimento', detalle: 'En cuántos días se acaba cada alimento y cada silo según el consumo real.' },
    { id: 'costoLitro', nivel: 2, icono: '🧮', titulo: 'Costo por litro', detalle: 'Costo, precio y margen por litro liquidado (12 meses), por rubro.' },
    { id: 'mantenimiento', nivel: 2, icono: '🔧', titulo: 'Equipos y mantenimiento', detalle: 'Órdenes abiertas, próximos services y gasto en reparaciones por equipo.' },
    { id: 'rentabilidad', nivel: 3, icono: '📈', titulo: 'Rentabilidad', detalle: 'Ingresos, costos y margen de 12 meses y en qué se va la plata.' },
    { id: 'cumplimiento', nivel: 3, icono: '🩺', titulo: 'Cumplimiento SENASA, ARCA y ambiente', detalle: 'Sanidad, RENSPA, LUME sin calcular, certificados F. 2005, IVA y residuos.' },
    { id: 'caja90', nivel: 3, icono: '💵', titulo: 'Caja a 90 días', detalle: 'Saldo proyectado con leche a cobrar, cheques, cuotas y sueldos.' },
  ];

  const UMBRAL = { produccion: 0.1, entrega: 0.03, precio: 0.1, rcs: 400000, ufc: 100000, diasStock: 30, ventanaConsumoDias: 90 };

  // Módulos que tiene que poder abrir el usuario para ver cada respuesta (alcanza con uno).
  const MODULOS_REQUERIDOS = {
    rodeo: ['animales', 'hacienda'],
    stock: ['alimentos', 'silos', 'inventario'],
    costoLitro: ['costos', 'rentabilidad'],
    mantenimiento: ['mantenimiento'],
    rentabilidad: ['rentabilidad'],
    cumplimiento: ['arca', 'sanidad'],
    caja90: ['finanzas'],
    plata: ['finanzas'],
    gastos: ['costos'],
    leche: ['ordenes', 'entregas', 'produccion', 'arca'],
    cheques: ['finanzas'],
    sanidad: ['sanidad', 'animales'],
  };
  const MODULOS_DATO = {
    plata: ['finanzas'],
    costos: ['costos'],
    cheques: ['finanzas'],
    stock: ['alimentos', 'silos', 'inventario'],
    services: ['mantenimiento'],
    rodeo: ['animales', 'sanidad'],
    leche: ['ordenes', 'entregas', 'produccion'],
    fiscal: ['arca'],
    ambiente: ['residuos'],
  };

  const pesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
  const num = (n, dec = 0) => (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: dec });
  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const iso = (fecha) => new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const sumarDias = (fechaIso, dias) => { const d = new Date(`${fechaIso}T12:00:00`); d.setDate(d.getDate() + dias); return iso(d); };
  const fechaCorta = (f) => { const [, m, d] = String(f || '').split('-'); return d ? `${d}/${m}` : ''; };
  function fechaIso(f) {
    if (!f) return '';
    const t = String(f).trim();
    const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
  }

  // Pregunta o parte: "¿cuánto gasté?" pregunta; "ordeñamos 3200 litros" cuenta algo que se hizo.
  const PALABRAS_PREGUNTA = /^(cuanto|cuanta|cuantos|cuantas|que|como|cual|cuales|donde|cuando|decime|pasame|mostrame|mandame|dame|contame|necesito saber|quiero saber)\b/;
  function esConsulta(texto) {
    const crudo = String(texto || '');
    const t = normalizar(crudo).trim();
    if (!t) return false;
    if (/[¿?]/.test(crudo) || PALABRAS_PREGUNTA.test(t)) return true;
    return /\b(margen|rentabilidad|saldo|saldos|reporte|resumen|rodeo|costo por litro)\b/.test(t) &&
      !/\b(pague|pagamos|compre|compramos|cargue|cargamos|vacune|vacunamos|vendi|vendimos|cobre|cobramos|gaste|gastamos|ordenamos|entregamos|pario|parieron|murio|murieron)\b/.test(t);
  }

  /**
   * @param {object} d  { estado(), plan(), rol(), acceso(rol, modulo), nombreRol(rol), monto(v), esIngreso(tipo), esEgreso(tipo),
   *                      resultado(desde, hasta), costoMensualEmpleado(sueldo), getRetiroActivo(vaca), getRetiroCarneActivo(vaca),
   *                      doesEstado(), aftosa(), b19(), renspa(), residuos(), posicionIva(), retenciones(periodo) }
   */
  function crearAsistente(d) {
    const numero = (v) => { const n = d.monto(v); return Number.isFinite(n) ? n : 0; };
    const plan = () => (NIVEL_PLAN[d.plan()] ? d.plan() : 'basica');
    const capacidad = (id) => CAPACIDADES.find((c) => c.id === id);
    const planMinimo = (nivel) => ({ 1: 'Básica', 2: 'Profesional', 3: 'Premium' })[nivel];
    const puede = (id) => NIVEL_PLAN[plan()] >= capacidad(id).nivel;
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
      const neto = (lista) => (lista || []).reduce((t, m) => t + (d.esIngreso(m.tipo) ? numero(m.monto ?? m.importe) : d.esEgreso(m.tipo) ? -numero(m.monto ?? m.importe) : 0), 0);
      return { caja: neto(s.caja), bancos: neto(s.bancos), finanzas: neto(s.finanzas) };
    }
    const totalPlata = (x) => x.caja + x.bancos + x.finanzas;
    const pendiente = (c) => !/cobrad|pagad|rechaz|anulad|depositad/i.test(String(c.estado || ''));
    const litrosDe = (lista, desde, hasta) => (lista || []).filter((r) => { const f = fechaIso(r.fecha); return f && f >= desde && f <= hasta; }).reduce((t, r) => t + numero(r.litros), 0);
    const estadoAnimal = (a) => normalizar(a.estado);
    const activo = (a) => !/vendid|muert|baja/.test(estadoAnimal(a));
    const enOrdene = (a) => activo(a) && /produc|ordene|lactan/.test(estadoAnimal(a));
    const seca = (a) => activo(a) && /seca/.test(estadoAnimal(a));
    const prenada = (a) => activo(a) && (/prenad/.test(estadoAnimal(a)) || /prenad/.test(normalizar(a.resultado_reproductivo)));

    function vacasEnRetiro() {
      if (!d.getRetiroActivo) return [];
      return (d.estado().animales || []).filter(activo).map((a) => ({ a, r: d.getRetiroActivo(a.caravana) })).filter((x) => x.r);
    }

    // Alertas sanitarias, de ARCA y ambientales, con los mismos cálculos de cada módulo.
    function alertasSanitarias() {
      const out = [];
      const does = d.doesEstado ? d.doesEstado() : null;
      if (does) [['tuberculosis', 'Tuberculosis'], ['brucelosis', 'Brucelosis']].forEach(([k, n]) => {
        const e = does[k];
        if (!e || !e.ultima) out.push({ nivel: 'warn', texto: `${n}: sin control anual registrado.` });
        else if (e.estado === 'VENCIDO') out.push({ nivel: 'risk', texto: `${n}: control anual vencido hace ${Math.abs(e.diasRestantes)} día(s).` });
        else if (e.estado === 'POR_VENCER') out.push({ nivel: 'warn', texto: `${n}: control anual vence en ${e.diasRestantes} día(s).` });
      });
      const af = d.aftosa ? d.aftosa() : null;
      if (af && af.configurada) {
        if (af.general.estado === 'VENCIDO' && af.general.pendientes > 0) out.push({ nivel: 'risk', texto: `Aftosa: campaña vencida con ${af.general.pendientes} animal(es) sin vacunar (riesgo de bloqueo del DT-e).` });
        else if (af.general.estado === 'POR_VENCER' && af.general.pendientes > 0) out.push({ nivel: 'warn', texto: `Aftosa: faltan ${af.general.pendientes} animal(es) y quedan ${af.general.diasRestantes} día(s) de campaña.` });
      }
      const b19 = d.b19 ? d.b19() : null;
      if (b19 && b19.vencidas.length) out.push({ nivel: 'risk', texto: `Brucelosis Cepa 19: ${b19.vencidas.length} ternera(s) pasaron los 8 meses sin vacunar.` });
      else if (b19 && b19.pendientes.length) out.push({ nivel: 'warn', texto: `Brucelosis Cepa 19: ${b19.pendientes.length} ternera(s) de 3 a 8 meses sin vacunar.` });
      const renspa = d.renspa ? d.renspa() : null;
      if (renspa && renspa.estado === 'VENCIDO') out.push({ nivel: 'risk', texto: 'RENSPA vencido: no se pueden emitir DT-e.' });
      else if (renspa && renspa.estado === 'POR_VENCER') out.push({ nivel: 'warn', texto: `RENSPA vence en ${renspa.dias} día(s).` });
      return out;
    }

    function costosDelDia(dia) {
      return d.resultado(dia, dia).costos.filter((c) => c.origen !== 'Sueldos' && c.origen !== 'Amortizaciones').reduce((t, c) => t + c.importe, 0);
    }

    // ─── Básica ──────────────────────────────────────────────────────────────────────────
    function resumenDiario(hoyFecha = new Date()) {
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const ayer = sumarDias(hoy, -1);
      const lineas = [];
      const plata = veDato('plata');
      if (plata) {
        const x = saldos();
        lineas.push(linea('ok', `💰 Caja *${pesos(x.caja)}* · Bancos *${pesos(x.bancos)}*${x.finanzas ? ` · Otros movimientos ${pesos(x.finanzas)}` : ''}`));
      }
      for (const [dia, etiqueta] of [[hoy, 'Hoy'], [ayer, 'Ayer']]) {
        const partes = [];
        if (veDato('leche')) {
          const ord = litrosDe(s.ordenes, dia, dia);
          const ent = litrosDe(s.entregasUsina, dia, dia);
          if (ord || ent) partes.push(`🥛 ordeñe ${num(ord)} L · entregado ${num(ent)} L`);
        }
        if (plata) {
          const movs = [...(s.caja || []), ...(s.bancos || []), ...(s.finanzas || [])].filter((m) => fechaIso(m.fecha) === dia);
          const entra = movs.filter((m) => d.esIngreso(m.tipo)).reduce((t, m) => t + numero(m.monto ?? m.importe), 0);
          const sale = movs.filter((m) => d.esEgreso(m.tipo)).reduce((t, m) => t + numero(m.monto ?? m.importe), 0);
          if (entra || sale) partes.push(`entró ${pesos(entra)}, salió ${pesos(sale)}`);
        }
        if (veDato('costos')) { const c = costosDelDia(dia); if (c) partes.push(`costos ${pesos(c)}`); }
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
      if (veDato('rodeo')) {
        const retiro = vacasEnRetiro();
        if (retiro.length) lineas.push(linea('warn', `• 💉 ${retiro.length} vaca(s) con leche en retiro (no va al tanque): ${retiro.slice(0, 6).map((x) => x.a.caravana).join(', ')}${retiro.length > 6 ? '…' : ''}`));
        alertasSanitarias().filter((a) => a.nivel === 'risk').forEach((a) => lineas.push(linea('risk', `• 🩺 ${a.texto}`)));
      }
      if (veDato('stock')) {
        const sin = (s.alimentos || []).filter((a) => Number(a.stock) <= 0);
        if (sin.length) lineas.push(linea('warn', `• 🌾 Sin stock: ${sin.map((a) => a.nombre).join(', ')}`));
      }
      if (veDato('services')) {
        const pend = (s.mantenimiento || []).filter((o) => /pend|curso|abiert/i.test(o.estado || ''));
        if (pend.length) lineas.push(linea('warn', `• 🔧 Órdenes de mantenimiento abiertas: ${pend.map((o) => o.equipo || o.tarea || 'orden').join(', ')}`));
      }
      if (veDato('ambiente') && d.residuos) d.residuos().alertas.filter((a) => a.level === 'bad').forEach((a) => lineas.push(linea('risk', `• ♻️ ${a.title.replace(/^Ambiente · /, '')}: ${a.detail}`)));
      if (lineas.length === informativas) lineas.push(linea('ok', '• Sin vencimientos, faltantes ni alertas pendientes.'));
      return resultado(`📋 Resumen del día · ${fechaCorta(hoy)}`, lineas);
    }

    function alertasDesvios(hoyFecha = new Date()) {
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const lineas = [];
      if (veDato('leche')) {
        // Producción: últimos 7 días contra los 7 anteriores.
        const actual = litrosDe(s.ordenes, sumarDias(hoy, -6), hoy);
        const previa = litrosDe(s.ordenes, sumarDias(hoy, -13), sumarDias(hoy, -7));
        if (actual && previa) {
          const desvio = (actual - previa) / previa;
          if (desvio <= -UMBRAL.produccion) lineas.push(linea('risk', `🥛 Producción: ${num(actual)} L en los últimos 7 días, *${Math.round(desvio * 100)} %* contra la semana anterior (${num(previa)} L). Revisá sanidad, dieta y ordeñe.`));
        }
        // Ordeñado contra entregado (últimos 30 días).
        const ord = litrosDe(s.ordenes, sumarDias(hoy, -29), hoy);
        const ent = litrosDe(s.entregasUsina, sumarDias(hoy, -29), hoy);
        if (ord && ent && (ord - ent) / ord > UMBRAL.entrega) lineas.push(linea('warn', `🚛 En 30 días se ordeñaron ${num(ord)} L y se entregaron ${num(ent)} L: faltan ${num(ord - ent)} L (${num(((ord - ent) / ord) * 100, 1)} %). Leche en retiro, guachera o pérdidas.`));
        // Calidad: última muestra.
        const muestras = [...(s.muestrasCalidadLeche || [])].filter((m) => fechaIso(m.fecha)).sort((a, b) => fechaIso(a.fecha).localeCompare(fechaIso(b.fecha)));
        const ultima = muestras[muestras.length - 1];
        if (ultima) {
          if (numero(ultima.rcs) > UMBRAL.rcs) lineas.push(linea('warn', `🔬 Células somáticas: ${num(numero(ultima.rcs))} el ${fechaCorta(fechaIso(ultima.fecha))} (más de ${num(UMBRAL.rcs)}): revisá mastitis; baja el precio del litro.`));
          if (numero(ultima.ufc) > UMBRAL.ufc) lineas.push(linea('warn', `🔬 Bacterias (UFC): ${num(numero(ultima.ufc))} el ${fechaCorta(fechaIso(ultima.fecha))} (más de ${num(UMBRAL.ufc)}): revisá limpieza del equipo y frío.`));
        }
      }
      if (veDato('fiscal')) {
        // Precio del litro: última LUME contra el promedio de las anteriores.
        const lumes = [...(s.liquidacionesLeche || [])].filter((l) => numero(l.litros_liquidados) > 0 && numero(l.neto) > 0).sort((a, b) => fechaIso(a.fecha).localeCompare(fechaIso(b.fecha)));
        if (lumes.length >= 2) {
          const precio = (l) => numero(l.neto) / numero(l.litros_liquidados);
          const ultima = lumes[lumes.length - 1];
          const previas = lumes.slice(0, -1);
          const promedio = previas.reduce((t, l) => t + precio(l), 0) / previas.length;
          const desvio = (precio(ultima) - promedio) / promedio;
          if (Math.abs(desvio) >= UMBRAL.precio) lineas.push(linea(desvio < 0 ? 'warn' : 'ok', `💲 Precio del litro: la última LUME (${fechaCorta(fechaIso(ultima.fecha))}) pagó ${pesos(precio(ultima))}/L, ${desvio < 0 ? '' : '+'}${Math.round(desvio * 100)} % contra tu promedio (${pesos(promedio)}/L).`));
        }
      }
      if (veDato('stock')) (s.alimentos || []).filter((a) => Number(a.stock) <= 0).forEach((a) => lineas.push(linea('risk', `🌾 *${a.nombre}*: sin stock`)));
      if (veDato('rodeo')) alertasSanitarias().forEach((a) => lineas.push(linea(a.nivel, `🩺 ${a.texto}`)));
      if (!lineas.length) lineas.push(linea('ok', 'Sin desvíos: producción, calidad, entregas, precio del litro y sanidad dentro de lo normal.'));
      return resultado('⚠️ Alertas de desvíos', lineas);
    }

    function rodeoYProduccion(hoyFecha = new Date()) {
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const animales = (s.animales || []).filter(activo);
      const ordene = animales.filter(enOrdene).length;
      const secas = animales.filter(seca).length;
      const prenadas = animales.filter(prenada).length;
      const retiro = vacasEnRetiro().length;
      const lineas = [
        linea('ok', `🐄 Vacas: *${num(animales.length)}* · en ordeñe *${num(ordene)}* · secas ${num(secas)} · preñadas ${num(prenadas)}${retiro ? ` · en retiro ${num(retiro)}` : ''}`),
        linea('ok', `🍼 Guachera: ${num((s.guachera || []).filter((g) => !/egres|vendid|muert|baja/i.test(g.estado || g.destino || '')).length)} · Recría: ${num((s.recria || []).filter((r) => !/baja|vendid|muert/i.test(r.estado || '')).length)} · Toros: ${num((s.toros || []).length)}`),
      ];
      const litros30 = litrosDe(s.ordenes, sumarDias(hoy, -29), hoy);
      if (litros30) lineas.push(linea('ok', `🥛 Últimos 30 días: ${num(litros30)} L ordeñados · ${num(litros30 / 30)} L/día${ordene ? ` · *${num(litros30 / 30 / ordene, 1)} L por vaca en ordeñe*` : ''}`));
      else lineas.push(linea('ok', 'Sin ordeñes cargados en los últimos 30 días.'));
      const mes = hoy.slice(0, 7);
      const ent = litrosDe(s.entregasUsina, `${mes}-01`, hoy);
      if (ent) lineas.push(linea('ok', `🚛 Entregado a la usina este mes: ${num(ent)} L`));
      return resultado('🐄 Rodeo y producción', lineas, { datos: { animales: animales.length, ordene, secas, prenadas, retiro } });
    }

    // ─── Profesional ─────────────────────────────────────────────────────────────────────
    function proyeccionStock(hoyFecha = new Date()) {
      if (!puede('stock')) return bloqueado('stock');
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const desde = sumarDias(hoy, -UMBRAL.ventanaConsumoDias);
      const dentro = (f) => { const x = fechaIso(f); return x && x > desde && x <= hoy; };
      const lineas = [];
      const consumo = {};
      (s.consumosAlimento || []).filter((c) => dentro(c.fecha)).forEach((c) => { const k = normalizar(c.alimento); consumo[k] = (consumo[k] || 0) + numero(c.cantidad); });
      const filas = (s.alimentos || []).map((a) => {
        const porDia = (consumo[normalizar(a.nombre)] || 0) / UMBRAL.ventanaConsumoDias;
        const stock = Number(a.stock) || 0;
        return { nombre: a.nombre, unidad: a.unidad || 'kg', stock, porDia, dias: porDia > 0 ? stock / porDia : null };
      }).filter((f) => f.porDia > 0).sort((a, b) => a.dias - b.dias);
      filas.forEach((f) => lineas.push(linea(f.dias <= 7 ? 'risk' : f.dias <= UMBRAL.diasStock ? 'warn' : 'ok', `🌾 *${f.nombre}*: ${num(f.stock)} ${f.unidad}, se usan ${num(f.porDia, 1)} ${f.unidad}/día → se acaba en *${Math.round(f.dias)} días* (${fechaCorta(sumarDias(hoy, Math.round(f.dias)))})`)));
      // Silos: extracciones de los últimos 90 días.
      (s.silos || []).forEach((silo) => {
        const extraido = (s.siloMovimientos || []).filter((m) => String(m.silo_id) === String(silo.id) && normalizar(m.tipo) === 'consumo' && dentro(m.fecha)).reduce((t, m) => t + numero(m.toneladas), 0);
        const porDia = extraido / UMBRAL.ventanaConsumoDias;
        const stock = numero(silo.toneladas_actuales);
        if (porDia > 0) {
          const dias = stock / porDia;
          lineas.push(linea(dias <= 7 ? 'risk' : dias <= UMBRAL.diasStock ? 'warn' : 'ok', `🏗️ *${silo.nombre || 'Silo'}* (${silo.tipo_grano_actual || 'grano'}): ${num(stock, 1)} TN, se extraen ${num(porDia, 2)} TN/día → alcanza *${Math.round(dias)} días*`));
        }
      });
      if (!lineas.length) lineas.push(linea('ok', `No hay consumos de alimento ni extracciones de silo en los últimos ${UMBRAL.ventanaConsumoDias} días para proyectar. Registralos en Alimentos → Consumo de alimentos o en Silos.`));
      return resultado('🌾 Proyección de alimento', lineas, { datos: filas });
    }

    function doceMeses(hoyFecha) {
      const hoy = iso(hoyFecha);
      return d.resultado(sumarDias(hoy, -364), hoy);
    }

    function costoPorLitro(hoyFecha = new Date()) {
      if (!puede('costoLitro')) return bloqueado('costoLitro');
      const r = doceMeses(hoyFecha);
      if (!r.litros) return resultado('🧮 Costo por litro (12 meses)', [linea('ok', 'No hay litros liquidados (LUME) en los últimos 12 meses: cargá las liquidaciones de leche para calcularlo.')]);
      const ingresoLeche = r.ingresosPorOrigen.Leche || 0;
      const precio = ingresoLeche / r.litros;
      const costo = r.totalCostos / r.litros;
      const lineas = [
        linea('ok', `Litros liquidados: *${num(r.litros)}* · Costo total ${pesos(r.totalCostos)}`),
        linea(precio - costo < 0 ? 'risk' : 'ok', `Por litro: costo *${pesos(costo)}* · precio cobrado *${pesos(precio)}* · margen *${pesos(precio - costo)}*`),
        ...Object.entries(r.porGrupo).sort((a, b) => b[1] - a[1]).map(([g, v]) => linea('ok', `• ${g}: ${pesos(v / r.litros)}/L (${num((v / r.totalCostos) * 100)} %)`)),
      ];
      lineas.push(linea('ok', '_Costo con la misma cuenta que Costos y Rentabilidad: alimento por consumo, sueldo + SAC + cargas, mediero y amortizaciones._'));
      return resultado('🧮 Costo por litro (12 meses)', lineas, { datos: { litros: r.litros, costo, precio } });
    }

    function equiposYMantenimiento(hoyFecha = new Date()) {
      if (!puede('mantenimiento')) return bloqueado('mantenimiento');
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const desde = sumarDias(hoy, -365);
      const lineas = [];
      (s.mantenimiento || []).filter((o) => /pend|curso|abiert/i.test(o.estado || '')).forEach((o) => lineas.push(linea('warn', `🔧 *${o.equipo || 'Equipo'}* · ${o.tipo || ''} ${o.tarea || ''}: ${String(o.estado).toLowerCase()} (${pesos(numero(o.costo))})`)));
      (s.mantenimiento || []).filter((o) => fechaIso(o.proximo_servicio)).forEach((o) => {
        const f = fechaIso(o.proximo_servicio);
        if (f < hoy) lineas.push(linea('risk', `📅 Service de *${o.equipo || 'equipo'}* vencido el ${fechaCorta(f)}`));
        else if (f <= sumarDias(hoy, 30)) lineas.push(linea('warn', `📅 Service de *${o.equipo || 'equipo'}* el ${fechaCorta(f)}`));
      });
      const porEquipo = {};
      (s.mantenimiento || []).filter((o) => fechaIso(o.fecha) >= desde).forEach((o) => { const k = o.equipo || 'Sin equipo'; porEquipo[k] = (porEquipo[k] || 0) + numero(o.costo); });
      Object.entries(porEquipo).sort((a, b) => b[1] - a[1]).forEach(([e, v]) => { if (v) lineas.push(linea('ok', `🚜 *${e}*: ${pesos(v)} en reparaciones (12 meses)`)); });
      if (!lineas.length) lineas.push(linea('ok', 'No hay órdenes de mantenimiento cargadas.'));
      return resultado('🔧 Equipos y mantenimiento', lineas);
    }

    // ─── Premium ─────────────────────────────────────────────────────────────────────────
    function rentabilidad(hoyFecha = new Date()) {
      if (!puede('rentabilidad')) return bloqueado('rentabilidad');
      const r = doceMeses(hoyFecha);
      const lineas = [linea(r.resultado < 0 ? 'risk' : 'ok', `Ingresos *${pesos(r.totalIngresos)}* · Costos *${pesos(r.totalCostos)}* · Resultado *${pesos(r.resultado)}*${r.totalIngresos ? ` (${num((r.resultado / r.totalIngresos) * 100, 1)} %)` : ''}`)];
      Object.entries(r.ingresosPorOrigen).sort((a, b) => b[1] - a[1]).forEach(([o, v]) => lineas.push(linea('ok', `• Ingreso ${o}: ${pesos(v)}`)));
      const orden = Object.entries(r.porGrupo).sort((a, b) => b[1] - a[1]);
      if (orden.length) lineas.push(linea('ok', `En qué se va la plata: ${orden.slice(0, 5).map(([g, v]) => `${g} ${r.totalCostos ? Math.round((v / r.totalCostos) * 100) : 0} %`).join(' · ')}`));
      if (r.litros) lineas.push(linea('ok', `Por litro: ingreso ${pesos((r.ingresosPorOrigen.Leche || 0) / r.litros)} · costo ${pesos(r.costoPorLitro)}`));
      if (r.sinPrecio && r.sinPrecio.length) lineas.push(linea('warn', `Consumos sin precio de compra (no suman costo): ${r.sinPrecio.join(', ')}`));
      if (!r.totalIngresos && !r.totalCostos) lineas.push(linea('ok', 'Sin ingresos ni costos en los últimos 12 meses.'));
      return resultado('📈 Rentabilidad (12 meses)', lineas, { datos: r });
    }

    function cumplimiento(hoyFecha = new Date()) {
      if (!puede('cumplimiento')) return bloqueado('cumplimiento');
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const lineas = [];
      if (veDato('rodeo')) {
        const san = alertasSanitarias();
        san.forEach((a) => lineas.push(linea(a.nivel, `🩺 ${a.texto}`)));
        if (!san.length) lineas.push(linea('ok', '🩺 SENASA al día: controles anuales, aftosa, Cepa 19 y RENSPA.'));
      }
      if (veDato('fiscal')) {
        const mes = hoy.slice(0, 7);
        const sinCalcular = (s.liquidacionesLeche || []).filter((l) => fechaIso(l.fecha).slice(0, 7) === mes && !l.resumen_fiscal);
        if (sinCalcular.length) lineas.push(linea('warn', `🥛 ${sinCalcular.length} LUME del mes sin "Calcular fiscal": el débito de IVA está incompleto.`));
        if (d.retenciones) {
          const ret = d.retenciones('anio');
          if (ret.sinCertificado) lineas.push(linea('warn', `🧾 ${ret.sinCertificado} retención(es) del año sin certificado F. 2005: pedíselo a la usina.`));
        }
        const p = d.posicionIva ? d.posicionIva() : null;
        if (p) lineas.push(linea(p.aPagar > 0 ? 'warn' : 'ok', `🧾 IVA ${p.anual ? `del año ${p.mes}` : 'del mes'}: ${p.aPagar > 0 ? `*${pesos(p.aPagar)} a pagar*` : `${pesos(p.favorTecnico + p.favorLibre)} a favor`} (débito ${pesos(p.debito)} − crédito ${pesos(p.credito)}${p.favorTecnicoAnterior ? ` − a favor anterior ${pesos(p.favorTecnicoAnterior)}` : ''} − ret./perc. ${pesos(p.retIva + p.favorLibreAnterior)})`));
      }
      if (veDato('ambiente') && d.residuos) {
        const amb = d.residuos().alertas;
        amb.forEach((a) => lineas.push(linea(a.level === 'bad' ? 'risk' : 'warn', `♻️ ${a.title.replace(/^Ambiente · /, '')}: ${a.detail}`)));
        if (!amb.length) lineas.push(linea('ok', '♻️ Residuos y efluentes sin alertas.'));
      }
      if (!lineas.length) lineas.push(linea('ok', 'Sin datos de sanidad, fiscales ni ambientales para revisar.'));
      return resultado('🩺 Cumplimiento SENASA, ARCA y ambiente', lineas);
    }

    function cajaA90Dias(hoyFecha = new Date()) {
      if (!puede('caja90')) return bloqueado('caja90');
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const x = saldos();
      const tramos = [30, 60, 90].map((dias) => ({ dias, hasta: sumarDias(hoy, dias), entra: 0, sale: 0 }));
      const sumar = (fecha, importe, tipo) => {
        const f = fechaIso(fecha) || hoy;
        const tramo = tramos.find((t) => (f < hoy ? hoy : f) <= t.hasta);
        if (tramo) tramo[tipo] += importe;
      };
      (s.chequesCobrar || []).filter(pendiente).forEach((c) => sumar(c.vencimiento, numero(c.importe), 'entra'));
      (s.chequesCubrir || []).filter(pendiente).forEach((c) => sumar(c.vencimiento, numero(c.importe), 'sale'));
      // Leche liquidada sin cobrar: entra en los próximos 30 días (neto de retenciones si está calculada).
      const lecheACobrar = (s.liquidacionesLeche || []).filter((l) => !String(l.fecha_cobro || '').trim());
      const montoLeche = lecheACobrar.reduce((t, l) => t + (numero(l.resumen_fiscal && l.resumen_fiscal.neto_estimado_tambo) || numero(l.neto)), 0);
      if (montoLeche) tramos[0].entra += montoLeche;
      // Cuotas de créditos tomados y activos: capital / cuotas (sin intereses).
      let cuotaMensual = 0;
      (s.creditos || []).filter((c) => /tomad/i.test(c.tipo || 'tomado') && !/cancel/i.test(c.estado || '')).forEach((c) => {
        const cuotas = Number(c.cuotas) || 0;
        if (cuotas > 0) cuotaMensual += numero(c.monto) / cuotas;
      });
      const sueldos = (s.empleados || []).filter((e) => { const est = normalizar(e.estado || 'activo'); return est.includes('activo') && !est.includes('inactivo'); })
        .reduce((t, e) => t + (d.costoMensualEmpleado ? d.costoMensualEmpleado(numero(e.sueldo_base)) : numero(e.sueldo_base)), 0);
      tramos.forEach((t) => { t.sale += sueldos + cuotaMensual; });
      let saldo = totalPlata(x);
      const lineas = [linea('ok', `Hoy: Caja + Bancos + otros movimientos *${pesos(saldo)}*`)];
      let primerNegativo = null;
      tramos.forEach((t) => {
        saldo += t.entra - t.sale;
        if (saldo < 0 && !primerNegativo) primerNegativo = t.dias;
        lineas.push(linea(saldo < 0 ? 'risk' : 'ok', `• A ${t.dias} días (${fechaCorta(t.hasta)}): *${pesos(saldo)}* · entra ${pesos(t.entra)} · sale ${pesos(t.sale)}`));
      });
      if (primerNegativo) lineas.push(linea('risk', `⚠️ La caja queda en negativo antes de los ${primerNegativo} días: adelantá cobros o reprogramá pagos.`));
      lineas.push(linea('ok', `_Incluye leche liquidada sin cobrar (${pesos(montoLeche)}), cheques pendientes, cuotas de créditos (${pesos(cuotaMensual)}/mes, sin intereses) y sueldos + SAC + cargas (${pesos(sueldos)}/mes). No incluye leche de meses futuros._`));
      return resultado('💵 Caja a 90 días', lineas);
    }

    const EJECUTAR = { resumen: resumenDiario, alertas: alertasDesvios, rodeo: rodeoYProduccion, stock: proyeccionStock, costoLitro: costoPorLitro, mantenimiento: equiposYMantenimiento, rentabilidad, cumplimiento, caja90: cajaA90Dias };
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
      const hoy = iso(hoyFecha);
      if (tipo === 'finanzas') {
        if (!ve(MODULOS_REQUERIDOS.plata)) return sinAcceso('💰 Análisis financiero');
        const x = saldos();
        const cobrar = (s.chequesCobrar || []).filter(pendiente).reduce((t, c) => t + numero(c.importe), 0);
        const pagar = (s.chequesCubrir || []).filter(pendiente).reduce((t, c) => t + numero(c.importe), 0);
        const mes = d.resultado(`${hoy.slice(0, 7)}-01`, hoy);
        return resultado('💰 Análisis financiero', [
          linea('ok', `Caja *${pesos(x.caja)}* · Bancos *${pesos(x.bancos)}* · Total *${pesos(totalPlata(x))}*`),
          linea(pagar > cobrar + totalPlata(x) ? 'risk' : pagar > cobrar ? 'warn' : 'ok', `Cheques por cobrar ${pesos(cobrar)} · por pagar ${pesos(pagar)}`),
          veDato('costos') ? linea(mes.resultado < 0 ? 'warn' : 'ok', `Este mes: ingresos ${pesos(mes.totalIngresos)} · costos ${pesos(mes.totalCostos)} · resultado ${pesos(mes.resultado)}`) : null,
        ].filter(Boolean));
      }
      if (tipo === 'operacion') {
        const r = rodeoYProduccion(hoyFecha);
        const lineas = [
          veDato('rodeo') ? r.lineas[0] : null,
          veDato('leche') ? r.lineas[2] : null,
          veDato('stock') ? linea((s.alimentos || []).some((a) => Number(a.stock) <= 0) ? 'warn' : 'ok', (s.alimentos || []).some((a) => Number(a.stock) <= 0) ? `Sin stock: ${(s.alimentos || []).filter((a) => Number(a.stock) <= 0).map((a) => a.nombre).join(', ')}` : 'Alimentos con stock.') : null,
          veDato('services') ? linea((s.mantenimiento || []).some((o) => /pend|curso|abiert/i.test(o.estado || '')) ? 'warn' : 'ok', (s.mantenimiento || []).some((o) => /pend|curso|abiert/i.test(o.estado || '')) ? 'Hay órdenes de mantenimiento abiertas.' : 'Sin órdenes de mantenimiento abiertas.') : null,
        ].filter(Boolean);
        return resultado('🚜 Análisis operativo', lineas.length ? lineas : [linea('warn', 'Tu usuario no tiene acceso a los módulos operativos.')]);
      }
      if (tipo === 'riesgos') return alertasDesvios(hoyFecha);
      return resultado('🏢 Diagnóstico general', [
        linea('ok', `${(s.campos || []).length} campo(s) · ${(s.lotes || []).length} lotes · ${veDato('rodeo') ? `${num((s.animales || []).filter(activo).length)} vacas · ` : ''}${(s.maquinas || []).length} equipos · ${(s.empleados || []).length} empleados`),
        ...(veDato('plata') ? resumenDiario(hoyFecha).lineas.slice(0, 1) : []),
        linea('ok', `Plan de IA: *${NOMBRE_PLAN[plan()]}* · ${capacidades().filter((c) => c.habilitada).length} de ${CAPACIDADES.length} funciones habilitadas para tu usuario`),
      ]);
    }

    // ─── Consultas en texto libre (panel, nota de voz, WhatsApp) ───────────────────────────
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
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
      const r = d.resultado(p.desde, p.hasta);
      const lineas = [linea('ok', `Total: *${pesos(r.totalCostos)}*`), ...Object.entries(r.porGrupo).sort((a, b) => b[1] - a[1]).map(([g, v]) => linea('ok', `• ${g}: ${pesos(v)}`))];
      if (!r.costos.length) lineas.push(linea('ok', 'No hay costos registrados en ese período.'));
      return resultado(`📊 Gastos de ${p.nombre}`, lineas);
    }

    function consultaLeche(t, hoyFecha) {
      if (!ve(MODULOS_REQUERIDOS.leche)) return sinAcceso('🥛 Leche');
      const s = d.estado();
      const p = periodoDe(t, hoyFecha);
      const ord = litrosDe(s.ordenes, p.desde, p.hasta);
      const ent = litrosDe(s.entregasUsina, p.desde, p.hasta);
      const lumes = (s.liquidacionesLeche || []).filter((l) => fechaIso(l.fecha) >= p.desde && fechaIso(l.fecha) <= p.hasta);
      const litrosLiq = lumes.reduce((a, l) => a + numero(l.litros_liquidados), 0);
      const neto = lumes.reduce((a, l) => a + numero(l.neto), 0);
      const lineas = [linea('ok', `Ordeñado *${num(ord)} L* · entregado *${num(ent)} L*`)];
      if (lumes.length) lineas.push(linea('ok', `Liquidado: ${num(litrosLiq)} L por ${pesos(neto)}${litrosLiq ? ` (${pesos(neto / litrosLiq)}/L)` : ''}`));
      if (!ord && !ent && !lumes.length) lineas.push(linea('ok', 'No hay ordeñes, entregas ni liquidaciones en ese período.'));
      return resultado(`🥛 Leche de ${p.nombre}`, lineas);
    }

    function consultaPlata() {
      if (!ve(MODULOS_REQUERIDOS.plata)) return sinAcceso('💰 Caja y Bancos');
      const x = saldos();
      return resultado('💰 Caja y Bancos', [linea('ok', `Caja *${pesos(x.caja)}* · Bancos *${pesos(x.bancos)}*${x.finanzas ? ` · Otros movimientos ${pesos(x.finanzas)}` : ''} · Total *${pesos(totalPlata(x))}*`)]);
    }

    function consultaCheques(hoyFecha) {
      if (!ve(MODULOS_REQUERIDOS.cheques)) return sinAcceso('🧾 Cheques');
      const s = d.estado();
      const hoy = iso(hoyFecha);
      const fila = (c, sentido) => linea(fechaIso(c.vencimiento) && fechaIso(c.vencimiento) < hoy ? 'risk' : 'ok', `• ${sentido} ${c.numero || ''} · ${pesos(numero(c.importe))} · vence ${c.vencimiento || '-'}`);
      const lineas = [...(s.chequesCobrar || []).filter(pendiente).map((c) => fila(c, 'A cobrar')), ...(s.chequesCubrir || []).filter(pendiente).map((c) => fila(c, 'A pagar'))];
      if (!lineas.length) lineas.push(linea('ok', 'No hay cheques pendientes.'));
      return resultado('🧾 Cheques pendientes', lineas);
    }

    function consultaSanidad() {
      if (!ve(MODULOS_REQUERIDOS.sanidad)) return sinAcceso('🩺 Sanidad');
      const lineas = alertasSanitarias().map((a) => linea(a.nivel, `• ${a.texto}`));
      const retiro = vacasEnRetiro();
      if (retiro.length) lineas.push(linea('warn', `• 💉 En retiro de leche: ${retiro.map((x) => `${x.a.caravana} (${x.r.diasRestantes} d)`).join(', ')}`));
      if (!lineas.length) lineas.push(linea('ok', 'Sanidad al día: controles anuales, aftosa, Cepa 19, RENSPA y sin vacas en retiro.'));
      return resultado('🩺 Sanidad SENASA', lineas);
    }

    const RUTAS = [
      { id: 'caja90', patron: /\b(caja a 90|proyecc\w* de caja|flujo de caja|me alcanza la plata|vamos a estar en rojo)/ },
      { id: 'costoLitro', patron: /\b(costo por litro|cuanto me cuesta (el|cada|un) litro|costo del litro)/ },
      { id: 'rentabilidad', patron: /\b(rentabilidad|margen|gano|ganando|pierdo|perdiendo|negocio|resultado)\b/ },
      { id: 'cumplimiento', patron: /\b(lume|iva|arca|fiscal|f\.? ?2005|certificado|retencion|retenciones|cumplimiento|efluente|efluentes|residuo|residuos|ambiente|renspa)/ },
      { id: 'mantenimiento', patron: /\b(mantenimiento|service|services|tractor|maquina|maquinas|equipo|equipos|repar|ordenadora|equipo de frio)/ },
      { id: 'stock', patron: /\b(alimento|alimentos|racion|raciones|balanceado|rollo|rollos|silo|silos|maiz|stock|se acaba|faltante|reponer)\b/ },
      { id: 'rodeo', patron: /\b(cuantas vacas|cuantos animales|rodeo|en ordene|vacas secas|prenadas|guachera|recria|litros por vaca)/ },
      { id: 'resumen', patron: /\b(resumen|como estamos|como esta todo|que paso hoy|novedades|que tengo que (revisar|hacer)|que deberia revisar)/ },
      { id: 'alertas', patron: /\b(alerta|alertas|desvio|desvios|riesgo|riesgos|problema|problemas|calidad|celulas|rcs|ufc|bacterias)\b/ },
    ];

    function ayuda() {
      const lineas = [linea('ok', 'Probá preguntarme, por ejemplo:'), linea('ok', '• 📊 _"¿Cuánto gasté este mes?"_ · 💰 _"¿Cuánta plata hay en caja y bancos?"_'), linea('ok', '• 🥛 _"¿Cuántos litros entregamos esta semana?"_ · 🐄 _"¿Cuántas vacas en ordeñe tengo?"_ · 🩺 _"¿Cómo está la sanidad?"_')];
      capacidades().forEach((c) => lineas.push(linea(c.habilitada ? 'ok' : 'warn', `• ${c.icono} ${c.titulo}${c.habilitada ? '' : c.porRol ? ' 🔒 _sin acceso para tu usuario_' : ` 🔒 _versión ${c.requiere}_`}`)));
      return resultado('🤔 No entendí la consulta', lineas);
    }

    const responder = (pregunta, opciones = {}) => conRol(opciones, () => responderConRol(pregunta, opciones.hoy || new Date()));
    function responderConRol(pregunta, hoy) {
      const t = normalizar(pregunta);
      if (!t.trim()) return ayuda();
      if (/\b(gaste|gastamos|gasto|gastos|costos? de|cuanto se fue)\b/.test(t) && !/por litro/.test(t)) return consultaGastos(t, hoy);
      if (/\b(litros|leche|ordene|ordenamos|ordenaron|entregamos|entrega|entregas|liquidacion|liquidaciones|usina)\b/.test(t) && !/\b(lume|iva|fiscal|certificado|retencion|costo por litro|por vaca|vacas?|animales|rodeo)\b/.test(t)) return consultaLeche(t, hoy);
      if (/\b(caja|bancos?|plata|saldo|efectivo)\b/.test(t) && !/90|proyecc|flujo|alcanza/.test(t)) return consultaPlata();
      if (/\bcheques?\b/.test(t)) return consultaCheques(hoy);
      if (/\b(sanidad|vacuna\w*|aftosa|brucelosis|tuberculosis|retiro|carencia|senasa|mastitis|tratamiento)\b/.test(t) && !/\b(iva|arca|lume)\b/.test(t)) return consultaSanidad();
      const ruta = RUTAS.find((r) => r.patron.test(t));
      if (ruta) {
        // "alimento/stock" en Básica: lo que está sin stock; la proyección es de Profesional.
        if (ruta.id === 'stock' && !puede('stock')) {
          if (!ve(MODULOS_REQUERIDOS.stock)) return sinAcceso('🌾 Stock');
          const sin = (d.estado().alimentos || []).filter((a) => Number(a.stock) <= 0);
          return resultado('🌾 Stock de alimentos', sin.length ? sin.map((a) => linea('warn', `🌾 *${a.nombre}*: sin stock`)) : [linea('ok', 'Todos los alimentos tienen stock.')], { nota: bloqueado('stock').texto });
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

    return { plan, puede, capacidades, ejecutar, analizar, responder, esConsulta, resumenDiario, alertasDesvios, rodeoYProduccion, proyeccionStock, costoPorLitro, equiposYMantenimiento, rentabilidad, cumplimiento, cajaA90Dias, saldos };
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

  return { NIVEL_PLAN, CAPACIDADES, UMBRAL, crearAsistente, esConsulta, aHtml, escapar, montarCapacidades, insightsHtml, fechaIso };
});
