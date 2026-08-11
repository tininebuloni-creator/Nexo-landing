/*!
 * PampaTopografía — Validador de licencias (offline, firma ECDSA P-256 / SHA-256)
 * -----------------------------------------------------------------------------
 * Verifica claves emitidas por el generador interno SIN necesidad de internet.
 *
 * Funciona en 3 entornos con el mismo código:
 *   - Electron / navegador (usa Web Crypto: window.crypto.subtle)
 *   - Node.js puro (usa el módulo 'crypto')
 *   - Móvil (WebView / Capacitor / React Native con Web Crypto polyfill)
 *
 * USO EN EL CLIENTE:
 *   const { validarLicencia } = require('./licencia-validador'); // Node/Electron
 *   const res = await validarLicencia(claveIngresada);
 *   if (!res.valida) { ...bloquear app... }
 *
 * IMPORTANTE: este archivo SOLO contiene la clave PÚBLICA. Es seguro
 * distribuirlo dentro del .exe / web / app. La clave privada NUNCA va acá.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;              // Node / Electron (require)
  } else {
    root.PampaLicencia = mod;          // navegador (window.PampaLicencia)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===================== CONFIGURACIÓN =====================
  const PRODUCTO_ESPERADO = 'PAMPATOPO';
  const PREFIJO = 'PAMPA';

  // Clave PÚBLICA de verificación (SPKI DER, base64). Segura de distribuir.
  const PUBLIC_KEY_B64 =
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEW9LS/ZJ3ybjpNykfWpev2BUg9gRiS1RfbzwkXgo4yhWD7/u8RAEcxEvzpPF8ea0ViSO6xwbDM2zVa84WDoy3lA==';
  // =========================================================

  // ---- Detección de entorno crypto ----
  const isNode = (typeof process !== 'undefined' && process.versions && process.versions.node);
  const webcrypto =
    (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle)
      ? globalThis.crypto
      : (isNode ? require('crypto').webcrypto : null);

  if (!webcrypto || !webcrypto.subtle) {
    throw new Error('[PampaLicencia] No hay Web Crypto disponible en este entorno.');
  }

  // ---- Helpers base64 / base64url ----
  function b64ToBytes(b64) {
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  function bytesToStr(bytes) {
    if (typeof TextDecoder === 'function') return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString('utf8');
  }
  function strToBytes(str) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }

  let _pubKeyPromise = null;
  function importPublicKey() {
    if (!_pubKeyPromise) {
      _pubKeyPromise = webcrypto.subtle.importKey(
        'spki',
        b64ToBytes(PUBLIC_KEY_B64),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
    }
    return _pubKeyPromise;
  }

  /**
   * Valida una clave de licencia.
   * @param {string} clave  Token completo "PAMPA.<payload>.<firma>"
   * @param {object} [opts]
   * @param {Date}   [opts.ahora]  Fecha de referencia (default: now)
   * @param {string} [opts.plataforma]  'pc' | 'movil' | 'web' — si se pasa, exige que la licencia la incluya
   * @returns {Promise<{valida:boolean, motivo?:string, tipo?:string, ...}>}
   */
  async function validarLicencia(clave, opts) {
    opts = opts || {};
    const ahora = opts.ahora instanceof Date ? opts.ahora : new Date();

    try {
      if (typeof clave !== 'string' || !clave.trim()) {
        return { valida: false, motivo: 'CLAVE_VACIA' };
      }
      const partes = clave.trim().split('.');
      if (partes.length !== 3 || partes[0] !== PREFIJO) {
        return { valida: false, motivo: 'FORMATO_INVALIDO' };
      }

      const payloadB64 = partes[1];
      const sigBytes = b64ToBytes(partes[2]);

      // 1) Verificar firma sobre el payload en base64url
      const pub = await importPublicKey();
      const ok = await webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pub,
        sigBytes,
        strToBytes(payloadB64)
      );
      if (!ok) return { valida: false, motivo: 'FIRMA_INVALIDA' };

      // 2) Decodificar payload
      let data;
      try {
        data = JSON.parse(bytesToStr(b64ToBytes(payloadB64)));
      } catch (_) {
        return { valida: false, motivo: 'PAYLOAD_CORRUPTO' };
      }

      // 3) Producto correcto
      if (data.p !== PRODUCTO_ESPERADO) {
        return { valida: false, motivo: 'OTRO_PRODUCTO' };
      }

      // 4) Expiración
      let expirada = false;
      let diasRestantes = null;
      if (data.exp) {
        const exp = new Date(data.exp);
        expirada = ahora.getTime() > exp.getTime();
        diasRestantes = Math.ceil((exp.getTime() - ahora.getTime()) / 86400000);
      }

      // 5) Plataforma (opcional)
      if (opts.plataforma && Array.isArray(data.plt) && !data.plt.includes(opts.plataforma)) {
        return {
          valida: false, motivo: 'PLATAFORMA_NO_PERMITIDA',
          tipo: data.t, plataformas: data.plt
        };
      }

      const base = {
        tipo: data.t,                 // 'USO' | 'TRIAL'
        id: data.id,
        cliente: data.c || null,
        plataformas: data.plt || [],
        maxDispositivos: data.md || null,
        emitida: data.iat || null,
        expira: data.exp || null,
        diasRestantes: diasRestantes,
        expirada: expirada
      };

      if (expirada) {
        return Object.assign({ valida: false, motivo: 'EXPIRADA' }, base);
      }
      return Object.assign({ valida: true, motivo: 'OK' }, base);

    } catch (err) {
      return { valida: false, motivo: 'ERROR_INTERNO', detalle: String(err && err.message || err) };
    }
  }

  return { validarLicencia, PRODUCTO_ESPERADO };
});
