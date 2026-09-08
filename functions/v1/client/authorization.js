import { verifyToken, getStore, json, options } from '../../_license.js';

export function onRequestOptions() { return options(); }

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const licenseId = String(url.searchParams.get('licenseId') || '').trim();
    const deviceId = String(url.searchParams.get('deviceId') || '').trim();
    const current = await getStore(env, licenseId);
    if (!current || !current.devices?.some((item) => item.deviceId === deviceId)) return json({ ok: false, message: 'Dispositivo no activado' }, 403);
    const payload = await verifyToken(current.token, current.product);
    return json({ ok: true, token: current.token, activeUsers: current.devices.length, maxUsers: payload.maxUsers });
  } catch (error) {
    return json({ ok: false, message: error.message || 'No autorizado' }, 403);
  }
}
