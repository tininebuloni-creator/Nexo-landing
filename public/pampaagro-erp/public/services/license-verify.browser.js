/*
 * Verificacion de licencias firmadas (Ed25519) para PampaAgro ERP en el navegador / PWA.
 * Expone window.PampaLicense.verifyLicenseToken(token) -> Promise<licenciaValida|null>
 *
 * Usa WebCrypto (algoritmo "Ed25519") cuando el navegador lo soporta y, si no,
 * recurre a una verificacion Ed25519 en JavaScript puro (BigInt + SHA-512 de WebCrypto)
 * para que la app siga funcionando offline en telefonos con navegadores antiguos.
 */
(function (global) {
  'use strict';

  var TOKEN_PREFIX = 'PAMPAAGRO1';
  var PRODUCT_ID = 'pampa-agro';
  var VALID_PLANS = ['basica', 'profesional', 'premium'];

  function base64ToBytes(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function base64UrlToBytes(value) {
    var b64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return base64ToBytes(b64);
  }

  function pemToSpki(pem) {
    var body = String(pem)
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s+/g, '');
    return base64ToBytes(body);
  }

  // Los ultimos 32 bytes del SPKI Ed25519 son la clave publica cruda.
  function spkiToRawKey(spki) {
    return spki.slice(spki.length - 32);
  }

  function bytesToUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(out));
  }

  /* ---------------- Ed25519 en JS puro (fallback) ---------------- */

  var P = (1n << 255n) - 19n;
  var D = mod(-121665n * modInv(121666n));
  var L = 2n ** 252n + 27742317777372353535851937790883648493n;
  var SQRT_M1 = powMod(2n, (P - 1n) / 4n, P);

  function mod(a) {
    var r = a % P;
    return r < 0n ? r + P : r;
  }

  function powMod(base, exp, m) {
    var result = 1n;
    var b = base % m;
    var e = exp;
    while (e > 0n) {
      if (e & 1n) result = (result * b) % m;
      b = (b * b) % m;
      e >>= 1n;
    }
    return result;
  }

  function modInv(a) {
    return powMod(mod(a), P - 2n, P);
  }

  var D2 = 0n; // inicializado abajo (2*d)

  function bytesToBigIntLE(bytes) {
    var value = 0n;
    for (var i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
    return value;
  }

  // Punto en coordenadas extendidas [X, Y, Z, T]
  function pointAdd(p1, p2) {
    var a = mod((p1[1] - p1[0]) * (p2[1] - p2[0]));
    var b = mod((p1[1] + p1[0]) * (p2[1] + p2[0]));
    var c = mod(p1[3] * D2 * p2[3]);
    var d = mod(p1[2] * 2n * p2[2]);
    var e = b - a;
    var f = d - c;
    var g = d + c;
    var h = b + a;
    return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
  }

  function scalarMul(point, scalar) {
    var q = [0n, 1n, 1n, 0n];
    var p = point;
    var s = scalar;
    while (s > 0n) {
      if (s & 1n) q = pointAdd(q, p);
      p = pointAdd(p, p);
      s >>= 1n;
    }
    return q;
  }

  function pointEquals(p1, p2) {
    return mod(p1[0] * p2[2]) === mod(p2[0] * p1[2]) && mod(p1[1] * p2[2]) === mod(p2[1] * p1[2]);
  }

  function decodePoint(bytes) {
    var y = bytesToBigIntLE(bytes) & ((1n << 255n) - 1n);
    var sign = BigInt(bytes[31] >> 7);
    if (y >= P) return null;

    var y2 = mod(y * y);
    var u = mod(y2 - 1n);
    var v = mod(D * y2 + 1n);
    // x = u*v^3 * (u*v^7)^((p-5)/8)
    var x = mod(mod(u * powMod(v, 3n, P)) * powMod(mod(u * powMod(v, 7n, P)), (P - 5n) / 8n, P));

    if (mod(v * x * x) === mod(-u)) x = mod(x * SQRT_M1);
    if (mod(v * x * x) !== u) return null;
    if ((x & 1n) !== sign) x = mod(-x);

    return [x, y, 1n, mod(x * y)];
  }

  var BASE_POINT = null;

  function initConstants() {
    if (BASE_POINT) return;
    D2 = mod(2n * D);
    var gy = mod(4n * modInv(5n));
    var gyBytes = new Uint8Array(32);
    var tmp = gy;
    for (var i = 0; i < 32; i++) {
      gyBytes[i] = Number(tmp & 0xffn);
      tmp >>= 8n;
    }
    BASE_POINT = decodePoint(gyBytes);
  }

  async function sha512(bytes) {
    var digest = await global.crypto.subtle.digest('SHA-512', bytes);
    return new Uint8Array(digest);
  }

  function concatBytes() {
    var total = 0;
    var i;
    for (i = 0; i < arguments.length; i++) total += arguments[i].length;
    var out = new Uint8Array(total);
    var offset = 0;
    for (i = 0; i < arguments.length; i++) {
      out.set(arguments[i], offset);
      offset += arguments[i].length;
    }
    return out;
  }

  async function ed25519VerifyFallback(publicKeyRaw, message, signature) {
    if (typeof BigInt === 'undefined') return false;
    if (signature.length !== 64 || publicKeyRaw.length !== 32) return false;

    initConstants();
    if (!BASE_POINT) return false;

    var rBytes = signature.slice(0, 32);
    var sBytes = signature.slice(32, 64);
    var s = bytesToBigIntLE(sBytes);
    if (s >= L) return false;

    var pointA = decodePoint(publicKeyRaw);
    var pointR = decodePoint(rBytes);
    if (!pointA || !pointR) return false;

    var hash = await sha512(concatBytes(rBytes, publicKeyRaw, message));
    var k = bytesToBigIntLE(hash) % L;

    var left = scalarMul(BASE_POINT, s);
    var right = pointAdd(pointR, scalarMul(pointA, k));
    return pointEquals(left, right);
  }

  /* ---------------- Verificacion de firma ---------------- */

  var cachedWebCryptoKey = null;
  var webCryptoUnavailable = false;

  async function verifySignature(payloadBytes, signature) {
    var pem = global.PAMPAAGRO_LICENSE_PUBLIC_KEY;
    if (!pem) return false;

    var spki = pemToSpki(pem);

    if (!webCryptoUnavailable && global.crypto && global.crypto.subtle) {
      try {
        if (!cachedWebCryptoKey) {
          cachedWebCryptoKey = await global.crypto.subtle.importKey('spki', spki, { name: 'Ed25519' }, false, ['verify']);
        }
        return await global.crypto.subtle.verify({ name: 'Ed25519' }, cachedWebCryptoKey, signature, payloadBytes);
      } catch (e) {
        webCryptoUnavailable = true;
        cachedWebCryptoKey = null;
      }
    }

    try {
      return await ed25519VerifyFallback(spkiToRawKey(spki), payloadBytes, signature);
    } catch (e) {
      return false;
    }
  }

  async function verifyLicenseToken(token) {
    try {
      if (typeof token !== 'string') return null;
      var parts = token.trim().split('.');
      if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;

      var payloadBytes = base64UrlToBytes(parts[1]);
      var signature = base64UrlToBytes(parts[2]);
      if (!(await verifySignature(payloadBytes, signature))) return null;

      var payload = JSON.parse(bytesToUtf8(payloadBytes));
      if (!payload || payload.product !== PRODUCT_ID) return null;
      if (VALID_PLANS.indexOf(payload.plan) === -1) return null;

      if (payload.expiresAt) {
        var expiration = new Date(payload.expiresAt).getTime();
        if (!isFinite(expiration) || Date.now() > expiration) return null;
      }

      return {
        type: 'signed',
        key: token.trim(),
        plan: payload.plan,
        maxUsers: Number.isInteger(payload.maxUsers) && payload.maxUsers > 0 ? payload.maxUsers : 1,
        customer: String(payload.customer || ''),
        licenseId: String(payload.licenseId || ''),
        issuedAt: payload.issuedAt || null,
        expiresAt: payload.expiresAt || null,
        activatedAt: new Date().toISOString()
      };
    } catch (e) {
      return null;
    }
  }

  global.PampaLicense = {
    TOKEN_PREFIX: TOKEN_PREFIX,
    PRODUCT_ID: PRODUCT_ID,
    VALID_PLANS: VALID_PLANS,
    verifyLicenseToken: verifyLicenseToken
  };
}(typeof globalThis !== 'undefined' ? globalThis : window));
