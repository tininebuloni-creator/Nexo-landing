// ARCHIVO GENERADO por scripts/sync-trial-guard.js desde packages/core-licensing: no editar acá.
// browser-trial-guard.js — CANÓNICO del lado navegador del control de días del trial web.
//
// Lo distribuye scripts/sync-trial-guard.js a cada app publicada en la landing como
// pampa-trial-guard.js, reemplazando pbp por el id corto de la app. Se carga en el
// <head>, antes del script de la app. El servidor (trial-status-core.js) recuerda el primer
// inicio de la prueba: su vencimiento manda sobre el que guarda el navegador.
//
// window.PampaTrialGuard:
//   estado()       -> Promise<{ disponible, activo, agotado, activatedAt, expiresAt, diasRestantes }>
//   registrar(desde?) -> igual, registrando el inicio si todavía no existe (desde = ISO opcional)
//   mostrarAgotado()  -> pantalla "Prueba gratuita finalizada"
//   consultarTrialServidor() / registrarTrialIP()  -> compatibilidad con la versión anterior
//
// disponible = false cuando no hay servidor que responda (escritorio, servidor local, sin red):
// ahí cada app sigue con su control local de siempre.
(function () {
  'use strict';
  var APP_ID = 'pbp';
  var ENDPOINT = '/api/pampa-trial-status';
  var CLAVE = 'pampaTrialDispositivo';
  var NO_DISPONIBLE = { disponible: false, activo: false, agotado: false };

  function idValido(id) {
    return typeof id === 'string' && /^[a-z0-9-]{16,64}$/i.test(id) ? id.toLowerCase() : '';
  }
  function nuevoId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function leerLocal() { try { return idValido(localStorage.getItem(CLAVE)); } catch (e) { return ''; } }
  function escribirLocal(id) { try { localStorage.setItem(CLAVE, id); } catch (e) { /* sin almacenamiento */ } }
  function leerCookie() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + CLAVE + '=([^;]+)'));
    return m ? idValido(decodeURIComponent(m[1])) : '';
  }
  function escribirCookie(id) {
    try {
      document.cookie = CLAVE + '=' + encodeURIComponent(id) + '; path=/; max-age=' + 2 * 365 * 24 * 3600 + '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) { /* sin cookies */ }
  }
  function conIndexedDB(modo, fn) {
    return new Promise(function (resolve) {
      try {
        var pedido = indexedDB.open('pampa-trial', 1);
        pedido.onupgradeneeded = function () { pedido.result.createObjectStore('datos'); };
        pedido.onerror = function () { resolve(''); };
        pedido.onsuccess = function () {
          try {
            var tx = pedido.result.transaction('datos', modo);
            var r = fn(tx.objectStore('datos'));
            tx.oncomplete = function () { resolve(r && r.result !== undefined ? r.result : ''); };
            tx.onerror = function () { resolve(''); };
          } catch (e) { resolve(''); }
        };
      } catch (e) { resolve(''); }
    });
  }
  // Identificador aleatorio del navegador (no identifica a la persona): se guarda en tres
  // lugares y se recupera de cualquiera, así borrar uno solo no alcanza para reiniciar.
  var dispositivoPromesa = null;
  function dispositivo() {
    if (!dispositivoPromesa) {
      dispositivoPromesa = conIndexedDB('readonly', function (s) { return s.get(CLAVE); }).then(function (deIdb) {
        var id = leerLocal() || leerCookie() || idValido(deIdb) || nuevoId();
        escribirLocal(id);
        escribirCookie(id);
        return conIndexedDB('readwrite', function (s) { return s.put(id, CLAVE); }).then(function () { return id; });
      });
    }
    return dispositivoPromesa;
  }

  // Acceso de propietario: ?propietario=<clave> se guarda en este navegador (y se saca de la dirección).
  // La valida el servidor (PAMPA_PROPIETARIO_CLAVE): acá no hay ninguna clave.
  var CLAVE_DUENO = 'pampaPropietario';
  (function tomarClaveDeLaDireccion() {
    try {
      var url = new URL(location.href);
      var clave = url.searchParams.get('propietario');
      if (clave === null) return;
      if (clave) localStorage.setItem(CLAVE_DUENO, clave); else localStorage.removeItem(CLAVE_DUENO);
      url.searchParams.delete('propietario');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    } catch (e) { /* sin almacenamiento */ }
  })();
  function claveDueno() { try { return localStorage.getItem(CLAVE_DUENO) || ''; } catch (e) { return ''; } }

  // Con el propietario confirmado se libera el control local de la prueba en este navegador: inicio de hoy,
  // sin marcas de "agotado" y la licencia de prueba con el vencimiento que dio el servidor.
  function liberarPropietario(expiresAt) {
    var cambio = false;
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (/^pampa_trial_exhausted/i.test(k)) { localStorage.removeItem(k); cambio = true; }
        if (/^pampa_trial_init:/i.test(k)) { var v = localStorage.getItem(k); if (!v || (Date.now() - new Date(v).getTime()) > 864e5) { localStorage.setItem(k, new Date().toISOString()); cambio = true; } }
      });
      ['nexoAgroLicense', 'PampaPorcinosLicense', 'tambo_license', 'pampa-license-cache', 'PampaPrecisionLicense'].forEach(function (k) {
        var r = null; try { r = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { r = null; }
        if (!r || !(r.type === 'trial' || r.trial === true || (r.payload && r.payload.trial))) return;
        if (r.expiresAt && new Date(r.expiresAt) >= new Date(expiresAt)) return;
        r.expiresAt = expiresAt;
        if (r.payload && r.payload.exp) r.payload.exp = expiresAt;
        localStorage.setItem(k, JSON.stringify(r));
        cambio = true;
      });
    } catch (e) { /* sin almacenamiento */ }
    // Una sola recarga para que la app arranque ya liberada (si algo quedó bloqueado antes de la respuesta).
    try { if (cambio && !sessionStorage.getItem('pampaPropietarioRecargado')) { sessionStorage.setItem('pampaPropietarioRecargado', '1'); location.reload(); } } catch (e) {}
  }

  function consultar(registrar, desde) {
    return dispositivo().then(function (id) {
      var dueno = claveDueno();
      var url = ENDPOINT + '?app=' + encodeURIComponent(APP_ID) + '&d=' + encodeURIComponent(id) + (registrar ? '&pampa_trial=1' : '') + (desde ? '&desde=' + encodeURIComponent(desde) : '') + (dueno ? '&propietario=' + encodeURIComponent(dueno) : '');
      return fetch(url, { method: 'GET', cache: 'no-store', credentials: 'same-origin' });
    }).then(function (res) {
      // Sin la función del servidor, la landing responde el HTML del catálogo: no es un estado.
      if (!res.ok || !/json/i.test(res.headers.get('content-type') || '')) return NO_DISPONIBLE;
      return res.json().then(function (data) {
        if (!data || data.ok !== true) return NO_DISPONIBLE;
        if (data.propietario === true) liberarPropietario(data.expiresAt);
        return {
          propietario: data.propietario === true,
          disponible: true,
          activo: data.trialActive === true,
          agotado: data.trialExhausted === true,
          activatedAt: data.activatedAt || null,
          expiresAt: data.expiresAt || null,
          diasRestantes: typeof data.diasRestantes === 'number' ? data.diasRestantes : null,
        };
      });
    }).catch(function () { return NO_DISPONIBLE; });
  }

  function mostrarAgotado() {
    if (document.getElementById('pampaTrialAgotado')) return;
    var capa = document.createElement('div');
    capa.id = 'pampaTrialAgotado';
    capa.setAttribute('role', 'alertdialog');
    capa.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.88);font:16px Arial,sans-serif';
    capa.innerHTML = '<section style="max-width:480px;background:#fff;color:#172033;border-radius:10px;padding:24px;box-shadow:0 18px 48px rgba(0,0,0,.4)"><h2 style="margin:0 0 12px;font-size:22px">Prueba gratuita finalizada</h2><p style="margin:0 0 16px;line-height:1.5">Los 10 días de prueba de esta aplicación ya se usaron en este equipo o conexión, y no se pueden reiniciar. Para seguir usándola, consultanos por la versión completa.</p><a href="/" style="display:inline-block;padding:10px 14px;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;text-decoration:none">Volver al catálogo</a></section>';
    (document.body || document.documentElement).appendChild(capa);
  }

  window.PampaTrialGuard = {
    appId: APP_ID,
    dispositivo: dispositivo,
    estado: function () { return consultar(false); },
    registrar: function (desde) { return consultar(true, desde); },
    mostrarAgotado: mostrarAgotado,
    // Compatibilidad: true solo si el servidor confirma que la prueba ya venció.
    consultarTrialServidor: function () { return consultar(false).then(function (e) { return e.disponible && e.agotado; }); },
    registrarTrialIP: function () { consultar(true); },
  };
})();
