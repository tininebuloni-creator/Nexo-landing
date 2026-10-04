// Núcleo agrícola de PampaPrecision: Soja, Trigo, Maíz y Girasol.
// Lógica pura (sin DOM ni base de datos): el mismo archivo corre en el navegador (window.PampaAgroCore)
// y en Node (tests). Ver plan_agro_core.md.
//  - Liquidación Primaria de Granos (RG 3419) con retenciones de IVA y Ganancias según el estado del
//    productor en el SISA (RG (AFIP) 4310/2018), por grano y estado. La LPG SIEMPRE se calcula: si falta
//    una regla validada y vigente se usa la tabla por defecto y se avisa.
//  - Stock de granos en silobolsas y celdas a partir de los movimientos.
//  - Campañas fina (Trigo) y gruesa (Soja, Maíz, Girasol) y vínculo lote ↔ RENSPA.
//  - Posición de IVA mensual, libros de IVA y obligaciones de información del SISA.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PampaAgroCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const s = String(v ?? '').replace(/[^0-9.,-]/g, '');
    if (!s) return 0;
    const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
    if (coma > -1 && punto > -1) return parseFloat(coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')) || 0;
    if (coma > -1) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
    // Solo puntos con grupos de 3 dígitos: separador de miles argentino ("1.000.000").
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, '')) || 0;
    return parseFloat(s) || 0;
  };
  const sinAcentos = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  const fechaIso = (f) => {
    const t = String(f || '').trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  };

  const RG4310 = 'RG (AFIP) 4310/2018 — retenciones de IVA y Ganancias en la compraventa de granos según el estado del productor en el SISA';
  const RG3419 = 'RG (AFIP) 3419/2012 — Liquidación Primaria de Granos electrónica';

  // Los 4 granos del sistema. Humedad base: Cámaras Arbitrales de Cereales (misma tabla que Agro).
  const CULTIVOS = {
    SOJA: { nombre: 'Soja', codigo: 'SOJ', campania: 'gruesa', humedadBase: 13.5, ivaPct: 10.5, color: '#10b981' },
    MAIZ: { nombre: 'Maíz', codigo: 'MAI', campania: 'gruesa', humedadBase: 14.5, ivaPct: 10.5, color: '#f59e0b' },
    GIRASOL: { nombre: 'Girasol', codigo: 'GIR', campania: 'gruesa', humedadBase: 11, ivaPct: 10.5, color: '#eab308' },
    TRIGO: { nombre: 'Trigo', codigo: 'TRI', campania: 'fina', humedadBase: 14, ivaPct: 10.5, color: '#3b82f6' },
  };
  const ALIAS = { SOJ: 'SOJA', SOY: 'SOJA', SOYBEAN: 'SOJA', MAI: 'MAIZ', CORN: 'MAIZ', MAIZE: 'MAIZ', GIR: 'GIRASOL', SUNFLOWER: 'GIRASOL', TRI: 'TRIGO', WHEAT: 'TRIGO' };
  function grano(nombre) {
    const k = sinAcentos(nombre);
    const clave = CULTIVOS[k] ? k : ALIAS[k];
    return clave || null;
  }
  function cultivo(nombre) {
    const k = grano(nombre);
    if (!k) throw new Error(`Cultivo no admitido: "${nombre}". Precisión trabaja con Soja, Trigo, Maíz y Girasol.`);
    return { clave: k, ...CULTIVOS[k] };
  }

  // Estados SISA del productor. "INACTIVO" incluye al excluido o no inscripto.
  const ESTADOS_SISA = { 1: 'Estado 1 (riesgo bajo)', 2: 'Estado 2 (riesgo medio)', 3: 'Estado 3 (riesgo alto)', INACTIVO: 'Inactivo / no incluido en el SISA' };
  function estadoSisa(valor) {
    const t = sinAcentos(valor).replace(/^ESTADO\s*|^CATEGORIA\s*|^SISA[_\s]*/, '');
    if (['1', '2', '3'].includes(t)) return t;
    if (/INACT|EXCLU|NO INCL|NO INSCR/.test(t)) return 'INACTIVO';
    return null;
  }

  // Tabla confirmada por la usuaria el 21/9/2026 (misma que Agro y que el servidor de Precisión): porcentaje
  // sobre el subtotal neto del grano. Arranca igual para los 4 granos; cada fila se puede versionar.
  const TASAS_SISA = { 1: { ivaPct: 5, gananciasPct: 0, reintegro: true }, 2: { ivaPct: 7, gananciasPct: 2, reintegro: false }, 3: { ivaPct: 8, gananciasPct: 15, reintegro: false }, INACTIVO: { ivaPct: 10.5, gananciasPct: 30, reintegro: false } };
  const REGLAS_SISA_DEFECTO = Object.keys(CULTIVOS).flatMap((g) => Object.entries(TASAS_SISA).map(([estado, t]) => ({
    id: `defecto-${g}-${estado}`, grano: g, estado, ...t, vigenciaDesde: '2018-01-01', vigenciaHasta: '', estadoRegla: 'VALIDADA',
    fuente: `${RG4310}. Tabla comparativa confirmada el 21/9/2026.`, defecto: true,
  })));

  // Impuesto de Sellos sobre el contrato de compraventa, por provincia (simulador LPG de la usuaria,
  // hoja "Configuracion"). Es una deducción de la LPG, no una retención.
  const SELLOS_PROVINCIA = { 'SANTA FE': 1, CORDOBA: 1.2, 'BUENOS AIRES': 1.2, 'ENTRE RIOS': 1.4, 'SANTIAGO DEL ESTERO': 1.5, 'LA PAMPA': 1, CHACO: 1.2, 'SAN LUIS': 1, SALTA: 1.4, TUCUMAN: 1.5 };
  const PROVINCIAS = Object.keys(SELLOS_PROVINCIA);
  // Retención de Ingresos Brutos al productor: exento por defecto (se edita por provincia si corresponde).
  const REGLAS_IIBB_DEFECTO = PROVINCIAS.map((p) => ({ id: `defecto-iibb-${p}`, provincia: p, alicuotaPct: 0, vigenciaDesde: '2018-01-01', vigenciaHasta: '', estadoRegla: 'VALIDADA', fuente: 'Productor primario: exento de la retención de IIBB por defecto. Confirmar con la agencia provincial (ARBA, API, Rentas).', defecto: true }));
  const provincia = (p) => {
    const k = sinAcentos(p).replace(/^BS\.?\s*AS\.?$/, 'BUENOS AIRES').replace(/^PROVINCIA DE /, '');
    return k;
  };

  // Deducciones comerciales de la LPG: llevan IVA 21 % (crédito fiscal), salvo las marcadas exentas.
  const DEDUCCIONES = {
    COMISION: { nombre: 'Comisión de acopio / corredor', ivaPct: 21 },
    FLETE_CORTO: { nombre: 'Flete corto', ivaPct: 21 },
    FLETE_LARGO: { nombre: 'Flete largo', ivaPct: 21 },
    SECADO: { nombre: 'Secado', ivaPct: 21 },
    ZARANDEO: { nombre: 'Zarandeo / acondicionamiento', ivaPct: 21 },
    ALMACENAJE: { nombre: 'Almacenaje', ivaPct: 21 },
    PARITARIAS: { nombre: 'Paritarias / contribuciones', ivaPct: 0 },
    OTROS: { nombre: 'Otros gastos', ivaPct: 21 },
  };

  const vigente = (r, fecha) => {
    const f = fechaIso(fecha) || '9999-12-31';
    return r && (r.estadoRegla || 'VALIDADA') === 'VALIDADA' && (!r.vigenciaDesde || r.vigenciaDesde <= f) && (!r.vigenciaHasta || r.vigenciaHasta >= f);
  };
  const masNueva = (a, b) => String(b.vigenciaDesde || '').localeCompare(String(a.vigenciaDesde || ''));
  function reglaSisa(reglas, g, estado, fecha) {
    const propias = (reglas || []).filter((r) => r.grano === g && String(r.estado) === String(estado) && vigente(r, fecha)).sort(masNueva);
    if (propias.length) return { regla: propias[0], usaDefecto: Boolean(propias[0].defecto) };
    return { regla: REGLAS_SISA_DEFECTO.find((r) => r.grano === g && r.estado === String(estado)), usaDefecto: true, faltaRegla: true };
  }
  function reglaIibb(reglas, prov, fecha) {
    const k = provincia(prov);
    const propias = (reglas || []).filter((r) => provincia(r.provincia) === k && vigente(r, fecha)).sort(masNueva);
    if (propias.length) return { regla: propias[0], usaDefecto: Boolean(propias[0].defecto) };
    return { regla: REGLAS_IIBB_DEFECTO.find((r) => r.provincia === k) || { provincia: k, alicuotaPct: 0, fuente: 'Sin regla para la provincia: exento.' }, usaDefecto: true, faltaRegla: true };
  }

  // Liquidación Primaria de Granos completa. Siempre devuelve un cálculo; los problemas van en "avisos".
  //  datos: { grano, estadoSisa, fecha, tipo:'COMPRAVENTA'|'CONSIGNACION', ajuste:''|'DEBITO'|'CREDITO',
  //           kgBrutos, humedad, impurezasPct, volatilizacionPct, precioTn, provincia, sellos:true,
  //           deducciones:[{tipo, importe (neto sin IVA), ivaPct?}] }
  //  reglas: { sisa:[...], iibb:[...], normativa:(regimen, condicion, fecha) => alícuota % | undefined }
  function calcularLpg(datos, reglas = {}) {
    const avisos = [];
    const c = cultivo(datos.grano);
    const fecha = fechaIso(datos.fecha) || fechaIso(new Date().toISOString());
    let estado = estadoSisa(datos.estadoSisa);
    if (!estado) { avisos.push(`Estado SISA "${datos.estadoSisa ?? ''}" no reconocido: se calculó como Estado 1.`); estado = '1'; }
    const signo = String(datos.ajuste || '').toUpperCase() === 'CREDITO' ? -1 : 1;

    // Mermas (misma fórmula que la simulación de Agro): ((H - Hbase) / (100 - Hbase)) × 100.
    const kgBrutos = num(datos.kgBrutos);
    const humedad = num(datos.humedad) || c.humedadBase;
    const puntosExceso = Math.max(0, humedad - c.humedadBase);
    const mermaHumedadPct = humedad > c.humedadBase ? (puntosExceso / (100 - c.humedadBase)) * 100 : 0;
    const impurezasPct = num(datos.impurezasPct);
    const volatilizacionPct = num(datos.volatilizacionPct);
    const kgMermaHumedad = Math.round(kgBrutos * mermaHumedadPct / 100);
    const kgMermaImpurezas = Math.round(kgBrutos * impurezasPct / 100);
    const kgMermaVolatilizacion = Math.round(kgBrutos * volatilizacionPct / 100);
    const kgNetos = Math.max(0, kgBrutos - kgMermaHumedad - kgMermaImpurezas - kgMermaVolatilizacion);
    const precioTn = num(datos.precioTn);
    if (!(precioTn > 0)) avisos.push('Falta el precio por tonelada.');
    if (!(kgBrutos > 0)) avisos.push('Faltan los kilos.');

    const subtotal = redondear(kgNetos / 1000 * precioTn);
    // Productor monotributista: vende sin IVA (no hay débito ni retención de IVA) y, en regla, no sufre
    // retención de Ganancias. El IVA de las deducciones es costo, no crédito fiscal.
    const monotributo = /MONO/i.test(String(datos.condicionIva || ''));
    let ivaPct = monotributo ? 0 : c.ivaPct;
    const ivaNormativa = typeof reglas.normativa === 'function' ? reglas.normativa('IVA_GRANOS_ALICUOTA', c.clave, fecha) : undefined;
    if (Number.isFinite(ivaNormativa) && !monotributo) ivaPct = ivaNormativa;
    const ivaGrano = redondear(subtotal * ivaPct / 100);

    // Deducciones comerciales con su IVA (crédito fiscal) e Impuesto de Sellos por provincia.
    const deducciones = (datos.deducciones || []).filter((d) => num(d.importe)).map((d) => {
      const tipo = DEDUCCIONES[String(d.tipo || '').toUpperCase()] ? String(d.tipo).toUpperCase() : 'OTROS';
      const neto = redondear(num(d.importe));
      const pct = d.ivaPct != null && d.ivaPct !== '' ? num(d.ivaPct) : DEDUCCIONES[tipo].ivaPct;
      const iva = redondear(neto * pct / 100);
      return { tipo, nombre: d.nombre || DEDUCCIONES[tipo].nombre, neto, ivaPct: pct, iva, total: redondear(neto + iva) };
    });
    const prov = provincia(datos.provincia);
    const sellosPct = datos.sellos === false || !prov ? 0 : (SELLOS_PROVINCIA[prov] ?? 0);
    if (datos.sellos !== false && prov && SELLOS_PROVINCIA[prov] == null) avisos.push(`Sin alícuota de Sellos cargada para ${prov}: no se descontó.`);
    const sellos = redondear(subtotal * sellosPct / 100);
    if (sellos) deducciones.push({ tipo: 'SELLOS', nombre: `Impuesto de Sellos ${prov} (${sellosPct} %)`, neto: sellos, ivaPct: 0, iva: 0, total: sellos });

    // Retenciones (RG 4310: sobre el subtotal neto del grano).
    const sisa = reglaSisa(reglas.sisa, c.clave, estado, fecha);
    if (monotributo) avisos.push('Productor monotributista: la LPG va sin IVA y sin retenciones de IVA ni de Ganancias (si excede el régimen, cargalo como responsable inscripto).');
    else if (sisa.faltaRegla || sisa.usaDefecto) avisos.push(`Retenciones SISA de ${c.nombre} (${ESTADOS_SISA[estado]}) calculadas con la tabla por defecto: revisala en Fiscal → Reglas.`);
    let retIvaPct = num(sisa.regla.ivaPct);
    let retGanPct = num(sisa.regla.gananciasPct);
    const nIva = typeof reglas.normativa === 'function' ? reglas.normativa('IVA_GRANOS_RETENCION', `SISA_${estado}`, fecha) : undefined;
    const nGan = typeof reglas.normativa === 'function' ? reglas.normativa('GANANCIAS_GRANOS_RETENCION', `SISA_${estado}`, fecha) : undefined;
    if (Number.isFinite(nIva)) retIvaPct = nIva;
    if (Number.isFinite(nGan)) retGanPct = nGan;
    if (monotributo) { retIvaPct = 0; retGanPct = 0; }
    const iibb = reglaIibb(reglas.iibb, prov, fecha);
    const retIibbPct = num(iibb.regla.alicuotaPct);
    const retenciones = [
      { regimen: 'IVA', alicuotaPct: retIvaPct, base: subtotal, importe: redondear(subtotal * retIvaPct / 100), norma: RG4310, certificado: datos.certificadoIva || '' },
      { regimen: 'GANANCIAS', alicuotaPct: retGanPct, base: subtotal, importe: redondear(subtotal * retGanPct / 100), norma: RG4310, certificado: datos.certificadoGanancias || '' },
      { regimen: 'IIBB', provincia: prov, alicuotaPct: retIibbPct, base: subtotal, importe: redondear(subtotal * retIibbPct / 100), norma: iibb.regla.fuente || 'Ingresos Brutos provincial', certificado: datos.certificadoIibb || '' },
    ];
    const totalRetenciones = redondear(retenciones.reduce((s, r) => s + r.importe, 0));
    // Reintegro sistemático: solo Estado 1, devuelve la retención de IVA practicada.
    const reintegroIva = sisa.regla.reintegro && !monotributo ? retenciones[0].importe : 0;

    const totalDeducciones = redondear(deducciones.reduce((s, d) => s + d.total, 0));
    const ivaDeducciones = redondear(deducciones.reduce((s, d) => s + d.iva, 0));
    const neto = redondear(subtotal + ivaGrano - totalDeducciones - totalRetenciones);
    const conSigno = (v) => redondear(signo * v);
    // Campaña de la cosecha que se vende (la elige el usuario); si no viene, la de la fecha de la LPG.
    const campania = /^\d{4}\/\d{4}$/.test(String(datos.campania || '')) ? { tipo: c.campania, campania: datos.campania } : campaniaDe(c.nombre, fecha);

    return {
      grano: c.clave, cultivo: c.nombre, codigo: c.codigo, campania: campania.campania, tipoCampania: campania.tipo,
      fecha, tipo: String(datos.tipo || 'COMPRAVENTA').toUpperCase(), ajuste: String(datos.ajuste || '').toUpperCase(), signo,
      estadoSisa: estado, estadoSisaEtiqueta: ESTADOS_SISA[estado], provincia: prov,
      kgBrutos, humedad, humedadBase: c.humedadBase, mermaHumedadPct: redondear(mermaHumedadPct), impurezasPct, volatilizacionPct,
      kgMermaHumedad, kgMermaImpurezas, kgMermaVolatilizacion, kgNetos, precioTn,
      subtotal: conSigno(subtotal), ivaPct, ivaGrano: conSigno(ivaGrano),
      deducciones: deducciones.map((d) => ({ ...d, neto: conSigno(d.neto), iva: conSigno(d.iva), total: conSigno(d.total) })),
      totalDeducciones: conSigno(totalDeducciones), ivaDeducciones: conSigno(ivaDeducciones),
      retenciones: retenciones.map((r) => ({ ...r, base: conSigno(r.base), importe: conSigno(r.importe) })),
      totalRetenciones: conSigno(totalRetenciones), reintegroIva: conSigno(reintegroIva),
      neto: conSigno(neto), usaDefecto: Boolean(sisa.usaDefecto) && !monotributo, avisos, condicionIva: monotributo ? 'MONOTRIBUTO' : 'RI',
      normas: { lpg: RG3419, retenciones: RG4310 },
    };
  }

  // Campaña agrícola. Fina (Trigo): se siembra desde mayo y se cosecha en diciembre → 2025/2026 va de
  // marzo 2025 a febrero 2026. Gruesa (Soja, Maíz, Girasol): siembra de septiembre a enero y cosecha hasta
  // junio → 2025/2026 va de julio 2025 a junio 2026.
  function campaniaDe(nombreCultivo, fecha) {
    const c = cultivo(nombreCultivo);
    const f = fechaIso(fecha) || fechaIso(new Date().toISOString());
    const anio = Number(f.slice(0, 4));
    const mes = Number(f.slice(5, 7));
    const corte = c.campania === 'fina' ? 3 : 7;
    const inicio = mes >= corte ? anio : anio - 1;
    return { tipo: c.campania, campania: `${inicio}/${inicio + 1}` };
  }

  // Stock de granos por ubicación (silobolsa o celda) a partir de los movimientos, en kg.
  //  tipos: INGRESO_COSECHA (+), EGRESO_VENTA (−), TRASLADO (− origen, + ubicacionDestinoId), MERMA (−),
  //         AJUSTE (kg con signo).
  function stockPorUbicacion(movimientos) {
    const stock = {};
    const avisos = [];
    const mover = (id, g, kg) => {
      if (!id) return;
      stock[id] ||= { ubicacionId: id, grano: g, kg: 0 };
      if (g && !stock[id].grano) stock[id].grano = g;
      stock[id].kg = redondear(stock[id].kg + kg);
    };
    [...(movimientos || [])].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).forEach((m) => {
      const g = grano(m.grano);
      const kg = num(m.kg);
      const t = String(m.tipo || '').toUpperCase();
      if (t === 'INGRESO_COSECHA') mover(m.ubicacionId, g, kg);
      else if (t === 'EGRESO_VENTA' || t === 'MERMA') mover(m.ubicacionId, g, -kg);
      else if (t === 'TRASLADO') { mover(m.ubicacionId, g, -kg); mover(m.ubicacionDestinoId, g, kg); }
      else if (t === 'AJUSTE') mover(m.ubicacionId, g, kg);
      [m.ubicacionId, m.ubicacionDestinoId].forEach((id) => {
        if (id && stock[id] && stock[id].kg < 0) avisos.push(`${fechaIso(m.fecha)}: la ubicación ${id} queda con ${stock[id].kg} kg (más egresos que ingresos).`);
      });
    });
    return { stock, avisos };
  }
  function stockPorGrano(movimientos) {
    const { stock, avisos } = stockPorUbicacion(movimientos);
    const porGrano = Object.fromEntries(Object.keys(CULTIVOS).map((g) => [g, 0]));
    Object.values(stock).forEach((s) => { if (s.grano) porGrano[s.grano] = redondear((porGrano[s.grano] || 0) + s.kg); });
    return { porGrano, avisos };
  }

  // Vínculo lote ↔ RENSPA por campaña. Un lote puede tener una fina y una gruesa en el mismo año agrícola
  // (soja de segunda sobre trigo), pero no dos de la misma campaña.
  function validarVinculo(vinculo, { existentes = [], renspas = [], hoy } = {}) {
    const errores = [];
    let c = null;
    try { c = cultivo(vinculo.cultivo); } catch (e) { errores.push(e.message); }
    if (c && vinculo.tipo && vinculo.tipo !== c.campania) errores.push(`${c.nombre} es campaña ${c.campania}, no ${vinculo.tipo}.`);
    if (!vinculo.loteId) errores.push('Falta el lote.');
    if (!/^\d{4}\/\d{4}$/.test(String(vinculo.campania || ''))) errores.push('La campaña tiene que tener el formato 2025/2026.');
    const renspa = renspas.find((r) => r.id === vinculo.renspaId);
    if (!renspa) errores.push('Falta el RENSPA del lote.');
    else if (renspa.vence && renspa.vence < (fechaIso(vinculo.fechaSiembra) || fechaIso(hoy) || '0000')) errores.push(`El RENSPA ${renspa.numero} venció el ${renspa.vence}.`);
    const tipo = vinculo.tipo || c?.campania;
    if (existentes.some((e) => e.id !== vinculo.id && e.loteId === vinculo.loteId && e.campania === vinculo.campania && e.tipo === tipo))
      errores.push(`El lote ya tiene una campaña ${tipo} ${vinculo.campania}.`);
    return { ok: !errores.length, errores, tipo };
  }

  // IVA: cada comprobante cuenta una vez, en su mes (mismo criterio que Agro). lado: debito | credito.
  function movimientosIvaDeLpg(lpg) {
    const r = lpg.calculo || lpg;
    if (r.condicionIva === 'MONOTRIBUTO') return []; // sin IVA: no hay débito ni crédito
    const retIva = (r.retenciones || []).find((x) => x.regimen === 'IVA')?.importe || 0;
    const retGan = (r.retenciones || []).find((x) => x.regimen === 'GANANCIAS')?.importe || 0;
    const retIibb = (r.retenciones || []).find((x) => x.regimen === 'IIBB')?.importe || 0;
    const base = { fecha: r.fecha || lpg.fecha, comprobante: lpg.numero || lpg.coe || '—', origen: `LPG ${r.cultivo || ''}`.trim(), origenId: lpg.id };
    const movs = [{ ...base, lado: 'debito', neto: r.subtotal, iva: r.ivaGrano, retIva, retGanancias: retGan, otrasRet: retIibb, contraparte: lpg.comprador || '' }];
    if (r.ivaDeducciones) movs.push({ ...base, lado: 'credito', neto: redondear((r.totalDeducciones || 0) - (r.ivaDeducciones || 0)), iva: r.ivaDeducciones, retIva: 0, retGanancias: 0, otrasRet: 0, contraparte: lpg.comprador || '', origen: `Gastos LPG ${r.cultivo || ''}`.trim() });
    return movs;
  }
  const mesDe = (f) => (fechaIso(f) || '').slice(0, 7);
  // Posición mensual con saldo técnico y de libre disponibilidad arrastrados (igual que Agro y Tambo).
  function posicionIva(movs, mesRef, { anual = false } = {}) {
    const periodo = (f) => (anual ? (fechaIso(f) || '').slice(0, 4) : mesDe(f));
    const hoy = new Date();
    const actual = mesRef || (anual ? String(hoy.getFullYear()) : `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
    const porMes = {};
    (movs || []).forEach((m) => {
      const p = periodo(m.fecha);
      if (!p || p > actual) return;
      porMes[p] ||= { debito: 0, credito: 0, retIva: 0, retGanancias: 0, otrasRet: 0 };
      porMes[p][m.lado === 'credito' ? 'credito' : 'debito'] += num(m.iva);
      porMes[p].retIva += num(m.retIva);
      porMes[p].retGanancias += num(m.retGanancias);
      porMes[p].otrasRet += num(m.otrasRet);
    });
    let favorTecnico = 0, favorLibre = 0, resultado = null;
    const periodos = Object.keys(porMes).sort();
    if (!periodos.includes(actual)) periodos.push(actual);
    periodos.forEach((p) => {
      const x = porMes[p] || { debito: 0, credito: 0, retIva: 0, retGanancias: 0, otrasRet: 0 };
      const favorTecnicoAnterior = favorTecnico, favorLibreAnterior = favorLibre;
      let determinado = x.debito - x.credito - favorTecnico;
      favorTecnico = determinado < 0 ? -determinado : 0;
      determinado = Math.max(0, determinado);
      let aPagar = determinado - x.retIva - favorLibre;
      favorLibre = aPagar < 0 ? -aPagar : 0;
      aPagar = Math.max(0, aPagar);
      if (p === actual) resultado = { periodo: p, anual, ...Object.fromEntries(Object.entries(x).map(([k, v]) => [k, redondear(v)])), favorTecnicoAnterior: redondear(favorTecnicoAnterior), favorLibreAnterior: redondear(favorLibreAnterior), determinado: redondear(determinado), aPagar: redondear(aPagar), favorTecnico: redondear(favorTecnico), favorLibre: redondear(favorLibre) };
    });
    return resultado;
  }
  // Libro de IVA (ventas = débito, compras = crédito) del mes, en CSV con ";" (Excel en español).
  function libroIvaCsv(movs, mes, lado) {
    const filas = (movs || []).filter((m) => (lado === 'credito' ? m.lado === 'credito' : m.lado !== 'credito') && mesDe(m.fecha) === mes)
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const n = (v) => redondear(v).toFixed(2).replace('.', ',');
    const cab = ['Fecha', 'Comprobante', 'Contraparte', 'Concepto', 'Neto gravado', 'IVA', 'Ret. IVA', 'Ret. Ganancias', 'Otras ret.'];
    return [cab.map(esc).join(';'), ...filas.map((m) => [fechaIso(m.fecha), m.comprobante, m.contraparte, m.origen, n(m.neto), n(m.iva), n(m.retIva), n(m.retGanancias), n(m.otrasRet)].map((v, i) => (i >= 4 ? v : esc(v))).join(';'))].join('\r\n');
  }

  // Obligaciones de información del SISA: existencias de granos y áreas sembradas (fina y gruesa). Las
  // fechas límite las carga el usuario (config.vencimientos = [{tipo:'EXISTENCIAS'|'AREAS_FINA'|'AREAS_GRUESA', vence}]).
  function obligacionesSisa({ config = {}, stockKg = {}, vinculos = [], hoy } = {}) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    const dias = (f) => Math.round((Date.parse(`${fechaIso(f)}T12:00:00Z`) - Date.parse(`${h}T12:00:00Z`)) / 864e5);
    const alertas = [];
    if (!config.estado) alertas.push({ nivel: 'warn', texto: 'Cargá tu estado en el SISA: define las retenciones de cada LPG.' });
    if (config.actualizado && dias(config.actualizado) < -365) alertas.push({ nivel: 'warn', texto: `El estado SISA se actualizó el ${config.actualizado}: confirmalo en ARCA.` });
    const totalTn = Object.values(stockKg).reduce((s, v) => s + num(v), 0) / 1000;
    const haPor = (tipo) => vinculos.filter((v) => v.tipo === tipo).reduce((s, v) => s + num(v.superficieHa), 0);
    (config.vencimientos || []).forEach((v) => {
      if (!v.vence) return;
      const d = dias(v.vence);
      const que = v.tipo === 'EXISTENCIAS' ? `Existencias de granos (${redondear(totalTn).toLocaleString('es-AR')} t en silobolsas y celdas)` : v.tipo === 'AREAS_FINA' ? `Áreas sembradas campaña fina (${redondear(haPor('fina'))} ha)` : `Áreas sembradas campaña gruesa (${redondear(haPor('gruesa'))} ha)`;
      if (v.presentado) return;
      if (d < 0) alertas.push({ nivel: 'danger', texto: `SISA: ${que} — venció hace ${-d} día(s).` });
      else if (d <= 15) alertas.push({ nivel: 'warn', texto: `SISA: ${que} — vence en ${d} día(s).` });
    });
    return alertas;
  }

  // Arrendamiento rural pagado en pesos: retención de Ganancias RG 830 (mismos valores que
  // packages/core-fiscal-arca/retenciones-locacion-rural.js). La locación rural con destino agropecuario
  // está exenta de IVA. Pagado en quintales: es un egreso de stock (no lleva retención en pesos).
  const RG830_LOCACION_RURAL = { minimoNoImponibleMensual: 11200, alicuotaInscripto: 6, alicuotaNoInscriptoHumana: 28, alicuotaNoInscriptoJuridica: 25, minimoRetencion: 240, norma: 'RG (AFIP) 830/2000 — locación de inmuebles rurales' };
  function retencionArrendamiento({ importe, inscripto = true, personaJuridica = false, acumuladoMes = 0 }) {
    const monto = num(importe);
    if (!(monto > 0)) return { retencion: 0, base: 0, alicuotaPct: 0, neto: 0, norma: RG830_LOCACION_RURAL.norma, motivo: 'Sin importe.' };
    let base, alicuotaPct;
    if (inscripto) {
      const excedente = Math.max(0, num(acumuladoMes) + monto - RG830_LOCACION_RURAL.minimoNoImponibleMensual);
      base = Math.min(monto, excedente);
      alicuotaPct = RG830_LOCACION_RURAL.alicuotaInscripto;
    } else {
      base = monto;
      alicuotaPct = personaJuridica ? RG830_LOCACION_RURAL.alicuotaNoInscriptoJuridica : RG830_LOCACION_RURAL.alicuotaNoInscriptoHumana;
    }
    let retencion = redondear(base * alicuotaPct / 100);
    const motivo = retencion < RG830_LOCACION_RURAL.minimoRetencion ? `No se retiene: da menos de $${RG830_LOCACION_RURAL.minimoRetencion}.` : '';
    if (motivo) retencion = 0;
    return { retencion, base: redondear(base), alicuotaPct, neto: redondear(monto - retencion), norma: RG830_LOCACION_RURAL.norma, motivo };
  }

  // ================= COSTOS Y RESULTADOS (pesos; USD informativo) =================
  // Mismos criterios que Agro, Ganadería y Tambo:
  //  - Responsable inscripto: el costo es el NETO (el IVA es crédito fiscal). Monotributo: con IVA.
  //  - Insumos: la compra entra al stock (no es costo); es costo al consumirse en una labor, a la cantidad
  //    usada × último precio de compra a esa fecha.
  //  - Labores: solo las REALIZADAS (insumos + horas de máquina × costo horario o contratista).
  //  - Estructura (sueldos con cargas sociales, amortizaciones, servicios sin lote, arrendamientos) se
  //    reparte por hectárea entre los lotes de la campaña.
  const CARGAS_SOCIALES_PCT_DEFECTO = 36.5;
  const TIPOS_LABOR = ['Siembra', 'Fertilización', 'Aplicación', 'Cosecha', 'Labranza', 'Otro'];
  const CATEGORIAS_INSUMO = ['Semilla', 'Fertilizante', 'Fitosanitario', 'Combustible', 'Lubricante', 'Repuesto', 'Otro'];
  const CATEGORIAS_SERVICIO = ['Contratista', 'Flete', 'Servicios', 'Administración', 'Honorarios', 'Seguros', 'Otro'];
  const normNombre = (t) => sinAcentos(t).replace(/\s+/g, ' ');
  const esRI = (condicion) => !/MONO/i.test(String(condicion || 'RI'));

  // Período de una campaña: gruesa 2025/2026 = jul 2025 – jun 2026; fina 2025/2026 = mar 2025 – feb 2026.
  function periodoCampania(campania, tipo = 'gruesa') {
    const inicio = Number(String(campania).slice(0, 4));
    if (!inicio) return null;
    return tipo === 'fina'
      ? { desde: `${inicio}-03-01`, hasta: `${inicio + 1}-02-${(inicio + 1) % 4 === 0 ? 29 : 28}` }
      : { desde: `${inicio}-07-01`, hasta: `${inicio + 1}-06-30` };
  }

  // Costo de una compra: neto si es responsable inscripto, con IVA si es monotributo.
  function costoCompra(compra, condicionIva) {
    const neto = num(compra.neto);
    const iva = compra.iva != null && compra.iva !== '' ? num(compra.iva) : redondear(neto * num(compra.ivaPct ?? 21) / 100);
    return redondear(esRI(condicionIva) ? neto : neto + iva);
  }
  // Ingresos al stock de insumos a partir de las compras de insumos (precio unitario según la condición de IVA).
  function ingresosInsumo(compras, condicionIva) {
    return (compras || []).filter((c) => String(c.tipo || 'INSUMO').toUpperCase() === 'INSUMO' && num(c.cantidad) > 0)
      .map((c) => ({ fecha: fechaIso(c.fecha), insumo: normNombre(c.insumo), cantidad: num(c.cantidad), unidad: c.unidad || '', precio: costoCompra(c, condicionIva) / num(c.cantidad), compraId: c.id }));
  }
  // Último precio de compra del insumo a esa fecha (si no hubo antes, el primero posterior).
  function precioInsumo(ingresos, insumo, fecha) {
    const n = normNombre(insumo);
    const f = fechaIso(fecha) || '9999-12-31';
    const lista = (ingresos || []).filter((i) => i.insumo === n && i.precio > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (!lista.length) return null;
    const previos = lista.filter((i) => i.fecha <= f);
    return (previos.length ? previos[previos.length - 1] : lista[0]).precio;
  }
  // Stock de insumos: ingresos de compras menos consumos de labores realizadas (+ ajustes).
  function stockInsumos(compras, labores, ajustes = [], condicionIva) {
    const st = {};
    ingresosInsumo(compras, condicionIva).forEach((i) => { st[i.insumo] ||= { insumo: i.insumo, cantidad: 0, unidad: i.unidad }; st[i.insumo].cantidad += i.cantidad; });
    (labores || []).filter((l) => l.estado === 'REALIZADA').forEach((l) => (l.insumos || []).forEach((u) => {
      const n = normNombre(u.insumo); st[n] ||= { insumo: n, cantidad: 0, unidad: u.unidad || '' }; st[n].cantidad -= num(u.cantidad);
    }));
    (ajustes || []).forEach((a) => { const n = normNombre(a.insumo); st[n] ||= { insumo: n, cantidad: 0, unidad: a.unidad || '' }; st[n].cantidad += num(a.cantidad); });
    Object.values(st).forEach((s) => { s.cantidad = redondear(s.cantidad); });
    return st;
  }

  // Todas las filas de costo de un período. Cada fila: {fecha, grupo, origen, concepto, importe, loteId|null,
  // cultivo|null, campania|null, directo, motivo?}. Las filas con importe 0 y motivo explican por qué no suman.
  function costosDelPeriodo(d, desde, hasta) {
    const cond = d.condicionIva || 'RI';
    const dentro = (f) => { const x = fechaIso(f); return x && x >= desde && x <= hasta; };
    const filas = [];
    const push = (f) => filas.push({ loteId: null, cultivo: null, campania: null, directo: false, ...f, importe: redondear(f.importe) });
    const ingresos = ingresosInsumo(d.compras, cond);
    // Compras: servicios con lote = directo; sin lote = estructura; insumos van al stock.
    (d.compras || []).forEach((c) => {
      if (!dentro(c.fecha)) return;
      if (String(c.tipo || 'INSUMO').toUpperCase() === 'INSUMO') {
        push({ fecha: c.fecha, grupo: 'Insumos', origen: 'Compra', concepto: `${c.insumo} (${c.proveedor || ''})`, importe: 0, motivo: 'Entra al stock: es costo cuando se usa en una labor.' });
        return;
      }
      const lote = c.loteId ? (d.lotes || []).find((l) => l.id === c.loteId) : null;
      push({ fecha: c.fecha, grupo: c.categoria === 'Contratista' || c.categoria === 'Flete' ? 'Contratistas y servicios' : 'Estructura', origen: 'Compra', concepto: `${c.categoria || 'Servicio'}: ${c.concepto || c.proveedor || ''}`, importe: costoCompra(c, cond), loteId: lote?.id || null, cultivo: grano(c.cultivo) || null, campania: c.campania || null, directo: Boolean(lote) });
    });
    // Labores realizadas: insumos al último precio + máquina o contratista.
    (d.labores || []).forEach((l) => {
      if (!dentro(l.fecha)) return;
      if (l.estado !== 'REALIZADA') { push({ fecha: l.fecha, grupo: 'Labores', origen: 'Labor', concepto: `${l.tipo} (planificada)`, importe: 0, loteId: l.loteId, motivo: 'Planificada: suma cuando se marca realizada.' }); return; }
      const base = { fecha: l.fecha, loteId: l.loteId, cultivo: grano(l.cultivo), campania: l.campania || null, directo: true, origen: `Labor ${l.tipo}` };
      (l.insumos || []).forEach((u) => {
        const precio = precioInsumo(ingresos, u.insumo, l.fecha);
        push({ ...base, grupo: 'Insumos', concepto: `${u.insumo}: ${num(u.cantidad)} ${u.unidad || ''}`.trim(), importe: precio === null ? 0 : num(u.cantidad) * precio, motivo: precio === null ? 'Sin compra cargada de este insumo: no tiene precio.' : '' });
      });
      const equipo = (d.equipos || []).find((e) => e.id === l.equipoId);
      if (num(l.horas) && equipo) push({ ...base, grupo: 'Labores y maquinaria', concepto: `${equipo.nombre}: ${num(l.horas)} h × ${num(equipo.costoHora)}`, importe: num(l.horas) * num(equipo.costoHora) });
      if (num(l.contratistaNeto)) push({ ...base, grupo: 'Contratistas y servicios', concepto: `Contratista ${l.contratista || ''}`.trim(), importe: esRI(cond) ? num(l.contratistaNeto) : num(l.contratistaNeto) * 1.21 });
    });
    // Comercialización: deducciones de las LPG (neto sin IVA si RI) por cultivo y campaña.
    (d.lpg || []).forEach((l) => {
      const c = l.calculo;
      if (!c || !dentro(c.fecha)) return;
      (c.deducciones || []).forEach((x) => push({ fecha: c.fecha, grupo: 'Comercialización', origen: `LPG ${l.numero || ''}`.trim(), concepto: x.nombre, importe: esRI(cond) ? x.neto : x.total, cultivo: c.grano, campania: c.campania, directo: true }));
    });
    // Arrendamientos: pagos en pesos y en quintales (valuados al precio de la última LPG del grano).
    (d.contratos || []).forEach((k) => (k.pagos || []).forEach((p) => {
      if (!dentro(p.fecha)) return;
      let importe = num(p.importe);
      let motivo = '';
      if (!importe && num(p.kg)) {
        const ult = (d.lpg || []).filter((l) => l.calculo?.grano === k.grano && l.calculo.signo > 0 && fechaIso(l.calculo.fecha) <= fechaIso(p.fecha)).sort((a, b) => b.calculo.fecha.localeCompare(a.calculo.fecha))[0]
          || (d.lpg || []).filter((l) => l.calculo?.grano === k.grano && l.calculo.signo > 0)[0];
        importe = ult ? num(p.kg) / 1000 * ult.calculo.precioTn : 0;
        if (!ult) motivo = `Sin LPG de ${CULTIVOS[k.grano]?.nombre || 'ese grano'} para valuar los quintales.`;
      }
      push({ fecha: p.fecha, grupo: 'Arrendamiento', origen: 'Arrendamiento', concepto: `${k.campo}${num(p.kg) ? ` (${redondear(num(p.kg) / 100)} qq)` : ''}`, importe, campo: k.campo, motivo });
    }));
    // Personal: sueldo + cargas sociales por cada mes del período en que estuvo activo (solo meses ya
    // transcurridos: una campaña en curso no suma sueldos ni amortizaciones futuras).
    const hoyIso = fechaIso(d.hoy) || fechaIso(new Date().toISOString());
    const tope = hasta < hoyIso ? hasta : hoyIso;
    const meses = [];
    for (let f = new Date(`${desde.slice(0, 7)}-01T12:00:00Z`); f.toISOString().slice(0, 10) <= tope; f.setUTCMonth(f.getUTCMonth() + 1)) meses.push(f.toISOString().slice(0, 7));
    (d.empleados || []).forEach((e) => {
      const cargas = e.cargasPct === '' || e.cargasPct == null ? CARGAS_SOCIALES_PCT_DEFECTO : num(e.cargasPct);
      meses.forEach((m) => {
        if (e.ingreso && fechaIso(e.ingreso).slice(0, 7) > m) return;
        if (e.baja && fechaIso(e.baja).slice(0, 7) < m) return;
        push({ fecha: `${m}-01`, grupo: 'Personal', origen: 'Sueldos', concepto: `${e.nombre} (cargas ${cargas} %)`, importe: num(e.sueldo) * (1 + cargas / 100) });
      });
    });
    // Amortización lineal de equipos: (valor − residual) / vida útil, por mes, desde el alta, durante la
    // vida útil y hasta la baja del equipo.
    (d.equipos || []).forEach((e) => {
      const anual = num(e.vidaUtilAnios) > 0 ? (num(e.valor) - num(e.valorResidual)) / num(e.vidaUtilAnios) : 0;
      if (!(anual > 0)) return;
      meses.forEach((m) => {
        if (!amortizaEnMes(e, m)) return;
        push({ fecha: `${m}-01`, grupo: 'Amortizaciones', origen: 'Equipos', concepto: e.nombre, importe: anual / 12 });
      });
    });
    return filas;
  }

  // IVA de una compra: crédito fiscal (solo responsable inscripto; el monotributista no computa).
  function movimientosIvaDeCompra(compra, condicionIva) {
    if (!esRI(condicionIva)) return [];
    const neto = num(compra.neto);
    const iva = compra.iva != null && compra.iva !== '' ? num(compra.iva) : redondear(neto * num(compra.ivaPct ?? 21) / 100);
    if (!iva) return [];
    return [{ fecha: fechaIso(compra.fecha), lado: 'credito', neto, iva, retIva: 0, retGanancias: 0, otrasRet: 0, comprobante: compra.comprobante || '—', contraparte: compra.proveedor || '', origen: `Compra ${compra.tipo === 'SERVICIO' ? compra.categoria || 'servicio' : compra.insumo || ''}`.trim(), origenId: compra.id }];
  }

  // Resultado por lote de una campaña (fina y gruesa del mismo año agrícola).
  //  Ingresos: subtotal neto de las LPG del cultivo y campaña, repartido por hectárea entre sus lotes.
  //  Directos: labores, servicios con lote y comercialización (esta última por hectárea dentro del cultivo).
  //  Estructura: costos sin lote del período (gruesa jul–jun) repartidos por hectárea-campaña; los
  //  arrendamientos de un campo van solo a los lotes de ese campo.
  function resultadoCampania(d, campania, { tipoCambio } = {}) {
    const vinculos = (d.lotesCampania || []).filter((v) => v.campania === campania);
    const per = periodoCampania(campania, 'gruesa');
    const perFina = periodoCampania(campania, 'fina');
    const desde = perFina.desde < per.desde ? perFina.desde : per.desde;
    const filas = costosDelPeriodo(d, desde, per.hasta);
    const lotesPorId = Object.fromEntries((d.lotes || []).map((l) => [l.id, l]));
    const haTotal = vinculos.reduce((s, v) => s + num(v.superficieHa), 0);
    const haCultivo = (g) => vinculos.filter((v) => v.cultivo === g).reduce((s, v) => s + num(v.superficieHa), 0);
    const haCampo = (campo) => vinculos.filter((v) => normNombre(lotesPorId[v.loteId]?.campo) === normNombre(campo)).reduce((s, v) => s + num(v.superficieHa), 0);
    // Filas de la campaña: las que tienen campaña, por su campaña; la estructura sin campaña, por el
    // período de la gruesa (jul–jun), el mismo con el que se reparte entre los lotes.
    const enPeriodo = (f) => fechaIso(f.fecha) >= per.desde && fechaIso(f.fecha) <= per.hasta;
    const filasCampania = filas.filter((f) => (f.campania ? f.campania === campania : f.directo || enPeriodo(f)));
    // Kilos cosechados por lote (ingresos de cosecha con lote) y LPG por cultivo.
    const lpgCamp = (d.lpg || []).filter((l) => l.calculo?.campania === campania);
    // Producción valuada por cultivo: ventas (LPG) + lo cosechado y todavía no vendido, al último precio
    // de LPG del grano. Se reparte entre los lotes según lo que cosechó cada uno (o por hectárea).
    const kgCosechaLote = (loteId, g) => (d.movimientosGrano || []).filter((m) => m.tipo === 'INGRESO_COSECHA' && m.loteId === loteId && grano(m.grano) === g && campaniaDe(CULTIVOS[g].nombre, m.fecha).campania === campania).reduce((s, m) => s + num(m.kg), 0);
    const porCultivo = {};
    [...new Set(vinculos.map((v) => v.cultivo))].forEach((g) => {
      const lpgs = lpgCamp.filter((l) => l.calculo.grano === g);
      const ventas = lpgs.reduce((s, l) => s + num(l.calculo.subtotal), 0);
      const kgVendidos = lpgs.reduce((s, l) => s + num(l.calculo.kgNetos) * (l.calculo.signo || 1), 0);
      const kgCosechados = vinculos.filter((v) => v.cultivo === g).reduce((s, v) => s + kgCosechaLote(v.loteId, g), 0);
      const ultima = (d.lpg || []).filter((l) => l.calculo?.grano === g && (l.calculo.signo || 1) > 0).sort((a, b) => b.calculo.fecha.localeCompare(a.calculo.fecha))[0];
      const pizarra = d.preciosReferencia?.[g];
      const precioTn = ultima ? num(ultima.calculo.precioTn) : pizarra ? num(pizarra) : null;
      const fuentePrecio = ultima ? 'última LPG' : pizarra ? 'pizarra Rosario' : '';
      const kgSinVender = Math.max(0, kgCosechados - kgVendidos);
      porCultivo[g] = { ventas, kgVendidos, kgCosechados, kgSinVender, precioTn, fuentePrecio, stockValuado: precioTn ? kgSinVender / 1000 * precioTn : 0, sinPrecio: kgSinVender > 0 && !precioTn };
    });
    const res = vinculos.map((v) => {
      const lote = lotesPorId[v.loteId] || {};
      const ha = num(v.superficieHa);
      const parteCultivo = haCultivo(v.cultivo) ? ha / haCultivo(v.cultivo) : 0;
      const pc = porCultivo[v.cultivo];
      const kgLote = kgCosechaLote(v.loteId, v.cultivo);
      const parteProduccion = pc.kgCosechados > 0 ? kgLote / pc.kgCosechados : parteCultivo;
      const ventasLote = pc.ventas * parteProduccion;
      const stockLote = pc.stockValuado * parteProduccion;
      const ingresos = ventasLote + stockLote;
      const directosLote = filasCampania.filter((f) => f.directo && f.loteId === v.loteId && (!f.cultivo || f.cultivo === v.cultivo)).reduce((s, f) => s + f.importe, 0);
      const comercializacion = filasCampania.filter((f) => f.grupo === 'Comercialización' && f.cultivo === v.cultivo).reduce((s, f) => s + f.importe, 0) * parteProduccion;
      const estructuraGeneral = filas.filter((f) => !f.directo && f.grupo !== 'Arrendamiento' && fechaIso(f.fecha) >= per.desde && fechaIso(f.fecha) <= per.hasta).reduce((s, f) => s + f.importe, 0);
      const arrendCampo = filas.filter((f) => f.grupo === 'Arrendamiento' && fechaIso(f.fecha) >= per.desde && fechaIso(f.fecha) <= per.hasta);
      const arrend = arrendCampo.reduce((s, f) => {
        const hc = haCampo(f.campo);
        if (hc > 0) return s + (normNombre(f.campo) === normNombre(lote.campo) ? f.importe * ha / hc : 0);
        return s + (haTotal ? f.importe * ha / haTotal : 0);
      }, 0);
      const estructura = (haTotal ? estructuraGeneral * ha / haTotal : 0) + arrend;
      const kgCosecha = kgLote;
      const directos = directosLote + comercializacion;
      const margenBruto = ingresos - directos;
      const resultado = margenBruto - estructura;
      const t = kgCosecha / 1000;
      return {
        loteId: v.loteId, lote: lote.codigo || '', campo: lote.campo || '', cultivo: v.cultivo, tipo: v.tipo, ha,
        ingresos: redondear(ingresos), ventas: redondear(ventasLote), stockValuado: redondear(stockLote), directos: redondear(directos), comercializacion: redondear(comercializacion), margenBruto: redondear(margenBruto),
        estructura: redondear(estructura), resultado: redondear(resultado), kgCosecha, rindeTnHa: ha ? redondear(t / ha) : 0,
        costoHa: ha ? redondear((directos + estructura) / ha) : 0, costoTn: t ? redondear((directos + estructura) / t) : null,
        resultadoHaUsd: tipoCambio && ha ? redondear(resultado / ha / tipoCambio) : null, costoTnUsd: tipoCambio && t ? redondear((directos + estructura) / t / tipoCambio) : null,
      };
    });
    const sum = (k) => redondear(res.reduce((s, r) => s + (r[k] || 0), 0));
    const porGrupo = {};
    filasCampania.forEach((f) => { porGrupo[f.grupo] = redondear((porGrupo[f.grupo] || 0) + f.importe); });
    return { campania, periodo: { desde, hasta: per.hasta }, haTotal, lotes: res, porCultivo, totales: { ventas: sum('ventas'), stockValuado: sum('stockValuado'), ingresos: sum('ingresos'), directos: sum('directos'), margenBruto: sum('margenBruto'), estructura: sum('estructura'), resultado: sum('resultado') }, porGrupo, filas: filasCampania };
  }

  // ================= ARCA: Cartas de Porte Electrónicas (CPE) =================
  // RG (AFIP) 5017/2021: todo traslado de granos va con CPE. Tipo VENTA: el grano sale hacia el comprador
  // (el stock lo descuenta la LPG); TRASLADO: entre ubicaciones propias (mueve el stock).
  const RG5017 = 'RG (AFIP) 5017/2021 — Carta de Porte Electrónica para el traslado de granos';
  const ESTADOS_CPE = ['PENDIENTE', 'ACTIVA', 'CONFIRMADA', 'ANULADA'];
  function alertasCpe({ cpes = [], lpg = [], hoy } = {}) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    const dias = (f) => Math.round((Date.parse(`${h}T12:00:00Z`) - Date.parse(`${fechaIso(f)}T12:00:00Z`)) / 864e5);
    const alertas = [];
    const validas = cpes.filter((c) => c.estado !== 'ANULADA');
    lpg.filter((l) => (l.calculo?.signo || 1) > 0 && !l.datos?.ajuste).forEach((l) => {
      const tiene = validas.some((c) => c.lpgId === l.id) || (l.cpe && validas.some((c) => String(c.numero).trim() === String(l.cpe).trim()));
      if (!tiene) alertas.push({ nivel: 'warn', texto: `LPG ${l.numero || l.fecha} (${l.calculo?.cultivo || ''}) sin Carta de Porte vinculada.` });
    });
    validas.forEach((c) => {
      if (c.estado === 'ACTIVA' && dias(c.fecha) > 5) alertas.push({ nivel: 'warn', texto: `CPE ${c.numero}: activa hace ${dias(c.fecha)} días sin confirmar el arribo.` });
      if (c.tipo === 'VENTA' && c.estado === 'CONFIRMADA' && !c.lpgId && dias(c.fecha) > 30) alertas.push({ nivel: 'warn', texto: `CPE ${c.numero}: grano entregado hace ${dias(c.fecha)} días sin LPG (pedile la liquidación al comprador).` });
      if (num(c.kgOrigen) && num(c.kgDestino)) {
        const dif = (num(c.kgOrigen) - num(c.kgDestino)) / num(c.kgOrigen) * 100;
        if (Math.abs(dif) > 0.5) alertas.push({ nivel: Math.abs(dif) > 1 ? 'danger' : 'warn', texto: `CPE ${c.numero}: diferencia de ${redondear(dif)} % entre kilos de origen y de destino.` });
      }
    });
    return alertas;
  }

  // ================= SENASA: fitosanitarios, carencia, recetas, aplicadores y envases =================
  // Carencia: días entre la última aplicación de un producto y la cosecha (marbete aprobado por SENASA).
  function carencias({ labores = [], productos = [], hoy } = {}) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    const prod = (n) => productos.find((p) => normNombre(p.nombre) === normNombre(n));
    const porLote = {};
    labores.filter((l) => l.estado === 'REALIZADA' && l.tipo === 'Aplicación').forEach((l) => {
      (l.insumos || []).forEach((u) => {
        const p = prod(u.insumo);
        if (!p || !(num(p.carenciaDias) > 0)) return;
        const libera = new Date(`${fechaIso(l.fecha)}T12:00:00Z`);
        libera.setUTCDate(libera.getUTCDate() + num(p.carenciaDias));
        const f = libera.toISOString().slice(0, 10);
        const k = `${l.loteId}|${grano(l.cultivo)}|${l.campania || ''}`;
        if (!porLote[k] || porLote[k].libera < f) porLote[k] = { loteId: l.loteId, cultivo: grano(l.cultivo), campania: l.campania || '', producto: p.nombre, aplicacion: fechaIso(l.fecha), libera: f };
      });
    });
    const lista = Object.values(porLote);
    lista.forEach((c) => { c.activa = c.libera > h; c.diasRestantes = Math.max(0, Math.round((Date.parse(`${c.libera}T12:00:00Z`) - Date.parse(`${h}T12:00:00Z`)) / 864e5)); });
    return lista;
  }
  // Cosechas hechas antes de que termine la carencia (labor de cosecha o ingreso de cosecha del lote).
  function violacionesCarencia({ labores = [], productos = [], movimientosGrano = [] } = {}) {
    const lista = carencias({ labores, productos, hoy: '9999-12-31' });
    const out = [];
    lista.forEach((c) => {
      const cosechas = [
        ...labores.filter((l) => l.estado === 'REALIZADA' && l.tipo === 'Cosecha' && l.loteId === c.loteId && grano(l.cultivo) === c.cultivo).map((l) => fechaIso(l.fecha)),
        ...movimientosGrano.filter((m) => m.tipo === 'INGRESO_COSECHA' && m.loteId === c.loteId && grano(m.grano) === c.cultivo).map((m) => fechaIso(m.fecha)),
      ].filter((f) => f >= c.aplicacion && f < c.libera);
      if (cosechas.length) out.push({ ...c, cosecha: cosechas.sort()[0] });
    });
    return out;
  }
  // Envases vacíos de fitosanitarios a partir de las aplicaciones realizadas (Ley 27.279).
  function envasesDeAplicaciones({ labores = [], productos = [] } = {}) {
    const out = [];
    labores.filter((l) => l.estado === 'REALIZADA' && l.tipo === 'Aplicación').forEach((l) => (l.insumos || []).forEach((u, i) => {
      const p = productos.find((x) => normNombre(x.nombre) === normNombre(u.insumo));
      if (!p || !(num(p.litrosPorEnvase) > 0)) return;
      out.push({ id: `auto-${l.id}-${i}`, origenLaborId: l.id, fecha: fechaIso(l.fecha), producto: p.nombre, cantidad: Math.ceil(num(u.cantidad) / num(p.litrosPorEnvase)), capacidad: `${p.litrosPorEnvase} ${p.unidad || 'l'}`, loteId: l.loteId });
    }));
    return out;
  }
  const LEY_FITO = 'Ley 27.279 (envases vacíos de fitosanitarios) y leyes provinciales de agroquímicos (receta agronómica)';
  function alertasSenasa({ labores = [], productos = [], equipos = [], envases = [], recetas = [], renspa = [], lotes = [], lotesCampania = [], movimientosGrano = [], hoy } = {}) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    const dias = (f) => Math.round((Date.parse(`${fechaIso(f)}T12:00:00Z`) - Date.parse(`${h}T12:00:00Z`)) / 864e5);
    const loteCod = (id) => lotes.find((l) => l.id === id)?.codigo || id;
    const alertas = [];
    labores.filter((l) => l.tipo === 'Aplicación').forEach((l) => {
      alertas.push(...controlesAplicacion(l, { recetas, productos, lotes }));
      (l.insumos || []).forEach((u) => {
        const p = productos.find((x) => normNombre(x.nombre) === normNombre(u.insumo));
        if (!p) alertas.push({ nivel: 'warn', texto: `${u.insumo} (aplicación ${l.fecha}): no está en el registro de fitosanitarios (n.º SENASA y carencia).` });
        else if (!p.registroSenasa) alertas.push({ nivel: 'warn', texto: `${p.nombre}: falta el número de inscripción en SENASA.` });
      });
      const e = equipos.find((x) => x.id === l.equipoId);
      if (e && e.esAplicador) {
        if (!e.habilitacion) alertas.push({ nivel: 'danger', texto: `${e.nombre}: pulverizadora sin habilitación provincial cargada.` });
        else if (e.habilitacionVence && fechaIso(e.habilitacionVence) < fechaIso(l.fecha)) alertas.push({ nivel: 'danger', texto: `${e.nombre}: aplicó el ${l.fecha} con la habilitación vencida (${e.habilitacionVence}).` });
      }
    });
    equipos.filter((e) => e.esAplicador && e.habilitacionVence).forEach((e) => {
      const d = dias(e.habilitacionVence);
      if (d < 0) alertas.push({ nivel: 'danger', texto: `${e.nombre}: habilitación de aplicador vencida hace ${-d} día(s).` });
      else if (d <= 30) alertas.push({ nivel: 'warn', texto: `${e.nombre}: habilitación de aplicador vence en ${d} día(s).` });
    });
    recetas.filter((r) => r.estado !== 'ANULADA').forEach((r) => alertas.push(...controlesReceta(r, { productos, equipos, hoy: h }).map((a) => ({ ...a, texto: a.texto }))));
    carencias({ labores, productos, hoy: h }).filter((c) => c.activa).forEach((c) => alertas.push({ nivel: 'warn', texto: `${loteCod(c.loteId)} (${CULTIVOS[c.cultivo]?.nombre || ''}): en carencia por ${c.producto} hasta el ${c.libera} — no cosechar antes.` }));
    violacionesCarencia({ labores, productos, movimientosGrano }).forEach((c) => alertas.push({ nivel: 'danger', texto: `${loteCod(c.loteId)}: cosechado el ${c.cosecha} dentro de la carencia de ${c.producto} (liberaba el ${c.libera}).` }));
    const pendientes = envases.filter((x) => x.estado !== 'ENTREGADO_CAT');
    const viejos = pendientes.filter((x) => dias(x.fecha) < -30);
    if (viejos.length) alertas.push({ nivel: 'warn', texto: `${viejos.reduce((s, x) => s + num(x.cantidad), 0)} envase(s) de fitosanitarios con más de 30 días sin entregar al CAT.` });
    pendientes.filter((x) => x.estado === 'PENDIENTE_LAVADO').forEach((x) => alertas.push({ nivel: 'warn', texto: `${x.cantidad} envase(s) de ${x.producto} sin triple lavado.` }));
    return alertas;
  }

  // ================= Equipo: amortización, mantenimiento y costo operativo =================
  // El costo horario cargado en cada equipo (combustible, mantenimiento y operario) es el que se imputa a
  // las labores; la amortización va a estructura. Los registros de mantenimiento y el combustible de las
  // labores sirven para comparar el costo real por hora con el cargado (no se suman dos veces).
  const CATEGORIAS_EQUIPO = ['Tractor', 'Sembradora', 'Pulverizadora', 'Cosechadora', 'Fertilizadora', 'Tolva / acoplado', 'Camión / utilitario', 'Embolsadora / extractora', 'Otro'];
  const TIPOS_MANTENIMIENTO = { SERVICE: 'Service preventivo', REPARACION: 'Reparación', INSPECCION: 'Inspección / control', NEUMATICOS: 'Neumáticos', COMBUSTIBLE: 'Carga de combustible', OTRO: 'Otro' };
  const mesesEntre = (a, b) => { const [ya, ma] = fechaIso(a).split('-').map(Number); const [yb, mb] = fechaIso(b).split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
  function amortizacionEquipo(e, hoy) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    const vida = num(e.vidaUtilAnios);
    const base = num(e.valor) - num(e.valorResidual);
    const anual = vida > 0 && base > 0 ? base / vida : 0;
    const hasta = e.baja && fechaIso(e.baja) < h ? fechaIso(e.baja) : h;
    const meses = e.fechaAlta ? Math.max(0, Math.min(vida * 12, mesesEntre(e.fechaAlta, hasta) + 1)) : 0;
    const acumulada = anual / 12 * meses;
    return { anual: redondear(anual), mensual: redondear(anual / 12), acumulada: redondear(acumulada), valorLibro: redondear(num(e.valor) - acumulada), amortizado: vida > 0 && meses >= vida * 12, mesesRestantes: vida > 0 ? Math.max(0, vida * 12 - meses) : null };
  }
  // ¿Corresponde amortizar el equipo en ese mes? (desde el alta, durante la vida útil y hasta la baja)
  function amortizaEnMes(e, mes) {
    if (!(num(e.vidaUtilAnios) > 0)) return false;
    if (e.fechaAlta && fechaIso(e.fechaAlta).slice(0, 7) > mes) return false;
    if (e.baja && fechaIso(e.baja).slice(0, 7) < mes) return false;
    return !e.fechaAlta || mesesEntre(e.fechaAlta, `${mes}-01`) < num(e.vidaUtilAnios) * 12;
  }
  // Vencimientos del equipo: seguro, VTV / RTO y habilitación de aplicador.
  function vencimientosEquipo(e, hoy) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    return [['seguroVence', 'Seguro'], ['vtvVence', 'VTV / RTO'], ['habilitacionVence', 'Habilitación de aplicador']].filter(([k]) => e[k]).map(([k, nombre]) => {
      const dias = Math.round((Date.parse(`${fechaIso(e[k])}T12:00:00Z`) - Date.parse(`${h}T12:00:00Z`)) / 864e5);
      return { nombre, vence: fechaIso(e[k]), dias, estado: dias < 0 ? 'VENCIDO' : dias <= 30 ? 'POR_VENCER' : 'VIGENTE' };
    });
  }
  function alertasEquipos({ equipos = [], labores = [], mantenimientos = [], hoy } = {}) {
    const out = [];
    const activos = equipos.filter((e) => !e.baja);
    mantenimientoEquipos({ equipos: activos, labores, hoy }).forEach((m) => {
      if (m.vencido) out.push({ nivel: 'danger', texto: `${m.nombre}: service vencido (${Math.round(-m.restan)} h equivalentes de más).` });
      else if (m.restan <= m.intervalo * 0.15 || (m.dias !== null && m.dias <= 15)) out.push({ nivel: 'warn', texto: `${m.nombre}: faltan ${Math.round(m.restan)} h para el service${m.dias !== null ? ` (~${m.dias} día(s) al ritmo actual)` : ''}.` });
    });
    // La habilitación de aplicador la avisa SENASA (no se repite acá).
    activos.forEach((e) => vencimientosEquipo(e, hoy).filter((v) => v.nombre !== 'Habilitación de aplicador').forEach((v) => {
      if (v.estado === 'VENCIDO') out.push({ nivel: 'danger', texto: `${e.nombre}: ${v.nombre} vencido el ${v.vence}.` });
      else if (v.estado === 'POR_VENCER') out.push({ nivel: 'warn', texto: `${e.nombre}: ${v.nombre} vence en ${v.dias} día(s) (${v.vence}).` });
    }));
    mantenimientos.filter((m) => m.estado === 'PENDIENTE').forEach((m) => {
      const e = equipos.find((x) => x.id === m.equipoId);
      out.push({ nivel: m.fecha && fechaIso(m.fecha) < (fechaIso(hoy) || '') ? 'danger' : 'warn', texto: `${e?.nombre || 'Equipo'}: ${TIPOS_MANTENIMIENTO[m.tipo] || m.tipo} pendiente${m.fecha ? ` para el ${m.fecha}` : ''}${m.detalle ? ` (${m.detalle})` : ''}.` });
    });
    return out;
  }
  // Costo operativo real de cada equipo en los últimos 12 meses: amortización + mantenimiento + combustible
  // de sus labores + seguros y patentes, por hora trabajada, contra el costo horario cargado.
  function costosOperativosEquipos({ equipos = [], labores = [], mantenimientos = [], compras = [], condicionIva, hoy } = {}) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    const desde = sumarDiasIso(h, -365);
    const ingresos = ingresosInsumo(compras, condicionIva);
    const categoriaDe = (insumo) => compras.find((c) => normNombre(c.insumo) === normNombre(insumo))?.categoriaInsumo || '';
    return equipos.map((e) => {
      const labs = labores.filter((l) => l.estado === 'REALIZADA' && l.equipoId === e.id && fechaIso(l.fecha) > desde && fechaIso(l.fecha) <= h);
      const horas = labs.reduce((s, l) => s + num(l.horas), 0);
      const delPeriodo = (m) => m.equipoId === e.id && m.estado !== 'PENDIENTE' && fechaIso(m.fecha) > desde && fechaIso(m.fecha) <= h;
      const cargas = mantenimientos.filter((m) => delPeriodo(m) && m.tipo === 'COMBUSTIBLE');
      const litros = cargas.reduce((s, m) => s + num(m.litros), 0);
      const combustible = cargas.reduce((s, m) => s + num(m.costo), 0) + labs.reduce((s, l) => s + (l.insumos || []).filter((u) => /combustible|gasoil|diesel/i.test(categoriaDe(u.insumo) || u.insumo)).reduce((t, u) => t + num(u.cantidad) * (precioInsumo(ingresos, u.insumo, l.fecha) || 0), 0), 0);
      const mant = mantenimientos.filter((m) => delPeriodo(m) && m.tipo !== 'COMBUSTIBLE').reduce((s, m) => s + num(m.costo), 0);
      const am = amortizacionEquipo(e, h);
      const amortizacion = am.amortizado ? 0 : am.anual;
      const fijos = num(e.costosFijosAnuales);
      const total = amortizacion + mant + combustible + fijos;
      const operativo = mant + combustible;
      return { id: e.id, nombre: e.nombre, horas: redondear(horas), litros: redondear(litros), litrosHora: horas && litros ? redondear(litros / horas) : null, amortizacion: redondear(amortizacion), mantenimiento: redondear(mant), combustible: redondear(combustible), fijos: redondear(fijos), total: redondear(total), porHora: horas ? redondear(total / horas) : null, operativoPorHora: horas ? redondear(operativo / horas) : null, costoHoraCargado: num(e.costoHora), diferenciaPct: horas && num(e.costoHora) ? redondear((operativo / horas / num(e.costoHora) - 1) * 100) : null };
    });
  }

  // ================= Finanzas: caja y bancos, a cobrar, a pagar, cheques y créditos =================
  function saldosCuentas(cuentas = [], movimientos = []) {
    return cuentas.map((c) => {
      const movs = movimientos.filter((m) => m.cuentaId === c.id || m.cuentaDestinoId === c.id);
      const saldo = num(c.saldoInicial) + movs.reduce((s, m) => {
        if (m.tipo === 'TRANSFERENCIA') return s + (m.cuentaDestinoId === c.id ? num(m.importe) : -num(m.importe));
        return s + (m.tipo === 'INGRESO' ? num(m.importe) : -num(m.importe));
      }, 0);
      return { ...c, saldo: redondear(saldo), movimientos: movs.length };
    });
  }
  const totalCompra = (c) => { const neto = num(c.neto); const iva = c.iva != null && c.iva !== '' ? num(c.iva) : redondear(neto * num(c.ivaPct ?? 21) / 100); return redondear(neto + iva + num(c.percepciones)); };
  // LPG sin cobrar (neto a cobrar) y compras sin pagar (total con IVA).
  function cuentasACobrar({ lpg = [], movimientos = [] } = {}) {
    return lpg.filter((l) => l.calculo && (l.calculo.signo || 1) > 0).map((l) => {
      const cobrado = movimientos.filter((m) => m.origen === 'LPG' && m.origenId === l.id && m.tipo === 'INGRESO').reduce((s, m) => s + num(m.importe), 0);
      return { id: l.id, fecha: l.calculo.fecha, numero: l.numero || '', comprador: l.comprador || '', grano: l.calculo.grano, total: redondear(l.calculo.neto), cobrado: redondear(cobrado), saldo: redondear(l.calculo.neto - cobrado) };
    }).filter((x) => x.saldo > 0.5);
  }
  function cuentasAPagar({ compras = [], movimientos = [] } = {}) {
    return compras.map((c) => {
      const pagado = movimientos.filter((m) => m.origen === 'COMPRA' && m.origenId === c.id && m.tipo === 'EGRESO').reduce((s, m) => s + num(m.importe), 0);
      const total = totalCompra(c);
      // Compras marcadas pagadas al cargarlas (sin movimiento de fondos): no quedan a pagar.
      const saldo = String(c.pagado).toUpperCase() === 'SI' && !pagado ? 0 : total - pagado;
      return { id: c.id, fecha: fechaIso(c.fecha), vencimiento: fechaIso(c.vencimiento) || '', proveedor: c.proveedor || '', comprobante: c.comprobante || '', concepto: c.insumo || c.concepto || c.categoria || '', total, pagado: redondear(pagado), saldo: redondear(saldo) };
    }).filter((x) => x.saldo > 0.5);
  }
  // Créditos: sistema francés (cuota fija) con tasa nominal anual.
  function cuotasCredito(cr) {
    const capital = num(cr.capital), n = Math.max(1, Math.round(num(cr.cuotas))), i = num(cr.tasaAnual) / 100 / 12;
    const cuota = i > 0 ? capital * i / (1 - Math.pow(1 + i, -n)) : capital / n;
    let saldo = capital;
    const out = [];
    for (let k = 1; k <= n; k++) {
      const interes = saldo * i;
      const amort = cuota - interes;
      saldo = Math.max(0, saldo - amort);
      const d = new Date(`${fechaIso(cr.primeraCuota) || fechaIso(cr.fecha)}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + k - 1);
      out.push({ numero: k, vence: d.toISOString().slice(0, 10), cuota: redondear(cuota), interes: redondear(interes), capital: redondear(amort), saldo: redondear(saldo) });
    }
    return out;
  }
  function estadoCredito(cr, movimientos = [], hoy) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    const plan = cuotasCredito(cr);
    const pagadas = movimientos.filter((m) => m.origen === 'CREDITO' && m.origenId === cr.id && m.tipo === 'EGRESO').length;
    const pendientes = plan.slice(pagadas);
    const vencidas = pendientes.filter((c) => c.vence < h);
    return { plan, pagadas, pendientes: pendientes.length, proxima: pendientes[0] || null, vencidas: vencidas.length, montoVencido: redondear(vencidas.reduce((s, c) => s + c.cuota, 0)), saldoCapital: redondear(pagadas ? plan[pagadas - 1].saldo : num(cr.capital)), cancelado: !pendientes.length };
  }
  function alertasFinanzas({ cheques = [], creditos = [], movimientos = [], compras = [], hoy } = {}) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    const dias = (f) => Math.round((Date.parse(`${fechaIso(f)}T12:00:00Z`) - Date.parse(`${h}T12:00:00Z`)) / 864e5);
    const out = [];
    cheques.filter((c) => c.estado === 'EN_CARTERA' || c.estado === 'EMITIDO').forEach((c) => {
      const d = dias(c.vencimiento);
      const que = c.sentido === 'RECIBIDO' ? `Cheque a cobrar ${c.numero}` : `Cheque emitido ${c.numero}`;
      if (d < 0) out.push({ nivel: 'danger', texto: `${que} (${c.banco || ''}) venció hace ${-d} día(s): ${c.sentido === 'RECIBIDO' ? 'depositalo o reclamalo' : 'verificá que se haya debitado'}.` });
      else if (d <= 7) out.push({ nivel: 'warn', texto: `${que} vence en ${d} día(s) por $ ${Math.round(num(c.importe)).toLocaleString('es-AR')}.` });
    });
    creditos.forEach((cr) => {
      const e = estadoCredito(cr, movimientos, h);
      if (e.vencidas) out.push({ nivel: 'danger', texto: `Crédito ${cr.entidad}: ${e.vencidas} cuota(s) vencida(s) por $ ${Math.round(e.montoVencido).toLocaleString('es-AR')}.` });
      else if (e.proxima && dias(e.proxima.vence) <= 10) out.push({ nivel: 'warn', texto: `Crédito ${cr.entidad}: cuota ${e.proxima.numero} vence el ${e.proxima.vence} ($ ${Math.round(e.proxima.cuota).toLocaleString('es-AR')}).` });
    });
    cuentasAPagar({ compras, movimientos }).filter((x) => x.vencimiento && x.vencimiento < h).forEach((x) => out.push({ nivel: 'warn', texto: `Factura ${x.comprobante || ''} de ${x.proveedor} vencida el ${x.vencimiento}: saldo $ ${Math.round(x.saldo).toLocaleString('es-AR')}.` }));
    return out;
  }

  // ================= Receta agronómica y residuos agrícolas =================
  // Receta agronómica: la exigen las leyes provinciales de agroquímicos (la firma un ingeniero agrónomo
  // matriculado antes de aplicar). Se controla contra la aplicación realizada: producto recetado, dosis,
  // vigencia, aplicador habilitado, distancias y condiciones de aplicación.
  const ESTADOS_RECETA = ['EMITIDA', 'APLICADA', 'ANULADA'];
  // Distancias mínimas a zonas urbanas por banda toxicológica. Córdoba: Ley 9164 (aplicación terrestre de
  // clases Ia, Ib y II a menos de 500 m, y aérea de Ia, Ib y II a menos de 1.500 m y de III y IV a menos
  // de 500 m, prohibidas). Otras provincias y municipios fijan las suyas: se cargan en la receta.
  const DISTANCIAS_PROVINCIA = {
    CORDOBA: { norma: 'Ley 9164 (Córdoba)', TERRESTRE: { Ia: 500, Ib: 500, II: 500 }, AEREA: { Ia: 1500, Ib: 1500, II: 1500, III: 500, IV: 500 } },
  };
  // Buenas prácticas de aplicación (referencia técnica; no es norma): viento entre 3 y 15 km/h,
  // temperatura hasta 30 °C, humedad relativa desde 50 % y sin inversión térmica.
  const CONDICIONES_APLICACION = { vientoMin: 3, vientoMax: 15, temperaturaMax: 30, humedadMin: 50 };
  const VIGENCIA_RECETA_DIAS = 30;
  function distanciaMinima(receta, productos = []) {
    const prov = DISTANCIAS_PROVINCIA[provincia(receta.provincia)] || null;
    const tipo = receta.tipoAplicacion === 'AEREA' ? 'AEREA' : 'TERRESTRE';
    const bandas = (receta.productos || []).map((r) => productos.find((p) => normNombre(p.nombre) === normNombre(r.producto))?.banda).filter(Boolean);
    const porLey = prov ? Math.max(0, ...bandas.map((b) => prov[tipo][b] || 0)) : 0;
    const cargada = num(receta.distanciaMinimaM);
    return { metros: Math.max(porLey, cargada), norma: porLey >= cargada && porLey ? prov.norma : cargada ? 'cargada en la receta' : '', bandas };
  }
  function controlesReceta(receta, { productos = [], equipos = [], hoy } = {}) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    const out = [];
    const n = receta.numero ? `Receta ${receta.numero}` : 'Receta sin número';
    if (!receta.agronomo || !receta.matricula) out.push({ nivel: 'danger', texto: `${n}: falta el ingeniero agrónomo o su matrícula.` });
    if (!(receta.productos || []).length) out.push({ nivel: 'danger', texto: `${n}: sin productos recetados.` });
    (receta.productos || []).forEach((r) => {
      const p = productos.find((x) => normNombre(x.nombre) === normNombre(r.producto));
      if (!p) out.push({ nivel: 'warn', texto: `${n}: ${r.producto} no está en el registro de fitosanitarios (n.º SENASA, banda y carencia).` });
      else if (!p.registroSenasa) out.push({ nivel: 'warn', texto: `${n}: ${p.nombre} sin número de inscripción en SENASA.` });
      if (!(num(r.dosis) > 0)) out.push({ nivel: 'danger', texto: `${n}: ${r.producto} sin dosis por hectárea.` });
    });
    const dm = distanciaMinima(receta, productos);
    if (dm.metros && receta.distanciaUrbanaM !== '' && receta.distanciaUrbanaM != null && num(receta.distanciaUrbanaM) < dm.metros) out.push({ nivel: 'danger', texto: `${n}: el lote está a ${num(receta.distanciaUrbanaM)} m de zona urbana y la aplicación ${receta.tipoAplicacion === 'AEREA' ? 'aérea' : 'terrestre'} de banda ${dm.bandas.join('/')} exige al menos ${dm.metros} m (${dm.norma}).` });
    if (dm.metros && (receta.distanciaUrbanaM === '' || receta.distanciaUrbanaM == null)) out.push({ nivel: 'warn', texto: `${n}: falta la distancia del lote a la zona urbana (mínimo ${dm.metros} m, ${dm.norma}).` });
    const e = equipos.find((x) => x.id === receta.aplicadorEquipoId);
    if (e && !e.habilitacion) out.push({ nivel: 'danger', texto: `${n}: ${e.nombre} sin habilitación provincial de aplicador.` });
    else if (e && e.habilitacionVence && fechaIso(e.habilitacionVence) < fechaIso(receta.fecha)) out.push({ nivel: 'danger', texto: `${n}: la habilitación de ${e.nombre} venció el ${e.habilitacionVence}.` });
    if (receta.estado === 'EMITIDA' && receta.vence && fechaIso(receta.vence) < h) out.push({ nivel: 'warn', texto: `${n}: venció el ${receta.vence} sin aplicarse. Anulala o emití una nueva.` });
    return out;
  }
  // Aplicación realizada contra su receta: producto recetado, dosis (±10 %), vigencia y condiciones.
  function controlesAplicacion(labor, { recetas = [], productos = [], lotes = [] } = {}) {
    if (labor.tipo !== 'Aplicación' || labor.estado !== 'REALIZADA') return [];
    const out = [];
    const lote = lotes.find((l) => l.id === labor.loteId)?.codigo || '';
    const q = `Aplicación del ${labor.fecha} en ${lote}`;
    const receta = recetas.find((r) => r.id === labor.recetaId);
    if (!receta) {
      if (!labor.agronomo || !labor.matricula || !labor.receta) out.push({ nivel: 'danger', texto: `${q} sin receta agronómica (elegila en la labor o cargá ingeniero, matrícula y número).` });
    } else {
      if (receta.estado === 'ANULADA') out.push({ nivel: 'danger', texto: `${q}: la receta ${receta.numero} está anulada.` });
      if (receta.vence && fechaIso(labor.fecha) > fechaIso(receta.vence)) out.push({ nivel: 'danger', texto: `${q}: se aplicó con la receta ${receta.numero} vencida (${receta.vence}).` });
      if (fechaIso(labor.fecha) < fechaIso(receta.fecha)) out.push({ nivel: 'danger', texto: `${q}: es anterior a la receta ${receta.numero} (${receta.fecha}).` });
      if (receta.loteId && receta.loteId !== labor.loteId) out.push({ nivel: 'danger', texto: `${q}: la receta ${receta.numero} es de otro lote.` });
      const ha = num(labor.ha) || num(receta.ha);
      (labor.insumos || []).forEach((u) => {
        const p = productos.find((x) => normNombre(x.nombre) === normNombre(u.insumo));
        const r = (receta.productos || []).find((x) => normNombre(x.producto) === normNombre(u.insumo));
        if (!r) { if (p) out.push({ nivel: 'danger', texto: `${q}: ${u.insumo} no figura en la receta ${receta.numero}.` }); return; }
        const dosisReal = ha ? num(u.cantidad) / ha : 0;
        if (dosisReal && num(r.dosis) && dosisReal > num(r.dosis) * 1.1) out.push({ nivel: 'danger', texto: `${q}: ${u.insumo} a ${redondear(dosisReal)} ${r.unidad || ''}/ha, más de lo recetado (${r.dosis}).`.replace(' /ha', '/ha') });
      });
    }
    const c = CONDICIONES_APLICACION;
    if (labor.inversionTermica === 'SI') out.push({ nivel: 'danger', texto: `${q}: con inversión térmica (deriva del producto).` });
    if (labor.viento !== undefined && labor.viento !== '' && labor.viento !== null) {
      if (num(labor.viento) > c.vientoMax) out.push({ nivel: 'warn', texto: `${q}: viento de ${num(labor.viento)} km/h (más de ${c.vientoMax}: riesgo de deriva).` });
      else if (num(labor.viento) < c.vientoMin) out.push({ nivel: 'warn', texto: `${q}: viento de ${num(labor.viento)} km/h (menos de ${c.vientoMin}: posible inversión térmica).` });
    }
    if (labor.temperatura !== undefined && labor.temperatura !== '' && labor.temperatura !== null && num(labor.temperatura) > c.temperaturaMax) out.push({ nivel: 'warn', texto: `${q}: ${num(labor.temperatura)} °C (más de ${c.temperaturaMax} °C: evaporación y deriva).` });
    if (labor.humedad !== undefined && labor.humedad !== '' && labor.humedad !== null && num(labor.humedad) < c.humedadMin) out.push({ nivel: 'warn', texto: `${q}: humedad relativa ${num(labor.humedad)} % (menos de ${c.humedadMin} %).` });
    return out;
  }

  // Residuos agrícolas. Envases de fitosanitarios: Ley 27.279 (triple lavado y entrega a un Centro de
  // Almacenamiento Transitorio). Peligrosos (aceites, filtros, baterías): Ley 24.051 y leyes provinciales
  // (entrega a operador habilitado con manifiesto). Silobolsas y plásticos: retiro para reciclado.
  const TIPOS_RESIDUO = {
    SILOBOLSA: { nombre: 'Silobolsa usada', unidad: 'kg', peligroso: false },
    PLASTICOS: { nombre: 'Bolsas, big bags y otros plásticos', unidad: 'kg', peligroso: false },
    ACEITE_USADO: { nombre: 'Aceite y lubricante usado', unidad: 'l', peligroso: true },
    FILTROS: { nombre: 'Filtros usados', unidad: 'u', peligroso: true },
    BATERIAS: { nombre: 'Baterías', unidad: 'u', peligroso: true },
    NEUMATICOS: { nombre: 'Neumáticos fuera de uso', unidad: 'u', peligroso: false },
    OTRO: { nombre: 'Otro', unidad: 'kg', peligroso: false },
  };
  const LEY_RESIDUOS = 'Ley 27.279 (envases de fitosanitarios), Ley 24.051 y leyes provinciales (residuos peligrosos)';
  const KG_POR_METRO_SILOBOLSA = 3.8; // estimado para bolsa de 9 pies
  // Silobolsas que quedaron vacías (tuvieron grano y hoy no tienen) y todavía no se registró su retiro.
  function silobolsasVacias({ ubicaciones = [], movimientosGrano = [], residuos = [] } = {}) {
    const st = stockPorUbicacion(movimientosGrano).stock;
    return ubicaciones.filter((u) => u.tipo === 'SILOBOLSA' && movimientosGrano.some((m) => m.ubicacionId === u.id) && (st[u.id]?.kg || 0) <= 0 && !residuos.some((r) => r.ubicacionId === u.id))
      .map((u) => {
        const ultimo = movimientosGrano.filter((m) => m.ubicacionId === u.id).map((m) => fechaIso(m.fecha)).sort().pop();
        return { ubicacionId: u.id, nombre: u.nombre || u.codigo || 'Silobolsa', metros: num(u.metros), kg: Math.round(num(u.metros) * KG_POR_METRO_SILOBOLSA), desde: ultimo };
      });
  }
  function alertasResiduos({ residuos = [], ubicaciones = [], movimientosGrano = [], hoy, diasPeligrosos = 180 } = {}) {
    const h = fechaIso(hoy) || fechaIso(new Date().toISOString());
    const dias = (f) => Math.round((Date.parse(`${h}T12:00:00Z`) - Date.parse(`${fechaIso(f)}T12:00:00Z`)) / 864e5);
    const out = [];
    silobolsasVacias({ ubicaciones, movimientosGrano, residuos }).forEach((s) => out.push({ nivel: 'warn', texto: `${s.nombre} vacía desde el ${s.desde}: registrá su retiro para reciclado${s.kg ? ` (~${s.kg.toLocaleString('es-AR')} kg de plástico)` : ''}.` }));
    residuos.filter((r) => r.estado !== 'ENTREGADO').forEach((r) => {
      const t = TIPOS_RESIDUO[r.tipo] || TIPOS_RESIDUO.OTRO;
      if (t.peligroso && dias(r.fecha) > diasPeligrosos) out.push({ nivel: 'warn', texto: `${t.nombre}: ${num(r.cantidad)} ${r.unidad || t.unidad} almacenado(s) desde el ${r.fecha}. Coordiná el retiro con un operador habilitado.` });
      else if (!t.peligroso && dias(r.fecha) > 365) out.push({ nivel: 'warn', texto: `${t.nombre}: ${num(r.cantidad)} ${r.unidad || t.unidad} sin entregar desde el ${r.fecha}.` });
    });
    residuos.filter((r) => r.estado === 'ENTREGADO' && (TIPOS_RESIDUO[r.tipo] || {}).peligroso && !r.comprobante).forEach((r) => out.push({ nivel: 'danger', texto: `${TIPOS_RESIDUO[r.tipo].nombre} entregado el ${r.entregaFecha || r.fecha} sin manifiesto: es residuo peligroso, guardá el manifiesto del operador.` }));
    return out;
  }

  // ================= Clima, satélite y dólar (datos externos de /api/pampa-datos) =================
  // Ventanas para aplicar: cada paso del pronóstico (3 h) contra las mismas condiciones que controla la receta
  // (viento 3–15 km/h, hasta 30 °C, humedad desde 50 %) y sin lluvia.
  function evaluarCondicion(x, c = CONDICIONES_APLICACION) {
    const motivos = [];
    if (x.vientoKmh != null && x.vientoKmh > c.vientoMax) motivos.push(`viento ${x.vientoKmh} km/h`);
    if (x.vientoKmh != null && x.vientoKmh < c.vientoMin) motivos.push(`viento ${x.vientoKmh} km/h (posible inversión térmica)`);
    if (x.temperatura != null && x.temperatura > c.temperaturaMax) motivos.push(`${x.temperatura} °C`);
    if (x.humedad != null && x.humedad < c.humedadMin) motivos.push(`humedad ${x.humedad} %`);
    if (num(x.lluviaMm) > 0.2) motivos.push(`lluvia ${num(x.lluviaMm)} mm`);
    return { apta: !motivos.length, motivos };
  }
  function ventanasAplicacion(pronostico = [], c = CONDICIONES_APLICACION) {
    const pasos = pronostico.filter((x) => x && x.fecha).map((x) => ({ ...x, ...evaluarCondicion(x, c) }));
    const ventanas = [];
    pasos.forEach((p) => {
      const ult = ventanas[ventanas.length - 1];
      if (!p.apta) return;
      if (ult && Date.parse(p.fecha) - Date.parse(ult.hasta) <= 3 * 3600 * 1000) ult.hasta = p.fecha;
      else ventanas.push({ desde: p.fecha, hasta: p.fecha });
    });
    return { pasos, ventanas, lluviaPrevista: redondear(pasos.reduce((s, p) => s + num(p.lluviaMm), 0)) };
  }
  function alertasClima({ clima, lote = '' } = {}) {
    const out = [];
    const pr = clima?.pronostico || [];
    const minima = pr.reduce((m, x) => (x.temperatura != null && (m === null || x.temperatura < m) ? x.temperatura : m), null);
    if (minima !== null && minima <= 0) out.push({ nivel: 'danger', texto: `${lote}: pronóstico de helada (${minima} °C).` });
    const lluvia24 = pr.slice(0, 8).reduce((s, x) => s + num(x.lluviaMm), 0);
    if (lluvia24 >= 20) out.push({ nivel: 'warn', texto: `${lote}: se esperan ${redondear(lluvia24)} mm en las próximas 24 h (caminos y labores).` });
    const rafaga = pr.reduce((m, x) => Math.max(m, num(x.rafagaKmh || x.vientoKmh)), 0);
    if (rafaga >= 50) out.push({ nivel: 'warn', texto: `${lote}: ráfagas de hasta ${rafaga} km/h en el pronóstico.` });
    return out;
  }
  // NDVI: caída fuerte entre las dos últimas imágenes o valor bajo; si hay mapa de rinde del lote, se cruza
  // con su zona de bajo potencial.
  function alertasNdvi({ serie = [], lote = '', bajoPotencialPct = null, umbralCaida = 0.15 } = {}) {
    const s = serie.filter((x) => x.media != null).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    if (!s.length) return [];
    const out = [];
    const cruce = bajoPotencialPct ? ` El mapa de rinde marca ${Math.round(bajoPotencialPct)} % del lote como bajo potencial: revisá esa zona a campo.` : '';
    if (s[1] && s[1].media > 0 && (s[1].media - s[0].media) / s[1].media >= umbralCaida) out.push({ nivel: 'warn', texto: `${lote}: el NDVI bajó de ${s[1].media} a ${s[0].media} (${Math.round((s[1].media - s[0].media) / s[1].media * 100)} %) entre ${fechaIso(s[1].fecha)} y ${fechaIso(s[0].fecha)}.${cruce}` });
    else if (s[0].media < 0.3) out.push({ nivel: 'warn', texto: `${lote}: NDVI bajo (${s[0].media}) en la imagen del ${fechaIso(s[0].fecha)}.${cruce}` });
    return out;
  }
  // Cotización: días desde la última actualización (DolarAPI es un servicio no oficial).
  const diasDesde = (fecha, hoy) => (fecha ? Math.floor((Date.parse(`${fechaIso(hoy) || fechaIso(new Date().toISOString())}T23:59:59Z`) - Date.parse(fecha)) / 864e5) : null);

  // Dólar del día: la cotización de esa fecha o la del último día hábil anterior (serie diaria del MEP).
  function dolarDelDia(serie = [], fecha) {
    const f = fechaIso(fecha);
    if (!f || !serie.length) return null;
    let lo = 0, hi = serie.length - 1, res = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (serie[mid].fecha <= f) { res = mid; lo = mid + 1; } else hi = mid - 1; }
    return res >= 0 ? serie[res] : null;
  }
  // Promedio mensual del MEP (para completar el tipo de cambio informativo de cada mes).
  function promediosMensuales(serie = []) {
    const meses = {};
    serie.forEach((x) => { const m = x.fecha.slice(0, 7); (meses[m] ||= []).push(num(x.venta)); });
    return Object.fromEntries(Object.entries(meses).map(([m, v]) => [m, redondear(v.reduce((s, x) => s + x, 0) / v.length)]));
  }
  // Resultado de la campaña en US$ con el dólar de cada día: cada costo con el MEP de su fecha, cada venta
  // (LPG) con el de su fecha y el grano sin vender con el de hoy. Los importes prorrateados (estructura por
  // hectárea, ingresos por lote) mantienen la misma proporción que en pesos.
  function resultadoCampaniaUsd(r, { lpg = [], serie = [], hoy } = {}) {
    if (!serie.length) return null;
    let sinCotizacion = 0;
    const usd = (importe, fecha) => { const d = dolarDelDia(serie, fecha); if (!d) { sinCotizacion++; return 0; } return num(importe) / num(d.venta); };
    const sumar = (filas) => filas.reduce((s, f) => ({ ars: s.ars + num(f.importe), usd: s.usd + usd(f.importe, f.fecha) }), { ars: 0, usd: 0 });
    const dir = sumar(r.filas.filter((f) => f.directo));
    const est = sumar(r.filas.filter((f) => !f.directo));
    const ventasLpg = lpg.filter((l) => l.calculo?.campania === r.campania).map((l) => ({ importe: num(l.calculo.subtotal) * (l.calculo.signo || 1), fecha: l.calculo.fecha }));
    const ven = sumar(ventasLpg);
    const factor = (x, totalArs) => (x.ars ? x.usd / x.ars : 0) * totalArs;
    const t = r.totales;
    const hoyDolar = dolarDelDia(serie, hoy || new Date().toISOString());
    const ventas = factor(ven, t.ventas);
    const stockValuado = hoyDolar ? t.stockValuado / num(hoyDolar.venta) : 0;
    const directos = factor(dir, t.directos);
    const estructura = factor(est, t.estructura);
    const ingresos = ventas + stockValuado;
    // Por lote, la misma conversión por componente.
    const k = { ven: ven.ars ? ven.usd / ven.ars : 0, dir: dir.ars ? dir.usd / dir.ars : 0, est: est.ars ? est.usd / est.ars : 0, hoy: hoyDolar ? 1 / num(hoyDolar.venta) : 0 };
    const lotes = r.lotes.map((x) => { const ing = x.ventas * k.ven + x.stockValuado * k.hoy; const res = ing - x.directos * k.dir - x.estructura * k.est; return { loteId: x.loteId, cultivo: x.cultivo, resultado: redondear(res), resultadoHa: x.ha ? redondear(res / x.ha) : null, costoTn: x.kgCosecha ? redondear((x.directos * k.dir + x.estructura * k.est) / (x.kgCosecha / 1000)) : null }; });
    return { metodo: 'MEP del día de cada movimiento', ventas: redondear(ventas), stockValuado: redondear(stockValuado), ingresos: redondear(ingresos), directos: redondear(directos), estructura: redondear(estructura), margenBruto: redondear(ingresos - directos), resultado: redondear(ingresos - directos - estructura), lotes, sinCotizacion, dolarHoy: hoyDolar };
  }

  // ================= PampaIA: cálculos de las 9 funciones por versión =================
  // Ningún número sale de un modelo de lenguaje: todo se calcula con los registros cargados, con las
  // mismas funciones de Costos, Granos y SENASA. Si falta historial, se dice.
  const media = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const sumarDiasIso = (f, dias) => { const d = new Date(`${fechaIso(f)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
  const diasEntre = (a, b) => Math.round((Date.parse(`${fechaIso(b)}T12:00:00Z`) - Date.parse(`${fechaIso(a)}T12:00:00Z`)) / 864e5);

  // Rinde de cada lote y campaña (kilos de cosecha con lote ÷ hectáreas del vínculo).
  function rindesHistoricos({ movimientosGrano = [], lotesCampania = [], lotes = [] } = {}) {
    const porId = Object.fromEntries(lotes.map((l) => [l.id, l]));
    return lotesCampania.map((v) => {
      const g = grano(v.cultivo);
      const kg = movimientosGrano.filter((m) => m.tipo === 'INGRESO_COSECHA' && m.loteId === v.loteId && grano(m.grano) === g && campaniaDe(CULTIVOS[g].nombre, m.fecha).campania === v.campania).reduce((s, m) => s + num(m.kg), 0);
      const ha = num(v.superficieHa);
      const fechas = movimientosGrano.filter((m) => m.tipo === 'INGRESO_COSECHA' && m.loteId === v.loteId && grano(m.grano) === g).map((m) => fechaIso(m.fecha)).sort();
      return { loteId: v.loteId, lote: porId[v.loteId]?.codigo || '', campo: porId[v.loteId]?.campo || '', cultivo: g, campania: v.campania, tipo: v.tipo, ha, kg, rindeTnHa: ha && kg ? redondear(kg / 1000 / ha) : 0, fecha: fechas[fechas.length - 1] || '' };
    }).filter((r) => r.kg > 0);
  }

  // Básica · desvíos simples: precio de un insumo o rinde de un lote fuera del promedio histórico.
  function desviosPrecioInsumo(compras, condicionIva, { umbral = 0.2 } = {}) {
    const porInsumo = {};
    ingresosInsumo(compras, condicionIva).filter((i) => i.precio > 0).forEach((i) => { (porInsumo[i.insumo] ||= []).push(i); });
    return Object.entries(porInsumo).flatMap(([insumo, lista]) => {
      lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
      if (lista.length < 2) return [];
      const ultima = lista[lista.length - 1];
      const promedio = media(lista.slice(0, -1).map((i) => i.precio));
      const desvio = promedio ? ultima.precio / promedio - 1 : 0;
      return Math.abs(desvio) >= umbral ? [{ insumo, fecha: ultima.fecha, precio: redondear(ultima.precio), promedio: redondear(promedio), desvio: redondear(desvio * 100), unidad: ultima.unidad, compras: lista.length }] : [];
    });
  }
  function desviosRinde(historicos, { umbral = 0.2 } = {}) {
    return historicos.flatMap((r) => {
      // Promedio histórico del campo para ese cultivo (otras campañas u otros lotes del mismo campo).
      const base = historicos.filter((x) => x !== r && x.cultivo === r.cultivo && normNombre(x.campo) === normNombre(r.campo));
      if (!base.length) return [];
      const ha = base.reduce((s, x) => s + x.ha, 0);
      const promedio = ha ? base.reduce((s, x) => s + x.rindeTnHa * x.ha, 0) / ha : 0;
      const desvio = promedio ? r.rindeTnHa / promedio - 1 : 0;
      return Math.abs(desvio) >= umbral ? [{ ...r, promedio: redondear(promedio), desvio: redondear(desvio * 100), registros: base.length }] : [];
    });
  }

  // Profesional · quiebre de stock: al ritmo de consumo real (labores realizadas de la ventana) y con lo
  // planificado, en cuántos días se acaba cada insumo.
  function proyeccionInsumos({ compras = [], labores = [], ajustes = [], condicionIva, hoy, ventanaDias = 60 } = {}) {
    const st = stockInsumos(compras, labores, ajustes, condicionIva);
    const desde = sumarDiasIso(hoy, -ventanaDias);
    const consumo = {};
    const planificado = {};
    labores.forEach((l) => (l.insumos || []).forEach((u) => {
      const n = normNombre(u.insumo);
      const f = fechaIso(l.fecha);
      if (l.estado === 'REALIZADA' && f > desde && f <= fechaIso(hoy)) consumo[n] = (consumo[n] || 0) + num(u.cantidad);
      if (l.estado !== 'REALIZADA' && f >= fechaIso(hoy)) planificado[n] = (planificado[n] || 0) + num(u.cantidad);
    }));
    return Object.values(st).map((s) => {
      const porDia = (consumo[s.insumo] || 0) / ventanaDias;
      const plan = planificado[s.insumo] || 0;
      return { insumo: s.insumo, unidad: s.unidad, stock: s.cantidad, porDia: redondear(porDia), dias: porDia > 0 ? Math.max(0, Math.floor(s.cantidad / porDia)) : null, planificado: plan, faltantePlanificado: redondear(Math.max(0, plan - Math.max(0, s.cantidad))) };
    }).filter((x) => x.stock !== 0 || x.porDia || x.planificado).sort((a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9));
  }

  // Profesional · mantenimiento: horas acumuladas (horómetro al alta + horas de las labores realizadas),
  // ponderadas por el tipo de labor (cosecha y siembra exigen más), contra el intervalo de service.
  const FACTOR_DESGASTE = { COSECHA: 1.25, SIEMBRA: 1.15, LABRANZA: 1.2, APLICACION: 1, FERTILIZACION: 1, OTRO: 1 };
  const SERVICE_DEFECTO_HORAS = 250;
  function mantenimientoEquipos({ equipos = [], labores = [], hoy, ventanaDias = 60 } = {}) {
    const desde = sumarDiasIso(hoy, -ventanaDias);
    return equipos.filter((e) => !/contratist/i.test(e.nombre || '')).map((e) => {
      const propias = labores.filter((l) => l.estado === 'REALIZADA' && l.equipoId === e.id);
      const horasLabores = propias.reduce((s, l) => s + num(l.horas), 0);
      const equivalentes = propias.reduce((s, l) => s + num(l.horas) * (FACTOR_DESGASTE[sinAcentos(l.tipo)] || 1), 0);
      const horometro = num(e.horometro) + horasLabores;
      const intervalo = num(e.serviceCadaHoras) || SERVICE_DEFECTO_HORAS;
      const base = e.horasUltimoService !== undefined && e.horasUltimoService !== '' ? num(e.horasUltimoService) : num(e.horometro);
      // Desde el último service: horas equivalentes de las labores posteriores al horómetro de ese service.
      const factorMedio = horasLabores ? equivalentes / horasLabores : 1;
      const desdeService = Math.max(0, (horometro - base) * factorMedio);
      const restan = redondear(intervalo - desdeService);
      const horasVentana = propias.filter((l) => fechaIso(l.fecha) > desde && fechaIso(l.fecha) <= fechaIso(hoy)).reduce((s, l) => s + num(l.horas) * (FACTOR_DESGASTE[sinAcentos(l.tipo)] || 1), 0);
      const porDia = horasVentana / ventanaDias;
      return { id: e.id, nombre: e.nombre, codigo: e.codigo || '', horometro: redondear(horometro), intervalo, intervaloDefecto: !num(e.serviceCadaHoras), desdeService: redondear(desdeService), restan, factorMedio: redondear(factorMedio), porDia: redondear(porDia), dias: restan <= 0 ? 0 : porDia > 0 ? Math.floor(restan / porDia) : null, vencido: restan <= 0 };
    }).sort((a, b) => a.restan - b.restan);
  }

  // Profesional · costo y margen proyectado por lote antes de cosechar: costos ya hechos + labores
  // planificadas (al último precio y costo horario) e ingreso esperado con el rinde histórico del lote o
  // del campo y el último precio de LPG del grano.
  function proyeccionLotes(d, campania, { hoy, tipoCambio } = {}) {
    const r = resultadoCampania(d, campania, { tipoCambio });
    const hist = rindesHistoricos(d);
    const planificadas = (d.labores || []).filter((l) => l.estado !== 'REALIZADA' && (!l.campania || l.campania === campania)).map((l) => ({ ...l, estado: 'REALIZADA' }));
    const filasPlan = planificadas.length ? costosDelPeriodo({ ...d, compras: d.compras, labores: planificadas, empleados: [], contratos: [], lpg: [] }, '0000-01-01', '9999-12-31').filter((f) => f.origen.startsWith('Labor')) : [];
    const precio = (g) => (d.lpg || []).filter((l) => l.calculo?.grano === g && (l.calculo.signo || 1) > 0).sort((a, b) => b.calculo.fecha.localeCompare(a.calculo.fecha))[0]?.calculo.precioTn || null;
    const lotes = r.lotes.map((x) => {
      const pendiente = filasPlan.filter((f) => f.loteId === x.loteId && (!f.cultivo || f.cultivo === x.cultivo)).reduce((s, f) => s + f.importe, 0);
      const costoProyectado = x.directos + x.estructura + pendiente;
      let rindeEsperado = x.rindeTnHa || null;
      let fuente = x.rindeTnHa ? 'cosechado' : '';
      if (!rindeEsperado) {
        const delLote = hist.filter((h) => h.loteId === x.loteId && h.cultivo === x.cultivo && h.campania !== campania);
        const delCampo = hist.filter((h) => normNombre(h.campo) === normNombre(x.campo) && h.cultivo === x.cultivo && h.campania !== campania);
        const delCultivo = hist.filter((h) => h.cultivo === x.cultivo && h.campania !== campania);
        const base = delLote.length ? delLote : delCampo.length ? delCampo : delCultivo;
        fuente = delLote.length ? 'histórico del lote' : delCampo.length ? 'histórico del campo' : delCultivo.length ? 'histórico del cultivo' : '';
        rindeEsperado = base.length ? redondear(media(base.map((h) => h.rindeTnHa))) : null;
      }
      const p = precio(x.cultivo);
      const ingresoProyectado = x.rindeTnHa ? x.ingresos : rindeEsperado && p ? rindeEsperado * x.ha * p : null;
      const margen = ingresoProyectado === null ? null : ingresoProyectado - costoProyectado;
      return { ...x, pendiente: redondear(pendiente), costoProyectado: redondear(costoProyectado), costoHaProyectado: x.ha ? redondear(costoProyectado / x.ha) : 0, rindeEsperado, fuente, precioTn: p, ingresoProyectado: ingresoProyectado === null ? null : redondear(ingresoProyectado), margenProyectado: margen === null ? null : redondear(margen), margenHa: margen === null || !x.ha ? null : redondear(margen / x.ha), rindeIndiferencia: p && x.ha ? redondear(costoProyectado / p / x.ha) : null, cosechado: Boolean(x.rindeTnHa) };
    });
    return { campania, lotes, planificadas: planificadas.length };
  }

  // Premium · mapas de rinde: limpieza (sin rindes nulos, coordenadas inválidas ni valores fuera de ±3
  // desvíos) y zonificación de potencial por agrupamiento (k-medias sobre el rinde).
  function limpiarMapaRinde(puntos = []) {
    const base = puntos.map((p) => ({ lat: num(p.lat), lon: num(p.lon), rinde: num(p.rinde) })).filter((p) => p.rinde > 0 && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && (p.lat || p.lon));
    const m = media(base.map((p) => p.rinde));
    const sd = Math.sqrt(media(base.map((p) => (p.rinde - m) ** 2)));
    const validos = sd ? base.filter((p) => Math.abs(p.rinde - m) <= 3 * sd) : base;
    return { validos, total: puntos.length, descartados: puntos.length - validos.length, pctValidos: puntos.length ? redondear(validos.length / puntos.length * 100) : 0 };
  }
  function zonificar(puntos = [], k = 3) {
    const vals = puntos.map((p) => p.rinde).sort((a, b) => a - b);
    if (vals.length < k * 3) return null;
    let centros = Array.from({ length: k }, (_, i) => vals[Math.floor((i + 0.5) * vals.length / k)]);
    let asignacion = [];
    for (let it = 0; it < 50; it++) {
      asignacion = puntos.map((p) => centros.reduce((mejor, c, i) => (Math.abs(p.rinde - c) < Math.abs(p.rinde - centros[mejor]) ? i : mejor), 0));
      const nuevos = centros.map((c, i) => { const xs = puntos.filter((_, j) => asignacion[j] === i).map((p) => p.rinde); return xs.length ? media(xs) : c; });
      if (nuevos.every((c, i) => Math.abs(c - centros[i]) < 1e-9)) break;
      centros = nuevos;
    }
    const orden = centros.map((c, i) => [c, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    const nombres = k === 3 ? ['Bajo potencial', 'Potencial medio', 'Alto potencial'] : orden.map((_, i) => `Zona ${i + 1}`);
    const general = media(puntos.map((p) => p.rinde));
    const zonas = orden.map((i, pos) => {
      const xs = puntos.filter((_, j) => asignacion[j] === i).map((p) => p.rinde);
      return { zona: pos + 1, nombre: nombres[pos], n: xs.length, pct: redondear(xs.length / puntos.length * 100), rindeMedio: redondear(media(xs)), min: redondear(Math.min(...xs)), max: redondear(Math.max(...xs)), indice: redondear(media(xs) / general) };
    });
    const zonaDe = Object.fromEntries(orden.map((i, pos) => [i, pos + 1]));
    return { zonas, rindeGeneral: redondear(general), asignacion: asignacion.map((i) => zonaDe[i]) };
  }
  // Premium · prescripción variable: dosis por zona proporcional al potencial (índice de rinde de la zona),
  // dentro de la dosis mínima y máxima; con el área del lote, el total de insumo.
  function prescripcionPorZonas(z, { objetivo, minimo, maximo, ha = 0 } = {}) {
    if (!z) return null;
    const obj = num(objetivo);
    const lo = num(minimo) || obj * 0.7;
    const hi = num(maximo) || obj * 1.3;
    const zonas = z.zonas.map((x) => {
      const dosis = Math.round(Math.min(hi, Math.max(lo, obj * x.indice)) * 10) / 10;
      const haZona = ha * x.pct / 100;
      return { ...x, dosis, ha: redondear(haZona), total: redondear(dosis * haZona) };
    });
    const total = zonas.reduce((s, x) => s + x.total, 0);
    return { zonas, total: redondear(total), totalUniforme: redondear(obj * ha), ahorro: redondear(obj * ha - total) };
  }
  function prescripcionGeoJson(puntos, z, presc, { lote = '', operacion = '', unidad = '' } = {}) {
    const dosis = Object.fromEntries((presc?.zonas || []).map((x) => [x.zona, x.dosis]));
    return { type: 'FeatureCollection', name: `Prescripcion_${lote}`, properties: { lote, operacion, unidad }, features: puntos.map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { zona: z.asignacion[i], rinde: p.rinde, dosis: dosis[z.asignacion[i]] } })) };
  }

  // Premium · análisis multi-campo: rinde, costo y resultado por hectárea de cada campo, y patrones por
  // equipo de siembra o cosecha y por operador (rinde de sus lotes contra el promedio del cultivo).
  function analisisMultiCampo(d, campania, { tipoCambio } = {}) {
    const r = resultadoCampania(d, campania, { tipoCambio });
    const campos = {};
    r.lotes.forEach((x) => {
      const c = (campos[x.campo || 'Sin campo'] ||= { campo: x.campo || 'Sin campo', ha: 0, resultado: 0, costo: 0, lotes: 0, cultivos: {} });
      c.ha += x.ha; c.resultado += x.resultado; c.costo += x.directos + x.estructura; c.lotes++;
      if (x.rindeTnHa) { const k = (c.cultivos[x.cultivo] ||= { ha: 0, t: 0 }); k.ha += x.ha; k.t += x.rindeTnHa * x.ha; }
    });
    const lista = Object.values(campos).map((c) => ({ ...c, resultadoHa: c.ha ? redondear(c.resultado / c.ha) : 0, costoHa: c.ha ? redondear(c.costo / c.ha) : 0, rindes: Object.fromEntries(Object.entries(c.cultivos).map(([g, k]) => [g, redondear(k.t / k.ha)])) })).sort((a, b) => b.resultadoHa - a.resultadoHa);
    const promedioCultivo = {};
    r.lotes.filter((x) => x.rindeTnHa).forEach((x) => { const p = (promedioCultivo[x.cultivo] ||= { ha: 0, t: 0 }); p.ha += x.ha; p.t += x.rindeTnHa * x.ha; });
    const prom = (g) => (promedioCultivo[g]?.ha ? promedioCultivo[g].t / promedioCultivo[g].ha : 0);
    const patrones = [];
    const agrupar = (clave, etiqueta, tipos) => {
      const grupos = {};
      (d.labores || []).filter((l) => l.estado === 'REALIZADA' && tipos.includes(sinAcentos(l.tipo)) && (!l.campania || l.campania === campania) && l[clave]).forEach((l) => {
        const x = r.lotes.find((y) => y.loteId === l.loteId && y.cultivo === grano(l.cultivo) && y.rindeTnHa);
        if (!x || !prom(x.cultivo)) return;
        const nombre = clave === 'equipoId' ? ((d.equipos || []).find((e) => e.id === l.equipoId)?.nombre || l.equipoId) : String(l[clave]);
        const g = (grupos[nombre] ||= { nombre, ha: 0, indice: 0, lotes: new Set() });
        if (g.lotes.has(x.loteId)) return;
        g.lotes.add(x.loteId); g.ha += x.ha; g.indice += (x.rindeTnHa / prom(x.cultivo)) * x.ha;
      });
      const gs = Object.values(grupos).filter((g) => g.ha > 0).map((g) => ({ nombre: g.nombre, ha: g.ha, lotes: g.lotes.size, difPct: redondear((g.indice / g.ha - 1) * 100) }));
      if (gs.length >= 2) patrones.push({ etiqueta, grupos: gs.sort((a, b) => b.difPct - a.difPct) });
    };
    agrupar('equipoId', 'Equipo de siembra', ['SIEMBRA']);
    agrupar('equipoId', 'Equipo de cosecha', ['COSECHA']);
    agrupar('operador', 'Operador', ['SIEMBRA', 'COSECHA', 'APLICACION', 'FERTILIZACION', 'LABRANZA']);
    return { campania, campos: lista, patrones, totales: r.totales, haTotal: r.haTotal };
  }

  // ================= SINCRONIZACIÓN ENTRE EQUIPOS =================
  // Cada equipo tiene una copia completa. Al combinar: por registro gana la versión más nueva (updatedAt);
  // los borrados viajan como marcas {tabla, rowId, borradoEn} y ganan si son posteriores a la última
  // edición. Las filas derivadas (retenciones, IVA, egresos de stock de una LPG o compra) siguen a su
  // origen: se toman del mismo lado que ganó la LPG o la compra.
  const CLAVE_TABLA = { tiposCambio: 'mes' };
  const DERIVADAS = { retenciones: ['lpg', 'lpgId'], reintegrosIva: ['lpg', 'lpgId'], movimientosGrano: ['lpg', 'lpgId'], comprobantesIva: [null, 'origenId'] };
  const marca = (r) => String(r?.updatedAt || r?.createdAt || '');
  function fusionarDatos(local, remoto) {
    const L = local?.tablas || {};
    const R = remoto?.tablas || {};
    // Marcas de borrado: unión, la más reciente por registro.
    const borrados = {};
    [...(local?.borrados || []), ...(remoto?.borrados || [])].forEach((b) => {
      const k = `${b.tabla}|${b.rowId}`;
      if (!borrados[k] || String(b.borradoEn) > String(borrados[k].borradoEn)) borrados[k] = { tabla: b.tabla, rowId: b.rowId, borradoEn: b.borradoEn };
    });
    const borrado = (tabla, id, fila) => { const b = borrados[`${tabla}|${id}`]; return b && String(b.borradoEn) >= marca(fila); };
    // Qué lado ganó cada origen (LPG o compra), para arrastrar sus derivadas.
    const ganador = {};
    ['lpg', 'compras'].forEach((t) => {
      const ids = new Set([...(L[t] || []), ...(R[t] || [])].map((r) => r.id));
      ids.forEach((id) => {
        const a = (L[t] || []).find((r) => r.id === id);
        const b = (R[t] || []).find((r) => r.id === id);
        ganador[id] = !a ? 'R' : !b ? 'L' : marca(b) > marca(a) ? 'R' : 'L';
      });
    });
    const tablas = {};
    new Set([...Object.keys(L), ...Object.keys(R)]).forEach((t) => {
      const clave = CLAVE_TABLA[t] || 'id';
      const deriv = DERIVADAS[t];
      const out = new Map();
      const origenDe = (fila) => (deriv ? fila[deriv[1]] : null);
      const filasL = L[t] || [];
      const filasR = R[t] || [];
      // Derivadas de un origen conocido: todas las del lado ganador de ese origen.
      const conOrigen = (fila) => origenDe(fila) && ganador[origenDe(fila)];
      filasL.filter(conOrigen).forEach((f) => { if (ganador[origenDe(f)] === 'L') out.set(f[clave], f); });
      filasR.filter(conOrigen).forEach((f) => { if (ganador[origenDe(f)] === 'R') out.set(f[clave], f); });
      // El resto: gana la versión más nueva.
      filasL.filter((f) => !conOrigen(f)).forEach((f) => out.set(f[clave], f));
      filasR.filter((f) => !conOrigen(f)).forEach((f) => {
        const a = out.get(f[clave]);
        if (!a || marca(f) > marca(a)) out.set(f[clave], f);
      });
      // Borrados (no aplica a derivadas: se van con su origen).
      [...out.entries()].forEach(([k, f]) => { if (!conOrigen(f) && borrado(t, k, f)) out.delete(k); });
      // Derivadas cuyo origen fue borrado.
      if (deriv) [...out.entries()].forEach(([k, f]) => { const o = origenDe(f); if (o && deriv[0] && borrado(deriv[0], o, {})) out.delete(k); });
      tablas[t] = [...out.values()];
    });
    // Orígenes borrados en cualquier lado: sus derivadas se van.
    const vivos = new Set([...(tablas.lpg || []), ...(tablas.compras || [])].map((r) => r.id));
    Object.keys(DERIVADAS).forEach((t) => {
      if (!tablas[t]) return;
      tablas[t] = tablas[t].filter((f) => { const o = f[DERIVADAS[t][1]]; return !o || vivos.has(o) || !(borrados[`lpg|${o}`] || borrados[`compras|${o}`]); });
    });
    // Cambios = diferencia real con lo local (filas nuevas, distintas o que se van, y marcas de borrado nuevas).
    let cambios = 0;
    Object.entries(tablas).forEach(([t, filas]) => {
      const clave = CLAVE_TABLA[t] || 'id';
      const antes = new Map((L[t] || []).map((x) => [x[clave], JSON.stringify(x)]));
      filas.forEach((x) => { if (antes.get(x[clave]) !== JSON.stringify(x)) cambios++; antes.delete(x[clave]); });
      cambios += antes.size;
    });
    const marcasLocales = new Set((local?.borrados || []).map((b) => `${b.tabla}|${b.rowId}|${b.borradoEn}`));
    cambios += Object.values(borrados).filter((b) => !marcasLocales.has(`${b.tabla}|${b.rowId}|${b.borradoEn}`)).length;
    return { tablas, borrados: Object.values(borrados), cambios };
  }

  return {
    CLAVE_TABLA, DERIVADAS, fusionarDatos,
    dolarDelDia, promediosMensuales, resultadoCampaniaUsd,
    evaluarCondicion, ventanasAplicacion, alertasClima, alertasNdvi, diasDesde,
    CATEGORIAS_EQUIPO, TIPOS_MANTENIMIENTO, amortizacionEquipo, amortizaEnMes, vencimientosEquipo, alertasEquipos, costosOperativosEquipos,
    saldosCuentas, totalCompra, cuentasACobrar, cuentasAPagar, cuotasCredito, estadoCredito, alertasFinanzas,
    ESTADOS_RECETA, DISTANCIAS_PROVINCIA, CONDICIONES_APLICACION, VIGENCIA_RECETA_DIAS, distanciaMinima, controlesReceta, controlesAplicacion,
    TIPOS_RESIDUO, LEY_RESIDUOS, KG_POR_METRO_SILOBOLSA, silobolsasVacias, alertasResiduos, sumarDiasIso,
    rindesHistoricos, desviosPrecioInsumo, desviosRinde, proyeccionInsumos, mantenimientoEquipos, FACTOR_DESGASTE, SERVICE_DEFECTO_HORAS,
    proyeccionLotes, limpiarMapaRinde, zonificar, prescripcionPorZonas, prescripcionGeoJson, analisisMultiCampo,
    RG5017, ESTADOS_CPE, alertasCpe, carencias, violacionesCarencia, envasesDeAplicaciones, alertasSenasa, LEY_FITO,
    CARGAS_SOCIALES_PCT_DEFECTO, TIPOS_LABOR, CATEGORIAS_INSUMO, CATEGORIAS_SERVICIO, periodoCampania, costoCompra, ingresosInsumo,
    precioInsumo, stockInsumos, costosDelPeriodo, resultadoCampania, movimientosIvaDeCompra,
    RG830_LOCACION_RURAL, retencionArrendamiento,
    CULTIVOS, ESTADOS_SISA, REGLAS_SISA_DEFECTO, REGLAS_IIBB_DEFECTO, SELLOS_PROVINCIA, PROVINCIAS, DEDUCCIONES, RG4310, RG3419,
    grano, cultivo, estadoSisa, campaniaDe, reglaSisa, reglaIibb, calcularLpg, stockPorUbicacion, stockPorGrano,
    validarVinculo, movimientosIvaDeLpg, posicionIva, libroIvaCsv, obligacionesSisa, fechaIso, num, redondear,
  };
}));
