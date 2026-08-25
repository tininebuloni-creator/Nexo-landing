(function (global) {
  const config = {
    baseUrl: 'https://solucioneseningenieria.com.ar',
    apps: {
      pampaagro: '/pampaagro-erp/public/?trial=auto',
      pampaganaderia: '/pampaganaderia-erp/?trial=auto',
      pampaprecision: '/pampaprecision-erp/public/?trial=auto',
      pampatambo: '/pampatambo-erp/public/?trial=auto',
      pampaporcinos: '/pampaporcinos-erp/?trial=auto'
    }
  };
  function getTrialLandingUrl(app) {
    const path = config.apps[String(app || '').toLowerCase()];
    return path ? config.baseUrl + path : '';
  }
  function openTrialWhatsApp(app, label) {
    const link = getTrialLandingUrl(app);
    if (!link) return false;
    const message = `Hola. Te comparto el acceso de prueba de ${label || app} (${10} días):\n${link}`;
    global.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
    return true;
  }
  function showTrialBanner() {
    if (document.getElementById('trialBlueBanner')) return;
    const raw = localStorage.getItem('nexoAgroLicense') || localStorage.getItem('tambo_license') || localStorage.getItem('PampaPorcinosLicense');
    if (!raw) return;
    try {
      const license = JSON.parse(raw);
      if (license.type !== 'trial' && !license.payload?.trial) return;
      const expiration = license.expiresAt || license.payload?.exp;
      const remaining = Math.max(0, Math.ceil((new Date(expiration).getTime() - Date.now()) / 86400000));
      if (!remaining) return;
      const banner = document.createElement('div');
      banner.id = 'trialBlueBanner';
      banner.setAttribute('role', 'status');
      banner.textContent = `Prueba gratuita activa: quedan ${remaining} día(s).`;
      banner.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100000;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;box-shadow:0 6px 20px rgba(15,23,42,.25);font:600 14px Arial,sans-serif;max-width:calc(100vw - 32px);text-align:center;';
      document.body.appendChild(banner);
    } catch {}
  }
  function showTrialPrivacyNotice() {
    const keys = ['nexoAgroLicense', 'tambo_license', 'PampaPorcinosLicense', 'pampa-license-cache'];
    const activeTrial = keys.some((key) => {
      try {
        const stored = JSON.parse(localStorage.getItem(key) || 'null');
        const license = stored?.license || stored;
        const expiration = license?.expiresAt || license?.payload?.exp;
        return (license?.type === 'trial' || license?.payload?.trial) && new Date(expiration).getTime() > Date.now();
      } catch { return false; }
    });
    if (!activeTrial || document.getElementById('trialPrivacyNotice')) return;
    const dialog = document.createElement('div');
    dialog.id = 'trialPrivacyNotice';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'trialPrivacyNoticeTitle');
    dialog.style.cssText = 'position:fixed;inset:0;z-index:100001;display:grid;place-items:center;padding:20px;background:rgba(15,20,25,.78);font-family:Arial,sans-serif;';
    dialog.innerHTML = '<section style="width:min(460px,100%);border:1px solid #f59e0b;border-radius:8px;background:#1e2433;color:#f1f5f9;padding:28px;box-shadow:0 24px 70px rgba(0,0,0,.45)"><p style="margin:0 0 10px;color:#f59e0b;font-size:12px;font-weight:700;letter-spacing:1px">TRIAL DE PRUEBA</p><h2 id="trialPrivacyNoticeTitle" style="margin:0 0 14px;font-size:24px;line-height:1.2">Tus datos permanecen en tu entorno</h2><p style="margin:0;color:#cbd5e1;font-size:16px;line-height:1.55">Los datos cargados en este trial son de prueba y volátiles. Tus datos nunca salen de tu campo.</p><button type="button" style="margin-top:22px;border:0;border-radius:6px;background:#f59e0b;color:#172127;padding:11px 18px;font-size:14px;font-weight:700;cursor:pointer">Entendido</button></section>';
    const close = () => dialog.remove();
    dialog.querySelector('button').addEventListener('click', close);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    document.body.appendChild(dialog);
    dialog.querySelector('button').focus();
  }
  global.PampaTrialLinks = { config, getTrialLandingUrl, openTrialWhatsApp, showTrialBanner };
  document.addEventListener('DOMContentLoaded', showTrialBanner);
  document.addEventListener('DOMContentLoaded', showTrialPrivacyNotice);
  setTimeout(showTrialBanner, 1200);
  setTimeout(showTrialPrivacyNotice, 1200);
}(window));
