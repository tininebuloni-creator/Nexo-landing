/* Residuos y efluentes de PampaPorcinos (versión Premium; roles Propietario y Administración).
 *
 * Mismo esquema que "Residuos y efluentes" de PampaTambo, adaptado a la granja porcina:
 *   - Sistema de tratamiento y permisos (fosa, laguna, biodigestor, compostaje) con vencimientos.
 *   - Análisis de efluente, suelo y napa con la frecuencia que pide el permiso.
 *   - Uso agronómico de purines: kg de N y P por hectárea por lote contra el máximo anual.
 *   - Destino de la mortandad: cada Mortalidad registrada tiene que tener su destino.
 *   - Residuos patogénicos y veterinarios: acopio y retiro con manifiesto.
 *   - Envases y plásticos: triple lavado, inutilizado y entrega con comprobante.
 * Los límites y plazos dependen de la provincia y del permiso: son datos que carga el usuario.
 * Todo se guarda en stores sincronizados (todos los equipos ven lo mismo).
 */
const RESIDUOS_STORES = ['residuosConfig', 'efluentesAnalisis', 'efluentesAplicaciones', 'mortandadDestino', 'residuosPatogenicos', 'residuosEnvases'];
const RESIDUOS_CONFIG_CAMPOS = {
  resCfgSistema: 'sistema', resCfgCapacidad: 'capacidadM3', resCfgSeparador: 'separador', resCfgLaguna: 'laguna', resCfgSuelo: 'suelo',
  resCfgAutoridad: 'autoridad', resCfgPermiso: 'permiso', resCfgPermisoVence: 'permisoVence', resCfgDdjjVence: 'ddjjVence',
  resCfgProvincia: 'provincia', resCfgLagunas: 'lagunas', resCfgFreatimetros: 'freatimetros', resCfgIngenieria: 'ingenieria', resCfgOtorgado: 'otorgado',
  resCfgRegistroAda: 'registroAda', resCfgMitigacion: 'mitigacion', resCfgIac: 'iac', resCfgDistancia: 'distanciaM',
  resCfgNMax: 'nMax', resCfgPMax: 'pMax', resCfgFrecuencia: 'frecuenciaMeses', resCfgAcopio: 'diasAcopio', resCfgMortandad: 'diasMortandad'
};

async function residuosData() {
  const [config, analisis, aplicaciones, mortandad, patogenicos, envases, animals, health, treatments, vademecum] = await Promise.all(
    [...RESIDUOS_STORES, 'animals', 'health', 'treatments', 'vademecum'].map(all)
  );
  return { config: config[0] || null, analisis, aplicaciones, mortandad, patogenicos, envases, animals, health, treatments, vademecum };
}

// Cabezas de cada Mortalidad que todavía no tienen destino (compostaje, fosa, incineración, retiro...).
function mortandadPendiente(animals, destinos) {
  const asignadas = {};
  (destinos || []).forEach(d => { asignadas[d.mortalidadKey] = (asignadas[d.mortalidadKey] || 0) + (Number(d.cantidad) || 0); });
  // Identidad de la mortalidad: su syncKey (igual en todos los equipos); los registros viejos sin syncKey usan el id.
  return (animals || [])
    .filter(r => r.tipo === 'Mortalidad')
    .map(r => ({ ...r, syncKey: r.syncKey || `id:${r.id}` }))
    .map(r => ({ ...r, pendientes: Math.max(0, (Number(r.cantidad) || 0) - (asignadas[r.syncKey] || 0)) }))
    .filter(r => r.pendientes > 0)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

// Escala para efluentes (según el documento de gestión de purines): hasta 50 madres, 50 a 200 y más
// de 200. Es distinta de la escala comercial de Ventas: acá define la infraestructura exigible.
const ESCALA_EFLUENTES = [
  { hasta: 50, nombre: 'Pequeña escala (hasta 50 madres)', sistema: 'Fosas bajo galpón o canaletas de lavado hacia dos lagunas en serie con suelo arcilloso compactado. Distribución en campo propio con tanque estercolero.' },
  { hasta: 200, nombre: 'Mediana escala (50 a 200 madres)', sistema: 'Separador de sólidos (criba estática o rotativa) y tres lagunas de estabilización: anaeróbica, facultativa y de maduración. Distribución planificada con estercolera o cañerías a lotes en barbecho.' },
  { hasta: Infinity, nombre: 'Gran escala (más de 200 madres)', sistema: 'Ingeniería ambiental certificada por consultor matriculado, impermeabilización 100% con geomembrana PEAD verificada con freatímetros. Es común el biodigestor; aplicación con pivot o inyección directa según análisis.' }
];
const CATEGORIAS_MADRES_EFLUENTES = ['Cachorras de reposición', 'Madres gestantes', 'Madres lactantes'];
function madresEnStock(animals) {
  const stock = typeof stockByCategory === 'function' ? stockByCategory(animals || []) : {};
  return CATEGORIAS_MADRES_EFLUENTES.reduce((t, c) => t + Math.max(0, stock[c] || 0), 0);
}
const escalaEfluentes = madres => ESCALA_EFLUENTES.find(e => madres <= e.hasta);
const SIN_LAGUNAS = /Biodigestor|Cama profunda/;

// ─── Dimensionamiento de lagunas e impermeabilización ─────────────────────────────────────
// Purín diario = madres × litros por madre por día. Cada laguna guarda el purín de sus días de
// retención. Forma: tronco de pirámide de base cuadrada con taludes; con el volumen y la profundidad
// se despeja el lado del fondo. La geomembrana cubre fondo y taludes hasta el borde libre, más la
// zanja de anclaje y los solapes. Valores de diseño típicos, editables (los firma un profesional).
const LAGUNAS_CAMPOS = { lgLitros: 'litrosMadreDia', lgPrecioM2: 'precioGeomembranaM2', lgPrecioM3: 'precioExcavacionM3', lgEspesor: 'espesorGeomembrana', lgTrhA: 'trhAnaerobica', lgProfA: 'profAnaerobica', lgTrhF: 'trhFacultativa', lgProfF: 'profFacultativa', lgTrhM: 'trhMaduracion', lgProfM: 'profMaduracion', lgTalud: 'talud' };
const LAGUNAS_DISENO = { litrosMadreDia: 100, anaerobica: { trh: 40, prof: 3.5 }, facultativa: { trh: 30, prof: 1.8 }, maduracion: { trh: 15, prof: 1.2 }, talud: 2, bordeLibre: 0.5, anclaje: 1, solapes: 0.10 };

function volumenTronco(b, h, z) {
  const B = b + 2 * z * h;
  return h / 3 * (b * b + B * B + b * B);
}
function ladoFondo(volumen, h, z) {
  let lo = 0, hi = Math.max(10, Math.sqrt(volumen / h) * 2);
  while (volumenTronco(hi, h, z) < volumen) hi *= 2;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (volumenTronco(m, h, z) < volumen) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
function dimensionarLagunas(madres, cfg = {}) {
  const n = v => (v === '' || v === undefined || v === null || isNaN(Number(v)) ? null : Number(v));
  const litros = n(cfg.litrosMadreDia);
  const litrosUsados = litros ?? LAGUNAS_DISENO.litrosMadreDia;
  const z = n(cfg.talud) ?? LAGUNAS_DISENO.talud;
  const caudal = madres * litrosUsados / 1000; // m³/día
  const tipos = [
    { id: 'anaerobica', nombre: 'Anaeróbica', trh: n(cfg.trhAnaerobica) ?? LAGUNAS_DISENO.anaerobica.trh, prof: n(cfg.profAnaerobica) ?? LAGUNAS_DISENO.anaerobica.prof },
    { id: 'facultativa', nombre: 'Facultativa', trh: n(cfg.trhFacultativa) ?? LAGUNAS_DISENO.facultativa.trh, prof: n(cfg.profFacultativa) ?? LAGUNAS_DISENO.facultativa.prof },
    { id: 'maduracion', nombre: 'Maduración', trh: n(cfg.trhMaduracion) ?? LAGUNAS_DISENO.maduracion.trh, prof: n(cfg.profMaduracion) ?? LAGUNAS_DISENO.maduracion.prof }
  ];
  // Cantidad de lagunas: la cargada, o la que corresponde a la escala (2 hasta 50 madres, si no 3).
  const cantidad = Math.min(3, Math.max(1, n(cfg.lagunas) || (madres <= 50 ? 2 : 3)));
  const lagunas = tipos.slice(0, cantidad).map(t => {
    const volumen = caudal * t.trh;
    const b = volumen > 0 ? ladoFondo(volumen, t.prof, z) : 0;
    const H = t.prof + LAGUNAS_DISENO.bordeLibre;
    const ladoSup = b + 2 * z * H;
    const taludes = 4 * (b + ladoSup) / 2 * H * Math.sqrt(1 + z * z);
    const anclaje = 4 * ladoSup * LAGUNAS_DISENO.anclaje;
    const geomembrana = volumen > 0 ? (b * b + taludes + anclaje) * (1 + LAGUNAS_DISENO.solapes) : 0;
    const excavacion = volumen > 0 ? volumenTronco(b, H, z) : 0;
    return { ...t, volumen, ladoFondo: b, ladoSup, profTotal: H, geomembrana, excavacion };
  });
  const precioM2 = n(cfg.precioGeomembranaM2);
  const precioM3 = n(cfg.precioExcavacionM3);
  const totalM2 = lagunas.reduce((t, l) => t + l.geomembrana, 0);
  const totalM3 = lagunas.reduce((t, l) => t + l.excavacion, 0);
  return {
    madres, litros, litrosUsados, estimado: litros === null, caudal, talud: z, lagunas,
    volumenTotal: lagunas.reduce((t, l) => t + l.volumen, 0), totalM2, totalM3,
    costoGeomembrana: precioM2 !== null ? totalM2 * precioM2 : null,
    costoExcavacion: precioM3 !== null ? totalM3 * precioM3 : null
  };
}

const esEfluente = a => /^Efluente/.test(a.muestra || '');
// Último análisis de efluente con N o P: con él se calcula la dosis por hectárea de una aplicación.
function ultimoAnalisisEfluente(analisis) {
  return [...(analisis || [])].filter(esEfluente).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || null;
}

// Alertas y cifras del módulo (también van al tablero y a PampaIA). Función pura: recibe los datos.
function evaluarResiduos(d, hoy = dateNow()) {
  const cfg = d.config || {};
  const alertas = [];
  const dias = f => (f ? Math.round((new Date(`${f}T12:00:00`) - new Date(`${hoy}T12:00:00`)) / 86400000) : null);
  const hayEfluentes = (d.aplicaciones || []).length || (d.analisis || []).length || cfg.sistema;

  if (cfg.laguna === 'Sin impermeabilizar') alertas.push({ nivel: 'risk', titulo: 'Fosa o laguna sin impermeabilizar', detalle: `Está prohibido el estancamiento de purines sin impermeabilizar: contamina la napa${cfg.suelo === 'Arenoso' ? ' (en suelo arenoso percola muy rápido)' : ''}. Tiene que tener geomembrana, hormigón o arcilla compactada.` });

  // Requisitos por escala (madres en stock).
  const madres = d.madres ?? madresEnStock(d.animals);
  const escala = escalaEfluentes(madres);
  const conLagunas = cfg.sistema && !SIN_LAGUNAS.test(cfg.sistema) && cfg.laguna !== 'No tiene fosa ni laguna';
  const lagunas = cfg.lagunas === '' || cfg.lagunas === undefined ? null : Number(cfg.lagunas);
  if (madres > 0 && cfg.sistema) {
    if (madres <= 50) {
      if (conLagunas && lagunas !== null && lagunas < 2) alertas.push({ nivel: 'warn', titulo: 'Lagunas insuficientes para la escala', detalle: `${madres} madres: se recomiendan dos lagunas en serie (cargaste ${lagunas}).` });
    } else if (madres <= 200) {
      if (cfg.separador !== 'Sí') alertas.push({ nivel: 'warn', titulo: 'Falta separador de sólidos', detalle: `${madres} madres (mediana escala): separador mecánico de sólidos antes de las lagunas.` });
      if (conLagunas && lagunas !== null && lagunas < 3) alertas.push({ nivel: 'warn', titulo: 'Lagunas insuficientes para la escala', detalle: `${madres} madres: tres lagunas de estabilización (anaeróbica, facultativa y de maduración); cargaste ${lagunas}.` });
    } else {
      if (conLagunas && cfg.laguna !== 'Geomembrana PEAD') alertas.push({ nivel: 'risk', titulo: 'Impermeabilización insuficiente para la escala', detalle: `${madres} madres (gran escala): impermeabilización 100% con geomembrana PEAD.` });
      if (cfg.freatimetros !== 'Sí') alertas.push({ nivel: 'risk', titulo: 'Sin freatímetros', detalle: 'Gran escala: la impermeabilización se verifica con freatímetros (pozos de monitoreo aguas abajo).' });
      if (!String(cfg.ingenieria || '').trim()) alertas.push({ nivel: 'warn', titulo: 'Sin ingeniería ambiental certificada', detalle: 'Gran escala: el sistema tiene que estar certificado por un consultor matriculado. Cargá quién lo certificó.' });
    }
  }

  // Capacidad cargada contra la necesaria (solo con el gasto de agua medido o estimado por el usuario).
  if (conLagunas && madres > 0 && cfg.litrosMadreDia !== '' && cfg.litrosMadreDia !== undefined && Number(cfg.capacidadM3) > 0) {
    const dim = dimensionarLagunas(madres, cfg);
    if (Number(cfg.capacidadM3) < dim.volumenTotal) alertas.push({ nivel: 'risk', titulo: 'Lagunas chicas para la producción', detalle: `Capacidad cargada ${Number(cfg.capacidadM3).toLocaleString('es-AR')} m³; con ${madres} madres y ${dim.litrosUsados} L/madre/día hacen falta unos ${Math.round(dim.volumenTotal).toLocaleString('es-AR')} m³. Riesgo de desborde.` });
  }

  // Requisitos por provincia.
  const aplicaciones = (d.aplicaciones || []).filter(a => !/biodigestor/i.test(a.metodo || '') || /Digestato/.test(a.metodo || ''));
  if (cfg.provincia === 'Buenos Aires') {
    if (!String(cfg.registroAda || '').trim()) alertas.push({ nivel: 'risk', titulo: 'Sin inscripción en el registro de la ADA', detalle: 'Buenos Aires (Res. Conjunta ADA 1509/24): es obligatorio inscribirse en el Registro de productores primarios de porcinos de la Autoridad del Agua.' });
    if (cfg.mitigacion !== 'Sí') alertas.push({ nivel: 'warn', titulo: 'Sin plan de mitigación', detalle: 'Buenos Aires: se exige un plan de mitigación preventivo ante eventos climáticos extremos para evitar desbordes.' });
  }
  if (cfg.provincia === 'Córdoba') {
    if (conLagunas && cfg.laguna !== 'Geomembrana PEAD') alertas.push({ nivel: 'risk', titulo: 'Lagunas sin geomembrana', detalle: 'Córdoba (Decreto 847): impermeabilización total de las lagunas de estabilización, habitualmente con geomembrana PEAD.' });
    const primerAnalisis = [...(d.analisis || [])].filter(esEfluente).map(a => a.fecha).sort()[0];
    const sinAnalisis = aplicaciones.filter(a => !primerAnalisis || a.fecha < primerAnalisis);
    if (sinAnalisis.length) alertas.push({ nivel: 'risk', titulo: 'Aplicación sin análisis previo', detalle: `Córdoba: ${sinAnalisis.length} aplicación(es) sin análisis físico-químico previo del efluente (N y P).` });
  }
  if (cfg.provincia === 'Santa Fe') {
    if (!cfg.iac) alertas.push({ nivel: 'warn', titulo: 'Sin Informe Ambiental de Cumplimiento', detalle: 'Santa Fe (Ley 11.717): presentá el IAC ante el Ministerio de Ambiente y Cambio Climático y cargá la fecha.' });
    const dist = cfg.distanciaM === '' || cfg.distanciaM === undefined ? null : Number(cfg.distanciaM);
    if (dist === null && conLagunas) alertas.push({ nivel: 'warn', titulo: 'Distancia de las lagunas sin cargar', detalle: 'Santa Fe exige retiros mínimos de 1.000 a 3.000 m entre las lagunas y ejidos urbanos, rutas o escuelas rurales.' });
    else if (conLagunas && dist !== null && dist < 1000) alertas.push({ nivel: 'risk', titulo: 'Lagunas demasiado cerca', detalle: `Santa Fe: ${dist} m al ejido, ruta o escuela más cercana; el retiro mínimo es de 1.000 a 3.000 m.` });
    const hace12 = (() => { const x = new Date(`${hoy}T12:00:00`); x.setFullYear(x.getFullYear() - 1); return x.toISOString().slice(0, 10); })();
    const metales = (d.analisis || []).some(a => a.muestra === 'Suelo' && a.fecha >= hace12 && (a.cobre !== '' && a.cobre !== undefined || a.zinc !== '' && a.zinc !== undefined));
    if (aplicaciones.length && !metales) alertas.push({ nivel: 'warn', titulo: 'Sin control de cobre y zinc en suelo', detalle: 'Santa Fe: la aplicación como enmienda requiere rotación para evitar la acumulación de cobre y zinc (del balanceado). Cargá un análisis de suelo con Cu y Zn del último año.' });
  }
  [['permisoVence', 'Permiso de efluentes'], ['ddjjVence', 'Declaración jurada de efluentes']].forEach(([k, label]) => {
    const n = dias(cfg[k]);
    if (n === null) return;
    if (n < 0) alertas.push({ nivel: 'risk', titulo: `${label} vencido`, detalle: `Venció hace ${Math.abs(n)} día(s).` });
    else if (n <= 30) alertas.push({ nivel: 'warn', titulo: `${label} por vencer`, detalle: `Faltan ${n} día(s).` });
  });
  if (hayEfluentes && !cfg.permiso) alertas.push({ nivel: 'warn', titulo: 'Efluentes sin permiso cargado', detalle: 'Cargá el número de permiso o expediente y su vencimiento.' });

  const ultimo = ultimoAnalisisEfluente(d.analisis);
  const frecuencia = Number(cfg.frecuenciaMeses) > 0 ? Number(cfg.frecuenciaMeses) : 12;
  let proximoAnalisis = '';
  if (ultimo) {
    const x = new Date(`${ultimo.fecha}T12:00:00`);
    x.setMonth(x.getMonth() + frecuencia);
    proximoAnalisis = x.toISOString().slice(0, 10);
    if (proximoAnalisis < hoy) alertas.push({ nivel: 'warn', titulo: 'Análisis de efluente vencido', detalle: `El último es del ${fmtDate(ultimo.fecha)} (cada ${frecuencia} meses).` });
  } else if ((d.aplicaciones || []).length || cfg.sistema) {
    alertas.push({ nivel: 'warn', titulo: 'Sin análisis de efluente', detalle: 'Para calcular la dosis de purín por hectárea hace falta un análisis del efluente.' });
  }

  // Dosis por lote en el año calendario contra el máximo del permiso.
  const anio = hoy.slice(0, 4);
  const porLote = {};
  (d.aplicaciones || []).filter(a => String(a.fecha).slice(0, 4) === anio && a.metodo !== 'Envío a biodigestor').forEach(a => {
    const lote = a.lote || 'Sin lote';
    porLote[lote] = porLote[lote] || { n: 0, p: 0 };
    porLote[lote].n += Number(a.nKgHa) || 0;
    porLote[lote].p += Number(a.pKgHa) || 0;
  });
  const nMax = Number(cfg.nMax) || 0;
  const pMax = Number(cfg.pMax) || 0;
  Object.entries(porLote).forEach(([lote, x]) => {
    if (nMax && x.n > nMax) alertas.push({ nivel: 'risk', titulo: 'Dosis de nitrógeno excedida', detalle: `${lote}: ${x.n.toFixed(0)} kg N/ha en ${anio} (máximo ${nMax}).` });
    if (pMax && x.p > pMax) alertas.push({ nivel: 'risk', titulo: 'Dosis de fósforo excedida', detalle: `${lote}: ${x.p.toFixed(0)} kg P/ha en ${anio} (máximo ${pMax}).` });
  });
  const loteMax = Object.entries(porLote).sort((a, b) => b[1].n - a[1].n)[0] || null;

  // Mortandad sin destino.
  const pendientesMort = mortandadPendiente(d.animals, d.mortandad);
  const cabezasSinDestino = pendientesMort.reduce((t, r) => t + r.pendientes, 0);
  const diasMort = Number(cfg.diasMortandad) >= 0 && cfg.diasMortandad !== '' && cfg.diasMortandad !== undefined ? Number(cfg.diasMortandad) : 1;
  const atrasadas = pendientesMort.filter(r => -dias(String(r.fecha).slice(0, 10)) > diasMort);
  if (atrasadas.length) alertas.push({ nivel: 'risk', titulo: 'Mortandad sin destino', detalle: `${atrasadas.reduce((t, r) => t + r.pendientes, 0)} cabeza(s) muertas hace más de ${diasMort} día(s) sin destino registrado (compostaje, fosa, incineración o retiro).` });

  // Patogénicos: lo acopiado después del último retiro.
  const pat = [...(d.patogenicos || [])].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const ultimoRetiro = [...pat].reverse().find(r => r.movimiento === 'Retiro');
  const desde = ultimoRetiro ? ultimoRetiro.fecha : '';
  const acopios = pat.filter(r => r.movimiento !== 'Retiro' && r.fecha > desde);
  const kgAcopio = acopios.reduce((t, r) => t + (Number(r.kg) || 0), 0);
  const diasAcopio = Number(cfg.diasAcopio) > 0 ? Number(cfg.diasAcopio) : 30;
  if (acopios.length && -dias(acopios[0].fecha) > diasAcopio) alertas.push({ nivel: 'risk', titulo: 'Patogénicos sin retirar', detalle: `Hay acopio desde hace ${-dias(acopios[0].fecha)} día(s) (máximo ${diasAcopio}): coordiná el retiro con un transportista habilitado.` });
  const tratamientos = [...(d.health || []), ...(d.treatments || []).map(t => ({ fecha: t.fechaInicio || t.fecha }))].filter(r => String(r.fecha || '') > desde).length;
  if (tratamientos && !acopios.length && (!ultimoRetiro || -dias(ultimoRetiro.fecha) > 90)) alertas.push({ nivel: 'warn', titulo: 'Residuos veterinarios sin registrar', detalle: `${tratamientos} aplicación(es) sanitaria(s) desde el último retiro: registrá el acopio de agujas, jeringas y frascos.` });
  pat.filter(r => r.movimiento === 'Retiro' && !String(r.manifiesto || '').trim()).forEach(r => alertas.push({ nivel: 'warn', titulo: 'Retiro sin manifiesto', detalle: `Retiro del ${fmtDate(r.fecha)}: guardá el número de manifiesto o certificado de tratamiento.` }));

  // Envases y plásticos.
  const envases = d.envases || [];
  const sumar = l => l.reduce((t, r) => t + (Number(r.cantidad) || 0), 0);
  const sinLavar = sumar(envases.filter(r => ['Bidón de agroquímico', 'Envase de desinfectante'].includes(r.tipo) && r.tripleLavado === 'NO'));
  const sinPerforar = sumar(envases.filter(r => r.tripleLavado === 'SI' && r.perforado === 'NO'));
  const pendientes = envases.filter(r => !r.destino || /^Pendiente/.test(r.destino));
  if (sinLavar) alertas.push({ nivel: 'risk', titulo: 'Envases sin triple lavado', detalle: `${sinLavar} envase(s) de agroquímicos o desinfectantes: hay que hacerles triple lavado antes de entregarlos (Ley 27.279 para fitosanitarios).` });
  if (sinPerforar) alertas.push({ nivel: 'warn', titulo: 'Envases sin inutilizar', detalle: `${sinPerforar} envase(s) lavados sin perforar.` });
  if (pendientes.length) alertas.push({ nivel: 'warn', titulo: 'Envases sin entregar', detalle: `${sumar(pendientes)} envase(s) o plásticos en acopio: entregalos (CAT, reciclador o proveedor) y guardá el comprobante.` });
  envases.filter(r => r.destino && !/^Pendiente/.test(r.destino) && !String(r.comprobante || '').trim()).forEach(r => alertas.push({ nivel: 'warn', titulo: 'Entrega sin comprobante', detalle: `${r.tipo} del ${fmtDate(r.fecha)} (${r.destino}): cargá el comprobante.` }));

  // Residuos de medicamentos (Plan CREHA).
  const tratamientosActivos = (d.treatments || []).filter(t => (t.fechaLiberacion && t.fechaLiberacion > hoy) || (t.exclusionExportacion && t.exclusionExportacion > hoy));
  (d.treatments || []).filter(t => t.exclusionExportacion && t.exclusionExportacion > hoy).forEach(t => alertas.push({ nivel: 'warn', titulo: 'Lote con tetraciclinas', detalle: `Lote ${t.lote}: no apto para faena con destino UE / Unión Económica Euroasiática hasta el ${fmtDate(t.exclusionExportacion)} (exclusión de 90 días, Plan CREHA).` }));
  (d.treatments || []).filter(t => typeof crehaRequiereRecetaDigital === 'function' && crehaRequiereRecetaDigital(t.medicamento?.principioActivo) && !String(t.receta || '').trim()).forEach(t => alertas.push({ nivel: 'risk', titulo: 'Antimicrobiano crítico sin Receta Digital', detalle: `Lote ${t.lote} (${t.medicamento?.principioActivo}): la Res. SENASA 80/2025 exige Receta Digital Veterinaria.` }));
  (d.vademecum || []).forEach(m => {
    const ref = typeof crehaRetiroReferencia === 'function' ? crehaRetiroReferencia(m.principioActivo) : null;
    if (ref && Number(m.diasCarencia) < ref.min) alertas.push({ nivel: 'warn', titulo: 'Carencia menor a la referencia', detalle: `${m.nombre} (${ref.nombre}): ${m.diasCarencia} días; el retiro estándar es de ${ref.min} a ${ref.max}. Verificá el marbete.` });
  });

  return { alertas, madres, escala, tratamientosActivos, ultimo, proximoAnalisis, loteMax, cabezasSinDestino, pendientesMort, kgAcopio, acopiosPendientes: acopios.length, envasesPendientes: sumar(pendientes) };
}

// Alertas para el tablero: solo si la versión (Premium) y el rol tienen el módulo.
async function residuosDashboardAlerts() {
  if (typeof hasModuleAccess === 'function' && !hasModuleAccess('residuos')) return [];
  if (typeof roleHasView === 'function' && !roleHasView('residuos')) return [];
  return evaluarResiduos(await residuosData()).alertas.map(a => ({ danger: a.nivel === 'risk', title: `Ambiente · ${a.titulo}`, text: a.detalle, when: a.nivel === 'risk' ? 'URGENTE' : 'REVISAR' }));
}

async function refreshResiduos() {
  if (!$('residuos')) return;
  const d = await residuosData();
  ['eaFecha', 'apeFecha', 'mdFecha', 'rpFecha', 'reFecha'].forEach(id => { if ($(id) && !$(id).value) $(id).value = dateNow(); });
  const cfg = d.config || {};
  Object.entries(RESIDUOS_CONFIG_CAMPOS).forEach(([id, k]) => { const el = $(id); if (el && document.activeElement !== el) el.value = cfg[k] ?? ''; });
  // Lotes de Campos y de los movimientos.
  const lotes = new Set([...(await all('geoFields')).map(g => g.nombreLote || g.numeroLote), ...d.aplicaciones.map(a => a.lote)].filter(Boolean));
  if ($('resLotesList')) $('resLotesList').innerHTML = [...lotes].map(l => `<option value="${esc(l)}">`).join('');

  const ordenar = l => [...(l || [])].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const fila = (store, r, celdas) => `<tr>${celdas.map(c => `<td>${c}</td>`).join('')}<td>${delBtn(store, r)}</td></tr>`;
  const vacio = (n, t) => `<tr><td colspan="${n}" style="color:var(--text-dim)">${t}</td></tr>`;
  const num = (v, dec = 2) => (v === '' || v === null || v === undefined ? '-' : Number(v).toLocaleString('es-AR', { maximumFractionDigits: dec }));
  $('efluentesAnalisisTable').innerHTML = ordenar(d.analisis).map(r => fila('efluentesAnalisis', r, [esc(fmtDate(r.fecha)), esc(r.muestra), esc(r.lote || '-'), num(r.nitrogeno, 3), num(r.fosforo, 3), num(r.nitratos), `${num(r.cobre)} / ${num(r.zinc)}`, esc(r.laboratorio || '')])).join('') || vacio(9, 'Sin análisis cargados.');
  $('efluentesAplicacionesTable').innerHTML = ordenar(d.aplicaciones).map(r => fila('efluentesAplicaciones', r, [esc(fmtDate(r.fecha)), esc(r.metodo), esc(r.lote || '-'), num(r.superficieHa), num(r.volumen), num(r.nKgHa, 1), num(r.pKgHa, 1)])).join('') || vacio(8, 'Sin aplicaciones cargadas.');
  $('mortandadDestinoTable').innerHTML = ordenar(d.mortandad).map(r => fila('mortandadDestino', r, [esc(fmtDate(r.fecha)), esc(r.lote || '-'), esc(r.categoria || ''), num(r.cantidad, 0), num(r.kg, 1), esc(r.metodo), esc(r.lugar || ''), esc(r.comprobante || '')])).join('') || vacio(9, 'Sin destinos registrados.');
  $('residuosPatogenicosTable').innerHTML = ordenar(d.patogenicos).map(r => fila('residuosPatogenicos', r, [esc(fmtDate(r.fecha)), esc(r.movimiento), esc(r.descripcion || ''), num(r.kg, 1), esc(r.transportista || ''), esc(r.manifiesto || '')])).join('') || vacio(7, 'Sin movimientos de patogénicos.');
  const sn = v => ({ SI: 'Sí', NO: 'No', NA: 'No corresponde' })[v] || '-';
  $('residuosEnvasesTable').innerHTML = ordenar(d.envases).map(r => fila('residuosEnvases', r, [esc(fmtDate(r.fecha)), esc(r.tipo), esc(r.producto || ''), num(r.cantidad, 0), sn(r.tripleLavado), sn(r.perforado), esc(r.destino || ''), esc(r.comprobante || '')])).join('') || vacio(9, 'Sin envases registrados.');

  const ev = evaluarResiduos(d);
  const hoy = dateNow();
  if ($('crehaTable')) $('crehaTable').innerHTML = ev.tratamientosActivos.length
    ? ev.tratamientosActivos.sort((a, b) => String(b.fechaFin).localeCompare(String(a.fechaFin))).map(t => `<tr><td>${esc(t.lote)}</td><td>${esc(t.medicamento?.principioActivo || '')}</td><td>${esc(fmtDate(t.fechaFin))}</td><td>${t.fechaLiberacion > hoy ? `<span style="color:var(--red)">Desde ${esc(fmtDate(t.fechaLiberacion))}</span>` : 'Sí'}</td><td>${t.exclusionExportacion && t.exclusionExportacion > hoy ? `<span style="color:var(--red)">Desde ${esc(fmtDate(t.exclusionExportacion))}</span>` : (t.fechaLiberacion > hoy ? `Desde ${esc(fmtDate(t.fechaLiberacion))}` : 'Sí')}</td><td>${esc(t.receta || (t.recetaDigital ? 'FALTA' : '-'))}</td></tr>`).join('')
    : '<tr><td colspan="6" style="color:var(--text-dim)">Sin lotes en carencia ni en exclusión.</td></tr>';
  // Mortalidades con cabezas sin destino para elegir en el formulario.
  const sel = $('mdMortalidad');
  if (sel && document.activeElement !== sel) {
    const previo = sel.value;
    sel.innerHTML = ev.pendientesMort.length
      ? ev.pendientesMort.map(r => `<option value="${esc(r.syncKey)}">${esc(fmtDate(String(r.fecha).slice(0, 10)))} · ${esc(r.categoria || '')} · lote ${esc(r.origen || r.destino || '-')} · ${r.pendientes} cab. sin destino</option>`).join('')
      : '<option value="">No hay mortandad sin destino</option>';
    if ([...sel.options].some(o => o.value === previo)) sel.value = previo;
    const actual = ev.pendientesMort.find(r => r.syncKey === sel.value);
    if (actual && $('mdCant') && document.activeElement !== $('mdCant')) $('mdCant').value = actual.pendientes;
  }
  const set = (id, t) => { if ($(id)) $(id).textContent = t; };
  if ($('resEscala')) $('resEscala').innerHTML = ev.madres > 0
    ? `<b>${esc(ev.escala.nombre)}</b> · ${ev.madres} madres en stock<br>${esc(ev.escala.sistema)}`
    : 'Cargá las madres en Animales para saber qué sistema de tratamiento corresponde a la escala de la granja.';
  mostrarCamposProvincia();
  Object.entries(LAGUNAS_CAMPOS).forEach(([id, k]) => { const el = $(id); if (el && document.activeElement !== el && cfg[k] !== undefined) el.value = cfg[k]; });
  renderLagunas(ev.madres, cfg);
  set('kpiResAnalisis', ev.ultimo ? fmtDate(ev.ultimo.fecha) : '-');
  set('kpiResAnalisisSub', ev.proximoAnalisis ? `Próximo: ${fmtDate(ev.proximoAnalisis)}` : 'Sin análisis');
  set('kpiResNitrogeno', ev.loteMax ? `${ev.loteMax[1].n.toFixed(0)} kg N/ha` : '0');
  set('kpiResNitrogenoSub', ev.loteMax ? `${ev.loteMax[0]} (lote más cargado del año)` : 'Sin aplicaciones este año');
  set('kpiResMortandad', String(ev.cabezasSinDestino));
  set('kpiResPatogenicos', `${ev.kgAcopio.toLocaleString('es-AR', { maximumFractionDigits: 1 })} kg`);
  set('kpiResPatogenicosSub', ev.acopiosPendientes ? `${ev.acopiosPendientes} acopio(s) sin retirar` : 'Sin acopio pendiente');
  if ($('residuosAlertas')) $('residuosAlertas').innerHTML = ev.alertas.length
    ? ev.alertas.map(a => `<div class="dashboard-renspa-item ${a.nivel === 'risk' ? 'danger' : 'caution'}"><div class="dashboard-renspa-lot">${esc(a.titulo)}</div><div class="dashboard-renspa-campo">${esc(a.detalle)}</div></div>`).join('')
    : '<div style="color:var(--green,#16a34a)">Sin alertas ambientales.</div>';
}

function renderLagunas(madres, cfg) {
  const box = $('lagunasResultado');
  if (!box) return;
  if (!(madres > 0)) { box.innerHTML = '<span style="color:var(--text-dim)">Cargá las madres en Animales para calcular el purín y las lagunas.</span>'; return; }
  const r = dimensionarLagunas(madres, cfg);
  const m = (v, d = 0) => Number(v).toLocaleString('es-AR', { maximumFractionDigits: d });
  box.innerHTML = `<div style="font-size:13px;margin-bottom:6px"><b>${m(madres)} madres × ${m(r.litrosUsados)} L/día = ${m(r.caudal, 1)} m³ de purín por día</b> (${m(r.caudal * 365)} m³/año)${r.estimado ? ' · <span style="color:#f59e0b">Gasto de agua de referencia: cargá el medido o estimado de tu granja.</span>' : ''}</div>
   <div class="tablewrap"><table><thead><tr><th>Laguna</th><th>Retención</th><th>Volumen útil</th><th>Profundidad (+0,5 m borde)</th><th>Lado fondo / superior</th><th>Geomembrana</th><th>Excavación</th></tr></thead><tbody>
   ${r.lagunas.map(l => `<tr><td>${l.nombre}</td><td>${m(l.trh)} días</td><td>${m(l.volumen)} m³</td><td>${m(l.prof, 1)} m (${m(l.profTotal, 1)} m)</td><td>${m(l.ladoFondo, 1)} m / ${m(l.ladoSup, 1)} m</td><td>${m(l.geomembrana)} m²</td><td>${m(l.excavacion)} m³</td></tr>`).join('')}
   <tr><td><b>Total</b></td><td></td><td><b>${m(r.volumenTotal)} m³</b></td><td></td><td></td><td><b>${m(r.totalM2)} m²</b></td><td><b>${m(r.totalM3)} m³</b></td></tr></tbody></table></div>
   <div style="margin-top:8px;font-size:14px">${r.costoGeomembrana !== null ? `💰 <b>Impermeabilización con geomembrana PEAD ${esc(cfg.espesorGeomembrana || '1,5 mm')}: ${money(r.costoGeomembrana)}</b> (${m(r.totalM2)} m² × ${money(cfg.precioGeomembranaM2)})` : '💰 Cargá el precio de la geomembrana PEAD colocada por m² para ver el costo de impermeabilizar.'}${r.costoExcavacion !== null ? `<br>Excavación: ${money(r.costoExcavacion)} (${m(r.totalM3)} m³ × ${money(cfg.precioExcavacionM3)}) · <b>Total: ${money((r.costoGeomembrana || 0) + r.costoExcavacion)}</b>` : ''}</div>
   <div style="margin-top:6px;font-size:11px;color:var(--text-dim)">Supuestos: lagunas de planta cuadrada, talud ${m(r.talud, 1)}:1, borde libre 0,5 m, zanja de anclaje de 1 m alrededor y 10% de solapes y desperdicio. ${Number(cfg.capacidadM3) > 0 ? `Capacidad cargada en el sistema: ${m(cfg.capacidadM3)} m³ (${Number(cfg.capacidadM3) >= r.volumenTotal ? 'alcanza' : 'NO alcanza'}).` : ''}</div>`;
}

// ─── Formularios ─────────────────────────────────────────────────────────────────────────
function residuosForm(id, handler) {
  const form = $(id);
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const msg = await handler();
      if (msg === false) return;
      form.reset();
      await refresh();
      if (msg) alert(msg);
    } catch (err) { alert(`No se pudo guardar: ${err.message}`); }
  });
}
const numOrEmpty = id => ($(id).value === '' ? '' : Number($(id).value));

residuosForm('residuosConfigForm', async () => {
  const actual = (await all('residuosConfig'))[0];
  const datos = {};
  Object.entries(RESIDUOS_CONFIG_CAMPOS).forEach(([id, k]) => { datos[k] = String($(id).value ?? '').trim(); });
  // Buenos Aires: los permisos de gestión y aplicación de purines tienen vigencia de 4 años.
  if (datos.provincia === 'Buenos Aires' && datos.otorgado && !datos.permisoVence) {
    const v = new Date(`${datos.otorgado}T12:00:00`); v.setFullYear(v.getFullYear() + 4); datos.permisoVence = v.toISOString().slice(0, 10);
  }
  // Un único registro sincronizado: los cambios de cada campo viajan a los demás equipos.
  if (actual) await putManyWithSync('residuosConfig', [{ ...actual, ...datos }]);
  else await add('residuosConfig', datos);
  return 'Sistema de tratamiento y permisos guardados.';
});

// Gasto de agua, diseño de lagunas y precios: se guardan en la misma configuración sincronizada.
residuosForm('lagunasForm', async () => {
  const actual = (await all('residuosConfig'))[0];
  const datos = {};
  Object.entries(LAGUNAS_CAMPOS).forEach(([id, k]) => { datos[k] = String($(id).value ?? '').trim(); });
  if (actual) await putManyWithSync('residuosConfig', [{ ...actual, ...datos }]);
  else await add('residuosConfig', datos);
  return '';
});

residuosForm('efluenteAnalisisForm', async () => {
  await add('efluentesAnalisis', { fecha: $('eaFecha').value, muestra: $('eaMuestra').value, lote: $('eaLote').value.trim(), nitrogeno: numOrEmpty('eaN'), fosforo: numOrEmpty('eaP'), nitratos: numOrEmpty('eaNitratos'), cobre: numOrEmpty('eaCu'), zinc: numOrEmpty('eaZn'), laboratorio: $('eaLab').value.trim() });
  return 'Análisis guardado.';
});

residuosForm('efluenteAplicacionForm', async () => {
  const metodo = $('apeMetodo').value;
  const volumen = Number($('apeVol').value) || 0;
  const sup = Number($('apeSup').value) || 0;
  let nKgHa = numOrEmpty('apeN');
  let pKgHa = numOrEmpty('apeP');
  let nota = '';
  if (metodo !== 'Envío a biodigestor') {
    if (!$('apeLote').value.trim() || sup <= 0) { alert('Indicá el lote y la superficie aplicada.'); return false; }
    // Dosis con el último análisis del efluente (kg de N y P por m³).
    const ultimo = ultimoAnalisisEfluente(await all('efluentesAnalisis'));
    if (nKgHa === '' && ultimo && ultimo.nitrogeno !== '') { nKgHa = Math.round(volumen * Number(ultimo.nitrogeno) / sup * 100) / 100; nota = ` Dosis calculada con el análisis del ${fmtDate(ultimo.fecha)}.`; }
    if (pKgHa === '' && ultimo && ultimo.fosforo !== '') pKgHa = Math.round(volumen * Number(ultimo.fosforo) / sup * 100) / 100;
    if (nKgHa === '' && !ultimo) nota = ' Sin análisis de efluente: la dosis de N y P no se pudo calcular.';
  }
  await add('efluentesAplicaciones', { fecha: $('apeFecha').value, metodo, lote: $('apeLote').value.trim(), superficieHa: sup || '', volumen, nKgHa, pKgHa, obs: $('apeObs').value.trim() });
  return `Aplicación guardada.${nota}`;
});

residuosForm('mortandadDestinoForm', async () => {
  const key = $('mdMortalidad').value;
  if (!key) { alert('No hay mortandad sin destino.'); return false; }
  const d = await residuosData();
  const mort = mortandadPendiente(d.animals, d.mortandad).find(r => r.syncKey === key);
  if (!mort) { alert('Esa mortalidad ya tiene destino.'); return false; }
  const cantidad = Number($('mdCant').value) || 0;
  if (cantidad <= 0 || cantidad > mort.pendientes) { alert(`Indicá entre 1 y ${mort.pendientes} cabeza(s).`); return false; }
  await add('mortandadDestino', { fecha: $('mdFecha').value, mortalidadKey: key, lote: mort.origen || mort.destino || '', categoria: mort.categoria || '', cantidad, kg: numOrEmpty('mdKg'), metodo: $('mdMetodo').value, lugar: $('mdLugar').value.trim(), comprobante: $('mdComp').value.trim() });
  return 'Destino de la mortandad guardado.';
});

residuosForm('residuoPatogenicoForm', async () => {
  await add('residuosPatogenicos', { fecha: $('rpFecha').value, movimiento: $('rpMov').value, descripcion: $('rpDesc').value.trim(), kg: numOrEmpty('rpKg'), transportista: $('rpTransp').value.trim(), manifiesto: $('rpManif').value.trim() });
  return 'Movimiento de residuos patogénicos guardado.';
});

residuosForm('residuoEnvaseForm', async () => {
  await add('residuosEnvases', { fecha: $('reFecha').value, tipo: $('reTipo').value, producto: $('reProd').value.trim(), cantidad: Number($('reCant').value) || 0, tripleLavado: $('reLavado').value, perforado: $('rePerf').value, destino: $('reDestino').value, comprobante: $('reComp').value.trim() });
  return 'Envases guardados.';
});

// Campos que pide cada provincia (Buenos Aires: registro ADA y plan de mitigación; Santa Fe: IAC y distancias).
function mostrarCamposProvincia() {
  const prov = $('resCfgProvincia')?.value || '';
  document.querySelectorAll('#residuosConfigForm [data-prov]').forEach(el => { el.hidden = el.dataset.prov !== prov; });
}
$('resCfgProvincia')?.addEventListener('change', mostrarCamposProvincia);

if ($('mdMortalidad')) $('mdMortalidad').addEventListener('change', async () => {
  const d = await residuosData();
  const r = mortandadPendiente(d.animals, d.mortandad).find(x => x.syncKey === $('mdMortalidad').value);
  if (r) $('mdCant').value = r.pendientes;
});
