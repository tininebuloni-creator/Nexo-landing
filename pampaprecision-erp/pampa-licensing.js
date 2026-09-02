(function (global) {
  const pattern = /^NEXO-([A-Z])([A-Z0-9]{3})-([A-Z0-9]{4})-([A-Z0-9]{4})$/;
  const plans = {
    B: { name: 'Básica', maxUsers: 4, modules: ['centro_operativo', 'dashboard', 'empresa', 'campos', 'precision', 'fiscal', 'ia', 'reportes', 'usuarios_roles'] },
    P: { name: 'Profesional', maxUsers: 10, modules: ['centro_operativo', 'dashboard', 'empresa', 'campos', 'precision', 'fiscal', 'ia', 'reportes', 'usuarios_roles', 'maquinarias', 'finanzas', 'telemetria_clima', 'calibraciones', 'analitica'] },
    M: { name: 'Premium', maxUsers: -1, modules: ['centro_operativo', 'dashboard', 'empresa', 'campos', 'precision', 'fiscal', 'ia', 'reportes', 'usuarios_roles', 'maquinarias', 'finanzas', 'documentos', 'conectividad', 'telemetria_clima', 'calibraciones', 'analitica', 'rrhh', 'auditoria'] }
  };
  function normalize(value) { return String(value || '').trim().toUpperCase(); }
  function validateLicenseFormat(value) { return pattern.test(normalize(value)); }
  function validateOfflineRecord(record, now) {
    if (!record || !validateLicenseFormat(record.key)) return { valid: false, error: 'Licencia offline inválida' };
    const type = normalize(record.key).match(pattern)[1];
    const expiration = record.expirationDate || record.exp;
    const expired = expiration && new Date(expiration).getTime() <= (now || new Date()).getTime();
    if (expired) return { valid: false, expired: true, error: 'La licencia está vencida' };
    return { ...record, type, ...plans[type], valid: Boolean(plans[type]), offline: true };
  }
  global.PampaLicensing = { plans, validateLicenseFormat, validateOfflineRecord };
}(window));
