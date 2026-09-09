const AUDIT_PREFIX = 'fiscal-audit:pampa-biogas:';
const CH4_TONNES_PER_M3 = 0.000717;
const METHANE_GWP = 28;
const CARBON_PRICE_USD = 25;
const DISPOSAL_RATE_USD_PER_TON = 12.5;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
  });
}

function number(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} inválido`);
  return parsed;
}

export function onRequestOptions() {
  return json(null, 204);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.LICENSE_ACTIVATIONS) throw new Error('Falta configurar el KV LICENSE_ACTIVATIONS');
    const body = await request.json();
    const substrateTons = number(body.substrateTons, 'substrateTons');
    const methaneM3 = number(body.methaneM3, 'methaneM3');
    const disposalRate = DISPOSAL_RATE_USD_PER_TON;
    const tonnesMethane = methaneM3 * CH4_TONNES_PER_M3;
    const co2Avoided = tonnesMethane * METHANE_GWP;
    const carbonCredit = co2Avoided * CARBON_PRICE_USD;
    const disposal = substrateTons * disposalRate;
    const net = disposal - carbonCredit;
    const auditId = crypto.randomUUID();
    const record = {
      auditId,
      product: 'pampa-biogas',
      mode: body.mode === 'electron' ? 'electron' : 'trial-web',
      licenseId: String(body.licenseId || ''),
      deviceId: String(body.deviceId || ''),
      plantId: String(body.plantId || ''),
      createdAt: new Date().toISOString(),
      inputs: { substrateTons, methaneM3, disposalRate, carbonPrice: CARBON_PRICE_USD, ch4TonnesPerM3: CH4_TONNES_PER_M3, methaneGwp: METHANE_GWP },
      results: { tonnesMethane, co2Avoided, disposal, carbonCredit, net }
    };
    await env.LICENSE_ACTIVATIONS.put(`${AUDIT_PREFIX}${auditId}`, JSON.stringify(record));
    return json({ ok: true, auditId, record });
  } catch (error) {
    return json({ ok: false, message: error.message || 'No se pudo registrar la auditoría fiscal' }, 400);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.LICENSE_ACTIVATIONS) throw new Error('Falta configurar el KV LICENSE_ACTIVATIONS');
    const auditId = new URL(request.url).searchParams.get('auditId');
    if (!auditId) return json({ ok: false, message: 'Falta auditId' }, 400);
    const record = await env.LICENSE_ACTIVATIONS.get(`${AUDIT_PREFIX}${auditId}`, 'json');
    return record ? json({ ok: true, record }) : json({ ok: false, message: 'Auditoría no encontrada' }, 404);
  } catch (error) {
    return json({ ok: false, message: error.message || 'No se pudo leer la auditoría fiscal' }, 400);
  }
}
