import { verifyToken, getStore, json, options } from '../../_license.js';

export function onRequestOptions() { return options(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const payload = await verifyToken(body.token, body.product || 'pampa-agro');
    const current = await getStore(env, payload.licenseId);
    if (!current) return json({ ok: true, licenseId: payload.licenseId, activeUsers: 0, maxUsers: payload.maxUsers, devices: [] });
    return json({ ok: true, licenseId: payload.licenseId, activeUsers: current.devices?.length || 0, maxUsers: payload.maxUsers, devices: (current.devices || []).map((item) => ({ deviceId: item.deviceId, activatedAt: item.activatedAt })) });
  } catch (error) {
    return json({ ok: false, message: error.message || 'No se pudo listar activaciones' }, 400);
  }
}