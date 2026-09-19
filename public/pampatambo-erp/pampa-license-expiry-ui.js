(function (global) {
  'use strict';

  var WHATSAPP = '5492364719731';
  var LICENSE_KEYS = ['nexoAgroLicense', 'pampa-license-cache', 'tambo_license', 'PampaPorcinosLicense'];

  function readExpiredLicense() {
    for (var index = 0; index < LICENSE_KEYS.length; index += 1) {
      try {
        var raw = global.localStorage.getItem(LICENSE_KEYS[index]);
        if (!raw) continue;
        var record = JSON.parse(raw);
        // El ERP guarda la licencia verificada como { key, payload: { exp, licenseId, owner, ... } },
        // no con exp/licenseId en el nivel superior: sin este chequeo anidado nunca se detectaba el vencimiento.
        var payload = record && record.payload;
        // Una prueba gratis vencida (payload.trial === true, o key === 'TRIAL-10DIAS') no es
        // una suscripción paga sin renovar: no corresponde mostrarle a ese usuario el cartel de
        // "renueve su abono" con el link de WhatsApp de pago. Para pruebas vencidas, que se
        // encargue el cartel de activación de licencia propio de la app.
        var isTrialRecord = Boolean(payload && payload.trial) || record.key === 'TRIAL-10DIAS';
        if (isTrialRecord) continue;
        var expiration = record && (record.expiresAt || record.expirationDate || record.exp
          || (record.license && record.license.expiresAt)
          || (payload && (payload.exp || payload.expiresAt)));
        if (!expiration) continue;
        var end = new Date(expiration);
        if (!isNaN(end.getTime()) && end.getTime() < Date.now()) return { record: record, expiration: end, payload: payload };
      } catch (error) {
        // El validador de cada aplicación continúa controlando registros ilegibles.
      }
    }
    return null;
  }

  function showExpiredLicense() {
    var expired = readExpiredLicense();
    if (!expired || !global.document || !global.document.body) return;

    var overlay = global.document.getElementById('activationOverlay') || global.document.getElementById('licenseActivationOverlay');
    if (!overlay) {
      overlay = global.document.createElement('div');
      overlay.id = 'pampaCommercialLicenseOverlay';
      global.document.body.appendChild(overlay);
    }
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:#0f111a;color:#fff;font-family:Segoe UI,system-ui,sans-serif;';
    var record = expired.record || {};
    var payload = expired.payload || {};
    var identifier = record.licenseId || record.customer || payload.licenseId || payload.owner || payload.customer || '';
    var date = expired.expiration.toLocaleDateString('es-AR');
    var message = 'Hola. Deseo notificar el pago de mi abono para la licencia del ERP' + (identifier ? ' ' + identifier : '') + '.';
    overlay.innerHTML = '<div style="background:#161925;border-top:4px solid #ef4444;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.5);box-sizing:border-box;max-width:480px;padding:36px 28px;text-align:center;width:100%">' +
      '<div style="font-size:52px;line-height:1;margin-bottom:18px">🔒</div>' +
      '<h1 style="font-size:24px;margin:0 0 12px">Suscripción temporal inactiva</h1>' +
      '<p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 22px">Para resguardar la seguridad de sus registros, el acceso a esta terminal ERP requiere la renovación del abono periódico.</p>' +
      '<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.22);border-radius:8px;color:#f87171;font-size:13px;font-weight:600;line-height:1.5;margin-bottom:22px;padding:12px">Estado: licencia vencida (' + date + ')' + (identifier ? ' · ' + identifier : '') + '</div>' +
      '<a href="https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(message) + '" target="_blank" rel="noopener noreferrer" style="background:#25d366;border-radius:8px;box-sizing:border-box;color:#fff;display:inline-flex;font-size:15px;font-weight:700;justify-content:center;padding:14px 18px;text-decoration:none;width:100%">💬 Informar pago o solicitar activación</a>' +
      '<div style="border-top:1px solid #23283b;color:#94a3b8;font-size:12px;line-height:1.5;margin-top:22px;padding-top:14px">Los datos locales e históricos de su empresa permanecen resguardados de forma segura.</div>' +
      '</div>';
    overlay.style.display = 'flex';
  }

  global.addEventListener('DOMContentLoaded', function () {
    showExpiredLicense();
    global.setTimeout(showExpiredLicense, 1200);
  });
}(window));
