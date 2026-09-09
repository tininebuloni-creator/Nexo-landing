const PUBLIC_KEY_B64 = 'MCowBQYDK2VwAyEAq7tUZMWSHD1Q36bRapLV6adFdCUzm9mwrV94npOEW3c=';

function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value).length + 3) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function verifyToken(token, expectedProduct) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'PAMPAN1') throw new Error('Licencia inválida');
  const payloadBytes = decodeBase64Url(parts[1]);
  const signature = decodeBase64Url(parts[2]);
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  if (payload.product !== expectedProduct) throw new Error('Licencia emitida para otra aplicación');
  if (!Number.isInteger(payload.maxUsers) || payload.maxUsers < 1) throw new Error('La licencia no tiene cupo válido');
  if (payload.expiresAt && new Date(`${payload.expiresAt}T23:59:59`).getTime() < Date.now()) throw new Error('Licencia vencida');
  const key = await crypto.subtle.importKey('spki', decodeBase64Url(PUBLIC_KEY_B64), { name: 'Ed25519' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, payloadBytes);
  if (!valid) throw new Error('Firma de licencia inválida');
  return payload;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } });
}

export function options() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } });
}

export function getStore(env, licenseId) {
  if (!env.LICENSE_ACTIVATIONS) throw new Error('Falta configurar el KV LICENSE_ACTIVATIONS');
  return env.LICENSE_ACTIVATIONS.get(`license:${licenseId}`, 'json');
}

export function putStore(env, licenseId, value) {
  if (!env.LICENSE_ACTIVATIONS) throw new Error('Falta configurar el KV LICENSE_ACTIVATIONS');
  return env.LICENSE_ACTIVATIONS.put(`license:${licenseId}`, JSON.stringify(value));
}
