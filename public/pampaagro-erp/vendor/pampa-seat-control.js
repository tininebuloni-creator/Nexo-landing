(function (global) {
  'use strict';

  const GRACE_MS = 72 * 60 * 60 * 1000;
  // Licencias locales: la firma y el vencimiento de la licencia se verifican en el equipo, sin consultar
// ningún servidor por internet (no pasan por Cloudflare).
  // Para volver a usar un servidor de cupos propio, poner su URL acá.
  const API_URL = '';
  const product = document.currentScript?.dataset?.product || '';
  const storageKey = `pampaSeatControl:${product}`;
  const licenseKeys = (window.PAMPA_LICENSE_STORAGE_KEY ? [window.PAMPA_LICENSE_STORAGE_KEY] : ['nexoAgroLicense', 'PampaPorcinosLicense', 'tambo_license', 'pampa-license-cache']);

  // Solo bloquea un rechazo explícito del servidor de cupos (JSON con ok:false y 403/409/429). Sin conexión,
  // sin servidor o con una respuesta que no es suya (404, desafío de Cloudflare, error 5xx) la licencia
  // firmada sigue funcionando: antes cualquier falla mostraba "No quedan cupos disponibles".
  function rechazoExplicito(response, body) { return Boolean(body && body.ok === false && [403, 409, 429].includes(response.status)); }
  function readLicense() {
    for (const key of licenseKeys) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || 'null');
        if (value?.key && value.type !== 'trial') return value;
      } catch {}
    }
    return null;
  }

  function getDeviceId() {
    const key = `pampaDeviceId:${product}`;
    const license = readLicense();
    if (license?.deviceId) {
      localStorage.setItem(key, license.deviceId);
      return license.deviceId;
    }
    let id = localStorage.getItem(key);
    if (!id) {
      id = global.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  function readState() {
    try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
  }

  function saveState(value) {
    localStorage.setItem(storageKey, JSON.stringify(value));
  }

  function showBlocked(message) {
    if (document.getElementById('pampaSeatBlocked')) return;
    const overlay = document.createElement('div');
    overlay.id = 'pampaSeatBlocked';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.82);font:15px Arial,sans-serif';
    overlay.innerHTML = `<section style="max-width:480px;background:#fff;color:#172033;border-radius:10px;padding:24px;box-shadow:0 18px 48px rgba(0,0,0,.4)"><h2 style="margin:0 0 12px">Cupo de licencia no disponible</h2><p style="line-height:1.5">${message}</p><p style="font-size:12px;color:#475569;line-height:1.45">Liberá otro usuario/dispositivo o solicitá una ampliación de cupo.</p><button type="button" style="padding:10px 14px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer" onclick="location.reload()">Reintentar</button></section>`;
    document.body.appendChild(overlay);
  }

  async function activate(license, deviceId) {
    const response = await fetch(`${API_URL}/v1/client/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: license.key, product, deviceId }) });
    const body = await response.json().catch(() => null);
    if (rechazoExplicito(response, body)) throw Object.assign(new Error(body.message || body.error || 'No quedan cupos disponibles.'), { rechazo: true });
    if (!response.ok || !body || body.ok === false) return { ok: true, offline: true };
    return body;
  }

  async function authorize(license, deviceId) {
    const url = new URL(`${API_URL}/v1/client/authorization`);
    url.searchParams.set('licenseId', license.licenseId || '');
    url.searchParams.set('deviceId', deviceId);
    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    if (rechazoExplicito(response, body)) throw Object.assign(new Error(body.message || body.error || 'Dispositivo no autorizado.'), { rechazo: true });
    if (!response.ok || !body || body.ok === false) return { ok: true, offline: true };
    return body;
  }

  async function release() { if (!API_URL) return;
    const license = readLicense();
    const state = readState();
    if (!license || !state.deviceId) return;
    fetch(`${API_URL}/v1/client/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: license.key, product, deviceId: state.deviceId }) }).catch(() => {});
    localStorage.removeItem(storageKey);
  }

  async function enforce() { if (!API_URL) return { ok: true, local: true };
    const license = readLicense();
    if (!license || !license.licenseId || !product) return { ok: true, skipped: true };
    const state = readState();
    const deviceId = state.deviceId || getDeviceId();
    try {
      const body = state.activated ? await authorize(license, deviceId) : await activate(license, deviceId);
      saveState({ deviceId, activated: true, activeUsers: body.activeUsers, maxUsers: body.maxUsers, lastOnlineAt: new Date().toISOString() });
      return { ok: true, ...body };
    } catch (error) {
      if (!error.rechazo) return { ok: true, offline: true };
      const lastOnlineAt = new Date(state.lastOnlineAt || 0).getTime();
      if (Number.isFinite(lastOnlineAt) && Date.now() - lastOnlineAt <= GRACE_MS) return { ok: true, offlineGrace: true };
      showBlocked(error.message || 'No se pudo verificar la licencia.');
      return { ok: false, error: error.message };
    }
  }

  global.PampaSeatControl = { enforce, release, getDeviceId };
  global.addEventListener('beforeunload', () => { /* El cupo se conserva para evitar liberar por un cierre accidental. */ });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enforce, { once: true });
  else enforce();
}(window));
