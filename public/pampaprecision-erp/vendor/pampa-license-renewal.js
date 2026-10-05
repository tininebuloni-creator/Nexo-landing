/* browser-license-renewal.js — Aviso de vencimiento y renovación de licencias (sin internet).
 *
 * - Desde AVISO_DIAS días antes del vencimiento: cartel una vez por día (no bloquea).
 * - Vencida: pantalla que bloquea hasta cargar la licencia renovada.
 * En los dos casos muestra el "código de estado" (primeras 8 letras del licenseId + vencimiento) con un
 * botón para mandarlo por WhatsApp, y un campo para pegar el código de renovación.
 *
 * El código de renovación es una licencia firmada nueva (mismo licenseId, nuevo vencimiento) que se
 * genera con:  npm run licencia:renovar -- --id <código de estado> --dias 30
 * Se aplica con la activación propia de cada app (la verifica y la guarda como cualquier licencia), así
 * que no se puede inventar y no depende de ningún servidor.
 *
 * window.PampaLicenseRenewal: { estado(), revisar(), aplicar(codigo) }
 */
(function (global) {
  'use strict';

  var AVISO_DIAS = 5;
  var WHATSAPP = '5492364719731';
  var CLAVES = ['nexoAgroLicense', 'PampaPorcinosLicense', 'tambo_license', 'pampa-license-cache', 'PampaPrecisionLicense'];
  // Activación propia de cada app: campo donde se pega la licencia y cómo se dispara.
  var ACTIVACIONES = [
    { campo: 'activationKey', activar: function () { return global.activateLicense && global.activateLicense(); } },          // Agro, Ganadería
    { campo: 'licenseInput', activar: function () { return global.activateLicenseFromInput && global.activateLicenseFromInput(); } }, // Tambo
    { campo: 'licenseActivationKey', activar: function () { var f = document.getElementById('licenseActivationForm'); if (f) f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); } }, // Porcinos
    { campo: 'precisionLicenseTokenInput', activar: function () { var b = document.getElementById('btnActivatePrecisionLicense'); if (b) b.click(); } }, // Precisión
  ];
  var CONOCIDA = 'pampaLicenciaConocida';
  var NOMBRES = { 'pampa-agro': 'PampaAgro', 'pampa-ganaderia': 'PampaGanadería', 'pampa-tambo': 'PampaTambo', 'pampa-porcinos': 'PampaPorcinos', 'pampa-precision': 'PampaPrecisión' };
  var ERRORES = ['activationError', 'licenseActivationMsg', 'licenseActivationError', 'precisionLicenseTokenError'];

  function leer(clave) { try { return JSON.parse(global.localStorage.getItem(clave) || 'null'); } catch (e) { return null; } }
  function decodificarToken(token) {
    var partes = String(token || '').split('.');
    if (partes.length !== 3 || partes[0] !== 'PAMPAN1') return null;
    try {
      var b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(decodeURIComponent(escape(global.atob(b64))));
    } catch (e) { return null; }
  }
  function esPrueba(r) { return !r || r.type === 'trial' || r.trial === true || r.plan === 'trial' || /^TRIAL|^NEXO-MTRI/i.test(String(r.key || '')) || (r.payload && r.payload.trial); }

  // Licencia firmada activa: licenseId, cliente, producto y vencimiento (del registro o del token).
  function licenciaActual() {
    var claves = global.PAMPA_LICENSE_STORAGE_KEY ? [global.PAMPA_LICENSE_STORAGE_KEY].concat(CLAVES) : CLAVES;
    for (var i = 0; i < claves.length; i++) {
      var r = leer(claves[i]);
      if (!r || esPrueba(r)) continue;
      var token = r.token || r.key || (r.payload && r.raw) || '';
      var p = decodificarToken(token) || {};
      var vence = r.expiresAt || (r.payload && (r.payload.expiresAt || r.payload.exp)) || p.expiresAt;
      var id = r.licenseId || (r.payload && r.payload.licenseId) || p.licenseId;
      if (!vence || !id) continue;
      var lic = { clave: claves[i], licenseId: String(id), cliente: r.customer || p.customer || '', producto: r.product || p.product || '', vence: String(vence).slice(0, 10) };
      try { global.localStorage.setItem(CONOCIDA, JSON.stringify(lic)); } catch (e) {}
      return lic;
    }
    // Algunas apps borran la licencia al vencer: se usan los datos de la última conocida para seguir
    // mostrando el código de estado (solo si ya venció; si la desactivaron vigente no se avisa).
    var conocida = leer(CONOCIDA);
    if (conocida && conocida.licenseId && conocida.vence && diasHasta(conocida.vence) < 0) return conocida;
    return null;
  }

  function diasHasta(fecha) {
    var p = String(fecha).split('-');
    var fin = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return Math.round((fin - hoy) / 86400000);
  }
  function fechaAr(f) { var p = String(f).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  function estado() {
    var lic = licenciaActual();
    if (!lic) return null;
    var dias = diasHasta(lic.vence);
    return Object.assign(lic, { dias: dias, vencida: dias < 0, porVencer: dias >= 0 && dias <= AVISO_DIAS, codigo: lic.licenseId.slice(0, 8).toUpperCase() + '-' + lic.vence.replace(/-/g, '') });
  }

  function linkWhatsApp(e) {
    var texto = 'Hola, quiero renovar mi licencia' + (NOMBRES[e.producto] ? ' de ' + NOMBRES[e.producto] : '') + (e.cliente ? ' (' + e.cliente + ')' : '') + '. Código de estado: ' + e.codigo + ' (vence el ' + fechaAr(e.vence) + ').';
    return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(texto);
  }

  function estilos() {
    if (document.getElementById('pampaRenovacionEstilos')) return;
    var s = document.createElement('style');
    s.id = 'pampaRenovacionEstilos';
    s.textContent = '#pampaRenovacion{position:fixed;z-index:2147483000;font:14px Arial,sans-serif}#pampaRenovacion.bloqueo{inset:0;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.88)}#pampaRenovacion.aviso{left:50%;top:14px;transform:translateX(-50%);width:min(560px,calc(100vw - 24px))}#pampaRenovacion section{background:#fff;color:#172033;border-radius:10px;padding:18px 20px;box-shadow:0 18px 48px rgba(0,0,0,.35);max-width:560px}#pampaRenovacion h2{margin:0 0 8px;font-size:18px}#pampaRenovacion p{margin:6px 0;line-height:1.45}#pampaRenovacion code{display:inline-block;padding:3px 8px;border-radius:5px;background:#eef2f7;font:600 15px monospace;letter-spacing:.5px}#pampaRenovacion textarea{width:100%;box-sizing:border-box;min-height:64px;margin-top:8px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;font:12px monospace}#pampaRenovacion .botones{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}#pampaRenovacion button,#pampaRenovacion a.b{padding:9px 13px;border:0;border-radius:6px;font-weight:700;cursor:pointer;text-decoration:none;font-size:13px}#pampaRenovacion .wa{background:#16a34a;color:#fff}#pampaRenovacion .ok{background:#2563eb;color:#fff}#pampaRenovacion .x{background:#e2e8f0;color:#172033}#pampaRenovacion .msg{font-size:12px;color:#b91c1c;min-height:16px}';
    document.head.appendChild(s);
  }

  function cerrar() { var el = document.getElementById('pampaRenovacion'); if (el) el.remove(); }

  function mostrar(e) {
    if (!document.body) return;
    estilos();
    cerrar();
    var caja = document.createElement('div');
    caja.id = 'pampaRenovacion';
    caja.className = e.vencida ? 'bloqueo' : 'aviso';
    var titulo = e.vencida ? 'Licencia vencida' : (e.dias === 0 ? 'Tu licencia vence hoy' : 'Tu licencia vence en ' + e.dias + ' día' + (e.dias === 1 ? '' : 's'));
    var texto = e.vencida
      ? 'Venció el ' + fechaAr(e.vence) + '. Para seguir usando el sistema, mandá este código de estado a tu proveedor y pegá abajo el código de renovación que te devuelve.'
      : 'Vence el ' + fechaAr(e.vence) + '. Podés seguir usando el sistema con normalidad hasta ese día. Para renovar, mandá este código de estado a tu proveedor.';
    caja.innerHTML = '<section role="dialog" aria-modal="' + (e.vencida ? 'true' : 'false') + '"><h2></h2><p class="t"></p><p>Código de estado: <code></code></p>' +
      '<div class="botones"><a class="b wa" target="_blank" rel="noopener">Enviar por WhatsApp</a>' + (e.vencida ? '' : '<button type="button" class="x" data-cerrar>Recordármelo mañana</button>') + '</div>' +
      '<p style="margin-top:12px">¿Ya tenés el código de renovación? Pegalo acá:</p><textarea spellcheck="false" placeholder="PAMPAN1...."></textarea><div class="msg"></div>' +
      '<div class="botones"><button type="button" class="ok" data-aplicar>Aplicar renovación</button></div></section>';
    caja.querySelector('h2').textContent = titulo;
    caja.querySelector('.t').textContent = texto;
    caja.querySelector('code').textContent = e.codigo;
    caja.querySelector('a.wa').href = linkWhatsApp(e);
    var cerrarBtn = caja.querySelector('[data-cerrar]');
    if (cerrarBtn) cerrarBtn.addEventListener('click', function () { try { global.localStorage.setItem('pampaAvisoVencimiento:' + e.licenseId, hoyIso()); } catch (x) {} cerrar(); });
    caja.querySelector('[data-aplicar]').addEventListener('click', function () {
      var msg = caja.querySelector('.msg');
      msg.style.color = '#475569'; msg.textContent = 'Verificando…';
      aplicar(caja.querySelector('textarea').value).then(function (r) {
        if (r.ok) { cerrar(); if (typeof global.showToast === 'function') global.showToast('Licencia renovada hasta el ' + fechaAr(r.vence), 'success'); else global.alert('Licencia renovada hasta el ' + fechaAr(r.vence) + '.'); }
        else { msg.style.color = '#b91c1c'; msg.textContent = r.error; }
      });
    });
    document.body.appendChild(caja);
  }

  function hoyIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // Aplica el código de renovación con la activación propia de la app y confirma que se guardó.
  function aplicar(codigo) {
    var token = String(codigo || '').replace(/\s+/g, '');
    var actual = estado();
    var p = decodificarToken(token);
    if (!p) return Promise.resolve({ ok: false, error: 'El código no es una licencia válida: copialo completo, empieza con PAMPAN1.' });
    if (actual && p.licenseId !== actual.licenseId) return Promise.resolve({ ok: false, error: 'Ese código es de otra licencia. Pedile a tu proveedor el de esta (código de estado ' + actual.codigo + ').' });
    if (actual && p.expiresAt && p.expiresAt <= actual.vence) return Promise.resolve({ ok: false, error: 'Ese código no extiende el vencimiento actual (' + fechaAr(actual.vence) + ').' });
    var act = null;
    for (var i = 0; i < ACTIVACIONES.length; i++) if (document.getElementById(ACTIVACIONES[i].campo)) { act = ACTIVACIONES[i]; break; }
    if (!act) return Promise.resolve({ ok: false, error: 'No se encontró la pantalla de activación de la app. Pegalo en Activar licencia.' });
    ERRORES.forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = ''; });
    var campo = document.getElementById(act.campo);
    campo.value = token;
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    return Promise.resolve().then(act.activar).catch(function () {}).then(function () {
      return new Promise(function (ok) {
        var intentos = 0;
        (function esperar() {
          var e = estado();
          if (e && e.licenseId === p.licenseId && e.vence >= String(p.expiresAt || '')) return ok({ ok: true, vence: e.vence });
          if (++intentos > 40) {
            var error = ERRORES.map(function (id) { var el = document.getElementById(id); return el && el.textContent.trim(); }).filter(Boolean)[0];
            return ok({ ok: false, error: error || 'La app no aceptó el código. Verificá que esté completo o pegalo en Activar licencia.' });
          }
          setTimeout(esperar, 150);
        })();
      });
    });
  }

  function revisar() {
    var e = estado();
    if (!e) return null;
    if (e.vencida) mostrar(e);
    else if (e.porVencer) {
      var visto = null;
      try { visto = global.localStorage.getItem('pampaAvisoVencimiento:' + e.licenseId); } catch (x) {}
      if (visto !== hoyIso()) mostrar(e);
    }
    return e;
  }

  global.PampaLicenseRenewal = { estado: estado, revisar: revisar, aplicar: aplicar, AVISO_DIAS: AVISO_DIAS };
  // Solo en las apps de escritorio: en la web no hay licencias (solo la prueba gratis). Se decide al cargar
  // la página, porque cada app marca PAMPA_DESKTOP_MODE en scripts que pueden venir después de este.
  function escritorio() { return Boolean(global.PAMPA_DESKTOP_MODE || global.electronAPI || /\bElectron\//.test(global.navigator && global.navigator.userAgent || '') || global.location.protocol === 'file:'); }
  function iniciar() {
    if (!escritorio()) return;
    setTimeout(revisar, 2500);
    setInterval(revisar, 6 * 60 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  else iniciar();
}(typeof window !== 'undefined' ? window : globalThis));
