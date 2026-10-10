/* Verifica licencias PAMPAN1 (Ed25519) en el navegador. Espeja packages/core-licensing/signing.js */
(function (root) {
  'use strict';

  var PREFIX = 'PAMPAN1';
  var PLAN_CODES = { basica: 'B', profesional: 'P', premium: 'M' };
  var DEFAULT_WARN_DAYS = 15;
  var MS_PER_DAY = 86400000;
  var cachedKey = null;

  function decode(value) {
    var base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function startOfDay(date) {
    var copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  // "YYYY-MM-DD" se interpreta en hora local para no perder un dia por UTC.
  function parseDate(value) {
    var text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      var parts = text.split('-');
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }
    return new Date(text);
  }

  function getExpiryStatus(expiresAt, options) {
    options = options || {};
    var now = options.now ? new Date(options.now) : new Date();
    var warnDays = typeof options.warnDays === 'number' ? options.warnDays : DEFAULT_WARN_DAYS;
    if (!expiresAt) return { perpetual: true, expired: false, daysLeft: null, expiringSoon: false, warnDays: warnDays };

    var end = parseDate(expiresAt);
    if (isNaN(end.getTime())) {
      return { perpetual: false, expired: true, daysLeft: null, expiringSoon: false, warnDays: warnDays };
    }
    var daysLeft = Math.round((startOfDay(end) - startOfDay(now)) / MS_PER_DAY);
    return {
      perpetual: false,
      expired: daysLeft < 0,
      daysLeft: daysLeft,
      expiringSoon: daysLeft >= 0 && daysLeft <= warnDays,
      warnDays: warnDays,
      expiresAt: expiresAt
    };
  }

  function importKey() {
    var pem = root.PAMPA_LICENSE_PUBLIC_KEY;
    if (!pem || !root.crypto || !root.crypto.subtle) return Promise.resolve(null);
    if (cachedKey) return Promise.resolve(cachedKey);
    var raw = decode(String(pem).replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, ''));
    return root.crypto.subtle.importKey('spki', raw, { name: 'Ed25519' }, false, ['verify']).then(function (key) {
      cachedKey = key;
      return key;
    }).catch(function () { return null; });
  }

  function verifyLicense(token, options) {
    options = options || {};
    var parts = String(token || '').trim().split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX) {
      return Promise.resolve({ valid: false, error: 'Formato de licencia invalido' });
    }
    return importKey().then(function (key) {
      if (!key) return { valid: false, error: 'No se pudo cargar la clave publica de licencias' };
      var payloadBytes = decode(parts[1]);
      return root.crypto.subtle.verify({ name: 'Ed25519' }, key, decode(parts[2]), payloadBytes).then(function (ok) {
        if (!ok) return { valid: false, error: 'Firma de licencia invalida' };
        var payload = JSON.parse(new TextDecoder().decode(payloadBytes));
        if (!payload || !PLAN_CODES[payload.plan]) return { valid: false, error: 'Contenido de licencia invalido' };
        if (options.product && payload.product !== options.product) {
          return { valid: false, error: 'Licencia emitida para ' + payload.product };
        }
        var expiry = getExpiryStatus(payload.expiresAt, options);
        if (expiry.expired) {
          return Object.assign({ valid: false, expired: true, error: 'La licencia esta vencida' }, payload, expiry);
        }
        return Object.assign({ valid: true, token: String(token).trim() }, payload, expiry);
      });
    }).catch(function () {
      return { valid: false, error: 'Licencia ilegible' };
    });
  }

  root.PampaLicenseSigned = {
    TOKEN_PREFIX: PREFIX,
    PLAN_CODES: PLAN_CODES,
    verifyLicense: verifyLicense,
    getExpiryStatus: getExpiryStatus
  };
}(typeof globalThis !== 'undefined' ? globalThis : window));
