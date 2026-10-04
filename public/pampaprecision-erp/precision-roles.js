/* Roles y permisos de PampaPrecisión (agricultura pura), según "pampaprecision - versiones":
 *   Básica       4 roles: Propietario / Responsable, Administración, Ingeniero Agrónomo, Operador.
 *   Profesional 10 roles: los de la tabla de la versión Profesional.
 *   Premium     los 10 + roles propios de la empresa (módulos y pestañas elegidos uno por uno).
 *   La prueba gratis ve los roles de Premium.
 * Cada rol define qué módulos del menú ve y qué pestañas de "Granos, costos y fiscal". PampaIA usa los
 * mismos permisos. Centro operativo lo ven todos. Mismo criterio que Tambo, Ganadería y Porcinos.
 * UMD: navegador (window.PampaRolesPrecision) y Node (tests).
 */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) raiz.PampaRolesPrecision = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VISTAS = [
    ['Centro operativo', 'Centro operativo'], ['Campos y lotes', 'Campos y lotes'], ['Agricola', 'Campañas, siembra y cosecha'], ['Operaciones', 'Labores y aplicaciones'],
    ['Granos', 'Granos, costos y fiscal'], ['Rentabilidad', 'Rentabilidad'], ['Precision', 'Precisión (mapas y prescripciones)'], ['Inventario', 'Inventario'],
    ['Plan de equipamiento', 'Equipo (maquinaria, mantenimiento y costos)'], ['Calibraciones', 'Calibraciones'], ['Telemetria y clima', 'Telemetría y clima'], ['Analitica', 'Analítica'],
    ['Finanzas', 'Finanzas'], ['Costos', 'Costos'], ['ARCA', 'ARCA'], ['RRHH', 'RRHH'], ['Usuarios y roles', 'Usuarios y roles'], ['Auditoria', 'Auditoría'],
    ['Conectividad y sincronizacion', 'Conectividad y respaldo'], ['Licencias', 'Licencias'], ['Reportes', 'Reportes'],
  ];
  const TABS = [
    ['stock', 'Stock de granos'], ['lpg', 'Liquidaciones (LPG)'], ['cpe', 'Cartas de Porte'], ['renspa', 'RENSPA y campañas'], ['compras', 'Compras e insumos'],
    ['labores', 'Labores'], ['senasa', 'SENASA y recetas'], ['residuos', 'Residuos'], ['resultados', 'Costos y resultados'], ['fiscal', 'Fiscal'],
  ];
  const TODO = '*';
  // plan: desde qué versión existe el rol (basica = en las tres).
  const ROLES = [
    { nombre: 'Propietario / Responsable', plan: 'basica', descripcion: 'Gestión general y aprobación', vistas: TODO, tabs: TODO },
    { nombre: 'Administrador General', plan: 'profesional', descripcion: 'Administra el sistema, usuarios y respaldo', vistas: TODO, tabs: TODO },
    { nombre: 'Administración', plan: 'basica', descripcion: 'Compras, ventas de granos, costos, fiscal y finanzas', vistas: ['Campos y lotes', 'Granos', 'Rentabilidad', 'Costos', 'Plan de equipamiento', 'Inventario', 'Finanzas', 'ARCA', 'RRHH', 'Reportes', 'Auditoria', 'Licencias', 'Conectividad y sincronizacion'], tabs: ['stock', 'lpg', 'cpe', 'renspa', 'compras', 'residuos', 'resultados', 'fiscal'] },
    { nombre: 'Ingeniero Agrónomo', plan: 'basica', descripcion: 'Decisiones agronómicas, recetas, lotes y costos por lote', vistas: ['Campos y lotes', 'Agricola', 'Operaciones', 'Granos', 'Rentabilidad', 'Costos', 'Plan de equipamiento', 'Precision', 'Inventario', 'Calibraciones', 'Telemetria y clima', 'Analitica', 'Reportes'], tabs: ['stock', 'renspa', 'compras', 'labores', 'senasa', 'residuos', 'resultados'] },
    { nombre: 'Operador', plan: 'basica', soloPlan: 'basica', descripcion: 'Ejecución de tareas de campo', vistas: ['Agricola', 'Operaciones', 'Granos', 'Inventario', 'Telemetria y clima'], tabs: ['stock', 'labores', 'senasa', 'residuos'] },
    { nombre: 'Responsable de Agricultura de Precisión', plan: 'profesional', descripcion: 'Mapas, zonas, prescripciones y calibración', vistas: ['Campos y lotes', 'Agricola', 'Precision', 'Calibraciones', 'Telemetria y clima', 'Analitica', 'Granos', 'Reportes'], tabs: ['stock', 'labores', 'senasa', 'resultados'] },
    { nombre: 'Encargado de Campo', plan: 'profesional', descripcion: 'Organiza las labores, la cosecha y el acopio', vistas: ['Campos y lotes', 'Agricola', 'Operaciones', 'Granos', 'Inventario', 'Telemetria y clima'], tabs: ['stock', 'cpe', 'renspa', 'labores', 'senasa', 'residuos'] },
    { nombre: 'Operador de Maquinaria', plan: 'profesional', descripcion: 'Registra labores y horas de máquina', vistas: ['Operaciones', 'Granos', 'Calibraciones', 'Telemetria y clima'], tabs: ['labores', 'residuos'] },
    { nombre: 'Responsable de Inventario', plan: 'profesional', descripcion: 'Insumos, granos almacenados y despachos', vistas: ['Inventario', 'Granos', 'Reportes'], tabs: ['stock', 'cpe', 'compras', 'residuos'] },
    { nombre: 'Técnico de Equipos', plan: 'profesional', descripcion: 'Mantenimiento, calibración y residuos del taller', vistas: ['Plan de equipamiento', 'Calibraciones', 'Telemetria y clima', 'Inventario', 'Granos'], tabs: ['labores', 'residuos'] },
    { nombre: 'Consultor / Auditor', plan: 'profesional', descripcion: 'Revisa información productiva, económica y fiscal', vistas: ['Campos y lotes', 'Agricola', 'Granos', 'Rentabilidad', 'Costos', 'Analitica', 'Reportes', 'Auditoria', 'ARCA'], tabs: TODO },
  ];
  // Nombres de versiones anteriores de la app.
  const ALIAS = { 'ingeniero / veterinario': 'Ingeniero Agrónomo', 'ingeniero': 'Ingeniero Agrónomo', 'operario de campo': 'Operador', 'operario': 'Operador', 'propietario/responsable': 'Propietario / Responsable', 'administracion': 'Administración' };
  const NIVEL = { basica: 1, profesional: 2, premium: 3, trial: 3 };
  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

  // Roles disponibles en el plan (+ los propios de la empresa en Premium).
  function rolesDelPlan(plan, propios = []) {
    const n = NIVEL[plan] || 1;
    const base = ROLES.filter((r) => NIVEL[r.plan] <= n && (!r.soloPlan || r.soloPlan === (n === 1 ? 'basica' : 'x')));
    return n >= 3 ? [...base, ...(propios || []).map((r) => ({ ...r, propio: true, plan: 'premium' }))] : base;
  }
  function buscarRol(nombre, plan, propios) {
    const lista = rolesDelPlan(plan, propios);
    let n = norm(ALIAS[norm(nombre)] || nombre);
    // El Operador de la Básica pasa a Operador de Maquinaria en Profesional y Premium.
    if (n === 'operador' && (NIVEL[plan] || 1) >= 2) n = norm('Operador de Maquinaria');
    return lista.find((r) => norm(r.nombre) === n) || null;
  }
  // Sin rol elegido manda el Propietario / Responsable (instalación nueva). Un rol que el plan no tiene
  // (o un rol propio borrado) no da acceso a nada más que al Centro operativo.
  const SIN_ROL = { nombre: 'Rol no disponible en esta versión', descripcion: 'Elegí otro rol', vistas: [], tabs: [], invalido: true };
  const rolEfectivo = (nombre, plan, propios) => (!nombre ? rolesDelPlan(plan, propios)[0] : buscarRol(nombre, plan, propios) || { ...SIN_ROL, pedido: nombre });
  function puedeVista(rol, vista) {
    if (!rol || vista === 'Centro operativo') return true;
    return rol.vistas === TODO || rol.vistas.includes(vista);
  }
  function puedeTab(rol, tab) {
    if (!rol) return true;
    if (!puedeVista(rol, 'Granos') && !(tab === 'resultados' && puedeVista(rol, 'Rentabilidad'))) return false;
    return rol.tabs === TODO || rol.tabs.includes(tab);
  }
  // Datos que usa PampaIA (asistente-ia.js) → módulos o pestañas que los muestran.
  const DATO_IA = {
    granos: [['tab', 'stock']], insumos: [['tab', 'compras'], ['vista', 'Inventario']], labores: [['tab', 'labores'], ['vista', 'Operaciones']],
    costos: [['tab', 'resultados'], ['vista', 'Rentabilidad'], ['vista', 'Costos']], finanzas: [['tab', 'lpg'], ['vista', 'Finanzas']], fiscal: [['tab', 'fiscal'], ['vista', 'ARCA']],
    maquinaria: [['vista', 'Plan de equipamiento'], ['vista', 'Calibraciones'], ['tab', 'labores']], precision: [['vista', 'Precision']],
  };
  function puedeDatoIA(rol, dato) {
    const reglas = DATO_IA[dato];
    if (!rol || !reglas) return true;
    return reglas.some(([tipo, x]) => (tipo === 'tab' ? puedeTab(rol, x) : puedeVista(rol, x)));
  }
  // Módulos por versión ("pampaprecision - versiones"): Básica = Centro operativo, Campos y lotes,
  // Agrícola (campañas, labores y aplicaciones) e Inventario; Profesional suma Precisión y Calibraciones;
  // Premium tiene todo. Usuarios y roles, Conectividad y Licencias son servicios del sistema (todas).
  const SISTEMA = ['Centro operativo', 'Usuarios y roles', 'Conectividad y sincronizacion', 'Licencias'];
  const MODULOS_BASICA = [...SISTEMA, 'Campos y lotes', 'Agricola', 'Operaciones', 'Granos', 'Inventario'];
  const MODULOS_PLAN = { basica: MODULOS_BASICA, profesional: [...MODULOS_BASICA, 'Precision', 'Calibraciones'] };
  // De "Granos, costos y fiscal", Básica y Profesional ven lo agrícola y de inventario; LPG, Cartas de
  // Porte, fiscal y costos (ARCA, Finanzas y Analítica) son de Premium.
  const TABS_BASICA = ['stock', 'renspa', 'compras', 'labores', 'senasa', 'residuos'];
  const claveNivel = (plan) => ((NIVEL[plan] || 1) >= 3 ? null : (NIVEL[plan] || 1) === 2 ? 'profesional' : 'basica');
  const vistaEnPlan = (plan, vista) => { const k = claveNivel(plan); return !k || MODULOS_PLAN[k].includes(vista); };
  const tabEnPlan = (plan, tab) => !claveNivel(plan) || TABS_BASICA.includes(tab);
  const planMinimoVista = (vista) => (MODULOS_BASICA.includes(vista) ? 'basica' : MODULOS_PLAN.profesional.includes(vista) ? 'profesional' : 'premium');
  const planMinimoTab = (tab) => (TABS_BASICA.includes(tab) ? 'basica' : 'premium');

  return { VISTAS, TABS, ROLES, ALIAS, TODO, MODULOS_PLAN, TABS_BASICA, vistaEnPlan, tabEnPlan, planMinimoVista, planMinimoTab, rolesDelPlan, buscarRol, rolEfectivo, puedeVista, puedeTab, puedeDatoIA, norm };
});
