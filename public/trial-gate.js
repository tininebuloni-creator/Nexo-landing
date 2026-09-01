(function () {
  'use strict';

  var match = location.pathname.match(/^\/(?:t|trials)\/([a-z0-9]+)\//i);
  var code = match ? match[1].toLowerCase() : '';
  var isLanding = !code && (location.pathname === '/' || /\/index\.html$/i.test(location.pathname));

  function dialog(id, title, text, buttons) {
    if (document.getElementById(id)) return;
    var overlay = document.createElement('div');
    overlay.id = id;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.78);font:16px Arial,sans-serif';
    overlay.innerHTML = '<section style="max-width:480px;background:#fff;color:#172033;border-radius:10px;padding:24px;box-shadow:0 18px 48px rgba(0,0,0,.4)"><h2 style="margin:0 0 12px;font-size:22px">' + title + '</h2><p style="margin:0;line-height:1.5">' + text + '</p><p style="font-size:13px;line-height:1.45;color:#475569">Consultá la <a href="/privacidad.html" target="_blank" rel="noopener" style="color:#1d4ed8">Política de Privacidad</a>.</p><div id="' + id + '-actions" style="display:flex;gap:10px;flex-wrap:wrap"></div></section>';
    document.body.appendChild(overlay);
    var actions = overlay.querySelector('#' + id + '-actions');
    buttons.forEach(function (button) {
      var control = document.createElement(button.href ? 'a' : 'button');
      control.textContent = button.label;
      if (button.href) control.href = button.href;
      else control.type = 'button';
      control.style.cssText = 'padding:10px 14px;border:' + (button.primary ? '0' : '1px solid #94a3b8') + ';border-radius:6px;background:' + (button.primary ? '#2563eb' : '#fff') + ';color:' + (button.primary ? '#fff' : '#172033') + ';font-weight:' + (button.primary ? '700' : '400') + ';text-decoration:none;cursor:pointer';
      if (button.onClick) control.addEventListener('click', button.onClick);
      actions.appendChild(control);
    });
  }

  function beginTrial(trialCode) {
    var consentKey = 'pampaWebTrialConsent:' + trialCode;
    var trialKey = 'pampaWebTrial:' + trialCode;
    var now = Date.now();
    if (localStorage.getItem(consentKey) !== 'accepted') {
      dialog('pampaTrialConsent', 'Prueba gratuita de 10 días', 'Para iniciar la prueba necesitás aceptar el tratamiento local de los datos que cargues. El período no comienza hasta aceptar.', [
        { label: 'Aceptar e iniciar prueba', primary: true, onClick: function () { localStorage.setItem(consentKey, 'accepted'); location.href = location.pathname + '?trial=auto'; } },
        { label: 'Volver al catálogo', onClick: function () { location.href = '/'; } }
      ]);
      return;
    }

    var trial;
    try { trial = JSON.parse(localStorage.getItem(trialKey) || 'null'); } catch (error) { trial = null; }
    if (!trial) {
      trial = { startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 10 * 86400000).toISOString() };
      localStorage.setItem(trialKey, JSON.stringify(trial));
    }
    var remaining = Math.ceil((new Date(trial.expiresAt).getTime() - now) / 86400000);
    if (remaining <= 0) {
      dialog('pampaTrialExpired', 'Prueba finalizada', 'La prueba gratuita de 10 días terminó para este dispositivo. Los datos locales no se eliminan por esta pantalla.', [{ label: 'Volver al catálogo', href: '/' }]);
      return;
    }
    document.addEventListener('DOMContentLoaded', function () {
      if (document.getElementById('trialBlueBanner')) return;
      var banner = document.createElement('div');
      banner.id = 'trialBlueBanner';
      banner.setAttribute('role', 'status');
      banner.textContent = 'Prueba gratuita activa: quedan ' + remaining + ' día(s).';
      banner.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100000;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;box-shadow:0 6px 20px rgba(15,23,42,.25);font:600 14px Arial,sans-serif;max-width:calc(100vw - 32px);text-align:center';
      document.body.appendChild(banner);
    });
  }

  function bindLandingLinks() {
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[href^="/t/"]');
      if (!link) return;
      event.preventDefault();
      var trialMatch = link.getAttribute('href').match(/^\/t\/([a-z0-9]+)\/?$/i);
      if (!trialMatch) return;
      var trialCode = trialMatch[1].toLowerCase();
      dialog('pampaLandingTrialConsent', 'Prueba gratuita de 10 días', 'La aplicación se abrirá en modo de prueba. Los datos que cargues durante la prueba se guardan localmente en este dispositivo.', [
        { label: 'Aceptar y ver aplicación', primary: true, onClick: function () { localStorage.setItem('pampaWebTrialConsent:' + trialCode, 'accepted'); location.href = link.getAttribute('href') + '?trial=auto'; } },
        { label: 'Cancelar', onClick: function () { document.getElementById('pampaLandingTrialConsent').remove(); } }
      ]);
    });
  }

  if (isLanding) document.addEventListener('DOMContentLoaded', bindLandingLinks);
  if (code) beginTrial(code);
}());