const PRODUCT = 'pampa-agro';
const TOKEN_PREFIX = 'PAMPAAGRO1';
const VALID_PLANS = new Set(['basica', 'profesional', 'premium']);
const REMINDER_DAYS = [15, 7, 3, 1];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function fail(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function html(content, status = 200) {
  return new Response(content, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function adminPage() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Control de suscripciones</title><style>
    :root{color-scheme:dark;font-family:Arial,sans-serif}body{margin:0;background:#10151b;color:#edf2f4}main{max-width:1120px;margin:auto;padding:28px}h1{margin:0 0 8px}p{color:#b8c5c9}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin:24px 0}.panel{background:#19212a;border:1px solid #31404a;border-radius:8px;padding:18px}label{display:block;font-size:12px;color:#b8c5c9;margin-top:10px}input,select,button{box-sizing:border-box;width:100%;margin-top:4px;border-radius:5px;border:1px solid #455862;padding:10px;background:#10151b;color:#edf2f4}button{background:#e5a929;color:#17130a;border:0;font-weight:bold;cursor:pointer;margin-top:16px}#result{white-space:pre-wrap;background:#0c1116;border:1px solid #31404a;padding:14px;min-height:72px;border-radius:6px}.login{max-width:360px;margin:15vh auto}.hidden{display:none}</style></head><body><main>
    <section id="login" class="login panel"><h1>Administración</h1><p>Ingresá el token de administración.</p><input id="token" type="password" autocomplete="current-password"><button onclick="login()">Ingresar</button></section>
    <section id="app" class="hidden"><h1>Control de suscripciones</h1><p>Pagos manuales: transferencia, efectivo, cheque, canje y factura. Los pagos acreditados renuevan PampaAgro sin reenviar una licencia.</p><div class="grid">
      <form class="panel" onsubmit="createCustomer(event)"><h2>Nuevo cliente</h2><label>Nombre<input name="name" required></label><label>Email<input name="email" type="email"></label><label>WhatsApp internacional<input name="whatsapp" placeholder="549..." required></label><button>Guardar cliente</button></form>
      <form class="panel" onsubmit="createSubscription(event)"><h2>Nueva suscripción</h2><label>ID de cliente<input name="customerId" required></label><label>Plan<select name="plan"><option value="basica">Básica</option><option value="profesional">Profesional</option><option value="premium">Premium</option></select></label><label>Vigente hasta<input name="paidUntil" type="date" required></label><label>Equipos permitidos<input name="deviceLimit" type="number" min="1" value="1" required></label><button>Crear suscripción</button></form>
      <form class="panel" onsubmit="registerPayment(event)"><h2>Registrar pago</h2><label>ID de suscripción<input name="subscriptionId" required></label><label>Medio<select name="method"><option>Transferencia bancaria</option><option>Efectivo</option><option>Cheque</option><option>Canje</option><option>Factura</option><option>Otro</option></select></label><label>Días pagados<input name="periodDays" type="number" min="1" value="30" required></label><label>Importe en centavos<input name="amountCents" type="number" min="0"></label><label>Referencia / comprobante<input name="reference"></label><button>Acreditar y renovar</button></form>
    </div><button onclick="runReminders()">Ejecutar recordatorios ahora</button><h2>Resultado</h2><pre id="result">Esperando una acción.</pre></section>
    <script>let token='';const result=document.querySelector('#result');function show(value){result.textContent=JSON.stringify(value,null,2)}async function api(path,body){const res=await fetch(path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error||'Error');return data}function login(){token=document.querySelector('#token').value;if(!token)return;document.querySelector('#login').classList.add('hidden');document.querySelector('#app').classList.remove('hidden')}async function createCustomer(e){e.preventDefault();try{show(await api('/v1/admin/customers',Object.fromEntries(new FormData(e.target))));e.target.reset()}catch(err){show({error:err.message})}}async function createSubscription(e){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.deviceLimit=Number(data.deviceLimit);try{show(await api('/v1/admin/subscriptions',data));e.target.reset()}catch(err){show({error:err.message})}}async function registerPayment(e){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.periodDays=Number(data.periodDays);data.amountCents=data.amountCents?Number(data.amountCents):null;try{show(await api('/v1/admin/payments',data));e.target.reset()}catch(err){show({error:err.message})}}async function runReminders(){try{show(await api('/v1/admin/reminders/run',{}))}catch(err){show({error:err.message})}}</script>
  </main></body></html>`;
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToBytes(pem) {
  const base64 = String(pem || '').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getSigningKey(env) {
  if (!env.LICENSE_PRIVATE_KEY) throw new Error('Falta LICENSE_PRIVATE_KEY');
  return crypto.subtle.importKey('pkcs8', pemToBytes(env.LICENSE_PRIVATE_KEY), { name: 'Ed25519' }, false, ['sign']);
}

async function signAuthorization(subscription, env) {
  const payload = {
    product: subscription.product,
    plan: subscription.plan,
    customer: subscription.customer_name,
    maxUsers: subscription.device_limit,
    licenseId: subscription.license_id,
    subscriptionId: subscription.id,
    issuedAt: nowIso(),
    expiresAt: subscription.grace_until
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', await getSigningKey(env), payloadBytes));
  return `${TOKEN_PREFIX}.${base64Url(payloadBytes)}.${base64Url(signature)}`;
}

function isAdmin(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return Boolean(env.ADMIN_API_TOKEN && token && token === env.ADMIN_API_TOKEN);
}

async function requestJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function parseDate(value, field) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error(`${field} inválida`);
  return date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

async function getSubscription(db, subscriptionId) {
  return db.prepare(`
    SELECT s.*, c.name AS customer_name, c.whatsapp AS customer_whatsapp
    FROM subscriptions s JOIN customers c ON c.id = s.customer_id
    WHERE s.id = ?
  `).bind(subscriptionId).first();
}

async function rememberDevice(subscription, deviceId, env) {
  const existing = await env.DB.prepare('SELECT 1 FROM devices WHERE subscription_id = ? AND device_id = ?').bind(subscription.id, deviceId).first();
  if (!existing) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM devices WHERE subscription_id = ?').bind(subscription.id).first();
    if (Number(count.total) >= subscription.device_limit) return false;
    await env.DB.prepare('INSERT INTO devices (subscription_id, device_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)')
      .bind(subscription.id, deviceId, nowIso(), nowIso()).run();
    return true;
  }
  await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE subscription_id = ? AND device_id = ?')
    .bind(nowIso(), subscription.id, deviceId).run();
  return true;
}

async function clientAuthorization(url, env) {
  const licenseId = String(url.searchParams.get('licenseId') || '').trim();
  const deviceId = String(url.searchParams.get('deviceId') || '').trim();
  if (!licenseId || !deviceId) return fail('licenseId y deviceId son obligatorios');

  const subscription = await env.DB.prepare(`
    SELECT s.*, c.name AS customer_name, c.whatsapp AS customer_whatsapp
    FROM subscriptions s JOIN customers c ON c.id = s.customer_id
    WHERE s.license_id = ?
  `).bind(licenseId).first();
  if (!subscription || !['active', 'past_due'].includes(subscription.status)) return fail('Suscripción no habilitada', 403);
  if (new Date(subscription.grace_until).getTime() <= Date.now()) return fail('Suscripción vencida', 403);
  if (!await rememberDevice(subscription, deviceId, env)) return fail('Se alcanzó el límite de equipos autorizados', 403);

  return json({ ok: true, token: await signAuthorization(subscription, env), checkedAt: nowIso() });
}

async function createCustomer(request, env) {
  const body = await requestJson(request);
  if (!body?.name) return fail('name es obligatorio');
  const customer = { id: id('cus'), name: String(body.name).trim(), email: String(body.email || '').trim(), whatsapp: String(body.whatsapp || '').trim() };
  await env.DB.prepare('INSERT INTO customers (id, name, email, whatsapp, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(customer.id, customer.name, customer.email || null, customer.whatsapp || null, nowIso()).run();
  return json({ ok: true, customer }, 201);
}

async function createSubscription(request, env) {
  const body = await requestJson(request);
  if (!body?.customerId || !VALID_PLANS.has(body.plan)) return fail('customerId y plan válido son obligatorios');
  const customer = await env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(body.customerId).first();
  if (!customer) return fail('Cliente inexistente', 404);
  const startsAt = parseDate(body.startsAt || nowIso(), 'startsAt');
  const paidUntil = parseDate(body.paidUntil, 'paidUntil');
  const graceDays = Number.isInteger(body.graceDays) ? body.graceDays : 7;
  const subscription = {
    id: id('sub'), licenseId: String(body.licenseId || id('lic')).trim(), product: PRODUCT, plan: body.plan,
    status: body.status === 'past_due' ? 'past_due' : 'active', deviceLimit: Number.isInteger(body.deviceLimit) && body.deviceLimit > 0 ? body.deviceLimit : 1,
    startsAt: startsAt.toISOString(), paidUntil: paidUntil.toISOString(), graceUntil: addDays(paidUntil, graceDays).toISOString()
  };
  await env.DB.prepare(`INSERT INTO subscriptions (id, customer_id, license_id, product, plan, status, device_limit, starts_at, paid_until, grace_until, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(subscription.id, body.customerId, subscription.licenseId, subscription.product, subscription.plan, subscription.status, subscription.deviceLimit, subscription.startsAt, subscription.paidUntil, subscription.graceUntil, nowIso(), nowIso()).run();
  return json({ ok: true, subscription }, 201);
}

async function registerPayment(body, env, provider = 'manual', providerPaymentId = null) {
  if (!body?.subscriptionId || !Number.isInteger(body.periodDays) || body.periodDays <= 0) throw new Error('subscriptionId y periodDays positivo son obligatorios');
  const subscription = await getSubscription(env.DB, body.subscriptionId);
  if (!subscription) throw new Error('Suscripción inexistente');
  const base = Math.max(Date.now(), new Date(subscription.paid_until).getTime());
  const paidUntil = addDays(new Date(base), body.periodDays);
  const graceDays = Number.isInteger(body.graceDays) ? body.graceDays : 7;
  const payment = { id: id('pay'), method: String(body.method || provider), amountCents: Number.isInteger(body.amountCents) ? body.amountCents : null, currency: String(body.currency || 'ARS'), paidAt: body.paidAt ? parseDate(body.paidAt, 'paidAt').toISOString() : nowIso(), reference: String(body.reference || '') };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO payments (id, subscription_id, provider, provider_payment_id, method, amount_cents, currency, paid_at, period_days, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(payment.id, subscription.id, provider, providerPaymentId, payment.method, payment.amountCents, payment.currency, payment.paidAt, body.periodDays, payment.reference || null, nowIso()),
    env.DB.prepare('UPDATE subscriptions SET status = ?, paid_until = ?, grace_until = ?, updated_at = ? WHERE id = ?')
      .bind('active', paidUntil.toISOString(), addDays(paidUntil, graceDays).toISOString(), nowIso(), subscription.id)
  ]);
  return { subscriptionId: subscription.id, paidUntil: paidUntil.toISOString(), graceUntil: addDays(paidUntil, graceDays).toISOString() };
}

async function manualPayment(request, env) {
  try {
    return json({ ok: true, payment: await registerPayment(await requestJson(request), env) }, 201);
  } catch (error) {
    return fail(error.message);
  }
}

async function mercadoPagoWebhook(request, env) {
  if (!env.MERCADO_PAGO_ACCESS_TOKEN) return fail('Mercado Pago no está configurado', 503);
  const body = await requestJson(request);
  const paymentId = String(body?.data?.id || body?.id || '').trim();
  if (!paymentId) return fail('Webhook sin identificador de pago');
  const remote = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { authorization: `Bearer ${env.MERCADO_PAGO_ACCESS_TOKEN}` } });
  if (!remote.ok) return fail('No se pudo verificar el pago en Mercado Pago', 502);
  const payment = await remote.json();
  if (payment.status !== 'approved') return json({ ok: true, ignored: true, status: payment.status });
  const match = /^subscription:(.+)$/.exec(String(payment.external_reference || ''));
  if (!match) return fail('Pago sin referencia de suscripción');
  const existing = await env.DB.prepare('SELECT id FROM payments WHERE provider = ? AND provider_payment_id = ?').bind('mercado_pago', paymentId).first();
  if (existing) return json({ ok: true, duplicate: true });
  try {
    const result = await registerPayment({ subscriptionId: match[1], periodDays: 30, method: 'Mercado Pago', amountCents: Math.round(Number(payment.transaction_amount || 0) * 100), currency: payment.currency_id, reference: paymentId }, env, 'mercado_pago', paymentId);
    return json({ ok: true, payment: result });
  } catch (error) {
    return fail(error.message);
  }
}

async function sendWhatsApp(to, parameters, env) {
  if (!to || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_TEMPLATE_NAME) return false;
  const response = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: env.WHATSAPP_TEMPLATE_NAME, language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE || 'es_AR' }, components: [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }] } })
  });
  return response.ok;
}

async function sendDueReminders(env) {
  const limit = new Date(Date.now() + 15 * 86400000).toISOString();
  const rows = await env.DB.prepare(`SELECT s.*, c.name AS customer_name, c.whatsapp AS customer_whatsapp FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('active', 'past_due') AND s.paid_until <= ? AND s.grace_until > ?`).bind(limit, nowIso()).all();
  let sent = 0;
  for (const subscription of rows.results || []) {
    const days = Math.max(0, Math.ceil((new Date(subscription.paid_until).getTime() - Date.now()) / 86400000));
    if (!REMINDER_DAYS.includes(days)) continue;
    const scheduledFor = new Date(subscription.paid_until).toISOString().slice(0, 10);
    for (const recipient of [subscription.customer_whatsapp, env.ADMIN_WHATSAPP_TO].filter(Boolean)) {
      const alreadySent = await env.DB.prepare('SELECT 1 FROM notifications WHERE subscription_id = ? AND recipient = ? AND kind = ? AND scheduled_for = ?').bind(subscription.id, recipient, `due_${days}`, scheduledFor).first();
      if (alreadySent) continue;
      if (await sendWhatsApp(recipient, [subscription.customer_name, subscription.product, String(days), scheduledFor], env)) {
        await env.DB.prepare('INSERT INTO notifications (id, subscription_id, recipient, kind, scheduled_for, sent_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id('msg'), subscription.id, recipient, `due_${days}`, scheduledFor, nowIso()).run();
        sent += 1;
      }
    }
  }
  return sent;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
      if (request.method === 'GET' && url.pathname === '/admin') return html(adminPage());
      if (request.method === 'GET' && url.pathname === '/v1/client/authorization') return clientAuthorization(url, env);
      if (request.method === 'POST' && url.pathname === '/v1/webhooks/mercado-pago') return mercadoPagoWebhook(request, env);
      if (!isAdmin(request, env)) return fail('No autorizado', 401);
      if (request.method === 'POST' && url.pathname === '/v1/admin/customers') return createCustomer(request, env);
      if (request.method === 'POST' && url.pathname === '/v1/admin/subscriptions') return createSubscription(request, env);
      if (request.method === 'POST' && url.pathname === '/v1/admin/payments') return manualPayment(request, env);
      if (request.method === 'POST' && url.pathname === '/v1/admin/reminders/run') return json({ ok: true, sent: await sendDueReminders(env) });
      return fail('Ruta no encontrada', 404);
    } catch (error) {
      console.error(error);
      return fail('Error interno', 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDueReminders(env));
  }
};