/*
 * Sincronizacion con el Google Drive del cliente - PampaAgro ERP.
 *
 * El CLIENT_ID es publico por diseño: la seguridad la da el login del usuario.
 * Scope drive.file: la app SOLO ve los archivos que ella misma creo, no el resto del Drive.
 */
(function (global) {
  'use strict';

  var CLIENT_ID = '306258427763-5b6p97s7mjvq5juv1eiaog8l8agmm9ro.apps.googleusercontent.com';
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var TOKEN_KEY = 'nexoAgroDriveToken';

  var tokenClient = null;
  var accessToken = null;
  var expiraEn = 0;

  function ahora() {
    return Date.now();
  }

  function guardarToken(token, expiresInSegundos) {
    accessToken = token;
    // Se descuenta un minuto para no usar un token a punto de vencer.
    expiraEn = ahora() + (Number(expiresInSegundos || 3600) - 60) * 1000;
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: accessToken, expiraEn: expiraEn }));
    } catch (e) { /* sin almacenamiento disponible */ }
  }

  function recuperarToken() {
    if (accessToken && ahora() < expiraEn) return accessToken;
    try {
      var guardado = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if (guardado && guardado.token && ahora() < guardado.expiraEn) {
        accessToken = guardado.token;
        expiraEn = guardado.expiraEn;
        return accessToken;
      }
    } catch (e) { /* dato corrupto */ }
    return null;
  }

  function olvidarToken() {
    accessToken = null;
    expiraEn = 0;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignorado */ }
  }

  // El login de Google requiere origen http/https: no funciona con file:// (Electron).
  function estaDisponible() {
    var protocoloOk = window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    return protocoloOk && Boolean(global.google && global.google.accounts && global.google.accounts.oauth2);
  }

  function motivoNoDisponible() {
    if (window.location.protocol === 'file:') {
      return 'La versión de escritorio usa la carpeta sincronizada en lugar de conectarse a Drive.';
    }
    if (!global.google || !global.google.accounts) {
      return 'No se pudo cargar el conector de Google. Revisá la conexión a internet.';
    }
    return 'Google Drive requiere una conexión segura (https).';
  }

  function estaConectado() {
    return Boolean(recuperarToken());
  }

  function pedirToken(forzarConsentimiento) {
    return new Promise(function (resolve, reject) {
      if (!estaDisponible()) {
        reject(new Error(motivoNoDisponible()));
        return;
      }

      if (!tokenClient) {
        tokenClient = global.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPE,
          callback: function () { /* se reemplaza en cada pedido */ }
        });
      }

      tokenClient.callback = function (respuesta) {
        if (respuesta.error) {
          reject(new Error(respuesta.error_description || respuesta.error));
          return;
        }
        guardarToken(respuesta.access_token, respuesta.expires_in);
        resolve(accessToken);
      };

      tokenClient.requestAccessToken({ prompt: forzarConsentimiento ? 'consent' : '' });
    });
  }

  async function obtenerToken() {
    var vigente = recuperarToken();
    if (vigente) return vigente;
    return pedirToken(false);
  }

  async function pedirDrive(url, opciones) {
    var token = await obtenerToken();
    var config = opciones || {};
    config.headers = Object.assign({ Authorization: 'Bearer ' + token }, config.headers || {});

    var res = await fetch(url, config);

    // Token vencido o revocado: se pide de nuevo una sola vez.
    if (res.status === 401) {
      olvidarToken();
      token = await pedirToken(false);
      config.headers.Authorization = 'Bearer ' + token;
      res = await fetch(url, config);
    }

    if (!res.ok) {
      var detalle = await res.text().catch(function () { return ''; });
      throw new Error('Google Drive respondió ' + res.status + '. ' + detalle.slice(0, 200));
    }

    return res;
  }

  async function conectar() {
    await pedirToken(!estaConectado());
    return true;
  }

  function desconectar() {
    var token = recuperarToken();
    if (token && global.google && global.google.accounts && global.google.accounts.oauth2) {
      try { global.google.accounts.oauth2.revoke(token); } catch (e) { /* ya revocado */ }
    }
    olvidarToken();
  }

  async function buscarArchivo(nombre) {
    var query = encodeURIComponent("name='" + nombre.replace(/'/g, "\\'") + "' and trashed=false");
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + query +
      '&spaces=drive&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=1';

    var res = await pedirDrive(url);
    var data = await res.json();
    return (data.files && data.files[0]) || null;
  }

  async function subirRespaldo(nombre, contenido) {
    var existente = await buscarArchivo(nombre);
    var limite = '-------pampaagro' + Date.now();
    var metadata = existente ? { name: nombre } : { name: nombre, mimeType: 'application/json' };

    var cuerpo =
      '--' + limite + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + limite + '\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      contenido + '\r\n' +
      '--' + limite + '--';

    var url = existente
      ? 'https://www.googleapis.com/upload/drive/v3/files/' + existente.id + '?uploadType=multipart&fields=id,name,modifiedTime'
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime';

    var res = await pedirDrive(url, {
      method: existente ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + limite },
      body: cuerpo
    });

    return res.json();
  }

  async function bajarRespaldo(nombre) {
    var archivo = await buscarArchivo(nombre);
    if (!archivo) return null;

    var res = await pedirDrive('https://www.googleapis.com/drive/v3/files/' + archivo.id + '?alt=media');
    return {
      fileName: archivo.name,
      modificadoEn: archivo.modifiedTime,
      content: await res.text()
    };
  }

  global.PampaDrive = {
    CLIENT_ID: CLIENT_ID,
    estaDisponible: estaDisponible,
    motivoNoDisponible: motivoNoDisponible,
    estaConectado: estaConectado,
    conectar: conectar,
    desconectar: desconectar,
    buscarArchivo: buscarArchivo,
    subirRespaldo: subirRespaldo,
    bajarRespaldo: bajarRespaldo
  };
}(typeof globalThis !== 'undefined' ? globalThis : window));
