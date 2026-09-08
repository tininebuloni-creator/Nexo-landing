import { verifyToken, getStore, putStore, json, options } from '../../_license.js';

export function onRequestOptions() { return options(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const payload = await verifyToken(body.token, body.product || 'pampa-agro');
    const deviceId = String(body.deviceId || '').trim();
    const current = await getStore(env, payload.licenseId);
    if (!current) return json({ ok: true, activeUsers: 0, maxUsers: payload.maxUsers });
    const devices = (current.devices || []).filter((item) => item.deviceId !== deviceId);
    await putStore(env, payload.licenseId, { ...current, devices });
    return json({ ok: true, activeUsers: devices.length, maxUsers: payload.maxUsers });
  } catch (error) {
    return json({ ok: false, message: error.message || 'No se pudo liberar el dispositivo' }, 400);
  }
}
