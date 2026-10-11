/* Pampa PBP - versiones comerciales (Básica, Profesional y Max)
 * Fuente única que usan el servidor (cupos por rol) y el navegador (módulos visibles).
 * Lo que ve cada usuario = módulos de la versión de la licencia ∩ permisos de su rol.
 * El plan sale de la licencia firmada PAMPAN1 (producto 'pampa-pbp'): basica → B, profesional → P, premium → M.
 * Sin licencia la app funciona en modo prueba con todos los módulos y muestra a qué versión pertenece cada uno.
 */
(function (root) {
  'use strict';
  const PRODUCT = 'pampa-pbp';
  const PLAN_CODES = { basica: 'B', profesional: 'P', premium: 'M' };
  const ROLE_NAMES = {
    'USR-DIR-GER': 'Director / gerencia', 'USR-ADM-FAC': 'Administración / facturación', 'USR-QC-NUT': 'Calidad y nutrición',
    'USR-LOG-DES': 'Logística y despacho', 'USR-OP-CON': 'Operador de consola', 'USR-OP-MAN': 'Operario de planta'
  };
  const MODULE_NAMES = {
    home: 'Dashboard', dashboard: 'Control de planta', production: 'Producción', inventory: 'Inventario', installations: 'Instalaciones',
    lots: 'Lotes', recipes: 'Recetas', equipment: 'Equipamiento', quality: 'Calidad y bioseguridad', costs: 'Costos', reports: 'Reportes', ai: 'PampaIA',
    waste: 'Residuos', supply: 'Abastecimiento', treasury: 'Finanzas', hr: 'RRHH', finance: 'Viabilidad financiera', tender: 'Pliego y compras'
  };
  // Cada versión incluye la anterior. -1 = sin límite de equipos para ese rol.
  const BASICA = ['home', 'dashboard', 'production', 'inventory', 'installations', 'lots', 'recipes', 'equipment', 'quality', 'costs', 'reports', 'ai'];
  const PROFESIONAL = [...BASICA, 'waste', 'supply', 'treasury', 'hr'];
  const MAX = [...PROFESIONAL, 'finance', 'tender'];
  const POLICIES = {
    B: {
      code: 'B', plan: 'basica', name: 'Básica', modules: BASICA,
      summary: 'Planta: producción, inventario y silos, recetas, equipos, calidad, costos por tonelada, reportes y PampaIA.',
      roles: ['USR-DIR-GER', 'USR-ADM-FAC', 'USR-QC-NUT', 'USR-OP-CON'],
      roleCaps: { 'USR-DIR-GER': 1, 'USR-ADM-FAC': 1, 'USR-QC-NUT': 1, 'USR-OP-CON': 1 }
    },
    P: {
      code: 'P', plan: 'profesional', name: 'Profesional', modules: PROFESIONAL,
      summary: 'Básica + residuos, abastecimiento, finanzas (tesorería y operativo) y RRHH con capacitaciones.',
      roles: ['USR-DIR-GER', 'USR-ADM-FAC', 'USR-QC-NUT', 'USR-LOG-DES', 'USR-OP-CON', 'USR-OP-MAN'],
      roleCaps: { 'USR-DIR-GER': 1, 'USR-ADM-FAC': 2, 'USR-QC-NUT': 2, 'USR-LOG-DES': 2, 'USR-OP-CON': 2, 'USR-OP-MAN': 1 }
    },
    M: {
      code: 'M', plan: 'premium', name: 'Max', modules: MAX,
      summary: 'Profesional + viabilidad financiera del proyecto y pliego técnico de compras, con equipos ilimitados por rol.',
      roles: ['USR-DIR-GER', 'USR-ADM-FAC', 'USR-QC-NUT', 'USR-LOG-DES', 'USR-OP-CON', 'USR-OP-MAN'],
      roleCaps: { 'USR-DIR-GER': -1, 'USR-ADM-FAC': -1, 'USR-QC-NUT': -1, 'USR-LOG-DES': -1, 'USR-OP-CON': -1, 'USR-OP-MAN': -1 }
    }
  };
  const ORDER = ['B', 'P', 'M'];
  // Versión mínima que incluye un módulo (para las etiquetas del modo prueba)
  const minimumTier = page => ORDER.find(code => POLICIES[code].modules.includes(page)) || null;
  // Código de versión de una licencia (payload verificado) o null si no hay licencia válida
  function planCodeOf(license) {
    if (!license || !license.plan) return null;
    if (license.expiresAt && new Date(`${String(license.expiresAt).slice(0, 10)}T23:59:59`) < new Date()) return null;
    return PLAN_CODES[license.plan] || null;
  }
  const policyFor = license => POLICIES[planCodeOf(license)] || null;
  const totalSeats = policy => (Object.values(policy.roleCaps).some(c => c < 0) ? -1 : Object.values(policy.roleCaps).reduce((a, b) => a + b, 0));

  const api = { PRODUCT, PLAN_CODES, ROLE_NAMES, MODULE_NAMES, POLICIES, ORDER, minimumTier, planCodeOf, policyFor, totalSeats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PBP_VERSIONS = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
