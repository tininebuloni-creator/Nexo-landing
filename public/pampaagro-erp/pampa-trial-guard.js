// browser-trial-guard.js — CANÓNICO del lado navegador para el guard de trial por IP.
//
// Lo distribuye scripts/sync-trial-guard.js a apps/<app>/public/pampa-trial-guard.js.
// Se carga con <script src="pampa-trial-guard.js"></script> en el <head>, ANTES del
// script inline que define activateTrial() / maybeAutoActivateTrialFromQuery().
//
// Expone window.PampaTrialGuard:
//   consultarTrialServidor() -> Promise<boolean>  true = agotado / no verificable (fail-closed)
//   registrarTrialIP()       -> void               fire-and-forget; registra la IP al activar
//
// Consumo típico en los index.html de las apps:
//   if (window.PampaTrialGuard && (await window.PampaTrialGuard.consultarTrialServidor())) {
//     showToast('La prueba gratuita ya venció en este equipo', 'error');
//     return;
//   }
//   // ... activar el trial local ...
//   if (window.PampaTrialGuard) window.PampaTrialGuard.registrarTrialIP();
//
// Si el archivo no llegara a cargar (deploy parcial), window.PampaTrialGuard es
// undefined y la app degrada al comportamiento original sin bloquear la activación.
(function () {
  'use strict';
  var ENDPOINT = '/api/pampa-trial-status';

  function consultarTrialServidor() {
    return fetch(ENDPOINT, { method: 'GET', cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) return true; // el endpoint no respondió bien: fail-closed
        return res.json();
      })
      .then(function (data) {
        return !!(data && data.trialExhausted === true);
      })
      .catch(function () {
        // Sin red o servidor inaccesible: no arriesgar una reactivación indebida.
        return true;
      });
  }

  function registrarTrialIP() {
    try {
      fetch(ENDPOINT + '?pampa_trial=1', { method: 'GET', cache: 'no-store' }).catch(function () {});
    } catch (e) { /* noop */ }
  }

  window.PampaTrialGuard = {
    consultarTrialServidor: consultarTrialServidor,
    registrarTrialIP: registrarTrialIP
  };
})();
