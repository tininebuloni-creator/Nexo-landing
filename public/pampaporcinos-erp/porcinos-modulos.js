// Módulos de PampaPorcinos que se apoyan en el script principal de index.html (usa sus globales:
// $, esc, money, add, all, putManyWithSync, dateNow, parseISODate, loadEmpresa, loadArcaFiscal,
// loadTransportLinks, fiscalApiAvailable, fiscalApiState, download, csvEscape, refresh, CATS).
//  - Historial clínico del lote: vademécum, tratamientos, carencia, aptitud para faena, Libro Sanitario PDF.
//  - Operación SENASA: responsables y bioseguridad, plan sanitario, DT-e y notificaciones inmediatas.
//  - Fiscal: liquidación mensual de IVA (débito/crédito, saldo técnico y de libre disponibilidad),
//    Libro IVA, emisión real ARCA con su respuesta (CAE + QR) y comprobante PDF.
//  - Canje de granos: contratos y cuenta corriente en pesos y kilos.
//  - Alertas: mortalidad por lote, carencias, plan sanitario, notificaciones y quiebre de stock.

const SENASA_CONFIG_KEY = 'PampaPorcinosSenasa';
const MORTALITY_RULES_KEY = 'PampaPorcinosMortalityRules';
const DAY_MS = 86400000;

// Plan Nacional de Sanidad Porcina (SENASA):
//  - Aujeszky, Res. SENASA 810/2025 (reemplaza la Res. 474/2009): establecimientos clasificados como
//    Libres o bajo Vigilancia; serología cuatrimestral obligatoria en predios comerciales y de genética
//    con más de 100 reproductores; un positivo bloquea movimientos hasta presentar el Plan de Saneamiento
//    (plazo 30 días, actualización semestral); un predio sin clasificación tiene restricción total de traslados.
//  - Triquinelosis, Res. SAGPyA 555/2006: digestión artificial en faena (por faena, sin vencimiento).
//  - Peste Porcina Clásica, Res. SENASA 834/2002 (vigilancia; vacunación prohibida) y Peste Porcina
//    Africana, Res. SENASA 275/2023 (contingencia): notificación inmediata.
//  - Brucelosis: control complementario registrable, sin vencimiento ni bloqueo automático.
const SANITARY_PLAN = {
  AUJESZKY: { label: 'Aujeszky', norma: 'Res. SENASA 810/2025', expireMonths: 4, renewDays: 15 },
  BRUCELOSIS: { label: 'Brucelosis', norma: 'control complementario', expireMonths: 0, complementario: true },
  TRIQUINOSIS: { label: 'Triquinelosis', norma: 'Res. SAGPyA 555/2006', expireMonths: 0 }
};
const AUJESZKY_CLASSIFICATION = { LIBRE: 'Libre', VIGILANCIA: 'Bajo vigilancia', SIN_CLASIFICACION: 'Sin clasificación' };
const REPRODUCTIVE_CATEGORIES = ['Madres gestantes', 'Madres lactantes', 'Cachorras de reposición', 'Padrillos'];
const IMMEDIATE_NOTIFICATIONS = {
  PPA: 'Peste porcina africana (sospecha) · Res. SENASA 275/2023',
  PPC: 'Peste porcina clásica (sospecha) · Res. SENASA 834/2002',
  PRRS: 'Síndrome reproductivo y respiratorio porcino (PRRS)',
  FIEBRE_AFTOSA: 'Fiebre aftosa (sospecha)',
  SINDROME_VESICULAR: 'Síndrome vesicular',
  SINDROME_HEMORRAGICO: 'Síndrome hemorrágico',
  FALLA_REPRODUCTIVA_MASIVA: 'Falla reproductiva masiva',
  MORTALIDAD_ELEVADA: 'Mortalidad elevada'
};
const MORTALITY_PHASES = ['MATERNIDAD', 'RECRIA', 'DESARROLLO', 'TERMINACION', 'REPRODUCTORES'];
const PHASE_LABEL = { MATERNIDAD: 'Maternidad', RECRIA: 'Recría', DESARROLLO: 'Desarrollo', TERMINACION: 'Terminación', REPRODUCTORES: 'Reproductores' };
const PHASE_BY_CATEGORY = {
  'Lechones maternidad': 'MATERNIDAD', 'Destetados': 'RECRIA', 'Recría': 'RECRIA', 'Engorde': 'DESARROLLO',
  'Capones': 'TERMINACION', 'Madres gestantes': 'REPRODUCTORES', 'Madres lactantes': 'REPRODUCTORES',
  'Cachorras de reposición': 'REPRODUCTORES', 'Padrillos': 'REPRODUCTORES'
};
// Categorías porcinas oficiales de WSLSP / DT-e. Los nombres usados antes se traducen con officialCategory().
const PORCINE_CATEGORIES = ['Capón', 'Lechón', 'Cachorro', 'Cachorra', 'Macho entero joven (MEJ)', 'Cerda', 'Padrillo'];
const CATEGORY_ALIASES = { capones: 'Capón', capon: 'Capón', lechones: 'Lechón', lechon: 'Lechón', cachorras: 'Cachorra', cachorros: 'Cachorro', cerdas: 'Cerda', padrillos: 'Padrillo', mej: 'Macho entero joven (MEJ)' };
function officialCategory(value) {
  const key = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return PORCINE_CATEGORIES.find(cat => cat.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === key) || CATEGORY_ALIASES[key] || String(value || '').trim();
}
const INVOICE_TYPE_CODES = {
  'Factura A': 1, 'Nota de débito A': 2, 'Nota de crédito A': 3, 'Factura B': 6, 'Nota de débito B': 7, 'Nota de crédito B': 8,
  'Factura C': 11, 'Nota de débito C': 12, 'Nota de crédito C': 13
};
// Formato oficial de RENSPA (mismo criterio que hacienda-validacion.js del paquete fiscal).
const RENSPA_REGEX = /^\d{2}\.\d{3}\.\d\.\d{5}\/\d{2}$/;
// SIGSA se opera con Clave Fiscal desde ARCA (no hay webservice público de SENASA para terceros).
const SIGSA_URL_DEFAULT = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml';

// ---------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------
function isoAddDays(iso, days) {
  const base = parseISODate(iso);
  if (!base) return '';
  base.setDate(base.getDate() + days);
  return toLocalISODate(base);
}

function daysUntil(iso, from = dateNow()) {
  const target = parseISODate(iso);
  const start = parseISODate(from);
  if (!target || !start) return null;
  return Math.round((target - start) / DAY_MS);
}

function fmtDate(iso) {
  const value = String(iso || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : (value || '-');
}

function sameLot(a, b) {
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase() && String(a || '').trim() !== '';
}

function monthOf(iso) {
  return String(iso || '').slice(0, 7);
}

function loadJson(key, fallback) {
  try { return { ...fallback, ...(JSON.parse(localStorage.getItem(key) || 'null') || {}) }; } catch (err) { return { ...fallback }; }
}

function notifyBrowser(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
  } catch (err) {
    console.warn('No se pudo mostrar la notificación del navegador.', err);
  }
}

// CUIT: módulo 11 de ARCA (mismo criterio que @pampa/core-fiscal-arca en el servidor).
function validateCuitField(value, label, required = false) {
  const cuit = String(value || '').replace(/\D/g, '');
  if (!cuit) return required ? `${label} es obligatorio.` : '';
  if (cuit.length !== 11) return `${label} debe tener 11 dígitos.`;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, weight, index) => acc + weight * Number(cuit[index]), 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10 || check !== Number(cuit[10])) return `${label} no es válido (dígito verificador incorrecto).`;
  return '';
}

// ---------------------------------------------------------------------------------------------
// Historial clínico y carencia
// ---------------------------------------------------------------------------------------------
// Los días de carencia corren desde el día siguiente a la última dosis.
function liberationDate(lastDose, withdrawalDays) {
  return isoAddDays(lastDose, Number(withdrawalDays || 0) + 1);
}

// Plan CREHA Animal (SENASA): control de residuos de medicamentos veterinarios.
// - Retiro estándar de referencia por principio activo (validar siempre con el marbete del producto).
// - Tetraciclinas (oxitetraciclina, tetraciclina, clortetraciclina): no usar en capones para la
//   Unión Europea o la Unión Económica Euroasiática; si se usaron, exclusión de 90 días para esos destinos.
// - Res. SENASA 445/2024: prohibidos los antimicrobianos como promotores de crecimiento; solo uso
//   terapéutico (tratamiento o metafilaxia) bajo prescripción.
// - Res. SENASA 80/2025: colistina / polimixina B y fosfomicina requieren Receta Digital Veterinaria
//   emitida en la plataforma de SENASA vinculada al RENSPA.
const CREHA_RETIRO = [
  { patron: /amoxicilin/i, nombre: 'Amoxicilina', min: 14, max: 20 },
  { patron: /tilosin/i, nombre: 'Tilosina', min: 14, max: 21 },
  { patron: /tiamulin/i, nombre: 'Tiamulina', min: 5, max: 7 },
  { patron: /ceftiofur/i, nombre: 'Ceftiofur', min: 2, max: 5 },
  { patron: /florfenicol/i, nombre: 'Florfenicol', min: 28, max: 38 }
];
const CREHA_TETRACICLINAS = /tetraciclin/i;
const CREHA_RECETA_DIGITAL = /colistin|polimixin|fosfomicin/i;
const CREHA_EXCLUSION_EXPORTACION_DIAS = 90;
const crehaRetiroReferencia = principio => CREHA_RETIRO.find(r => r.patron.test(String(principio || ''))) || null;
const crehaEsTetraciclina = principio => CREHA_TETRACICLINAS.test(String(principio || ''));
const crehaRequiereRecetaDigital = principio => CREHA_RECETA_DIGITAL.test(String(principio || ''));

// Lote con tetraciclinas dentro de los 90 días de exclusión: no apto para faena con destino UE / UEE.
async function activeExportExclusion(lote, fecha = dateNow()) {
  if (!String(lote || '').trim()) return null;
  return (await all('treatments'))
    .filter(row => sameLot(row.lote, lote) && row.exclusionExportacion && fecha < row.exclusionExportacion)
    .sort((a, b) => b.exclusionExportacion.localeCompare(a.exclusionExportacion))[0] || null;
}

async function activeWithdrawal(lote, fecha = dateNow()) {
  if (!String(lote || '').trim()) return null;
  const blocking = (await all('treatments'))
    .filter(row => sameLot(row.lote, lote) && row.fechaLiberacion && fecha < row.fechaLiberacion)
    .sort((a, b) => b.fechaLiberacion.localeCompare(a.fechaLiberacion));
  return blocking[0] || null;
}

function lastControl(controls, code) {
  return controls.filter(row => row.enfermedad === code).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || null;
}

function controlStatus(control, code, today = dateNow()) {
  const plan = SANITARY_PLAN[code];
  if (!control) return { estado: 'SIN_REGISTRO', texto: 'Sin registro', vence: '' };
  if (['POSITIVO', 'NO_APTO'].includes(control.resultado)) return { estado: 'POSITIVO', texto: `Resultado ${control.resultado === 'POSITIVO' ? 'positivo' : 'no apto'}`, vence: '' };
  if (!plan.expireMonths) return { estado: 'VIGENTE', texto: `Último análisis ${fmtDate(control.fecha)}`, vence: '' };
  const vence = addMonthsISO(control.fecha, plan.expireMonths);
  const renovar = isoAddDays(vence, -(plan.renewDays || 0));
  if (today > vence) return { estado: 'VENCIDO', texto: `Vencido el ${fmtDate(vence)}`, vence };
  if (today >= renovar) return { estado: 'RENOVAR', texto: `Renovar antes del ${fmtDate(vence)}`, vence };
  return { estado: 'VIGENTE', texto: `Vigente hasta ${fmtDate(vence)}`, vence };
}

// Bloqueo sanitario previo a cualquier salida de animales (venta, DT-e, liquidación).
// Devuelve false si el despacho no puede hacerse.
async function confirmDespachoSanitario(lote, fecha, aFaena) {
  const despacho = fecha || dateNow();
  if (aFaena) {
    const treatment = await activeWithdrawal(lote, despacho);
    if (treatment) {
      const faltan = daysUntil(treatment.fechaLiberacion, despacho);
      alert(`❌ DESPACHO BLOQUEADO POR BIOLOGÍA: el lote ${lote} se encuentra dentro del período de restricción sanitaria. Medicamento activo: ${treatment.medicamento?.principioActivo || treatment.medicamento?.nombre || '-'}. Fecha de liberación segura para faena: ${fmtDate(treatment.fechaLiberacion)}. Faltan ${faltan} día(s).`);
      return false;
    }
  }
  const check = await sanitaryMovementCheck(despacho);
  if (check.block) {
    alert(`❌ MOVIMIENTO BLOQUEADO (Plan Aujeszky, Res. SENASA 810/2025): ${check.block}`);
    return false;
  }
  if (check.warnings.length) return confirm(`${check.warnings.join(' ')} SENASA puede restringir el movimiento. ¿Continuar igualmente?`);
  return true;
}

// Reproductores en stock (madres, cachorras y padrillos), con el mismo criterio de altas/bajas del tablero.
function countReproductores(animals) {
  return animals.filter(row => REPRODUCTIVE_CATEGORIES.includes(row.categoria)).reduce((sum, row) => {
    const qty = Number(row.cantidad) || 0;
    if (['Alta / ingreso', 'Destete'].includes(row.tipo)) return sum + qty;
    if (['Mortalidad', 'Venta', 'Baja'].includes(row.tipo)) return sum - qty;
    return sum;
  }, 0);
}

function aujeszkyMandatory(config, reproductores) {
  return ['Comercial', 'Genética'].includes(config.tipoEstablecimiento) && reproductores > 100;
}

// Estado del establecimiento frente al Plan Aujeszky (Res. SENASA 810/2025) y demás controles.
// block: motivo de bloqueo de traslados; warnings: avisos que requieren confirmación.
function evaluateSanitaryStatus({ config, controls, reproductores, fecha = dateNow() }) {
  const warnings = [];
  let block = '';
  const clasificacion = config.clasificacionAujeszky;
  const last = lastControl(controls, 'AUJESZKY');
  if (clasificacion === 'SIN_CLASIFICACION') {
    block = 'el establecimiento no tiene clasificación (Libre o bajo Vigilancia): restricción total de traslados.';
  } else if (last && ['POSITIVO', 'NO_APTO'].includes(last.resultado)) {
    const plan = config.planSaneamientoFecha && config.planSaneamientoFecha >= last.fecha ? config.planSaneamientoFecha : '';
    if (!plan) {
      const plazo = isoAddDays(last.fecha, 30);
      block = `serología positiva del ${fmtDate(last.fecha)}: los movimientos quedan bloqueados hasta presentar el Plan de Saneamiento (plazo 30 días: ${fecha > plazo ? `VENCIDO el ${fmtDate(plazo)}` : `vence el ${fmtDate(plazo)}`}).`;
    } else {
      const ultimaActualizacion = [plan, config.planSaneamientoActualizacion].filter(Boolean).sort().at(-1);
      const proxima = addMonthsISO(ultimaActualizacion, 6);
      if (fecha > proxima) block = `el Plan de Saneamiento debe actualizarse cada 6 meses (última actualización ${fmtDate(ultimaActualizacion)}, venció el ${fmtDate(proxima)}).`;
    }
  }
  if (!clasificacion) warnings.push('Falta cargar la clasificación del establecimiento ante el Plan Aujeszky (Libre o bajo Vigilancia).');
  if (aujeszkyMandatory(config, reproductores)) {
    const status = controlStatus(last, 'AUJESZKY', fecha);
    if (['VENCIDO', 'SIN_REGISTRO'].includes(status.estado)) warnings.push(`Serología cuatrimestral de Aujeszky obligatoria (${reproductores} reproductores): ${status.texto.toLowerCase()}.`);
  }
  const brucelosis = lastControl(controls, 'BRUCELOSIS');
  if (brucelosis && ['POSITIVO', 'NO_APTO'].includes(brucelosis.resultado)) warnings.push(`Último control de Brucelosis positivo (${fmtDate(brucelosis.fecha)}): consultá al veterinario acreditado.`);
  return { block, warnings };
}

async function sanitaryMovementCheck(fecha) {
  const [controls, animals] = await Promise.all([all('sanitaryControls'), all('animals')]);
  return evaluateSanitaryStatus({ config: loadSenasaConfig(), controls, reproductores: countReproductores(animals), fecha });
}

function checkProhibitedVaccination(tipo, texto) {
  if (tipo !== 'Vacunación') return '';
  if (/\bPPC\b|peste porcina cl[aá]sica/i.test(String(texto || ''))) return 'La vacunación contra Peste Porcina Clásica (PPC) está prohibida (Res. SENASA 834/2002). No se puede registrar.';
  const config = loadSenasaConfig();
  if (!config.veterinario || !config.acreditacion) return 'La vacunación requiere la intervención de un veterinario acreditado por SENASA: cargá sus datos en SENASA > Responsables y bioseguridad.';
  return '';
}

async function syncVademecumToServer(medicine) {
  if (!(await fiscalApiAvailable())) return;
  await fiscalApi('POST', '/sanidad/vademecum', {
    nombre_comercial: medicine.nombre, principio_activo: medicine.principioActivo, laboratorio: medicine.laboratorio,
    numero_registro_senasa: medicine.registro, dias_carencia_faena: medicine.diasCarencia, unidad_medida: medicine.unidad
  });
}

async function syncTreatmentToServer(treatment) {
  const renspa = loadSenasaConfig().renspa || loadArcaFiscal().renspa;
  if (!renspa || !(await fiscalApiAvailable())) return;
  await syncVademecumToServer(treatment.medicamento);
  await fiscalApi('POST', '/sanidad/tratamientos', {
    granja_renspa: renspa, lote_codigo: treatment.lote, medicamento_id: treatment.medicamento.registro, operario: treatment.veterinario,
    fecha_inicio_tratamiento: treatment.fechaInicio, fecha_fin_tratamiento: treatment.fechaFin, diagnostico_brote: treatment.diagnostico,
    dosis_diaria_aplicada: treatment.dosis, matricula: treatment.matricula, nro_receta_archivada: treatment.receta
  });
}

function updateLiberationPreview() {
  const option = $('hcMedicamento')?.selectedOptions?.[0];
  const dias = option ? Number(option.dataset.carencia || 0) : 0;
  if ($('hcLiberacion')) $('hcLiberacion').value = $('hcFin')?.value && option?.value ? fmtDate(liberationDate($('hcFin').value, dias)) : '';
}

function exportLibroSanitario(treatments) {
  const JsPdf = window.jspdf?.jsPDF;
  if (!JsPdf) { alert('No se pudo cargar el generador de PDF.'); return; }
  const empresa = loadEmpresa();
  const fiscal = loadArcaFiscal();
  const senasa = loadSenasaConfig();
  const doc = new JsPdf({ unit: 'mm', format: 'a4' });
  const left = 12;
  const width = 186;
  doc.setDrawColor(60);
  doc.setTextColor(20);
  doc.rect(left, 10, width, 16);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('LIBRO DE REGISTRO SANITARIO PORCINO', left + 3, 16);
  doc.setFont('helvetica', 'normal');
  doc.text('Registro cronológico de tratamientos clínicos (SENASA)', left + 3, 22);
  doc.text(`Emitido: ${fmtDate(dateNow())}`, left + width - 3, 16, { align: 'right' });
  doc.rect(left, 26, width, 16);
  doc.text(`ESTABLECIMIENTO: ${empresa.nombre || '-'}`, left + 3, 32);
  doc.text(`RENSPA: ${senasa.renspa || fiscal.renspa || '-'}`, left + 110, 32);
  doc.text(`UBICACIÓN: ${empresa.ubicacion || empresa.direccion || '-'}`, left + 3, 38);
  doc.text(`CUIT: ${fiscal.cuit || empresa.cuit || '-'}`, left + 110, 38);

  const columns = [['Fecha ini.', 20], ['Lote', 26], ['Diagnóstico', 36], ['Fármaco (p. activo / reg.)', 50], ['Últ. dosis', 18], ['Alta faena', 18], ['Receta', 18]];
  let y = 48;
  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFillColor(225);
    doc.rect(left, y, width, 7, 'F');
    let x = left + 1;
    columns.forEach(([label, w]) => { doc.text(label, x, y + 5); x += w; });
    doc.setFont('helvetica', 'normal');
    y += 7;
  };
  header();
  const rows = [...treatments].sort((a, b) => String(b.fechaInicio).localeCompare(String(a.fechaInicio)));
  rows.forEach(row => {
    const cells = [fmtDate(row.fechaInicio), row.lote, row.diagnostico, `${row.medicamento?.principioActivo || ''} (${row.medicamento?.registro || '-'})`, fmtDate(row.fechaFin), fmtDate(row.fechaLiberacion), row.receta || '-'];
    const wrapped = cells.map((text, index) => doc.splitTextToSize(String(text || '-'), columns[index][1] - 2));
    const height = Math.max(...wrapped.map(lines => lines.length)) * 4 + 3;
    if (y + height > 270) { doc.addPage(); y = 14; header(); }
    let x = left + 1;
    wrapped.forEach((lines, index) => { doc.text(lines, x, y + 4); x += columns[index][1]; });
    doc.setDrawColor(190); doc.line(left, y + height, left + width, y + height);
    y += height;
  });
  if (!rows.length) { doc.text('Sin tratamientos registrados.', left + 2, y + 6); y += 10; }
  y = Math.max(y + 16, 250);
  if (y > 280) { doc.addPage(); y = 30; }
  doc.setDrawColor(60);
  doc.text(`Firma veterinario responsable: ______________________________`, left, y);
  doc.text(`Aclaración y matrícula: ${senasa.veterinario || ''} ${senasa.matricula ? `- Mat. ${senasa.matricula}` : ''}`, left, y + 7);
  doc.save(`libro-registro-sanitario-${dateNow()}.pdf`);
}

// ---------------------------------------------------------------------------------------------
// SENASA: responsables, DT-e y notificaciones
// ---------------------------------------------------------------------------------------------
function loadSenasaConfig() {
  return loadJson(SENASA_CONFIG_KEY, { veterinario: '', matricula: '', acreditacion: '', cerco: '', auditoria: '', renspa: '', tipoEstablecimiento: '', clasificacionAujeszky: '', planSaneamientoFecha: '', planSaneamientoActualizacion: '', existenciasFecha: '' });
}

function findDte(rows, numero) {
  return rows.find(row => String(row.numero || '').trim().toUpperCase() === String(numero || '').trim().toUpperCase() && row.estado !== 'Anulado') || null;
}

// La factura/liquidación debe coincidir con lo declarado en el DT-e (cantidad y categoría).
async function validateDteLink(numero, { cantidad, categoria, lote } = {}) {
  if (!String(numero || '').trim()) return 'Ingresá el DT-e de SENASA: toda venta o traslado de animales debe viajar con su DT-e.';
  const dte = findDte(await all('dteRegistry'), numero);
  if (!dte) return `El DT-e ${numero} no está registrado (o está anulado). Registralo en SENASA > DT-e antes de facturar.`;
  if (Number(cantidad) && Number(dte.cantidad) !== Number(cantidad)) return `La cantidad (${cantidad}) no coincide con las ${dte.cantidad} cabezas del DT-e ${dte.numero}.`;
  if (categoria && dte.categoria && officialCategory(dte.categoria) !== officialCategory(categoria)) return `La categoría "${categoria}" no coincide con la del DT-e ${dte.numero} ("${dte.categoria}").`;
  if (lote && dte.lote && !sameLot(dte.lote, lote)) return `El lote "${lote}" no coincide con el del DT-e ${dte.numero} ("${dte.lote}").`;
  return '';
}

function noticeStatus(row) {
  if (row.notificado) return { estado: 'Notificada', danger: false };
  const hours = (Date.now() - new Date(row.deteccion).getTime()) / 3600000;
  return hours > 24 ? { estado: 'VENCIDA (+24 h sin notificar)', danger: true } : { estado: 'Pendiente de notificar', danger: true };
}

async function updateRecord(store, row, changes) {
  await putManyWithSync(store, [{ ...row, ...changes }]);
  await refresh();
}

async function closeDte(id) {
  const row = (await all('dteRegistry')).find(item => item.id === id);
  if (row) await updateRecord('dteRegistry', row, { estado: 'Cerrado', cerradoEn: new Date().toISOString() });
}

async function voidDte(id) {
  const row = (await all('dteRegistry')).find(item => item.id === id);
  if (!row) return;
  const motivo = prompt(`Motivo de anulación del DT-e ${row.numero}:`);
  if (!motivo) return;
  await updateRecord('dteRegistry', row, { estado: 'Anulado', motivoAnulacion: motivo, anuladoEn: new Date().toISOString() });
}

async function markNoticeNotified(id) {
  const row = (await all('sanitaryNotices')).find(item => item.id === id);
  if (!row) return;
  const acta = prompt('N° de acta o constancia de la notificación a SENASA:');
  if (acta === null) return;
  await updateRecord('sanitaryNotices', row, { notificado: new Date().toISOString().slice(0, 16), acta: acta.trim(), canal: row.canal || 'Oficina local SENASA' });
}

// ---------------------------------------------------------------------------------------------
// IVA: débito, crédito, saldo técnico y de libre disponibilidad
// ---------------------------------------------------------------------------------------------
function ivaMonthly(data, month) {
  const inMonth = rows => rows.filter(row => monthOf(row.fecha) === month);
  const ops = inMonth(data.ops).filter(row => !row.motivo || row.motivo === 'Venta');
  const invoices = inMonth(data.invoices).filter(row => !row.opRef && row.estadoFiscal !== 'ANULADA');
  const debitoOps = ops.reduce((sum, row) => sum + (Number(row.iva) || 0), 0);
  const debitoFacturas = invoices.reduce((sum, row) => sum + (String(row.tipo || '').startsWith('Nota de crédito') ? -1 : 1) * (Number(row.iva) || 0), 0);
  const costs = inMonth(data.costs);
  return {
    debito: debitoOps + debitoFacturas,
    // Monotributo / Exento no computan crédito fiscal: ese IVA es costo (ver costLines).
    credito: esResponsableInscripto() ? costs.reduce((sum, row) => sum + (Number(row.ivaCredito) || 0), 0) : 0,
    creditoPorAlicuota: costs.reduce((acc, row) => {
      const iva = Number(row.ivaCredito) || 0;
      if (iva > 0 && esResponsableInscripto()) acc[row.ivaAlicuota || 0] = (acc[row.ivaAlicuota || 0] || 0) + iva;
      return acc;
    }, {}),
    retenciones: ops.reduce((sum, row) => sum + (Number(row.retIva) || 0), 0),
    percepciones: costs.reduce((sum, row) => sum + (Number(row.percIva) || 0), 0),
    pagosACuenta: inMonth(data.pagosCuenta || []).reduce((sum, row) => sum + (Number(row.total) || 0), 0),
    ventas: ops.length + invoices.length,
    compras: costs.filter(row => Number(row.ivaCredito) > 0).length
  };
}

// Recorre los meses en orden arrastrando el saldo técnico (1er párrafo) y el de libre disponibilidad
// (2do párrafo). Retenciones y percepciones sufridas solo alimentan el de libre disponibilidad.
function ivaLiquidation(data, month) {
  const months = [...new Set([...data.ops, ...data.invoices, ...data.costs, ...(data.pagosCuenta || [])].map(row => monthOf(row.fecha)).filter(m => /^\d{4}-\d{2}$/.test(m) && m <= month)), month].sort();
  let tecnicoFavor = 0;
  let libre = 0;
  let result = null;
  for (const current of [...new Set(months)]) {
    const m = ivaMonthly(data, current);
    const determinado = m.debito - m.credito - tecnicoFavor;
    const impuesto = Math.max(0, determinado);
    const tecnicoFavorRes = Math.max(0, -determinado);
    const libreDisponible = libre + m.retenciones + m.percepciones + m.pagosACuenta;
    const pagar = Math.max(0, impuesto - libreDisponible);
    const libreRes = Math.max(0, libreDisponible - impuesto);
    result = { ...m, month: current, tecnicoAnterior: tecnicoFavor, libreAnterior: libre, impuesto, tecnicoFavor: tecnicoFavorRes, libre: libreRes, pagar };
    tecnicoFavor = tecnicoFavorRes;
    libre = libreRes;
  }
  return result;
}

async function ivaData() {
  const [ops, invoices, costs, pagosCuenta] = await Promise.all(['arcaOperations', 'arcaInvoices', 'costs', 'ivaPagosCuenta'].map(all));
  return { ops, invoices, costs, pagosCuenta };
}

// ---------------------------------------------------------------------------------------------
// Costos: una sola fuente para el tablero, la vista Costos y el resumen fiscal.
//  - Costos cargados (importe neto; si el productor no es Responsable Inscripto se suma el IVA).
//  - Sanidad (costo de cada aplicación), mantenimiento de maquinaria, fletes de terceros y
//    sueldos de RRHH (último registro de cada persona, por mes): antes no entraban en el total.
//  - Alimentación por consumo (Alimentación > kg × costo/kg) NO se suma: es la imputación de lo
//    comprado, que ya está en Costos; sumarlo contaría la compra dos veces.
// ---------------------------------------------------------------------------------------------
// Stock de insumos y costo por uso. Las compras de alimento y de productos sanitarios entran al
// stock (Costos con insumo y cantidad, o Inventario > Ingreso con costo unitario); el costo del
// período es lo USADO: Alimentación (kg) y Sanidad (cantidad de producto) × costo promedio
// ponderado de las compras a esa fecha. Cada uso descuenta su cantidad del stock.
const KG_POR_UNIDAD = { kg: 1, tonelada: 1000 };
const itemKey = value => String(value || '').trim().toUpperCase();

function stockEntries(inventory) {
  return inventory.filter(r => r.tipo === 'Ingreso' && itemKey(r.item)).map(r => {
    const factor = KG_POR_UNIDAD[r.unidad] && r.unidad !== 'kg' ? KG_POR_UNIDAD[r.unidad] : 1;
    return { key: itemKey(r.item), fecha: String(r.fecha || ''), qty: (Number(r.cantidad) || 0) * factor, unit: (Number(r.costo) || 0) / factor, unidad: factor > 1 ? 'kg' : r.unidad };
  });
}

// Costo promedio ponderado de las compras del insumo hasta la fecha (si no hubo antes, las primeras posteriores).
function avgUnitCost(entries, item, fecha) {
  const key = itemKey(item);
  const priced = entries.filter(e => e.key === key && e.unit > 0 && e.qty > 0);
  if (!priced.length) return null;
  const before = priced.filter(e => e.fecha <= String(fecha || '9999-12-31'));
  const base = before.length ? before : [priced.sort((a, b) => a.fecha.localeCompare(b.fecha))[0]];
  const qty = base.reduce((s, e) => s + e.qty, 0);
  return qty > 0 ? base.reduce((s, e) => s + e.qty * e.unit, 0) / qty : null;
}

function feedingUseCost(row, entries) {
  const kg = Number(row.kg) || 0;
  const avg = avgUnitCost(entries, row.insumo, row.fecha);
  return { importe: kg * (avg ?? (Number(row.costoKg) || 0)), desdeStock: avg !== null, unitario: avg ?? (Number(row.costoKg) || 0) };
}

// Sanidad: producto usado del stock + costo cargado a mano (honorarios / servicios o registros anteriores).
function healthUseCost(row, entries) {
  const uso = Number(row.usoCantidad) || 0;
  const avg = uso > 0 ? avgUnitCost(entries, row.producto, row.fecha) : null;
  return { importe: (avg !== null ? uso * avg : 0) + (Number(row.costo) || 0), desdeStock: avg !== null };
}

// Producto total de un tratamiento: el cargado, o dosis diaria × días × animales.
function treatmentUse(t) {
  if (Number(t.usoCantidad) > 0) return Number(t.usoCantidad);
  const desde = String(t.fechaInicio || t.fecha || '');
  const hasta = String(t.fechaFin || desde);
  const dias = desde ? Math.max(1, Math.round((new Date(`${hasta}T12:00:00`) - new Date(`${desde}T12:00:00`)) / 86400000) + 1) : 1;
  return (Number(t.dosis) || 0) * dias * Math.max(1, Number(t.animales) || 0);
}

// Un registro de Sanidad es el mismo uso que un tratamiento si es del mismo producto, del mismo
// lote o categoría y cae entre el inicio y la última dosis.
function healthMatchesTreatment(h, t) {
  if (Number(h.treatmentId) && Number(h.treatmentId) === Number(t.id)) return true;
  const mismoProducto = itemKey(h.producto) === itemKey(t.medicamento?.nombre);
  const mismoLote = (t.categoria && h.categoria === t.categoria) || (t.lote && itemKey(h.categoria) === itemKey(t.lote));
  const fecha = String(h.fecha || '');
  return mismoProducto && mismoLote && fecha >= String(t.fechaInicio || t.fecha || '') && fecha <= String(t.fechaFin || t.fechaInicio || '');
}

// Tratamientos del historial clínico que no están en Registros de sanidad (cargados antes de que se
// vincularan): se cuentan como uso propio. Los que ya están en Sanidad no se repiten.
function treatmentOnlyUses(treatments = [], health = []) {
  return treatments
    .filter(t => !health.some(h => healthMatchesTreatment(h, t)))
    .map(t => ({ fecha: t.fechaInicio || t.fecha, categoria: t.categoria || t.lote, producto: t.medicamento?.nombre || '', usoCantidad: treatmentUse(t), costo: 0, tipo: 'Tratamiento' }))
    .filter(u => u.producto && u.usoCantidad > 0);
}

// Existencias: ingresos − consumos/ajustes de Inventario − usos de Alimentación y Sanidad.
function stockStatus(inventory, feeding = [], healthRows = [], treatments = []) {
  const health = [...healthRows, ...treatmentOnlyUses(treatments, healthRows)];
  const entries = stockEntries(inventory);
  const items = {};
  const item = (name, unidad) => {
    const key = itemKey(name);
    return items[key] || (items[key] = { item: String(name).trim(), unidad: unidad || 'kg', stock: 0, fecha: '' });
  };
  inventory.forEach(r => {
    if (!itemKey(r.item)) return;
    const factor = KG_POR_UNIDAD[r.unidad] && r.unidad !== 'kg' ? KG_POR_UNIDAD[r.unidad] : 1;
    const x = item(r.item, factor > 1 ? 'kg' : r.unidad);
    const qty = (Number(r.cantidad) || 0) * factor;
    x.stock += r.tipo === 'Ingreso' ? qty : -qty;
    if (String(r.fecha || '') > x.fecha) x.fecha = String(r.fecha || '');
  });
  feeding.forEach(r => {
    const x = items[itemKey(r.insumo)];
    if (!x) return;
    x.stock -= Number(r.kg) || 0;
    if (String(r.fecha || '') > x.fecha) x.fecha = String(r.fecha || '');
  });
  health.forEach(r => {
    const x = items[itemKey(r.producto)];
    if (!x || !(Number(r.usoCantidad) > 0)) return;
    x.stock -= Number(r.usoCantidad);
    if (String(r.fecha || '') > x.fecha) x.fecha = String(r.fecha || '');
  });
  Object.values(items).forEach(x => {
    x.costoPromedio = avgUnitCost(entries, x.item, dateNow()) || 0;
    x.valor = Math.max(0, x.stock) * x.costoPromedio;
  });
  return items;
}

function esResponsableInscripto() {
  return (loadArcaFiscal().iva || 'Responsable Inscripto') === 'Responsable Inscripto';
}

// RRHH guarda una fila por novedad: el estado y la remuneración vigentes son los del último registro.
function currentStaff(hrRows) {
  const latest = new Map();
  [...hrRows]
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')) || (Number(a.id) || 0) - (Number(b.id) || 0))
    .forEach(row => {
      const key = String(row.dni || '').replace(/\D/g, '') || String(row.nombre || '').trim().toLowerCase();
      if (key) latest.set(key, row);
    });
  return [...latest.values()];
}

function monthsBetween(desde, hasta) {
  const out = [];
  let [y, m] = desde.slice(0, 7).split('-').map(Number);
  const [yh, mh] = hasta.slice(0, 7).split('-').map(Number);
  while (y < yh || (y === yh && m <= mh)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function endOfMonth(mes) {
  const [y, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

async function costData() {
  const [costs, health, maintenance, transport, hr, sales, ops, inventory, feeding, treatments] = await Promise.all(['costs', 'health', 'machineMaintenance', 'transport', 'hr', 'sales', 'arcaOperations', 'inventory', 'feeding', 'treatments'].map(all));
  return { costs, health, maintenance, transport, hr, sales, ops, inventory, feeding, treatments };
}

function costSummary(data, desde, hasta) {
  const ri = esResponsableInscripto();
  const inRange = fecha => { const d = String(fecha || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= desde && d <= hasta; };
  const lines = [];
  const push = (fecha, origen, categoria, concepto, importe) => {
    const value = Math.round((Number(importe) || 0) * 100) / 100;
    if (value > 0 && inRange(fecha)) lines.push({ fecha: String(fecha).slice(0, 10), origen, categoria: categoria || 'Sin categoría', concepto: concepto || origen, importe: value });
  };
  const entries = stockEntries(data.inventory);
  let comprasAlimentoSinInsumo = 0;
  data.costs.forEach(r => {
    if (r.stockItem) return; // compra a stock: es costo cuando se usa
    if (r.tipo === 'Alimentación') { if (inRange(r.fecha)) comprasAlimentoSinInsumo += 1; return; }
    push(r.fecha, r.tipo || 'Otros', r.categoria, r.proveedor || r.obs || r.tipo, (Number(r.importe) || 0) + (ri ? 0 : Number(r.ivaCredito) || 0));
  });
  data.feeding.forEach(r => push(r.fecha, 'Alimentación', r.categoria, `${r.insumo || 'Ración'} · ${Number(r.kg) || 0} kg`, feedingUseCost(r, entries).importe));
  [...data.health, ...treatmentOnlyUses(data.treatments, data.health)].forEach(r => push(r.fecha, 'Sanidad', r.categoria, r.producto || r.tipo, healthUseCost(r, entries).importe));
  data.maintenance.forEach(r => push(r.fecha, 'Mantenimiento', 'Equipos', r.equipo || r.tipo, r.costo));
  data.transport.filter(r => r.tipo === 'Terceros').forEach(r => push(r.fecha, 'Fletes', 'Fletes', r.empresa || 'Flete de terceros', r.costo));
  // Sueldos devengados día por día entre el ingreso y la baja (el mes de ingreso o de baja se prorratea).
  const staff = currentStaff(data.hr).filter(r => ['Activo', 'Licencia', 'Baja'].includes(r.estado) && Number(r.remuneracion) > 0);
  const dias = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000) + 1;
  if (staff.length) {
    monthsBetween(desde, hasta).forEach(mes => {
      const inicio = `${mes}-01`;
      const fin = endOfMonth(mes);
      staff.forEach(r => {
        const baja = r.baja || (r.estado === 'Baja' ? String(r.fecha || '').slice(0, 10) : '');
        const desdeEmp = [inicio, desde, r.ingreso || ''].sort().at(-1);
        const hastaEmp = [fin, hasta, baja || '9999-12-31'].sort()[0];
        if (desdeEmp > hastaEmp) return;
        push(hastaEmp, 'Mano de obra', 'Personal', `Sueldo ${r.nombre || ''}`.trim(), Number(r.remuneracion) * dias(desdeEmp, hastaEmp) / dias(inicio, fin));
      });
    });
  }
  const sum = key => lines.reduce((acc, l) => { acc[l[key]] = (acc[l[key]] || 0) + l.importe; return acc; }, {});
  const avisos = [];
  if (comprasAlimentoSinInsumo) avisos.push(`${comprasAlimentoSinInsumo} compra(s) de alimentación sin insumo y cantidad: no entran al stock ni al costo (el alimento es costo cuando se usa). Completá el insumo y la cantidad.`);
  const cargadoA = (tipo) => data.costs.some(r => r.tipo === tipo && inRange(r.fecha));
  if (staff.length && cargadoA('Mano de obra')) avisos.push('Hay costos de "Mano de obra" cargados y sueldos en RRHH: si son los mismos, se cuentan dos veces.');
  if (data.transport.some(r => r.tipo === 'Terceros' && Number(r.costo) > 0 && inRange(r.fecha)) && cargadoA('Fletes')) avisos.push('Hay costos de "Fletes" cargados y fletes de terceros en Transporte: si son los mismos, se cuentan dos veces.');
  return { lines, total: lines.reduce((s, l) => s + l.importe, 0), porOrigen: sum('origen'), porCategoria: sum('categoria'), avisos, ivaEsCosto: !ri };
}

// KPI de costos del tablero y de la vista Costos (antes cada uno sumaba solo Costos + Sanidad).
async function renderCostKpis({ totalCabezas = 0 } = {}) {
  const data = await costData();
  const today = dateNow();
  const shift = days => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() + days); return toLocalISODate(d); };
  const fechas = [...data.costs, ...data.health, ...data.maintenance, ...data.transport, ...data.hr, ...data.feeding].map(r => String(r.fecha || r.ingreso || '').slice(0, 10)).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  const historico = costSummary(data, fechas[0] && fechas[0] < today ? fechas[0] : today, today);
  const mes = costSummary(data, `${today.slice(0, 7)}-01`, today);
  const ult30 = costSummary(data, shift(-30), today);
  const soldKg30 = data.sales.filter(r => String(r.fecha || '') >= shift(-30)).reduce((s, r) => s + (Number(r.kg) || 0), 0);
  const set = (id, value) => { if ($(id)) $(id).textContent = value; };
  set('kCost', money(historico.total));
  set('kCostOp', money(ult30.total));
  const alimentacion = historico.porOrigen['Alimentación'] || 0;
  const sanidad = historico.porOrigen.Sanidad || 0;
  set('costFeed', money(alimentacion));
  set('costHealth', money(sanidad));
  set('costOther', money(historico.total - alimentacion - sanidad));
  set('costTotal', money(historico.total));
  set('costOpMonth', money(mes.total));
  set('costOp30', money(ult30.total));
  set('costOpHead', money(totalCabezas > 0 ? ult30.total / totalCabezas : 0));
  set('costOpKg', money(soldKg30 > 0 ? ult30.total / soldKg30 : 0));
  if ($('costOtherNota')) $('costOtherNota').textContent = Object.entries(historico.porOrigen).filter(([k]) => !['Alimentación', 'Sanidad'].includes(k)).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${money(v)}`).join(' · ');
  if ($('costAvisos')) {
    const avisos = [...historico.avisos];
    if (historico.ivaEsCosto) avisos.unshift('El productor no es Responsable Inscripto: el IVA de las compras se suma al costo y no genera crédito fiscal.');
    $('costAvisos').innerHTML = avisos.map(a => `<div class="dashboard-renspa-item caution"><div class="dashboard-renspa-campo">${esc(a)}</div></div>`).join('');
  }
  if ($('costByCatTable')) {
    const rows = Object.entries(ult30.porCategoria).sort((a, b) => b[1] - a[1]);
    $('costByCatTable').innerHTML = rows.length
      ? rows.map(([cat, val]) => `<tr><td>${esc(cat)}</td><td>${money(val)}</td></tr>`).join('')
      : '<tr><td colspan="2">Sin datos de costos operativos en los últimos 30 días.</td></tr>';
  }
  await renderCostIvaSummary(data);
  await syncStockItemOptions();
  return { historico, mes, ult30 };
}

// Resumen de débito / crédito fiscal en la vista Costos (misma liquidación que ARCA > IVA).
async function renderCostIvaSummary(data) {
  if (!$('cIvaMes')) return;
  if (!$('cIvaMes').value) $('cIvaMes').value = monthOf(dateNow());
  const mes = $('cIvaMes').value;
  const iva = await ivaData();
  const r = ivaLiquidation(iva, mes);
  const anio = mes.slice(0, 4);
  const acumulado = [...new Set([...iva.ops, ...iva.invoices, ...iva.costs].map(row => monthOf(row.fecha)).filter(m => m && m.startsWith(anio) && m <= mes))]
    .reduce((acc, m) => { const x = ivaMonthly(iva, m); acc.debito += x.debito; acc.credito += x.credito; return acc; }, { debito: 0, credito: 0 });
  const set = (id, value) => { if ($(id)) $(id).textContent = value; };
  set('cIvaDebito', money(r.debito));
  set('cIvaDebitoNota', `${r.ventas} comprobante(s) de venta`);
  set('cIvaCredito', money(r.credito));
  set('cIvaCreditoNota', Object.entries(r.creditoPorAlicuota || {}).sort((a, b) => Number(b[0]) - Number(a[0])).map(([alic, v]) => `${String(alic).replace('.', ',')} %: ${money(v)}`).join(' · ') || `${r.compras} compra(s) con IVA`);
  set('cIvaSaldo', money(r.tecnicoFavor > 0 ? r.tecnicoFavor : r.impuesto));
  set('cIvaSaldoNota', r.tecnicoFavor > 0 ? 'saldo técnico a favor' : r.impuesto > 0 ? 'impuesto determinado' : 'sin saldo');
  set('cIvaPagos', money(r.retenciones + r.percepciones + r.pagosACuenta));
  set('cIvaResultado', r.pagar > 0 ? money(r.pagar) : money(r.libre));
  set('cIvaResultadoLabel', r.pagar > 0 ? 'IVA a pagar' : 'Saldo de libre disponibilidad');
  if ($('cIvaResultadoCard')) $('cIvaResultadoCard').classList.toggle('kpi-renspa-danger', r.pagar > 0 && esResponsableInscripto());
  if (!esResponsableInscripto()) {
    set('cIvaResultadoLabel', `${loadArcaFiscal().iva}: no liquida IVA`);
    set('cIvaResultado', money(0));
  }
  set('cIvaAnual', `Acumulado ${anio} hasta ${mes}: débito ${money(acumulado.debito)} · crédito ${money(acumulado.credito)} · diferencia ${money(acumulado.debito - acumulado.credito)}.`);
  // Faena / establecimiento: se documentan con la liquidación (operación ARCA, mismo DT-e).
  // Particular: con la factura a consumidor final vinculada a la venta.
  await loadDteMotivos();
  const dtesFacturados = new Set(data.ops.map(op => String(op.dte || '').trim()).filter(Boolean));
  const ventasFacturadas = new Set(iva.invoices.filter(inv => inv.ventaId && inv.estadoFiscal !== 'ANULADA').map(inv => Number(inv.ventaId)));
  const delMes = data.sales.filter(s => monthOf(s.fecha) === mes);
  const sinLiquidar = delMes.filter(s => saleChannel(s) !== 'PARTICULAR' && !dtesFacturados.has(String(s.dte || '').trim()));
  const sinFactura = delMes.filter(s => saleChannel(s) === 'PARTICULAR' && !ventasFacturadas.has(Number(s.id)));
  const avisos = [];
  if (sinLiquidar.length) avisos.push(`${sinLiquidar.length} venta(s) de ${mes} sin operación en ARCA (mismo DT-e): su IVA débito no está en este resumen. Registralas en ARCA > Operaciones.`);
  if (sinFactura.length) avisos.push(`${sinFactura.length} venta(s) minorista(s) a particulares de ${mes} sin factura a consumidor final: facturalas desde Ventas.`);
  if (!esResponsableInscripto()) avisos.push(`Condición ${loadArcaFiscal().iva}: no liquida IVA; el resumen es solo informativo.`);
  if ($('cIvaAvisos')) $('cIvaAvisos').innerHTML = avisos.map(a => `<div class="dashboard-renspa-item caution"><div class="dashboard-renspa-campo">${esc(a)}</div></div>`).join('');
}

// Compra que va al stock: el costo y su ingreso de inventario (costo unitario con IVA si el productor
// no es Responsable Inscripto). Devuelve el id del costo.
async function addStockPurchase(cost) {
  const id = await add('costs', cost);
  const unitario = ((Number(cost.importe) || 0) + (esResponsableInscripto() ? 0 : Number(cost.ivaCredito) || 0)) / (Number(cost.cantidad) || 1);
  await add('inventory', { fecha: cost.fecha, item: cost.stockItem, tipo: 'Ingreso', cantidad: Number(cost.cantidad), unidad: cost.unidad || 'kg', costo: Math.round(unitario * 10000) / 10000, lote: [cost.proveedor, cost.comprobante].filter(Boolean).join(' · '), origen: 'costs', origenId: id });
  return id;
}

// Los insumos nuevos que entran por Costos aparecen también en Alimentación, Sanidad e Inventario.
async function syncStockItemOptions() {
  const nombres = [...new Set([...(await all('inventory')).map(r => String(r.item || '').trim()), ...(await all('vademecum')).map(m => String(m.nombre || '').trim())].filter(Boolean))];
  const vademecum = new Set((await all('vademecum')).map(m => itemKey(m.nombre)));
  ['alInsumo', 'sProducto', 'iItem'].forEach(id => {
    const select = $(id);
    if (!select) return;
    const actuales = new Set([...select.options].map(o => itemKey(o.value || o.text)));
    nombres.filter(n => !actuales.has(itemKey(n)) && (id !== 'alInsumo' || !vademecum.has(itemKey(n)))).forEach(n => select.add(new Option(n, n)));
  });
  if ($('cStockItemList')) {
    const todos = new Set(nombres);
    ['alInsumo', 'sProducto'].forEach(id => [...($(id)?.options || [])].forEach(o => o.value && todos.add(o.value)));
    $('cStockItemList').innerHTML = [...todos].map(n => `<option value="${esc(n)}">`).join('');
  }
}

function toggleCostStockFields() {
  const tipo = $('cTipo')?.value;
  const aStock = ['Alimentación', 'Sanidad'].includes(tipo);
  document.querySelectorAll('[data-cost-stock]').forEach(el => { el.hidden = !aStock; });
  if ($('cStockItem')) $('cStockItem').required = tipo === 'Alimentación';
  if ($('cCantidad')) $('cCantidad').required = tipo === 'Alimentación';
  if ($('cStockNota')) $('cStockNota').textContent = tipo === 'Alimentación'
    ? 'El alimento comprado entra al stock y es costo cuando se usa (Alimentación).'
    : 'Producto sanitario: con insumo y cantidad entra al stock y es costo cuando se aplica (Sanidad). Sin insumo se toma como servicio u honorario (costo del período).';
}

// ---------------------------------------------------------------------------------------------
// Ventas por canal: faena, otro establecimiento o particular al por menor (consumidor final).
// ---------------------------------------------------------------------------------------------
const SALE_CHANNELS = { FAENA: 'Faena', ESTABLECIMIENTO: 'Otro establecimiento', PARTICULAR: 'Particular (minorista)' };
let dteMotivos = new Map();

// Ventas cargadas antes de existir el canal: se deduce del motivo del DT-e vinculado.
function saleChannel(sale) {
  if (SALE_CHANNELS[sale.canal]) return sale.canal;
  const motivo = dteMotivos.get(String(sale.dte || '').trim());
  return motivo === 'Venta a otro establecimiento' ? 'ESTABLECIMIENTO' : 'FAENA';
}

async function loadDteMotivos() {
  dteMotivos = new Map((await all('dteRegistry')).map(row => [String(row.numero || '').trim(), row.tipo]));
}

function toggleSaleChannel() {
  if (!$('vCanal')) return;
  const particular = $('vCanal').value === 'PARTICULAR';
  $('vDocWrap').hidden = !particular;
  $('vParticularNota').hidden = !particular;
  $('vDte').required = !particular;
  $('vDteLabel').textContent = particular ? 'DT-e SENASA (si el animal sale vivo)' : 'DT-e SENASA';
}

// Prepara la Factura B (o C si el productor es Monotributista / Exento) a consumidor final de una
// venta minorista. El precio al particular es final: incluye el IVA del 10,5 %.
async function invoiceRetailSale(id) {
  const sale = (await all('sales')).find(row => Number(row.id) === Number(id));
  if (!sale) return;
  const condicion = loadArcaFiscal().iva || 'Responsable Inscripto';
  const claseC = condicion !== 'Responsable Inscripto';
  const total = Math.round((Number(sale.total) || 0) * 100) / 100;
  const neto = claseC ? total : Math.round(total / 1.105 * 100) / 100;
  openView('arca');
  await refresh();
  $('aiTipo').value = claseC ? 'Factura C' : 'Factura B';
  await updateInvoiceFormForType();
  $('aiFecha').value = sale.fecha || dateNow();
  $('aiPtoVta').value = $('aiPtoVta').value || loadArcaFiscal().ptoVta || '';
  $('aiCuitComprador').value = sale.documento || '';
  $('aiCondReceptor').value = 'CONSUMIDOR_FINAL';
  $('aiNeto').value = neto.toFixed(2);
  $('aiIva').value = (claseC ? 0 : total - neto).toFixed(2);
  $('aiTotal').value = total.toFixed(2);
  $('aiVentaRef').value = String(sale.id);
  $('arcaInvForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  alert(`Factura ${claseC ? 'C' : 'B'} a consumidor final preparada con la venta a ${sale.cliente} (${money(total)}${claseC ? '' : `, IVA 10,5 % incluido ${money(total - neto)}`}). Revisala y guardala.`);
}

// ---------------------------------------------------------------------------------------------
// Escala productiva: por madres (capacidad instalada) y por cabezas a faena en 12 meses (volumen
// de negocio, comparable con el Anuario Porcino de la Secretaría de Agricultura). Rangos editables.
// ---------------------------------------------------------------------------------------------
const ESCALA_KEY = 'PampaPorcinosEscalas';
const ESCALA_DEFAULT = { micro: 10, pequena: 50, mediana: 150, faenaPequeno: 500, faenaMediano: 5000 };
const CATEGORIAS_MADRES = ['Cachorras de reposición', 'Madres gestantes', 'Madres lactantes'];

function loadEscala() {
  try { return { ...ESCALA_DEFAULT, ...JSON.parse(localStorage.getItem(ESCALA_KEY) || '{}') }; } catch { return { ...ESCALA_DEFAULT }; }
}

function segmentoMadres(madres, cfg = loadEscala()) {
  if (madres <= cfg.micro) return 'MICRO';
  if (madres <= cfg.pequena) return 'PEQUEÑA';
  if (madres <= cfg.mediana) return 'MEDIANA';
  return 'INDUSTRIAL';
}

function segmentoFaena(cabezas, cfg = loadEscala()) {
  if (cabezas < cfg.faenaPequeno) return 'PRODUCTOR_PEQUEÑO';
  if (cabezas <= cfg.faenaMediano) return 'PRODUCTOR_MEDIANO';
  return 'PRODUCTOR_GRANDE';
}

async function productionScale() {
  const [animals, sales, feeding] = await Promise.all(['animals', 'sales', 'feeding'].map(all));
  await loadDteMotivos();
  const hoy = dateNow();
  const desde = (dias) => { const d = new Date(`${hoy}T12:00:00`); d.setDate(d.getDate() - dias); return toLocalISODate(d); };
  const hace12 = desde(365);
  const stock = {};
  animals.forEach(row => {
    const qty = Number(row.cantidad) || 0;
    if (['Alta / ingreso', 'Destete'].includes(row.tipo)) stock[row.categoria] = (stock[row.categoria] || 0) + qty;
    if (['Mortalidad', 'Venta', 'Baja'].includes(row.tipo)) stock[row.categoria] = (stock[row.categoria] || 0) - qty;
  });
  const porCategoria = Object.fromEntries(CATEGORIAS_MADRES.map(c => [c, Math.max(0, stock[c] || 0)]));
  const madres = Object.values(porCategoria).reduce((s, v) => s + v, 0);
  const faena12 = sales.filter(s => String(s.fecha || '') >= hace12 && saleChannel(s) === 'FAENA').reduce((s, r) => s + (Number(r.cantidad) || 0), 0);
  const minorista12 = sales.filter(s => String(s.fecha || '') >= hace12 && saleChannel(s) === 'PARTICULAR').reduce((s, r) => s + (Number(r.cantidad) || 0), 0);
  const destetados12 = animals.filter(r => r.tipo === 'Destete' && String(r.fecha || '') >= hace12).reduce((s, r) => s + (Number(r.cantidad) || 0), 0);
  const kgMadres30 = feeding.filter(r => CATEGORIAS_MADRES.includes(r.categoria) && String(r.fecha || '') >= desde(30)).reduce((s, r) => s + (Number(r.kg) || 0), 0);
  return { madres, porCategoria, faena12, minorista12, destetados12, kgMadres30 };
}

async function renderProductionScale() {
  if (!$('esSegMadres')) return;
  const cfg = loadEscala();
  const e = await productionScale();
  $('esSegMadres').textContent = segmentoMadres(e.madres, cfg);
  $('esSegMadresNota').textContent = `${e.madres} madre(s): ${Object.entries(e.porCategoria).map(([c, v]) => `${c} ${v}`).join(' · ')}`;
  $('esSegFaena').textContent = segmentoFaena(e.faena12, cfg);
  $('esSegFaenaNota').textContent = `${e.faena12} cabeza(s) a faena en 12 meses${e.minorista12 ? ` · ${e.minorista12} vendida(s) a particulares (no cuentan como faena)` : ''}`;
  $('esLechonesMadre').textContent = e.madres > 0 ? (e.destetados12 / e.madres).toFixed(1) : '-';
  $('esLechonesNota').textContent = e.madres > 0 ? `${e.destetados12} destetados en 12 meses` : 'Cargá las madres en Movimientos';
  $('esAlimentoMadre').textContent = e.madres > 0 && e.kgMadres30 > 0 ? `${(e.kgMadres30 / 30 / e.madres).toFixed(2)} kg` : '-';
  $('esAlimentoNota').textContent = e.kgMadres30 > 0 ? `${Math.round(e.kgMadres30)} kg suministrados a madres en 30 días` : 'Sin alimentación cargada para madres';
  if (document.activeElement?.closest?.('#escalaForm')) return;
  $('esMicro').value = cfg.micro; $('esPeq').value = cfg.pequena; $('esMed').value = cfg.mediana;
  $('esFaenaPeq').value = cfg.faenaPequeno; $('esFaenaMed').value = cfg.faenaMediano;
}

async function renderIva() {
  if (!$('ivaMes')) return;
  if (!$('ivaMes').value) $('ivaMes').value = monthOf(dateNow());
  const r = ivaLiquidation(await ivaData(), $('ivaMes').value);
  $('ivaDebito').textContent = money(r.debito);
  $('ivaDebitoNota').textContent = `${r.ventas} comprobante(s) de venta`;
  $('ivaCredito').textContent = money(r.credito);
  $('ivaCreditoNota').textContent = `${r.compras} compra(s) con IVA`;
  $('ivaRetPerc').textContent = money(r.retenciones + r.percepciones + r.pagosACuenta);
  if ($('ivaCreditoNota') && !esResponsableInscripto()) $('ivaCreditoNota').textContent = `${loadArcaFiscal().iva}: sin crédito fiscal`;
  if ($('ivaRetPercNota')) $('ivaRetPercNota').textContent = r.pagosACuenta ? `incluye pago a cuenta 927: ${money(r.pagosACuenta)}` : '';
  await renderPagosCuenta();
  $('ivaLibre').textContent = money(r.libre);
  $('ivaPagar').textContent = money(r.pagar);
  const card = $('ivaTecnicoCard');
  card.classList.remove('kpi-renspa-ok', 'kpi-renspa-warn', 'kpi-renspa-danger');
  if (r.tecnicoFavor > 0) {
    $('ivaTecnico').textContent = money(r.tecnicoFavor);
    $('ivaTecnicoNota').textContent = 'a favor (inmovilizado)';
    card.classList.add('kpi-renspa-warn');
  } else {
    $('ivaTecnico').textContent = money(r.impuesto);
    $('ivaTecnicoNota').textContent = r.impuesto > 0 ? 'impuesto determinado' : 'sin saldo';
    card.classList.add('kpi-renspa-ok');
  }
  $('ivaPagarCard').classList.toggle('kpi-renspa-danger', r.pagar > 0);
  const alerta = $('ivaAlerta');
  if (r.tecnicoFavor > 0) {
    alerta.innerHTML = `<div class="dashboard-renspa-item caution"><div class="dashboard-renspa-campo"><b>Saldo técnico a favor de ${esc(money(r.tecnicoFavor))}</b>: las ventas de hacienda tributan 10,5 % y los insumos 21 %, y este saldo no se puede usar para otros impuestos ni se devuelve en efectivo. Opciones para licuarlo: anticipar ventas de hacienda antes del cierre mensual, planificar compras de reproductores (tasa reducida) o pagar insumos con canje de granos propios.</div></div>`;
  } else if (r.pagar > 0) {
    alerta.innerHTML = `<div class="dashboard-renspa-item danger"><div class="dashboard-renspa-campo">IVA a pagar en ${esc(r.month)}: <b>${esc(money(r.pagar))}</b> (impuesto determinado ${esc(money(r.impuesto))} menos libre disponibilidad ${esc(money(r.impuesto - r.pagar))}).</div></div>`;
  } else {
    alerta.innerHTML = '';
  }
}

// Pago a cuenta de IVA SIRE 927 (RG 4199/2018): importe fijo por cabeza previo a la faena.
async function renderPagosCuenta() {
  if (!$('pagoCuentaTable')) return;
  const rows = (await all('ivaPagosCuenta')).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  $('pagoCuentaTable').innerHTML = rows.length
    ? rows.map(r => `<tr><td>${esc(fmtDate(r.fecha))}</td><td>${esc(r.fechaFaena ? fmtDate(r.fechaFaena) : '-')}</td><td>${esc(r.cabezas)}</td><td>${esc(money(r.valorCabeza))}</td><td>${esc(money(r.total))}</td><td>${esc(r.vep)}</td><td>${esc(r.tropa || '-')}</td></tr>`).join('')
    : '<tr><td colspan="7">Sin pagos a cuenta registrados.</td></tr>';
  if ($('pc927Valor') && !$('pc927Valor').value && rows[0]) $('pc927Valor').value = rows[0].valorCabeza;
  if ($('pc927Fecha') && !$('pc927Fecha').value) $('pc927Fecha').value = dateNow();
}

function calcPagoCuenta() {
  const total = Math.round((Number($('pc927Cabezas').value) || 0) * (Number($('pc927Valor').value) || 0) * 100) / 100;
  $('pc927Total').value = total ? money(total) : '';
  return total;
}

async function exportLibroIva(kind) {
  const month = $('ivaMes').value || monthOf(dateNow());
  const data = await ivaData();
  const inMonth = rows => rows.filter(row => monthOf(row.fecha) === month);
  let header;
  let rows;
  if (kind === 'ventas') {
    header = ['Fecha', 'Comprobante', 'Número', 'CUIT comprador', 'Comprador', 'Neto gravado', 'Alícuota IVA', 'IVA débito', 'Percepción IIBB', 'Total', 'CAE'];
    rows = [
      ...inMonth(data.ops).filter(row => !row.motivo || row.motivo === 'Venta').map(row => [row.fecha, 'Liquidación hacienda porcina', row.respuestaArca?.comprobante_numero?.numero_desde || row.liquidacion || '', row.cuitComprador, row.comprador, row.bruto, '10,5', row.iva, row.percIibb || 0, (Number(row.bruto) || 0) + (Number(row.iva) || 0) + (Number(row.percIibb) || 0) + (Number(row.perc) || 0), row.respuestaArca?.cae || '']),
      ...inMonth(data.invoices).filter(row => !row.opRef && row.estadoFiscal !== 'ANULADA').map(row => [row.fecha, row.tipo, `${row.ptoVta}-${row.numero}`, row.cuitComprador, '', row.neto, row.neto ? String(Math.round(row.iva / row.neto * 1000) / 10).replace('.', ',') : '0', row.iva, 0, row.total, row.cae || ''])
    ];
  } else {
    header = ['Fecha', 'Proveedor', 'CUIT proveedor', 'Comprobante', 'Concepto', 'Neto', 'Alícuota IVA', 'IVA crédito', 'Percepción IVA', 'Total'];
    rows = inMonth(data.costs).map(row => [row.fecha, row.proveedor, row.cuitProveedor, row.comprobante, row.tipo, row.importe, String(row.ivaAlicuota || 0).replace('.', ','), row.ivaCredito || 0, row.percIva || 0, (Number(row.importe) || 0) + (Number(row.ivaCredito) || 0) + (Number(row.percIva) || 0)]);
  }
  if (!rows.length) { alert(`No hay comprobantes de ${kind} en ${month}.`); return; }
  download(`libro-iva-${kind}-${month}.csv`, `﻿${[header, ...rows].map(line => line.map(csvEscape).join(';')).join('\n')}\n`);
}

function calcCostIva() {
  const neto = Number($('cImporte')?.value || 0);
  const alicuota = Number($('cIvaAlic')?.value || 0);
  if ($('cIva')) $('cIva').value = (Math.round(neto * alicuota) / 100).toFixed(2);
}

// ---------------------------------------------------------------------------------------------
// ARCA: respuesta, QR y comprobante
// ---------------------------------------------------------------------------------------------
function arcaQrUrl({ fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, nroDocRec, codAut, tipoCodAut = 'E' }) {
  const doc = String(nroDocRec || '').replace(/\D/g, '');
  const data = { ver: 1, fecha, cuit: Number(String(cuit).replace(/\D/g, '')), ptoVta: Number(ptoVta), tipoCmp: Number(tipoCmp), nroCmp: Number(nroCmp), importe: Math.round(Number(importe || 0) * 100) / 100, moneda: 'PES', ctz: 1, tipoDocRec: doc.length === 11 ? 80 : doc.length >= 7 ? 96 : 99, nroDocRec: Number(doc) || 0, tipoCodAut, codAut: Number(String(codAut).replace(/\D/g, '')) };
  return `https://www.afip.gob.ar/fe/qr/?p=${btoa(unescape(encodeURIComponent(JSON.stringify(data))))}`;
}

// CAE cargado a mano: se guarda con el mismo formato de respuesta y se arma el QR cuando hay datos suficientes.
function buildManualArcaResponse(record) {
  const tipoCmp = INVOICE_TYPE_CODES[record.tipo];
  const cuit = loadArcaFiscal().cuit || loadEmpresa().cuit;
  const alertas = ['CAE informado manualmente: verificá el comprobante en ARCA.'];
  let qr = '';
  if (tipoCmp && cuit && record.ptoVta && record.numero) {
    qr = arcaQrUrl({ fecha: record.fecha, cuit, ptoVta: record.ptoVta, tipoCmp, nroCmp: record.numero, importe: record.total, nroDocRec: record.cuitComprador, codAut: record.cae });
  } else {
    alertas.push('No se generó el QR: faltan CUIT emisor, punto de venta o número del comprobante.');
  }
  return {
    resultado: 'INFORMADO_MANUALMENTE', cae: record.cae, fecha_vencimiento_cae: record.caeVto || '',
    comprobante_numero: { punto_venta: Number(record.ptoVta) || null, numero_desde: Number(record.numero) || null, numero_hasta: Number(record.numero) || null },
    fecha_proceso: new Date().toISOString(), alertas, errores: [], hash_qr: qr, tipo_comprobante: tipoCmp || null
  };
}

function arcaActionsHtml(store, row) {
  const buttons = [];
  const response = row.respuestaArca || row.ultimoIntentoArca;
  const emission = fiscalApiState?.disponible && fiscalApiState?.arca?.emissionAvailable;
  const canEmit = !row.respuestaArca?.cae && !row.cae && row.fiscalId && emission;
  if (canEmit) buttons.push(`<button class="btn" type="button" onclick="emitArca('${store}',${Number(row.id)})">Emitir ${store === 'arcaOperations' ? '(WSLSP)' : '(WSFE)'}</button>`);
  if (response) buttons.push(`<button class="btn secondary" type="button" onclick="showArcaResponse('${store}',${Number(row.id)})">Ver respuesta</button>`);
  return buttons.join(' ') || (row.respuestaArca?.cae ? esc(row.respuestaArca.cae) : '-');
}

async function emitArca(store, id) {
  const row = (await all(store)).find(item => item.id === id);
  if (!row) return;
  if (!confirm(`Se va a emitir ${store === 'arcaOperations' ? 'la liquidación' : 'la factura'} ante ARCA (${fiscalApiState?.arca?.environment === 'production' ? 'PRODUCCIÓN' : 'homologación'}). ¿Continuar?`)) return;
  let body = {};
  if (store === 'arcaOperations') {
    const dte = findDte(await all('dteRegistry'), row.dte);
    if (!dte) { alert('La operación no tiene un DT-e registrado.'); return; }
    body = { dte: { nroDTE: dte.numero, nroRenspa: dte.renspaOrigen, estado: dte.estado === 'Cerrado' ? 'CERRADO' : String(dte.estado || '').toUpperCase() } };
  }
  const path = store === 'arcaOperations' ? `/operaciones/${encodeURIComponent(row.fiscalId)}/emitir` : `/facturas/${encodeURIComponent(row.fiscalId)}/emitir`;
  let data = {};
  try {
    const response = await fetch(`/api/fiscal${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    data = await response.json().catch(() => ({}));
    if (!data.respuesta) throw new Error(data.error || `HTTP ${response.status}`);
  } catch (err) {
    alert(`No se pudo emitir: ${err.message}`);
    return;
  }
  const respuesta = data.respuesta;
  const aprobado = String(respuesta.resultado).startsWith('APROBADO');
  const changes = { ultimoIntentoArca: respuesta };
  if (aprobado) {
    Object.assign(changes, { respuestaArca: respuesta, estadoFiscal: respuesta.resultado });
    if (store === 'arcaInvoices') Object.assign(changes, { cae: respuesta.cae, caeVto: respuesta.fecha_vencimiento_cae, numero: String(respuesta.comprobante_numero.numero_desde || row.numero) });
    else Object.assign(changes, { liquidacion: String(respuesta.comprobante_numero.numero_desde || row.liquidacion), estado: 'Emitida' });
  }
  await updateRecord(store, row, changes);
  await showArcaResponse(store, id);
  alert(respuesta.resultado === 'APROBADO_CONTINGENCIA'
    ? `ARCA no respondió: el comprobante se emitió en contingencia con el CAEA ${respuesta.cae} (N° ${respuesta.comprobante_numero.numero_desde}). Informalo en "Contingencia CAEA" cuando ARCA vuelva a estar disponible.`
    : aprobado ? `ARCA aprobó el comprobante. CAE ${respuesta.cae}.` : `ARCA rechazó el comprobante: ${respuesta.errores.join(' | ') || 'sin detalle'}.`);
}

function qrModules(text) {
  if (typeof window.qrcode !== 'function') return null;
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr;
}

async function showArcaResponse(store, id) {
  const row = (await all(store)).find(item => item.id === id);
  const box = $('arcaRespuestaBox');
  if (!row || !box) return;
  const r = row.respuestaArca || row.ultimoIntentoArca;
  if (!r) { box.textContent = 'Sin respuesta de ARCA para este comprobante.'; return; }
  const ok = String(r.resultado).startsWith('APROBADO') || r.resultado === 'INFORMADO_MANUALMENTE';
  const qr = r.hash_qr ? qrModules(r.hash_qr) : null;
  const numero = r.comprobante_numero || {};
  box.innerHTML = `
    <div class="dashboard-renspa-item ${ok ? '' : 'danger'}"><div class="dashboard-renspa-lot">${esc(r.resultado)}</div>
      <div class="dashboard-renspa-campo">CAE: <b>${esc(r.cae || '-')}</b> · Vencimiento CAE: ${esc(fmtDate(r.fecha_vencimiento_cae))}<br>
      Comprobante: ${esc(String(numero.punto_venta || '-').padStart(5, '0'))}-${esc(String(numero.numero_desde || '-').padStart(8, '0'))} · Procesado: ${esc(new Date(r.fecha_proceso).toLocaleString('es-AR'))}</div></div>
    ${(r.alertas || []).map(text => `<div class="dashboard-renspa-item caution"><div class="dashboard-renspa-campo">${esc(text)}</div></div>`).join('')}
    ${(r.errores || []).map(text => `<div class="dashboard-renspa-item danger"><div class="dashboard-renspa-campo">${esc(text)}</div></div>`).join('')}
    ${qr ? `<div style="margin-top:10px"><img alt="QR ARCA" src="${qr.createDataURL(4, 2)}"><div><a href="${esc(r.hash_qr)}" target="_blank" rel="noopener noreferrer">Verificar en ARCA</a></div></div>` : ''}
    ${r.cae ? `<div class="actions" style="margin-top:10px"><button class="btn" type="button" onclick="exportComprobantePdf('${store}',${Number(row.id)})">Descargar comprobante PDF</button></div>` : ''}`;
  openView('arca');
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function exportComprobantePdf(store, id) {
  const JsPdf = window.jspdf?.jsPDF;
  const row = (await all(store)).find(item => item.id === id);
  if (!JsPdf || !row?.respuestaArca?.cae && !row?.cae) { alert('No se puede generar el comprobante.'); return; }
  const r = row.respuestaArca || row.ultimoIntentoArca;
  const fiscal = loadArcaFiscal();
  const empresa = loadEmpresa();
  const doc = new JsPdf({ unit: 'mm', format: 'a4' });
  const isOp = store === 'arcaOperations';
  const numero = r.comprobante_numero || {};
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(isOp ? 'LIQUIDACIÓN DE COMPRAVENTA DE HACIENDA PORCINA' : String(row.tipo || 'Comprobante').toUpperCase(), 105, 18, { align: 'center' });
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`N° ${String(numero.punto_venta || row.ptoVta || '').padStart(5, '0')}-${String(numero.numero_desde || row.numero || '').padStart(8, '0')}   Fecha: ${fmtDate(row.fecha)}`, 105, 25, { align: 'center' });
  doc.rect(12, 30, 186, 22);
  doc.text(`Emisor: ${fiscal.razon || empresa.nombre || '-'}`, 15, 36);
  doc.text(`CUIT: ${fiscal.cuit || empresa.cuit || '-'}   Cond. IVA: ${fiscal.iva || '-'}`, 15, 42);
  doc.text(`Domicilio: ${fiscal.domicilio || empresa.direccion || '-'}`, 15, 48);
  doc.rect(12, 54, 186, 14);
  doc.text(`Receptor: ${row.comprador || '-'}`, 15, 60);
  doc.text(`CUIT receptor: ${row.cuitComprador || '-'}`, 15, 66);
  const lines = isOp
    ? [[`${row.categoria || 'Porcinos'} - ${row.cantidad || 0} cab. - ${row.peso || 0} kg vivos a ${money(row.precioKg)}/kg`, money(row.bruto)], ['IVA 10,5 %', money(row.iva)], [`Percepción IIBB ${row.iibbJurisdiccion || ''}`, money(row.percIibb || 0)], ['Percepción IVA 925', money(row.perc || 0)], ['Retención IVA SIRE 926', `-${money(row.retIva || 0)}`], ['Retención Ganancias RG 830', `-${money(row.retGanancias || 0)}`], ['Neto a cobrar', money(row.neto)]]
    : [['Neto gravado', money(row.neto)], ['IVA', money(row.iva)], ['Total', money(row.total)]];
  let y = 78;
  lines.forEach(([label, value]) => { doc.text(label, 15, y); doc.text(value, 195, y, { align: 'right' }); y += 7; });
  if (isOp && row.dte) { doc.text(`DT-e SENASA: ${row.dte}   RENSPA: ${row.renspa || '-'}`, 15, y + 2); y += 9; }
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text(`CAE: ${r.cae || row.cae}`, 15, y);
  doc.text(`Vto. CAE: ${fmtDate(r.fecha_vencimiento_cae || row.caeVto)}`, 15, y + 7);
  doc.setFont('helvetica', 'normal');
  const qr = r.hash_qr ? qrModules(r.hash_qr) : null;
  if (qr) {
    const count = qr.getModuleCount();
    const size = 38 / count;
    doc.setFillColor(0);
    for (let rIdx = 0; rIdx < count; rIdx++) for (let c = 0; c < count; c++) if (qr.isDark(rIdx, c)) doc.rect(155 + c * size, y - 5 + rIdx * size, size, size, 'F');
  }
  doc.setFontSize(8);
  doc.text(r.resultado === 'INFORMADO_MANUALMENTE' ? 'CAE informado manualmente.' : 'Comprobante autorizado por ARCA.', 15, y + 16);
  doc.save(`${isOp ? 'liquidacion' : 'factura'}-${numero.numero_desde || row.numero || row.id}.pdf`);
}

async function loadArcaConnection() {
  const status = $('arcaConnStatus');
  if (!status) return;
  if (!(await fiscalApiAvailable())) {
    status.textContent = 'La emisión real ante ARCA está disponible en la aplicación de escritorio (servidor local con certificado). En la versión web se cargan los CAE a mano.';
    $('arcaConnForm').querySelectorAll('input,select,button').forEach(el => { el.disabled = true; });
    $('arcaEmisionForm').querySelectorAll('input,select,button').forEach(el => { el.disabled = true; });
    return;
  }
  const arcaStatus = fiscalApiState.arca || {};
  status.textContent = `${arcaStatus.emissionMessage || ''} WSAA: ${arcaStatus.ticketActive ? `ticket vigente (${arcaStatus.ticketMinutesRemaining} min)` : 'sin ticket activo'}.`;
  try {
    const [config, emisionCfg] = await Promise.all([fiscalApi('GET', '/arca/config'), fiscalApi('GET', '/arca/emision')]);
    $('acCuit').value = config.cuit || '';
    $('acAmbiente').value = config.environment || 'testing';
    $('acServicio').value = config.serviceName || 'wsfe';
    $('aeWsPtoVta').value = emisionCfg.puntoVenta || '';
    $('aeWsTipo').value = emisionCfg.tipoComprobante || '190';
    $('aeWsOperacion').value = emisionCfg.codOperacion || '';
    $('aeWsCarEmisor').value = emisionCfg.codCaracterEmisor || '101';
    $('aeWsCarReceptor').value = emisionCfg.codCaracterReceptor || '103';
    $('aeTrib926').value = emisionCfg.tributos?.RET_IVA_926 ?? '';
    $('aeTrib925').value = emisionCfg.tributos?.PERC_IVA_925 ?? '';
    $('aeWsMotivo').value = emisionCfg.codMotivo || '';
    $('aeWsTipoLiq').value = emisionCfg.tipoLiquidacion || '2';
    const inicio = String(emisionCfg.fechaInicioActividades || '');
    $('aeWsInicio').value = /^\d{8}$/.test(inicio) ? `${inicio.slice(0, 4)}-${inicio.slice(4, 6)}-${inicio.slice(6)}` : '';
    $('aeWsCategorias').innerHTML = PORCINE_CATEGORIES.map(cat => `<label style="display:flex;gap:6px;align-items:center">${esc(cat)} <input data-wslsp-cat="${esc(cat)}" inputmode="numeric" style="width:80px" value="${esc(emisionCfg.categorias?.[cat] ?? '')}"></label>`).join('');
  } catch (err) {
    status.textContent = `No se pudo leer la configuración ARCA: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Actualizaciones normativas: el servidor local lee el feed de reglamentaciones y vigila las
// páginas oficiales de ARCA/SENASA. Los cambios de valores llegan como propuestas que hay que
// aprobar; los cambios de páginas, como avisos para revisar.
// ---------------------------------------------------------------------------------------------
let normativaCache = null;

async function loadNormativa() {
  if (!$('normativaEstado')) return null;
  if (!(await fiscalApiAvailable())) {
    $('normativaEstado').textContent = 'Las actualizaciones normativas automáticas funcionan en la aplicación de escritorio (servidor local).';
    $('normativaConfigForm').querySelectorAll('input,button').forEach(el => { el.disabled = true; });
    $('normativaPropuestasTable').innerHTML = '';
    $('normativaFuentesTable').innerHTML = '';
    return null;
  }
  const data = await fiscalApi('GET', '/normativa/estado');
  normativaCache = data;
  if (document.activeElement !== $('normativaFeedUrl')) $('normativaFeedUrl').value = data.feed_url || '';
  const ultima = data.ultima_verificacion;
  $('normativaEstado').textContent = `${ultima ? `Última verificación: ${new Date(ultima.fecha).toLocaleString('es-AR')}${ultima.feed?.error ? ` · feed con error: ${ultima.feed.error}` : ultima.feed?.activo ? ` · feed ${ultima.feed.version_feed ? `del ${new Date(ultima.feed.version_feed).toLocaleDateString('es-AR')}` : 'leído'}` : ' · feed sin configurar'}` : 'Todavía no se verificó.'} Se verifica sola cada 24 h. ${data.propuestas_pendientes} propuesta(s) pendiente(s), ${data.cambios_sin_revisar} página(s) oficial(es) con cambios sin revisar.`;
  $('normativaPropuestasTable').innerHTML = data.propuestas.length
    ? data.propuestas.map(p => `<tr><td>${esc(p.etiqueta)}<br><small>${esc(p.fuente_normativa || '')}</small></td><td>${esc(p.condicion)}</td><td>${esc(p.valor_anterior)} % → <b>${esc(p.valor_nuevo)} %</b></td><td>${esc(fmtDate(p.vigencia_desde))}${p.vigencia_hasta ? ` a ${esc(fmtDate(p.vigencia_hasta))}` : ''}</td><td><a href="${esc(p.fuente_url)}" target="_blank" rel="noopener noreferrer">Ver fuente</a></td><td>${esc(p.estado === 'PROPUESTA' ? 'Pendiente de aprobación' : p.estado === 'APROBADA' ? `Aprobada ${fmtDate(String(p.resuelto_el).slice(0, 10))}` : `Rechazada: ${p.motivo_rechazo || ''}`)}</td><td>${p.estado === 'PROPUESTA' ? `<button class="btn" type="button" onclick="resolveNormativa('${esc(p.id)}',true)">Aprobar</button> <button class="btn danger" type="button" onclick="resolveNormativa('${esc(p.id)}',false)">Rechazar</button>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="7">Sin cambios de valores propuestos.</td></tr>';
  $('normativaFuentesTable').innerHTML = data.fuentes.map(f => `<tr><td><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.nombre)}</a><br><small>${esc(f.nota || '')}</small></td><td>${f.verificado_el ? esc(new Date(f.verificado_el).toLocaleString('es-AR')) : 'Sin verificar'}</td><td style="font-weight:600;color:${f.cambio_detectado ? 'var(--red)' : f.error ? 'var(--orange, #f59e0b)' : 'var(--green)'}">${f.cambio_detectado ? 'CAMBIÓ: revisar' : f.error ? `Sin respuesta (${esc(f.error)})` : f.verificado_el ? 'Sin cambios' : '-'}</td><td>${f.cambio_detectado && f.id ? `<button class="btn secondary" type="button" onclick="markNormativaReviewed('${esc(f.id)}')">Marcar revisada</button>` : ''}</td></tr>`).join('');
  return data;
}

async function resolveNormativa(id, approve) {
  try {
    if (approve) {
      if (!confirm('Al aprobar, el nuevo valor se usa en las liquidaciones desde su vigencia. La regla anterior se conserva. ¿Aprobar?')) return;
      await fiscalApi('POST', `/normativa/propuestas/${encodeURIComponent(id)}/aprobar`, { usuario: activeDashboardRole() });
    } else {
      const motivo = prompt('Motivo del rechazo:');
      if (!motivo) return;
      await fiscalApi('POST', `/normativa/propuestas/${encodeURIComponent(id)}/rechazar`, { motivo, usuario: activeDashboardRole() });
    }
  } catch (err) {
    alert(err.message);
  }
  await loadNormativa();
  await fiscalApiAvailable(true);
}

async function markNormativaReviewed(id) {
  await fiscalApi('POST', `/normativa/fuentes/${encodeURIComponent(id)}/revisado`);
  await loadNormativa();
}

// Trae de ARCA (WSLSP) los catálogos oficiales y completa los códigos que estén vacíos con las
// sugerencias por descripción; el usuario revisa y guarda.
async function loadWslspCatalogs() {
  const box = $('aeCatalogosEstado');
  box.textContent = 'Consultando catálogos de ARCA...';
  const { catalogos, errores, sugerencias } = await fiscalApi('POST', '/arca/wslsp/catalogos');
  const fill = (id, rows) => { if ($(id)) $(id).innerHTML = (rows || []).map(row => `<option value="${esc(row.codigo)}">${esc(`${row.codigo} · ${row.descripcion}`)}</option>`).join(''); };
  fill('aeOperacionesList', catalogos.operaciones);
  fill('aeMotivosList', catalogos.motivos);
  fill('aeTributosList', catalogos.tributos);
  const setIfEmpty = (el, value) => { if (el && !String(el.value || '').trim() && value) el.value = value; };
  setIfEmpty($('aeWsOperacion'), sugerencias.operacionVentaDirecta);
  setIfEmpty($('aeWsMotivo'), sugerencias.motivoFaena);
  setIfEmpty($('aeTrib926'), sugerencias.tributos?.RET_IVA_926);
  setIfEmpty($('aeTrib925'), sugerencias.tributos?.PERC_IVA_925);
  document.querySelectorAll('[data-wslsp-cat]').forEach(input => setIfEmpty(input, sugerencias.categorias?.[input.dataset.wslspCat]));
  const mapped = Object.keys(sugerencias.categorias || {}).length;
  const fallas = Object.entries(errores || {}).map(([name, msg]) => `${name}: ${msg}`);
  box.textContent = `Catálogos recibidos: ${Object.entries(catalogos).map(([name, rows]) => `${name} (${rows.length})`).join(', ') || 'ninguno'}. Categorías porcinas reconocidas: ${mapped} de ${PORCINE_CATEGORIES.length}. Revisá los códigos completados y guardá.${fallas.length ? ` Sin respuesta: ${fallas.join(' · ')}` : ''}`;
}

// Clase del comprobante según la condición frente al IVA del emisor y del receptor.
function invoiceClassError(record) {
  const clase = String(record.tipo || '').slice(-1);
  const emisor = loadArcaFiscal().iva;
  if (['A', 'B'].includes(clase) && emisor !== 'Responsable Inscripto') return `Con condición "${emisor}" se emiten comprobantes clase C, no ${clase}.`;
  if (clase === 'C' && emisor === 'Responsable Inscripto') return 'Un Responsable Inscripto emite comprobantes clase A o B, no C.';
  if (clase === 'A' && !['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO'].includes(record.condicionReceptor)) return 'La clase A es para receptores Responsables Inscriptos o Monotributistas.';
  if (clase === 'B' && record.condicionReceptor === 'RESPONSABLE_INSCRIPTO') return 'A un Responsable Inscripto se le emite clase A, no B.';
  return '';
}

async function updateInvoiceFormForType() {
  const tipo = $('aiTipo')?.value || '';
  const clase = tipo.slice(-1);
  const nota = /^Nota de/.test(tipo);
  if ($('aiAsociadoWrap')) $('aiAsociadoWrap').hidden = !nota;
  if ($('aiAsociado')) {
    $('aiAsociado').required = nota;
    const invoices = (await all('arcaInvoices')).filter(r => r.numero && String(r.tipo).slice(-1) === clase && String(r.tipo).startsWith('Factura') && r.estadoFiscal !== 'ANULADA');
    $('aiAsociado').innerHTML = '<option value="">Seleccionar</option>' + invoices.map(r => `<option value="${Number(r.id)}">${esc(r.tipo)} ${esc(String(r.ptoVta).padStart(5, '0'))}-${esc(String(r.numero).padStart(8, '0'))} · ${esc(fmtDate(r.fecha))} · ${esc(money(r.total))}</option>`).join('');
  }
  if ($('aiIva')) {
    $('aiIva').readOnly = clase === 'C';
    if (clase === 'C') { $('aiIva').value = '0'; if (typeof calcInvoiceTotal === 'function') calcInvoiceTotal(); }
  }
  if ($('aiCondReceptor') && clase === 'B' && $('aiCondReceptor').value === 'RESPONSABLE_INSCRIPTO') $('aiCondReceptor').value = 'CONSUMIDOR_FINAL';
}

async function loadCaea() {
  const table = $('caeaTable');
  if (!table) return;
  if (!(await fiscalApiAvailable())) {
    table.innerHTML = '<tr><td colspan="6">La contingencia CAEA está disponible en la aplicación de escritorio.</td></tr>';
    $('caeaForm').querySelectorAll('input,select,button').forEach(el => { el.disabled = true; });
    return;
  }
  if ($('caeaPtoVta') && !$('caeaPtoVta').value) $('caeaPtoVta').value = loadArcaFiscal().ptoVta || '';
  try {
    const rows = await fiscalApi('GET', `/arca/caea?puntoVenta=${encodeURIComponent($('caeaPtoVta').value || '')}`);
    table.innerHTML = rows.filter(r => r.vigente || r.pendientes).map(r => `<tr><td>${esc(r.tipo)}</td><td>${esc(r.vigente?.caea || '-')}</td><td>${r.vigente ? `${esc(fmtDate(isoFromCompact(r.vigente.fechaVigenciaDesde)))} a ${esc(fmtDate(isoFromCompact(r.vigente.fechaVigenciaHasta)))}` : '-'}</td><td>${esc(r.vigente ? fmtDate(isoFromCompact(r.vigente.fechaTopeInforme)) : '-')}</td><td>${r.pendientes}</td><td>${r.caeasPendientes.map(caea => `<button class="btn" type="button" onclick="informCaea('${esc(r.tipo)}','${esc(caea)}')">Informar ${esc(caea)}</button>`).join(' ')}</td></tr>`).join('')
      || '<tr><td colspan="6">Sin CAEA solicitados para este punto de venta.</td></tr>';
  } catch (err) {
    table.innerHTML = `<tr><td colspan="6">${esc(err.message)}</td></tr>`;
  }
}

function isoFromCompact(value) {
  const raw = String(value || '');
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : raw;
}

async function informCaea(tipo, caea) {
  try {
    const result = await fiscalApi('POST', '/arca/caea/informar', { tipo, caea, puntoVenta: $('caeaPtoVta').value });
    alert(result.informados ? `ARCA aceptó ${result.informados} comprobante(s) emitidos en contingencia.` : (result.motivo || 'No había comprobantes para informar.'));
  } catch (err) {
    alert(`ARCA no aceptó el informe: ${err.message}`);
  }
  await loadCaea();
}

// ---------------------------------------------------------------------------------------------
// SIGSA (SENASA): no hay webservice público para terceros. Como en PampaGanadería, se abre el
// portal con los datos copiados al portapapeles y luego se registra lo que SENASA devolvió.
// ---------------------------------------------------------------------------------------------
function sigsaUrl() {
  return normalizeUrl(loadTransportLinks().senasa) || SIGSA_URL_DEFAULT;
}

async function openSigsaWith(lines) {
  const text = lines.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '').map(([label, value]) => `${label}: ${value}`).join('\n');
  let copied = false;
  try {
    if (navigator.clipboard && text) { await navigator.clipboard.writeText(text); copied = true; }
  } catch (err) {
    console.warn('No se pudo copiar al portapapeles.', err);
  }
  window.open(sigsaUrl(), '_blank', 'noopener,noreferrer');
  return { copied, text };
}

function validateRenspa(value, label, required = false) {
  const renspa = String(value || '').trim();
  if (!renspa) return required ? `${label} es obligatorio.` : '';
  return RENSPA_REGEX.test(renspa) ? '' : `${label} "${renspa}" no tiene el formato oficial (ej. 01.023.0.04532/01).`;
}

function stockByCategory(animals) {
  const signs = {};
  animals.forEach(row => {
    const qty = Number(row.cantidad) || 0;
    const plus = ['Alta / ingreso', 'Destete'].includes(row.tipo);
    const minus = ['Mortalidad', 'Venta', 'Baja'].includes(row.tipo);
    signs[row.categoria] = (signs[row.categoria] || 0) + (plus ? qty : minus ? -qty : 0);
    if (row.tipo === 'Destete' && row.categoria !== 'Lechones maternidad') signs['Lechones maternidad'] = (signs['Lechones maternidad'] || 0) - qty;
  });
  return signs;
}

async function openSigsaForDte() {
  const renspaError = validateRenspa($('dteRenspaOrigen').value, 'RENSPA origen', true);
  if (renspaError) { alert(renspaError); return; }
  const { copied } = await openSigsaWith([
    ['RENSPA origen', $('dteRenspaOrigen').value.trim()], ['Destino', $('dteDestino').value.trim()], ['RENSPA / planta destino', $('dteRenspaDestino').value.trim()],
    ['Motivo', $('dteTipo').value], ['Especie', 'Porcinos'], ['Categoría', $('dteCategoria').value], ['Cantidad', $('dteCantidad').value],
    ['Lote', $('dteLote').value.trim()], ['Patente', $('dtePatente').value.trim()], ['Fecha', fmtDate($('dteFecha').value)]
  ]);
  alert(`${copied ? 'Datos del movimiento copiados al portapapeles. ' : ''}Se abrió ARCA: ingresá con Clave Fiscal a SENASA - SIGSA, emití el DT-e y cargá acá el número que te asigne.`);
  $('dteNumero').focus();
}

async function openSigsaForStock() {
  const config = loadSenasaConfig();
  const renspaError = validateRenspa(config.renspa || loadArcaFiscal().renspa, 'RENSPA del establecimiento', true);
  if (renspaError) { alert(`${renspaError} Cargalo en Responsables y bioseguridad.`); return; }
  const signs = stockByCategory(await all('animals'));
  const { copied } = await openSigsaWith([['RENSPA', config.renspa || loadArcaFiscal().renspa], ['Fecha', fmtDate(dateNow())], ...CATS.map(cat => [cat, Math.max(0, signs[cat] || 0)])]);
  const done = confirm(`${copied ? 'Existencias por categoría copiadas al portapapeles. ' : ''}Se abrió ARCA para actualizar el stock en SENASA - SIGSA. ¿Confirmás que actualizaste las existencias hoy?`);
  if (!done) return;
  localStorage.setItem(SENASA_CONFIG_KEY, JSON.stringify({ ...config, existenciasFecha: dateNow() }));
  await refresh();
  alert('Actualización de existencias registrada.');
}

// ---------------------------------------------------------------------------------------------
// Canje de granos
// ---------------------------------------------------------------------------------------------
function contractKey(row) {
  return String(row.syncKey || `local:${row.id}`);
}

function swapLedger(contract, movements) {
  const ledger = [{ fecha: contract.fecha, detalle: `Firma de contrato ${contract.numero || ''}`.trim(), debePesos: 0, haberPesos: 0, debeKg: contract.kgPactados, haberKg: 0 }];
  movements.filter(row => row.contratoRef === contractKey(contract)).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).forEach(row => {
    if (row.tipo === 'FACTURA') ledger.push({ fecha: row.fecha, detalle: `Factura insumos ${row.comprobante}`, debePesos: row.total, haberPesos: 0, debeKg: 0, haberKg: 0 });
    else if (row.tipo === 'ENTREGA') ledger.push({ fecha: row.fecha, detalle: `Entrega ${contract.grano} CPE ${row.comprobante} (${row.kg} kg a ${money(row.precio)}/kg)`, debePesos: 0, haberPesos: row.valor, debeKg: 0, haberKg: row.kg });
    else if (row.tipo === 'NOTA_CREDITO') ledger.push({ fecha: row.fecha, detalle: `Nota de crédito ${row.comprobante}`, debePesos: 0, haberPesos: row.total, debeKg: 0, haberKg: 0 });
    else ledger.push({ fecha: row.fecha, detalle: `Ajuste ${row.comprobante}`, debePesos: row.total, haberPesos: 0, debeKg: 0, haberKg: 0 });
  });
  let pesos = 0;
  let kg = 0;
  return ledger.map(line => {
    pesos += (Number(line.debePesos) || 0) - (Number(line.haberPesos) || 0);
    kg += (Number(line.debeKg) || 0) - (Number(line.haberKg) || 0);
    return { ...line, saldoPesos: pesos, saldoKg: kg };
  });
}

function swapStatus(contract, ledger) {
  const last = ledger[ledger.length - 1] || { saldoPesos: 0, saldoKg: 0 };
  if (last.saldoPesos <= 0.01 && last.saldoKg <= 0) return 'COMPENSADO';
  if (contract.vencimiento && dateNow() > contract.vencimiento) return 'VENCIDO';
  return 'ACTIVO';
}

function toggleSwapFields() {
  const tipo = $('cmTipo')?.value;
  document.querySelectorAll('#swapMovementForm [data-cm]').forEach(el => { el.hidden = !el.dataset.cm.split(' ').includes(tipo); });
}

async function renderSwap(contracts, movements) {
  const activos = contracts.map(c => ({ c, ledger: swapLedger(c, movements) })).map(item => ({ ...item, estado: swapStatus(item.c, item.ledger) }));
  const open = activos.filter(item => item.estado !== 'COMPENSADO');
  $('cjActivos').textContent = String(open.length);
  $('cjSaldoPesos').textContent = money(open.reduce((sum, item) => sum + Math.max(0, item.ledger.at(-1).saldoPesos), 0));
  $('cjSaldoKg').textContent = `${open.reduce((sum, item) => sum + Math.max(0, item.ledger.at(-1).saldoKg), 0).toLocaleString('es-AR')} kg`;
  const options = activos.map(item => `<option value="${esc(contractKey(item.c))}">${esc(item.c.proveedor)} · ${esc(item.c.grano)} · ${esc(item.c.numero || 's/n')} · ${esc(item.estado)}</option>`).join('');
  const selMov = $('cmContrato').value;
  $('cmContrato').innerHTML = '<option value="">Seleccionar</option>' + activos.filter(item => item.estado !== 'COMPENSADO').map(item => `<option value="${esc(contractKey(item.c))}">${esc(item.c.proveedor)} · ${esc(item.c.grano)} · ${esc(item.c.numero || 's/n')}</option>`).join('');
  if ([...$('cmContrato').options].some(o => o.value === selMov)) $('cmContrato').value = selMov;
  const selView = $('ccContratoSel').value;
  $('ccContratoSel').innerHTML = options || '<option value="">Sin contratos</option>';
  if ([...$('ccContratoSel').options].some(o => o.value === selView)) $('ccContratoSel').value = selView;
  const current = activos.find(item => contractKey(item.c) === $('ccContratoSel').value);
  if (!current) { $('ccResumen').innerHTML = ''; $('ccTable').innerHTML = '<tr><td colspan="8">Sin contratos de canje.</td></tr>'; return; }
  const last = current.ledger.at(-1);
  $('ccResumen').innerHTML = `
    <div class="card kpi"><div class="label">A pagar</div><div class="value">${esc(money(Math.max(0, last.saldoPesos)))}</div></div>
    <div class="card kpi"><div class="label">Pendiente de entrega</div><div class="value">${esc(Math.max(0, last.saldoKg).toLocaleString('es-AR'))} kg</div></div>
    <div class="card kpi"><div class="label">Pactado</div><div class="value">${esc(Number(current.c.toneladas).toLocaleString('es-AR'))} t</div><div class="kpi-note">${esc(current.c.precioRef || '')}</div></div>
    <div class="card kpi ${current.estado === 'COMPENSADO' ? 'kpi-renspa-ok' : current.estado === 'VENCIDO' ? 'kpi-renspa-danger' : ''}"><div class="label">Estado</div><div class="value">${esc(current.estado)}</div></div>`;
  $('ccTable').innerHTML = current.ledger.map(line => `<tr><td>${esc(fmtDate(line.fecha))}</td><td>${esc(line.detalle)}</td><td>${money(line.debePesos)}</td><td>${money(line.haberPesos)}</td><td>${money(line.saldoPesos)}${line.saldoPesos > 0.01 ? ' (D)' : ''}</td><td>${Number(line.debeKg || 0).toLocaleString('es-AR')}</td><td>${Number(line.haberKg || 0).toLocaleString('es-AR')}</td><td>${Number(line.saldoKg || 0).toLocaleString('es-AR')}${line.saldoKg > 0 ? ' (D)' : ''}</td></tr>`).join('');
}

// ---------------------------------------------------------------------------------------------
// Lotes, mortalidad y alertas
// ---------------------------------------------------------------------------------------------
function loadMortalityRules() {
  const defaults = Object.fromEntries(MORTALITY_PHASES.map(phase => [phase, { diaria: 0.5, acumulada: 3 }]));
  try {
    const saved = JSON.parse(localStorage.getItem(MORTALITY_RULES_KEY) || '{}') || {};
    return Object.fromEntries(MORTALITY_PHASES.map(phase => [phase, { ...defaults[phase], ...(saved[phase] || {}) }]));
  } catch (err) {
    return defaults;
  }
}

function lotKey(row) {
  return ['Mortalidad', 'Venta', 'Baja'].includes(row.tipo) ? (row.origen || row.destino) : row.destino;
}

function buildLots(animals, today = dateNow()) {
  const lots = {};
  animals.forEach(row => {
    const key = String(lotKey(row) || '').trim();
    if (!key) return;
    const id = key.toUpperCase();
    const lot = lots[id] || (lots[id] = { lote: key, iniciales: 0, muertes: 0, muertesHoy: 0, salidas: 0, categoria: row.categoria, fecha: row.fecha });
    const qty = Number(row.cantidad) || 0;
    if (['Alta / ingreso', 'Destete', 'Traslado'].includes(row.tipo) && sameLot(row.destino, key)) { lot.iniciales += qty; lot.categoria = row.categoria; }
    if (row.tipo === 'Mortalidad') { lot.muertes += qty; if (row.fecha === today) lot.muertesHoy += qty; }
    if (['Venta', 'Baja'].includes(row.tipo)) lot.salidas += qty;
  });
  const rules = loadMortalityRules();
  return Object.values(lots).filter(lot => lot.iniciales > 0).map(lot => {
    const fase = PHASE_BY_CATEGORY[lot.categoria] || 'DESARROLLO';
    const rule = rules[fase];
    const pctDiario = lot.muertesHoy / lot.iniciales * 100;
    const pctAcumulado = lot.muertes / lot.iniciales * 100;
    const excedeDiario = pctDiario > rule.diaria;
    const excedeAcumulado = pctAcumulado > rule.acumulada;
    return { ...lot, fase, rule, vivas: lot.iniciales - lot.muertes - lot.salidas, pctDiario, pctAcumulado, excedeDiario, excedeAcumulado, alerta: excedeDiario || excedeAcumulado };
  }).sort((a, b) => Number(b.alerta) - Number(a.alerta) || a.lote.localeCompare(b.lote));
}

async function evaluateMortalityAlert(lote) {
  const lot = buildLots(await all('animals')).find(item => sameLot(item.lote, lote));
  if (!lot || !lot.alerta) return;
  const detalle = `${lot.excedeDiario ? `mortalidad diaria ${lot.pctDiario.toFixed(2)}% (máx. ${lot.rule.diaria}%)` : ''}${lot.excedeDiario && lot.excedeAcumulado ? ' y ' : ''}${lot.excedeAcumulado ? `acumulada ${lot.pctAcumulado.toFixed(2)}% (máx. ${lot.rule.acumulada}%)` : ''}`;
  const message = `El lote ${lot.lote} superó el umbral en fase ${PHASE_LABEL[lot.fase]}: ${detalle}. Cabezas vivas: ${lot.vivas}. Posible brote sanitario: avisá al veterinario y evaluá notificar a SENASA.`;
  notifyBrowser('🚨 ¡Alerta de mortalidad excedida!', message);
  alert(`🚨 ¡Alerta de mortalidad excedida!\n\n${message}`);
}

function stockAutonomy(inventory, feeding, today = dateNow(), health = [], treatments = []) {
  const from = isoAddDays(today, -14);
  const items = {};
  Object.entries(stockStatus(inventory, feeding, health, treatments)).forEach(([key, x]) => { items[key] = { item: x.item, unidad: x.unidad, stock: x.stock, consumo: 0 }; });
  inventory.forEach(row => {
    const item = items[itemKey(row.item)];
    if (item && row.tipo === 'Consumo' && row.fecha >= from) item.consumo += Number(row.cantidad) || 0;
  });
  feeding.filter(row => row.fecha >= from).forEach(row => {
    const item = items[String(row.insumo || '').trim().toUpperCase()];
    if (item) item.consumo += Number(row.kg) || 0;
  });
  return Object.values(items).filter(item => item.consumo > 0).map(item => ({ ...item, diario: item.consumo / 14, dias: item.stock / (item.consumo / 14) }));
}

async function renderDashboardAlerts(data) {
  const box = $('dashboardAlerts');
  if (!box) return;
  const alerts = [];
  data.lots.filter(lot => lot.alerta).forEach(lot => alerts.push({ danger: true, title: `Mortalidad lote ${lot.lote}`, text: `${PHASE_LABEL[lot.fase]}: diaria ${lot.pctDiario.toFixed(2)}% / acumulada ${lot.pctAcumulado.toFixed(2)}% (máx. ${lot.rule.diaria}% / ${lot.rule.acumulada}%)`, when: 'CRÍTICA' }));
  data.notices.filter(row => !row.notificado).forEach(row => alerts.push({ danger: true, title: IMMEDIATE_NOTIFICATIONS[row.evento] || row.evento, text: `Lote ${row.lote || '-'} · detectado ${new Date(row.deteccion).toLocaleString('es-AR')}`, when: noticeStatus(row).estado.toUpperCase() }));
  if (data.sanitary.block) alerts.push({ danger: true, title: 'Traslados bloqueados (Aujeszky)', text: data.sanitary.block, when: 'BLOQUEO' });
  data.sanitary.warnings.forEach(text => alerts.push({ danger: false, title: 'Plan sanitario SENASA', text, when: 'PENDIENTE' }));
  if (data.normativa?.propuestas_pendientes) alerts.push({ danger: true, title: 'Cambios normativos para aprobar', text: `${data.normativa.propuestas_pendientes} cambio(s) de alícuotas propuestos por el feed de reglamentaciones (ARCA > Actualizaciones normativas).`, when: 'APROBAR' });
  if (data.normativa?.cambios_sin_revisar) alerts.push({ danger: false, title: 'Páginas oficiales actualizadas', text: `${data.normativa.cambios_sin_revisar} página(s) de ARCA/SENASA cambiaron desde la última revisión.`, when: 'REVISAR' });
  if (data.existencias.pendientes) alerts.push({ danger: false, title: 'Existencias ante SENASA', text: data.existencias.texto, when: 'ACTUALIZAR' });
  const carencias = data.treatments.filter(row => row.fechaLiberacion > dateNow());
  carencias.forEach(row => alerts.push({ danger: false, title: `Lote ${row.lote} en carencia`, text: `${row.medicamento?.principioActivo || ''} · no apto para faena hasta ${fmtDate(row.fechaLiberacion)}`, when: `FALTAN ${daysUntil(row.fechaLiberacion)} D` }));
  data.autonomy.filter(item => item.dias < 7).forEach(item => alerts.push({ danger: item.dias < 2, title: `Stock de ${item.item}`, text: `${Math.max(0, item.stock).toLocaleString('es-AR')} ${item.unidad || ''} · consumo ${item.diario.toFixed(1)}/día`, when: item.dias <= 0 ? 'SIN STOCK' : `${item.dias.toFixed(1)} DÍAS` }));
  // Residuos y efluentes (Premium): solo si la versión y el rol tienen el módulo.
  if (typeof residuosDashboardAlerts === 'function') alerts.push(...await residuosDashboardAlerts().catch(() => []));
  box.innerHTML = alerts.length
    ? alerts.sort((a, b) => Number(b.danger) - Number(a.danger)).slice(0, 12).map(a => `<div class="dashboard-renspa-item ${a.danger ? 'danger' : 'caution'}"><div class="dashboard-renspa-lot">${esc(a.title)}</div><div class="dashboard-renspa-campo">${esc(a.text)}</div><div class="dashboard-renspa-when">${esc(a.when)}</div></div>`).join('')
    : '<div class="dashboard-renspa-item"><div class="dashboard-renspa-campo">Sin alertas.</div></div>';
}

// ---------------------------------------------------------------------------------------------
// Render general
// ---------------------------------------------------------------------------------------------
async function refreshModulos() {
  const [animals, vademecum, treatments, controls, dtes, notices, contracts, movements, inventory, feeding] = await Promise.all(
    ['animals', 'vademecum', 'treatments', 'sanitaryControls', 'dteRegistry', 'sanitaryNotices', 'swapContracts', 'swapMovements', 'inventory', 'feeding'].map(all)
  );
  const today = dateNow();

  // Lotes conocidos (datalists)
  const lotNames = [...new Set([...animals.flatMap(r => [r.origen, r.destino]), ...treatments.map(r => r.lote), ...dtes.map(r => r.lote)].map(v => String(v || '').trim()).filter(Boolean))].sort();
  if ($('hcLotesList')) $('hcLotesList').innerHTML = lotNames.map(name => `<option value="${esc(name)}">`).join('');
  if ($('dteList')) $('dteList').innerHTML = dtes.filter(r => r.estado !== 'Anulado').map(r => `<option value="${esc(r.numero)}">${esc(`${r.categoria} · ${r.cantidad} cab. · ${r.destino}`)}</option>`).join('');
  if ($('cmInsumosList')) $('cmInsumosList').innerHTML = [...new Set(inventory.map(r => String(r.item || '').trim()).filter(Boolean))].map(name => `<option value="${esc(name)}">`).join('');

  // Historial clínico
  const medSelect = $('hcMedicamento');
  if (medSelect) {
    const selected = medSelect.value;
    medSelect.innerHTML = '<option value="">Seleccionar</option>' + vademecum.map(m => `<option value="${esc(m.registro)}" data-carencia="${Number(m.diasCarencia) || 0}">${esc(m.nombre)} (${esc(m.principioActivo)}) · ${Number(m.diasCarencia) || 0} días</option>`).join('');
    if ([...medSelect.options].some(o => o.value === selected)) medSelect.value = selected;
  }
  const senasa = loadSenasaConfig();
  const reproductores = countReproductores(animals);
  const sanitary = evaluateSanitaryStatus({ config: senasa, controls, reproductores, fecha: today });
  const movimientosPosteriores = senasa.existenciasFecha ? animals.filter(row => String(row.fecha) > senasa.existenciasFecha).length : animals.length;
  const existencias = {
    pendientes: movimientosPosteriores > 0,
    texto: senasa.existenciasFecha
      ? `${movimientosPosteriores} movimiento(s) de animales posteriores a la última actualización de existencias (${fmtDate(senasa.existenciasFecha)}).`
      : 'No hay registrada una actualización de existencias ante SENASA.'
  };
  if ($('hcVeterinario') && !$('hcVeterinario').value) $('hcVeterinario').value = senasa.veterinario || '';
  if ($('hcMatricula') && !$('hcMatricula').value) $('hcMatricula').value = senasa.matricula || '';
  $('vademecumTable').innerHTML = vademecum.length
    ? vademecum.map(m => `<tr><td>${esc(m.nombre)}</td><td>${esc(m.principioActivo)}</td><td>${esc(m.laboratorio)}</td><td>${esc(m.registro)}</td><td>${Number(m.diasCarencia) || 0}</td><td>${esc(m.unidad)}</td></tr>`).join('')
    : '<tr><td colspan="6">Sin medicamentos cargados.</td></tr>';
  const sortedTreatments = [...treatments].sort((a, b) => String(b.fechaInicio).localeCompare(String(a.fechaInicio)));
  $('treatmentsTable').innerHTML = sortedTreatments.length
    ? sortedTreatments.map(t => {
      const pending = t.fechaLiberacion > today;
      return `<tr><td>${esc(fmtDate(t.fechaInicio))}</td><td>${esc(t.lote)}</td><td>${esc(t.diagnostico)}</td><td>${esc(t.medicamento?.nombre || '')} (${esc(t.medicamento?.principioActivo || '')})</td><td>${esc(fmtDate(t.fechaFin))}</td><td>${esc(fmtDate(t.fechaLiberacion))}</td><td>${esc(t.receta || '-')}</td><td style="color:${pending ? 'var(--red)' : 'var(--green)'};font-weight:600">${pending ? `EN CARENCIA · faltan ${daysUntil(t.fechaLiberacion)} d` : 'LIBERADO'}</td></tr>`;
    }).join('')
    : '<tr><td colspan="8">Sin tratamientos registrados.</td></tr>';
  const inWithdrawal = treatments.filter(t => t.fechaLiberacion > today);
  $('hcLotesCarencia').textContent = String(new Set(inWithdrawal.map(t => t.lote.toUpperCase())).size);
  $('hcTratamientosTotal').textContent = String(treatments.length);
  $('hcVademecumTotal').textContent = String(vademecum.length);
  const nextRelease = inWithdrawal.map(t => t.fechaLiberacion).sort()[0];
  $('hcProximaLiberacion').textContent = nextRelease ? fmtDate(nextRelease) : '-';

  // SENASA
  if ($('snVet')) {
    ['veterinario:snVet', 'matricula:snMatricula', 'acreditacion:snAcreditacion', 'cerco:snCerco', 'auditoria:snAuditoria', 'renspa:snRenspa', 'tipoEstablecimiento:snTipoEstab', 'clasificacionAujeszky:snClasificacion', 'planSaneamientoFecha:snPlanSaneamiento', 'planSaneamientoActualizacion:snPlanActualizacion', 'existenciasFecha:snExistencias'].forEach(pair => {
      const [key, id] = pair.split(':');
      if (document.activeElement !== $(id)) $(id).value = senasa[key] || (key === 'renspa' ? loadArcaFiscal().renspa || '' : '');
    });
    $('snVetEstado').textContent = senasa.veterinario && senasa.acreditacion ? 'Sí' : 'Falta';
    const statuses = Object.keys(SANITARY_PLAN).map(code => ({ code, status: controlStatus(lastControl(controls, code), code) }));
    $('snPlanEstado').textContent = sanitary.block ? 'Traslados bloqueados' : sanitary.warnings.length ? `${sanitary.warnings.length} pendiente(s)` : 'Al día';
    $('snPlanDetalle').textContent = sanitary.block || sanitary.warnings.join(' · ');
    $('snReproductores').textContent = String(reproductores);
    $('snReproductoresNota').textContent = aujeszkyMandatory(senasa, reproductores) ? 'serología cuatrimestral obligatoria' : 'serología cuatrimestral: obligatoria en comerciales/genética con más de 100';
    $('snClasificacionKpi').textContent = AUJESZKY_CLASSIFICATION[senasa.clasificacionAujeszky] || 'Sin cargar';
    $('snExistenciasNota').textContent = existencias.texto;
    $('snExistenciasKpiValor').textContent = existencias.pendientes ? 'Actualizar' : 'Al día';
    $('snPlanChips').innerHTML = statuses.map(item => `<span class="renspa-chip ${item.status.estado === 'VIGENTE' ? 'ok' : ['POSITIVO', 'VENCIDO'].includes(item.status.estado) ? 'danger' : 'warn'}">${esc(SANITARY_PLAN[item.code].label)} (${esc(SANITARY_PLAN[item.code].norma)}): ${esc(item.status.texto)}</span>`).join(' ');
    const sortedControls = [...controls].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    $('sanitaryControlsTable').innerHTML = sortedControls.length
      ? sortedControls.map(c => `<tr><td>${esc(fmtDate(c.fecha))}</td><td>${esc(SANITARY_PLAN[c.enfermedad]?.label || c.enfermedad)}</td><td>${esc(c.laboratorio)}</td><td>${esc(c.protocolo)}</td><td>${esc(c.lote || '-')}</td><td>${esc(c.resultado)}</td><td>${esc(c.veterinario || '-')}</td><td>${esc(SANITARY_PLAN[c.enfermedad]?.expireMonths ? fmtDate(addMonthsISO(c.fecha, SANITARY_PLAN[c.enfermedad].expireMonths)) : c.enfermedad === 'TRIQUINOSIS' ? 'Por faena' : '-')}</td></tr>`).join('')
      : '<tr><td colspan="8">Sin controles registrados.</td></tr>';
    $('snDteMes').textContent = String(dtes.filter(r => monthOf(r.fecha) === monthOf(today) && r.estado !== 'Anulado').length);
    const sortedDtes = [...dtes].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    $('dteTable').innerHTML = sortedDtes.length
      ? sortedDtes.map(d => `<tr><td>${esc(fmtDate(d.fecha))}</td><td>${esc(d.numero)}</td><td>${esc(d.tipo)}</td><td>${esc(d.destino)}</td><td>${esc(d.categoria)}</td><td>${Number(d.cantidad) || 0}</td><td>${esc(d.lote || '-')}</td><td>${esc(d.estado)}</td><td>${d.estado === 'Emitido' ? `<button class="btn secondary" type="button" onclick="closeDte(${Number(d.id)})">Cerrar</button> <button class="btn danger" type="button" onclick="voidDte(${Number(d.id)})">Anular</button>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="9">Sin DT-e registrados.</td></tr>';
    if ($('pcVeterinario') && !$('pcVeterinario').value && document.activeElement !== $('pcVeterinario')) $('pcVeterinario').value = senasa.veterinario || '';
    if ($('dteRenspaOrigen') && !$('dteRenspaOrigen').value && document.activeElement !== $('dteRenspaOrigen')) $('dteRenspaOrigen').value = senasa.renspa || loadArcaFiscal().renspa || '';
    const sortedNotices = [...notices].sort((a, b) => String(b.deteccion).localeCompare(String(a.deteccion)));
    $('snNotifPendientes').textContent = String(notices.filter(n => !n.notificado).length);
    $('noticesTable').innerHTML = sortedNotices.length
      ? sortedNotices.map(n => { const st = noticeStatus(n); return `<tr><td>${esc(new Date(n.deteccion).toLocaleString('es-AR'))}</td><td>${esc(IMMEDIATE_NOTIFICATIONS[n.evento] || n.evento)}</td><td>${esc(n.lote || '-')}</td><td>${Number(n.afectados) || 0}</td><td>${n.notificado ? esc(`${new Date(n.notificado).toLocaleString('es-AR')} ${n.acta ? `· Acta ${n.acta}` : ''}`) : '-'}</td><td style="color:${st.danger ? 'var(--red)' : 'var(--green)'};font-weight:600">${esc(st.estado)}</td><td>${n.notificado ? '' : `<button class="btn" type="button" onclick="markNoticeNotified(${Number(n.id)})">Marcar notificada</button>`}</td></tr>`; }).join('')
      : '<tr><td colspan="7">Sin eventos registrados.</td></tr>';
  }

  // Lotes y mortalidad
  const lots = buildLots(animals, today);
  if ($('lotsTable')) {
    $('lotsTable').innerHTML = lots.length
      ? lots.map(l => `<tr><td>${esc(l.lote)}</td><td>${esc(PHASE_LABEL[l.fase])}</td><td>${l.iniciales}</td><td>${l.vivas}</td><td>${l.muertesHoy}</td><td style="${l.excedeDiario ? 'color:var(--red);font-weight:700' : ''}">${l.pctDiario.toFixed(2)}%</td><td style="${l.excedeAcumulado ? 'color:var(--red);font-weight:700' : ''}">${l.pctAcumulado.toFixed(2)}%</td><td>${l.alerta ? '🚨 Alerta' : 'Normal'}</td></tr>`).join('')
      : '<tr><td colspan="8">Sin lotes: cargá altas o destetes con "Destino / lote".</td></tr>';
    const rules = loadMortalityRules();
    MORTALITY_PHASES.forEach(phase => {
      if (document.activeElement !== $(`mr${phase}_d`)) $(`mr${phase}_d`).value = rules[phase].diaria;
      if (document.activeElement !== $(`mr${phase}_a`)) $(`mr${phase}_a`).value = rules[phase].acumulada;
    });
  }

  await renderSwap(contracts, movements);
  await renderIva();
  let normativaResumen = normativaCache;
  if (await fiscalApiAvailable().catch(() => false)) normativaResumen = await fiscalApi('GET', '/normativa/estado').then(data => (normativaCache = data)).catch(() => normativaCache);
  await renderDashboardAlerts({ lots, notices, controls, treatments, sanitary, existencias, normativa: normativaResumen, autonomy: stockAutonomy(inventory, feeding, today, await all('health'), treatments) });
  if ($('arca')?.classList.contains('active')) { await loadArcaConnection(); await loadCaea(); await loadNormativa().catch(err => console.warn('Normativa no disponible.', err)); }
}

// ---------------------------------------------------------------------------------------------
// Formularios
// ---------------------------------------------------------------------------------------------
function onSubmit(id, handler) {
  const form = $(id);
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await handler(event);
    } catch (err) {
      console.error(`Error en ${id}.`, err);
      alert(`No se pudo guardar: ${err.message || err}`);
    }
  });
}

onSubmit('vademecumForm', async event => {
  const registro = $('vdRegistro').value.trim();
  if ((await all('vademecum')).some(m => String(m.registro).toUpperCase() === registro.toUpperCase())) { alert('Ya existe un medicamento con ese número de registro SENASA.'); return; }
  const medicine = { nombre: $('vdNombre').value.trim(), principioActivo: $('vdPrincipio').value.trim(), laboratorio: $('vdLaboratorio').value.trim(), registro, diasCarencia: Math.max(0, Math.round(+$('vdCarencia').value || 0)), unidad: $('vdUnidad').value };
  // Plan CREHA: una carencia menor al retiro estándar de ese principio activo se confirma contra el marbete.
  const ref = crehaRetiroReferencia(medicine.principioActivo);
  if (ref && medicine.diasCarencia < ref.min && !confirm(`Plan CREHA: el retiro estándar de ${ref.nombre} es de ${ref.min} a ${ref.max} días y cargaste ${medicine.diasCarencia}. ¿El marbete aprobado de este producto indica ${medicine.diasCarencia} días?`)) return;
  await add('vademecum', medicine);
  syncVademecumToServer(medicine).catch(err => console.warn('Vademécum no sincronizado con el servidor.', err));
  event.target.reset();
  await refresh();
  alert('Medicamento guardado.');
});

function calcTreatmentUse() {
  if (!$('hcUso') || document.activeElement === $('hcUso')) return;
  const uso = treatmentUse({ fechaInicio: $('hcInicio').value, fechaFin: $('hcFin').value || $('hcInicio').value, dosis: +$('hcDosis').value || 0, animales: +$('hcAnimales').value || 0 });
  $('hcUso').value = uso > 0 ? Math.round(uso * 100) / 100 : '';
}
['hcInicio', 'hcFin', 'hcDosis', 'hcAnimales'].forEach(id => $(id)?.addEventListener('input', calcTreatmentUse));
['hcInicio', 'hcFin'].forEach(id => $(id)?.addEventListener('change', calcTreatmentUse));

onSubmit('treatmentForm', async event => {
  const medicine = (await all('vademecum')).find(m => m.registro === $('hcMedicamento').value);
  if (!medicine) { alert('Seleccioná un medicamento del vademécum.'); return; }
  if ($('hcFin').value < $('hcInicio').value) { alert('La última dosis no puede ser anterior al inicio del tratamiento.'); return; }
  // Res. SENASA 80/2025: antimicrobianos de importancia crítica solo con Receta Digital Veterinaria.
  if (crehaRequiereRecetaDigital(medicine.principioActivo) && !$('hcReceta').value.trim()) { alert(`${medicine.principioActivo} requiere Receta Digital Veterinaria (Res. SENASA 80/2025), emitida en la plataforma de SENASA y vinculada al RENSPA de la granja. Cargá el número de receta.`); return; }
  const treatment = {
    fecha: $('hcInicio').value, lote: $('hcLote').value.trim(), categoria: $('hcCategoria').value, diagnostico: $('hcDiagnostico').value.trim(),
    fechaInicio: $('hcInicio').value, fechaFin: $('hcFin').value, dosis: +$('hcDosis').value || 0, unidad: medicine.unidad, animales: +$('hcAnimales').value || 0,
    veterinario: $('hcVeterinario').value.trim(), matricula: $('hcMatricula').value.trim(), receta: $('hcReceta').value.trim(), obs: $('hcObs').value,
    medicamento: { nombre: medicine.nombre, principioActivo: medicine.principioActivo, laboratorio: medicine.laboratorio, registro: medicine.registro, diasCarencia: medicine.diasCarencia, unidad: medicine.unidad },
    fechaLiberacion: liberationDate($('hcFin').value, medicine.diasCarencia),
    // Res. SENASA 445/2024: solo uso terapéutico (los promotores de crecimiento están prohibidos).
    finalidad: $('hcFinalidad') ? $('hcFinalidad').value : 'Tratamiento',
    recetaDigital: crehaRequiereRecetaDigital(medicine.principioActivo)
  };
  // Tetraciclinas: exclusión de 90 días para faena con destino Unión Europea / Unión Económica Euroasiática.
  if (crehaEsTetraciclina(medicine.principioActivo)) treatment.exclusionExportacion = liberationDate($('hcFin').value, Math.max(CREHA_EXCLUSION_EXPORTACION_DIAS, Number(medicine.diasCarencia) || 0));
  treatment.usoCantidad = Number($('hcUso').value) || treatmentUse(treatment);
  const treatmentId = await add('treatments', treatment);
  // El tratamiento también queda en Registros de sanidad (una sola vez): ese registro descuenta el
  // producto del stock y es el costo del período.
  await add('health', { fecha: treatment.fechaInicio, categoria: treatment.categoria || treatment.lote, tipo: 'Tratamiento', producto: medicine.nombre, cantidad: treatment.animales, usoCantidad: treatment.usoCantidad, costo: 0, responsable: treatment.veterinario, obs: `Historial clínico · lote ${treatment.lote} · ${treatment.diagnostico}`, treatmentId });
  syncTreatmentToServer(treatment).catch(err => console.warn('Tratamiento no sincronizado con el servidor.', err));
  event.target.reset();
  setDates();
  await refresh();
  alert(`Tratamiento registrado. Lote ${treatment.lote} apto para faena desde el ${fmtDate(treatment.fechaLiberacion)}.${treatment.exclusionExportacion ? ` Tetraciclina: no apto para exportación a la UE / Unión Económica Euroasiática hasta el ${fmtDate(treatment.exclusionExportacion)} (exclusión de ${CREHA_EXCLUSION_EXPORTACION_DIAS} días, Plan CREHA).` : ''}`);
});

onSubmit('aptitudForm', async () => {
  const treatment = await activeWithdrawal($('apLote').value, $('apFecha').value);
  const box = $('apResultado');
  const exclusion = $('apDestino')?.value === 'EXPORTACION_UE' ? await activeExportExclusion($('apLote').value, $('apFecha').value) : null;
  if (!treatment && exclusion) {
    box.style.color = 'var(--red)';
    box.textContent = `❌ No apto para exportación a la UE / Unión Económica Euroasiática: tratado con ${exclusion.medicamento?.principioActivo || 'tetraciclina'}, exclusión hasta el ${fmtDate(exclusion.exclusionExportacion)} (Plan CREHA). Para mercado interno se rige por la carencia normal.`;
  } else if (treatment) {
    box.style.color = 'var(--red)';
    box.textContent = `❌ No apto: ${treatment.medicamento?.principioActivo || ''} hasta el ${fmtDate(treatment.fechaLiberacion)} (faltan ${daysUntil(treatment.fechaLiberacion, $('apFecha').value)} día(s)).`;
  } else {
    box.style.color = 'var(--green)';
    box.textContent = '✅ Apto para faena: sin tratamientos con carencia pendiente.';
  }
});

onSubmit('senasaConfigForm', async () => {
  const renspaError = validateRenspa($('snRenspa').value, 'El RENSPA del establecimiento');
  if (renspaError) { alert(renspaError); return; }
  if ($('snPlanActualizacion').value && $('snPlanSaneamiento').value && $('snPlanActualizacion').value < $('snPlanSaneamiento').value) { alert('La actualización del Plan de Saneamiento no puede ser anterior a su presentación.'); return; }
  localStorage.setItem(SENASA_CONFIG_KEY, JSON.stringify({
    veterinario: $('snVet').value.trim(), matricula: $('snMatricula').value.trim(), acreditacion: $('snAcreditacion').value.trim(), cerco: $('snCerco').value,
    auditoria: $('snAuditoria').value, renspa: $('snRenspa').value.trim(), tipoEstablecimiento: $('snTipoEstab').value, clasificacionAujeszky: $('snClasificacion').value,
    planSaneamientoFecha: $('snPlanSaneamiento').value, planSaneamientoActualizacion: $('snPlanActualizacion').value, existenciasFecha: $('snExistencias').value
  }));
  await refresh();
  alert('Responsables y bioseguridad guardados.');
});

onSubmit('sanitaryControlForm', async event => {
  const config = loadSenasaConfig();
  // Los muestreos los realiza un veterinario acreditado por SENASA.
  if ($('pcEnfermedad').value !== 'TRIQUINOSIS' && (!config.acreditacion || !$('pcVeterinario').value.trim())) { alert('El muestreo debe hacerlo un veterinario acreditado por SENASA: cargá sus datos en Responsables y bioseguridad.'); return; }
  await add('sanitaryControls', { fecha: $('pcFecha').value, enfermedad: $('pcEnfermedad').value, laboratorio: $('pcLaboratorio').value.trim(), protocolo: $('pcProtocolo').value.trim(), lote: $('pcLote').value.trim(), muestras: +$('pcMuestras').value || 0, resultado: $('pcResultado').value, veterinario: $('pcVeterinario').value.trim(), acreditacion: config.acreditacion, obs: $('pcObs').value });
  const positivo = ['POSITIVO', 'NO_APTO'].includes($('pcResultado').value);
  const aujeszkyPositivo = positivo && $('pcEnfermedad').value === 'AUJESZKY';
  const fechaControl = $('pcFecha').value || dateNow();
  event.target.reset();
  setDates();
  await refresh();
  alert(aujeszkyPositivo
    ? `Aujeszky positivo: los movimientos quedan bloqueados hasta presentar el Plan de Saneamiento ante SENASA (plazo 30 días: hasta el ${fmtDate(isoAddDays(fechaControl, 30))}). Registrá la presentación en Responsables y bioseguridad.`
    : positivo ? 'Control registrado con resultado positivo. Consultá al veterinario acreditado.' : 'Control sanitario registrado.');
});

onSubmit('dteForm', async event => {
  const numero = $('dteNumero').value.trim();
  if (findDte(await all('dteRegistry'), numero)) { alert('Ese número de DT-e ya está registrado.'); return; }
  const tipo = $('dteTipo').value;
  const renspaError = validateRenspa($('dteRenspaOrigen').value, 'RENSPA origen', true)
    || (['Venta a otro establecimiento', 'Traslado entre granjas'].includes(tipo) ? validateRenspa($('dteRenspaDestino').value, 'RENSPA destino', true) : '');
  if (renspaError) { alert(renspaError); return; }
  if (tipo !== 'Ingreso por compra' && !(await confirmDespachoSanitario($('dteLote').value, $('dteFecha').value, tipo === 'Venta a faena'))) return;
  await add('dteRegistry', { fecha: $('dteFecha').value, numero, tipo, renspaOrigen: $('dteRenspaOrigen').value.trim(), destino: $('dteDestino').value.trim(), renspaDestino: $('dteRenspaDestino').value.trim(), categoria: $('dteCategoria').value, cantidad: +$('dteCantidad').value || 0, lote: $('dteLote').value.trim(), patente: $('dtePatente').value.trim(), estado: 'Emitido' });
  event.target.reset();
  setDates();
  $('dteRenspaOrigen').value = loadSenasaConfig().renspa || loadArcaFiscal().renspa || '';
  await refresh();
  alert('DT-e registrado.');
});

onSubmit('noticeForm', async event => {
  const notificado = $('niNotificado').value;
  await add('sanitaryNotices', { fecha: $('niDeteccion').value.slice(0, 10), evento: $('niEvento').value, deteccion: $('niDeteccion').value, lote: $('niLote').value.trim(), afectados: +$('niAfectados').value || 0, muertos: +$('niMuertos').value || 0, notificado, canal: $('niCanal').value, acta: $('niActa').value.trim(), obs: $('niObs').value });
  event.target.reset();
  await refresh();
  alert(notificado ? 'Evento registrado.' : 'Evento registrado. Debe notificarse a SENASA dentro de las 24 horas.');
});

onSubmit('mortalityRulesForm', async () => {
  const rules = Object.fromEntries(MORTALITY_PHASES.map(phase => [phase, { diaria: Math.max(0, +$(`mr${phase}_d`).value || 0), acumulada: Math.max(0, +$(`mr${phase}_a`).value || 0) }]));
  localStorage.setItem(MORTALITY_RULES_KEY, JSON.stringify(rules));
  await refresh();
  alert('Reglas de alerta guardadas.');
});

onSubmit('swapContractForm', async event => {
  const cuitError = validateCuitField($('cjCuit').value, 'CUIT del proveedor', false);
  if (cuitError) { alert(cuitError); return; }
  const toneladas = +$('cjToneladas').value || 0;
  await add('swapContracts', { fecha: $('cjFecha').value, proveedor: $('cjProveedor').value.trim(), cuit: $('cjCuit').value.replace(/\D/g, ''), numero: $('cjNumero').value.trim(), grano: $('cjGrano').value, toneladas, kgPactados: Math.round(toneladas * 1000 * 100) / 100, precioRef: $('cjPrecioRef').value.trim(), vencimiento: $('cjVencimiento').value });
  event.target.reset();
  setDates();
  await refresh();
  alert('Contrato de canje registrado.');
});

onSubmit('swapMovementForm', async event => {
  const contract = (await all('swapContracts')).find(c => contractKey(c) === $('cmContrato').value);
  if (!contract) { alert('Seleccioná el contrato.'); return; }
  const tipo = $('cmTipo').value;
  const base = { fecha: $('cmFecha').value, contratoRef: contractKey(contract), tipo, comprobante: $('cmComprobante').value.trim(), detalle: $('cmDetalle').value.trim() };
  if (tipo === 'ENTREGA') {
    const kg = +$('cmKg').value || 0;
    const precio = +$('cmPrecio').value || 0;
    if (kg <= 0 || precio <= 0) { alert('Ingresá kilos entregados y precio de pizarra.'); return; }
    await add('swapMovements', { ...base, kg, precio, valor: Math.round(kg * precio * 100) / 100 });
    const insumo = $('cmInsumo').value.trim();
    if (insumo) await add('inventory', { fecha: base.fecha, item: insumo, tipo: 'Consumo', cantidad: kg, unidad: 'kg', costo: 0, lote: `Canje ${contract.proveedor} CPE ${base.comprobante}` });
  } else {
    const monto = +$('cmMonto').value || 0;
    if (monto <= 0) { alert('Ingresá el importe.'); return; }
    const alicuota = tipo === 'FACTURA' ? +$('cmAlicuota').value || 0 : 0;
    const iva = Math.round(monto * alicuota) / 100;
    await add('swapMovements', { ...base, monto, alicuota, iva, total: Math.round((monto + iva) * 100) / 100 });
    // La factura de insumos es una compra: entra a costos con su IVA crédito fiscal.
    if (tipo === 'FACTURA') {
      const insumo = $('cmInsumoFactura').value.trim();
      const cantidad = +$('cmCantFactura').value || 0;
      if (!insumo || cantidad <= 0) { alert('Indicá el insumo recibido y su cantidad: entra al stock y es costo cuando se usa.'); return; }
      await addStockPurchase({ fecha: base.fecha, tipo: 'Alimentación', categoria: 'Otros', importe: monto, ivaAlicuota: alicuota, ivaCredito: iva, percIva: 0, cuitProveedor: contract.cuit, proveedor: contract.proveedor, comprobante: base.comprobante, obs: `Canje ${contract.grano} contrato ${contract.numero || ''}`.trim(), stockItem: insumo, cantidad, unidad: $('cmUnidadFactura').value });
    }
  }
  event.target.reset();
  setDates();
  $('cmContrato').value = base.contratoRef;
  $('ccContratoSel').value = base.contratoRef;
  toggleSwapFields();
  await refresh();
  alert('Movimiento de canje registrado.');
});

if ($('vCanal')) { $('vCanal').addEventListener('change', toggleSaleChannel); toggleSaleChannel(); }
if ($('cTipo')) { $('cTipo').addEventListener('change', toggleCostStockFields); toggleCostStockFields(); }
onSubmit('escalaForm', async () => {
  const n = id => Math.round(Number($(id).value) || 0);
  const cfg = { micro: n('esMicro'), pequena: n('esPeq'), mediana: n('esMed'), faenaPequeno: n('esFaenaPeq'), faenaMediano: n('esFaenaMed') };
  if (!(cfg.micro > 0 && cfg.micro < cfg.pequena && cfg.pequena < cfg.mediana)) return alert('Los rangos por madres deben ser crecientes: MICRO < PEQUEÑA < MEDIANA.');
  if (!(cfg.faenaPequeno > 0 && cfg.faenaPequeno <= cfg.faenaMediano)) return alert('El límite de PRODUCTOR_PEQUEÑO debe ser menor o igual al de PRODUCTOR_MEDIANO.');
  try { localStorage.setItem(ESCALA_KEY, JSON.stringify(cfg)); } catch { return alert('No se pudieron guardar los rangos en este equipo.'); }
  await renderProductionScale();
  alert('Rangos guardados.');
});
if ($('cIvaMes')) $('cIvaMes').addEventListener('change', async () => renderCostIvaSummary(await costData()));
['pc927Cabezas', 'pc927Valor'].forEach(id => $(id)?.addEventListener('input', calcPagoCuenta));
onSubmit('pagoCuentaForm', async () => {
  const cabezas = Math.round(Number($('pc927Cabezas').value) || 0);
  const valorCabeza = Number($('pc927Valor').value) || 0;
  if (cabezas <= 0 || valorCabeza <= 0) return alert('Indicá las cabezas y el valor por cabeza fijado por ARCA.');
  if ($('pc927Faena').value && $('pc927Faena').value < $('pc927Fecha').value) return alert('El pago a cuenta se ingresa antes de la faena: la fecha de faena no puede ser anterior al pago.');
  const vep = $('pc927Vep').value.trim();
  if ((await all('ivaPagosCuenta')).some(r => r.vep === vep)) return alert('Ese VEP / comprobante ya está registrado.');
  await add('ivaPagosCuenta', { fecha: $('pc927Fecha').value, fechaFaena: $('pc927Faena').value, cabezas, valorCabeza, total: calcPagoCuenta(), vep, tropa: $('pc927Tropa').value.trim(), codigoSire: '927' });
  ['pc927Cabezas', 'pc927Vep', 'pc927Tropa', 'pc927Faena', 'pc927Total'].forEach(id => { $(id).value = ''; });
  await renderIva();
});

onSubmit('normativaConfigForm', async () => {
  await fiscalApi('PUT', '/normativa/config', { feedUrl: $('normativaFeedUrl').value.trim() });
  await loadNormativa();
  alert('URL del feed guardada.');
});

onSubmit('caeaForm', async () => {
  const periodo = ($('caeaPeriodo').value || '').replace('-', '');
  const result = await fiscalApi('POST', '/arca/caea/solicitar', { tipo: $('caeaTipo').value, puntoVenta: $('caeaPtoVta').value, periodo: periodo || undefined, orden: $('caeaOrden').value || undefined });
  alert(`CAEA ${result.caea} vigente del ${fmtDate(isoFromCompact(result.fechaVigenciaDesde))} al ${fmtDate(isoFromCompact(result.fechaVigenciaHasta))}. Informar antes del ${fmtDate(isoFromCompact(result.fechaTopeInforme))}.`);
  await loadCaea();
});

onSubmit('arcaConnForm', async () => {
  const saved = await fiscalApi('PUT', '/arca/config', { cuit: $('acCuit').value, environment: $('acAmbiente').value, serviceName: $('acServicio').value.trim(), certificatePath: $('acCert').value.trim(), privateKeyPath: $('acKey').value.trim() });
  await fiscalApiAvailable(true);
  await loadArcaConnection();
  alert(`Conexión ARCA guardada (${saved.environment === 'production' ? 'producción' : 'homologación'}).`);
});

onSubmit('arcaEmisionForm', async () => {
  const categorias = Object.fromEntries([...document.querySelectorAll('[data-wslsp-cat]')].map(input => [input.dataset.wslspCat, input.value.trim()]).filter(([, value]) => value));
  await fiscalApi('PUT', '/arca/emision', { tributos: { RET_IVA_926: $('aeTrib926').value.trim(), PERC_IVA_925: $('aeTrib925').value.trim() }, puntoVenta: $('aeWsPtoVta').value, tipoComprobante: $('aeWsTipo').value, codOperacion: $('aeWsOperacion').value, codCaracterEmisor: $('aeWsCarEmisor').value, codCaracterReceptor: $('aeWsCarReceptor').value, codMotivo: $('aeWsMotivo').value, tipoLiquidacion: $('aeWsTipoLiq').value, fechaInicioActividades: $('aeWsInicio').value.replace(/-/g, ''), categorias });
  alert('Datos de emisión guardados.');
});

// Inicialización de controles
if ($('sTipo')) $('sTipo').addEventListener('change', () => {
  if ($('sTipo').value === 'Vacunación' && !$('sResp').value) $('sResp').value = loadSenasaConfig().veterinario || '';
});
if ($('aiTipo')) { $('aiTipo').addEventListener('change', () => updateInvoiceFormForType().catch(err => console.error(err))); }
if ($('btnNormativaVerificar')) $('btnNormativaVerificar').addEventListener('click', async () => {
  $('normativaEstado').textContent = 'Verificando fuentes oficiales y feed...';
  try {
    const result = await fiscalApi('POST', '/normativa/verificar');
    await loadNormativa();
    alert(`Verificación terminada. ${result.feed?.activo ? (result.feed.error ? `Feed: ${result.feed.error}.` : `Feed: ${result.feed.nuevas} propuesta(s) nueva(s).`) : 'Feed sin configurar.'} Fuentes oficiales con cambios: ${(result.fuentes || []).filter(f => f.cambio).length}.`);
  } catch (err) {
    alert(`No se pudo verificar: ${err.message}`);
  }
});
if ($('btnWslspCatalogos')) $('btnWslspCatalogos').addEventListener('click', () => loadWslspCatalogs().catch(err => alert(`No se pudieron traer los catálogos: ${err.message}`)));
if ($('btnCaeaActualizar')) $('btnCaeaActualizar').addEventListener('click', () => loadCaea());
if ($('btnSigsaDte')) $('btnSigsaDte').addEventListener('click', () => openSigsaForDte().catch(err => alert(err.message)));
if ($('btnSigsaExistencias')) $('btnSigsaExistencias').addEventListener('click', () => openSigsaForStock().catch(err => alert(err.message)));
if ($('niEvento')) $('niEvento').innerHTML = Object.entries(IMMEDIATE_NOTIFICATIONS).map(([code, label]) => `<option value="${esc(code)}">${esc(label)}</option>`).join('');
['hcMedicamento', 'hcFin'].forEach(id => { if ($(id)) $(id).addEventListener('change', updateLiberationPreview); });
if ($('cmTipo')) { $('cmTipo').addEventListener('change', toggleSwapFields); toggleSwapFields(); }
if ($('ccContratoSel')) $('ccContratoSel').addEventListener('change', () => refreshModulos().catch(err => console.error(err)));
if ($('ivaMes')) $('ivaMes').addEventListener('change', () => renderIva().catch(err => console.error(err)));
['cImporte', 'cIvaAlic'].forEach(id => { if ($(id)) $(id).addEventListener('input', calcCostIva); });
if ($('cIvaAlic')) $('cIvaAlic').addEventListener('change', calcCostIva);
if ($('btnLibroSanitario')) $('btnLibroSanitario').addEventListener('click', async () => exportLibroSanitario(await all('treatments')));
if ($('btnLibroIvaVentas')) $('btnLibroIvaVentas').addEventListener('click', () => exportLibroIva('ventas'));
if ($('btnLibroIvaCompras')) $('btnLibroIvaCompras').addEventListener('click', () => exportLibroIva('compras'));
if ($('btnNotifPermission')) $('btnNotifPermission').addEventListener('click', async () => {
  if (!('Notification' in window)) { alert('Este navegador no admite notificaciones.'); return; }
  const permission = await Notification.requestPermission();
  alert(permission === 'granted' ? 'Notificaciones activadas.' : 'No se otorgó permiso de notificaciones.');
});
if ($('btnValidarWsaa')) $('btnValidarWsaa').addEventListener('click', async () => {
  try {
    const status = await fiscalApi('POST', '/arca/validar-wsaa');
    alert(`Autenticación correcta. Ticket vigente: ${status.ticketMinutesRemaining} minutos.`);
    await fiscalApiAvailable(true);
    await loadArcaConnection();
  } catch (err) {
    alert(`ARCA rechazó la autenticación: ${err.message}`);
  }
});
if ($('dteRenspaOrigen') && !$('dteRenspaOrigen').value) $('dteRenspaOrigen').value = loadSenasaConfig().renspa || loadArcaFiscal().renspa || '';
