/* Pampa PBP - control de la prueba gratuita web (10 días).
 * El vencimiento lo recuerda la landing (pampa-trial-guard.js → /api/pampa-trial-status), igual que en las
 * otras apps del ecosistema; si no responde, manda un control local en este navegador.
 */
(function () {
  'use strict';
  var DIAS = 10, INICIO = 'pampa_trial_init:pbp', AGOTADO = 'pampa_trial_exhausted_pbp';
  function local() {
    var inicio = localStorage.getItem(INICIO);
    if (!inicio) { inicio = new Date().toISOString(); localStorage.setItem(INICIO, inicio); }
    var restantes = Math.ceil((new Date(inicio).getTime() + DIAS * 86400000 - Date.now()) / 86400000);
    return { disponible: false, agotado: restantes <= 0 || localStorage.getItem(AGOTADO) === '1', diasRestantes: Math.max(0, restantes) };
  }
  function estado() {
    var guard = window.PampaTrialGuard;
    if (!guard || typeof guard.registrar !== 'function') return Promise.resolve(local());
    var desde = localStorage.getItem(INICIO) || undefined;
    return Promise.race([guard.registrar(desde).catch(function () { return { disponible: false }; }), new Promise(function (r) { setTimeout(function () { r({ disponible: false }); }, 6000); })])
      .then(function (st) { return st && st.disponible ? st : local(); });
  }
  function banner(dias) {
    var b = document.createElement('div');
    b.id = 'pbpTrialBanner';
    b.setAttribute('role', 'status');
    b.innerHTML = '<b>Prueba gratuita de Pampa PBP</b> · quedan ' + dias + ' día' + (dias === 1 ? '' : 's') + ' · datos de demostración guardados en este navegador · <button type="button" id="pbpTrialReset">Reiniciar datos</button> <button type="button" id="pbpTrialClose" aria-label="Ocultar">×</button>';
    b.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:100000;background:#2563eb;color:#fff;padding:9px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(15,23,42,.35);font:500 13px Arial,sans-serif;max-width:calc(100vw - 32px);text-align:center';
    document.body.appendChild(b);
    b.querySelectorAll('button').forEach(function (btn) { btn.style.cssText = 'background:rgba(255,255,255,.18);color:#fff;border:0;border-radius:5px;padding:3px 8px;margin-left:4px;cursor:pointer;font:inherit;width:auto'; });
    document.getElementById('pbpTrialReset').addEventListener('click', function () {
      if (confirm('¿Volver a los datos de demostración? Se pierde lo cargado en esta prueba.')) window.PBP_WEB_TRIAL.reset();
    });
    document.getElementById('pbpTrialClose').addEventListener('click', function () { b.remove(); });
  }
  document.addEventListener('DOMContentLoaded', function () {
    estado().then(function (st) {
      if (st.agotado) {
        try { localStorage.setItem(AGOTADO, '1'); } catch (e) {}
        if (window.PampaTrialGuard && window.PampaTrialGuard.mostrarAgotado) return window.PampaTrialGuard.mostrarAgotado();
        document.body.innerHTML = '<main style="max-width:520px;margin:15vh auto;padding:24px;font:16px Arial,sans-serif;color:#e2e8f0;text-align:center"><h1>Prueba gratuita finalizada</h1><p>La prueba de 10 días de Pampa PBP terminó en este dispositivo.</p><p><a href="/" style="color:#fbbf24">Volver al catálogo</a></p></main>';
        return;
      }
      banner(st.diasRestantes == null ? DIAS : st.diasRestantes);
    });
  });
}());
