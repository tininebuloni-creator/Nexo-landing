(function () {
  const params = new URLSearchParams(window.location.search);
  const cacheKey = 'pampa-license-cache';
  const syncKey = 'pampa-license-sync-time';
  const consumedKey = 'pampa-trial-consumed';
  const current = (() => {
    try { return JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch { return null; }
  })();
  const currentExpiry = current?.license?.expiresAt ? new Date(current.license.expiresAt).getTime() : 0;

  if ((!currentExpiry || currentExpiry <= Date.now()) && !localStorage.getItem(consumedKey)) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(cacheKey, JSON.stringify({
      valid: true,
      offline: true,
      license: { valid: true, type: 'trial', plan: 'trial', name: 'Trial', expiresAt }
    }));
    localStorage.setItem(syncKey, now.toISOString());
    localStorage.setItem(consumedKey, '1');
  }

  if (params.get('trial') === 'auto') {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
  }

  function showBanner() {
    if (document.getElementById('trialBlueBanner')) return;
    let license;
    try { license = JSON.parse(localStorage.getItem(cacheKey) || '{}').license; } catch { return; }
    const expiry = new Date(license?.expiresAt || '').getTime();
    const remaining = Math.max(0, Math.ceil((expiry - Date.now()) / 86400000));
    if (license?.type !== 'trial' || !remaining) return;
    const banner = document.createElement('div');
    banner.id = 'trialBlueBanner';
    banner.setAttribute('role', 'status');
    banner.textContent = `Prueba gratuita activa: quedan ${remaining} día(s).`;
    banner.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100000;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;box-shadow:0 6px 20px rgba(15,23,42,.25);font:600 14px Arial,sans-serif;max-width:calc(100vw - 32px);text-align:center;';
    document.body.appendChild(banner);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
  else showBanner();
}());
