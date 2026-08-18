/**
 * Sistema de validación de licencias - PampaAgro ERP
 * Formato: NEXO-XXXX-XXXX-XXXX
 * Versiones: B=Básica, P=Profesional, M=Premium
 * Modo: Offline-first con sincronización
 */

const fs = require('fs');
const path = require('path');

const LICENSES_FILE = path.join(__dirname, 'licenses-db.json');
const SYNC_ENDPOINT = '/api/license/sync';

// Tipos de licencia y características
const LICENSE_TYPES = {
  'B': {
    name: 'Básica',
    modules: ['Centro operativo', 'Campos y lotes', 'Agricola', 'Operaciones'],
    users: 3,
    roles: 3,
    maxHectares: 500
  },
  'P': {
    name: 'Profesional',
    modules: ['Centro operativo', 'Campos y lotes', 'Agricola', 'Precision', 'Inventario', 'Operaciones', 'Analitica'],
    users: 10,
    roles: 10,
    maxHectares: 5000
  },
  'M': {
    name: 'Premium',
    modules: ['Centro operativo', 'Campos y lotes', 'Agricola', 'Precision', 'Inventario', 'Plan de equipamiento', 'Calibraciones', 'Telemetria y clima', 'Analitica', 'Finanzas', 'ARCA', 'RRHH', 'Usuarios y roles', 'Auditoria', 'Conectividad y sincronizacion'],
    users: 999,
    roles: 20,
    maxHectares: 999999
  }
};

/**
 * Cargar base de datos de licencias
 */
function loadLicensesDB() {
  try {
    if (fs.existsSync(LICENSES_FILE)) {
      return JSON.parse(fs.readFileSync(LICENSES_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Error cargando licencias:', err.message);
  }
  return { activeLicense: null, history: [], lastSync: null };
}

/**
 * Guardar base de datos de licencias
 */
function saveLicensesDB(data) {
  try {
    fs.writeFileSync(LICENSES_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('Error guardando licencias:', err.message);
    return false;
  }
}

/**
 * Validar formato de licencia NEXO-XXXX-XXXX-XXXX
 */
function validateLicenseFormat(key) {
  const pattern = /^NEXO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  return pattern.test(key);
}

/**
 * Extraer tipo de licencia (primera letra del primer grupo después de NEXO-)
 */
function extractLicenseType(key) {
  if (!validateLicenseFormat(key)) return null;
  const match = key.match(/^NEXO-([A-Z])/);
  return match ? match[1] : null;
}

/**
 * Obtener información de una licencia
 */
function getLicenseInfo(key) {
  if (!validateLicenseFormat(key)) {
    return { valid: false, error: 'Formato de licencia inválido' };
  }

  const type = extractLicenseType(key);
  if (!LICENSE_TYPES[type]) {
    return { valid: false, error: 'Tipo de licencia no reconocido' };
  }

  const licenseData = LICENSE_TYPES[type];
  return {
    valid: true,
    key: key,
    type: type,
    name: licenseData.name,
    modules: licenseData.modules,
    maxUsers: licenseData.users,
    maxRoles: licenseData.roles,
    maxHectares: licenseData.maxHectares,
    activatedAt: new Date().toISOString()
  };
}

/**
 * Activar una licencia
 */
function activateLicense(key) {
  const info = getLicenseInfo(key);
  if (!info.valid) {
    return { success: false, error: info.error };
  }

  const db = loadLicensesDB();
  db.activeLicense = info;
  db.activatedAt = new Date().toISOString();
  
  // Agregar al historial
  if (!db.history) db.history = [];
  db.history.push({
    key: key,
    type: info.type,
    activatedAt: new Date().toISOString(),
    status: 'active'
  });

  if (saveLicensesDB(db)) {
    return { success: true, license: info };
  }
  return { success: false, error: 'Error al guardar licencia' };
}

/**
 * Obtener licencia activa
 */
function getActiveLicense() {
  const db = loadLicensesDB();
  return db.activeLicense || null;
}

/**
 * Validar que un módulo está disponible en la licencia
 */
function isModuleAllowed(moduleName, license = null) {
  const activeLicense = license || getActiveLicense();
  
  if (!activeLicense) {
    return false;
  }

  return activeLicense.modules.includes(moduleName);
}

/**
 * Obtener módulos permitidos
 */
function getAllowedModules() {
  const activeLicense = getActiveLicense();
  
  if (!activeLicense) {
    return [];
  }

  return activeLicense.modules;
}

/**
 * Revocar licencia actual
 */
function revokeLicense() {
  const db = loadLicensesDB();
  db.activeLicense = null;
  db.revokedAt = new Date().toISOString();
  
  if (saveLicensesDB(db)) {
    return { success: true, message: 'Licencia revocada' };
  }
  return { success: false, error: 'Error al revocar licencia' };
}

/**
 * Obtener historial de licencias
 */
function getLicensesHistory() {
  const db = loadLicensesDB();
  return db.history || [];
}

/**
 * Obtener payload para sincronización (offline-first)
 */
function getSyncPayload() {
  const db = loadLicensesDB();
  return {
    activeLicense: db.activeLicense,
    history: db.history || [],
    lastSync: new Date().toISOString(),
    serverTime: new Date().toISOString()
  };
}

/**
 * Obtener última sincronización
 */
function getLastSyncTime() {
  const db = loadLicensesDB();
  return db.lastSync ? new Date(db.lastSync) : null;
}

/**
 * Actualizar marca de última sincronización
 */
function updateLastSync() {
  const db = loadLicensesDB();
  db.lastSync = new Date().toISOString();
  saveLicensesDB(db);
}

module.exports = {
  validateLicenseFormat,
  extractLicenseType,
  getLicenseInfo,
  activateLicense,
  getActiveLicense,
  isModuleAllowed,
  getAllowedModules,
  revokeLicense,
  getLicensesHistory,
  getSyncPayload,
  getLastSyncTime,
  updateLastSync,
  LICENSE_TYPES
};
