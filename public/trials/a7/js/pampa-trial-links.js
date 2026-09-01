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
  global.PampaTrialLinks = { config, getTrialLandingUrl, openTrialWhatsApp, showTrialBanner };
  document.addEventListener('DOMContentLoaded', showTrialBanner);
  setTimeout(showTrialBanner, 1200);
}(window));
