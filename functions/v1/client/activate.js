import { verifyToken, getStore, putStore, json, options } from '../../_license.js';

export function onRequestOptions() { return options(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const payload = await verifyToken(body.token, body.product || 'pampa-agro');
    const deviceId = String(body.deviceId || '').trim();
    if (!deviceId) return json({ ok: false, message: 'Falta deviceId' }, 400);

    const current = await getStore(env, payload.licenseId) || { token: body.token, product: payload.product, maxUsers: payload.maxUsers, devices: [] };
    if (current.product !== payload.product) return json({ ok: false, message: 'Producto incompatible' }, 409);
    const devices = Array.isArray(current.devices) ? current.devices : [];
    if (!devices.some((item) => item.deviceId === deviceId) && devices.length >= payload.maxUsers) {
      return json({ ok: false, code: 'SEATS_EXHAUSTED', message: `No quedan cupos disponibles (${devices.length}/${payload.maxUsers}).` }, 409);
    }
    if (!devices.some((item) => item.deviceId === deviceId)) devices.push({ deviceId, activatedAt: new Date().toISOString() });
    await putStore(env, payload.licenseId, { token: body.token, product: payload.product, maxUsers: payload.maxUsers, devices });
    return json({ ok: true, licenseId: payload.licenseId, maxUsers: payload.maxUsers, activeUsers: devices.length, token: body.token });
  } catch (error) {
    return json({ ok: false, message: error.message || 'No se pudo activar el dispositivo' }, 400);
  }
}
