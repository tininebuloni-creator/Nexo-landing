// ARCHIVO GENERADO por scripts/sync-ia-servidor.js desde packages/core-ia/servidorPampa.js: no editar acá.
// servidorPampa.js — Servidor de IA propio de Pampa (Flowise + Ollama), para que los clientes no tengan
// que conseguir ni cargar una clave de IA.
//
// La app calcula los números (asistente-ia.js) y manda la pregunta con esos datos como contexto; el modelo
// solo interpreta la pregunta y redacta la respuesta con ese contexto. Si no hay datos en el contexto, lo
// tiene que decir: no inventa cifras.
//
// Proveedores:
//   - flowise: POST {url}/api/v1/prediction/{chatflowId}  (Authorization: Bearer {apiKey})
//   - ollama:  POST {url}/api/chat  (respaldo directo, sin Flowise)
// Isomórfico (fetch): lo usan el servidor de escritorio (Node) y la Pages Function de Nexo-landing.

const LIMITE_PREGUNTA = 600;
const LIMITE_CONTEXTO = 12000;

const INSTRUCCIONES = [
  'Sos PampaIA, el asistente de un ERP agropecuario argentino.',
  'Escribí siempre en castellano de Argentina (nunca en portugués ni en inglés). Respondé en 2 a 5 líneas, como un mensaje de WhatsApp (*negrita* para lo importante).',
  'Contestá la pregunta con las cifras concretas del contexto (cantidades, importes, fechas) y, si corresponde, una recomendación breve.',
  'Si el contexto trae próximas fechas u opciones (por ejemplo, ventanas aptas para aplicar), indicá la más cercana.',
  'Usá SOLO los datos del CONTEXTO, que ya están calculados por el sistema. No inventes cifras, fechas ni nombres.',
  'Si el contexto no tiene la información para responder, decilo en una línea. Solo podés mencionar funciones o datos que aparezcan en el contexto: no inventes funciones de la app.',
  'No des asesoramiento legal ni contable definitivo: para normativa, indicá revisarlo con el profesional.',
].join(' ');

const recortar = (t, n) => { const s = String(t || '').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };

function armarMensaje(pregunta, contexto) {
  return `CONTEXTO (datos calculados por el ERP):\n${recortar(contexto, LIMITE_CONTEXTO) || '(sin datos)'}\n\nPREGUNTA DEL USUARIO:\n${recortar(pregunta, LIMITE_PREGUNTA)}`;
}

async function conTiempo(promesa, ms) {
  let t;
  try { return await Promise.race([promesa, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('tiempo')), ms); })]); } finally { clearTimeout(t); }
}

async function consultarFlowise({ url, chatflowId, apiKey, pregunta, contexto, sesion, timeoutMs }) {
  const r = await conTiempo(fetch(`${String(url).replace(/\/$/, '')}/api/v1/prediction/${encodeURIComponent(chatflowId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ question: armarMensaje(pregunta, contexto), ...(sesion ? { overrideConfig: { sessionId: String(sesion).slice(0, 80) } } : {}) }),
  }), timeoutMs);
  if (!r.ok) throw new Error(`Flowise respondió ${r.status}`);
  const data = await r.json();
  const texto = String(data?.text ?? data?.answer ?? data?.json?.text ?? '').trim();
  if (!texto) throw new Error('Flowise no devolvió texto');
  return { respuesta: texto, proveedor: 'flowise' };
}

async function consultarOllama({ url, modelo, pregunta, contexto, timeoutMs }) {
  const r = await conTiempo(fetch(`${String(url).replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelo, stream: false, keep_alive: '30m', options: { temperature: 0.2 }, messages: [{ role: 'system', content: INSTRUCCIONES }, { role: 'user', content: armarMensaje(pregunta, contexto) }] }),
  }), timeoutMs);
  if (!r.ok) throw new Error(`Ollama respondió ${r.status}`);
  const data = await r.json();
  const texto = String(data?.message?.content || '').trim();
  if (!texto) throw new Error('Ollama no devolvió texto');
  return { respuesta: texto, proveedor: 'ollama', modelo };
}

// Servidor central de Pampa (la Pages Function /api/pampa-ia): lo usan las instalaciones de escritorio que
// no tienen un Flowise u Ollama propio, así el cliente no configura nada.
async function consultarCentral({ url, app, pregunta, contexto, sesion, timeoutMs }) {
  const r = await conTiempo(fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app, pregunta, contexto, sesion }) }), timeoutMs);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw new Error(data.error || `servidor central ${r.status}`);
  return { respuesta: String(data.respuesta || '').trim(), proveedor: 'central', modelo: data.modelo };
}

// config: { flowiseUrl, flowiseChatflowId, flowiseApiKey, ollamaUrl, ollamaModelo, centralUrl, app, timeoutMs }
async function consultarServidorIA({ pregunta, contexto, sesion } = {}, config = {}) {
  const q = String(pregunta || '').trim();
  if (!q) return { ok: false, error: 'Ingresá una consulta.' };
  const timeoutMs = Number(config.timeoutMs) || 60000;
  const errores = [];
  if (config.flowiseUrl && config.flowiseChatflowId) {
    try { return { ok: true, ...(await consultarFlowise({ url: config.flowiseUrl, chatflowId: config.flowiseChatflowId, apiKey: config.flowiseApiKey, pregunta: q, contexto, sesion, timeoutMs })) }; } catch (e) { errores.push(e.message); }
  }
  if (config.ollamaUrl) {
    try { return { ok: true, ...(await consultarOllama({ url: config.ollamaUrl, modelo: config.ollamaModelo || 'qwen2.5:3b', pregunta: q, contexto, timeoutMs })) }; } catch (e) { errores.push(e.message); }
  }
  if (config.centralUrl) {
    try { return { ok: true, ...(await consultarCentral({ url: config.centralUrl, app: config.app || 'precision', pregunta: q, contexto, sesion, timeoutMs })) }; } catch (e) { errores.push(e.message); }
  }
  return { ok: false, error: errores.length ? `El servidor de IA no respondió (${errores.join(' · ')}).` : 'No hay un servidor de IA configurado.' };
}

function configDesdeEntorno(env = typeof process !== 'undefined' ? process.env : {}) {
  return {
    flowiseUrl: env.PAMPA_IA_FLOWISE_URL || '',
    flowiseChatflowId: env.PAMPA_IA_FLOWISE_CHATFLOW || '',
    flowiseApiKey: env.PAMPA_IA_FLOWISE_KEY || '',
    ollamaUrl: env.PAMPA_IA_OLLAMA_URL || '',
    ollamaModelo: env.PAMPA_IA_OLLAMA_MODELO || 'qwen2.5:3b',
    centralUrl: env.PAMPA_IA_CENTRAL_URL || '',
    timeoutMs: Number(env.PAMPA_IA_TIMEOUT_MS) || 60000,
  };
}
const servidorConfigurado = (c) => Boolean((c.flowiseUrl && c.flowiseChatflowId) || c.ollamaUrl || c.centralUrl);
// Escritorio: sin Flowise ni Ollama propio, el servidor central de Pampa.
const CENTRAL_POR_DEFECTO = 'https://nexo-landing-elt.pages.dev/api/pampa-ia';


// ─── Pages Function: /api/pampa-ia ────────────────────────────────────────────────────────────────
const APPS_IA = ['precision', 'agro', 'ganaderia', 'tambo', 'porcinos', 'topografia'];
const respuestaJson = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// Estado (la app lo consulta para saber si hay servidor de IA).
export async function onRequestGet({ env }) {
  const c = configDesdeEntorno(env);
  return respuestaJson({ ok: true, configurado: servidorConfigurado(c), servidorPropio: true });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return respuestaJson({ ok: false, error: 'Pedido inválido.' }, 400); }
  if (!APPS_IA.includes(String(body?.app || ''))) return respuestaJson({ ok: false, error: 'App desconocida.' }, 400);
  const config = configDesdeEntorno(env);
  if (!servidorConfigurado(config)) return respuestaJson({ ok: false, error: 'El servidor de IA todavía no está configurado.' }, 503);
  // Límite diario por IP para que nadie use el servidor como IA gratis.
  const kv = env.PAMPA_TRIAL_KV;
  const limite = Number(env.PAMPA_IA_LIMITE_DIARIO) || 200;
  const ip = request.headers.get('CF-Connecting-IP') || 'sin-ip';
  const clave = `ia:${new Date().toISOString().slice(0, 10)}:${ip}`;
  if (kv) {
    const usadas = Number(await kv.get(clave)) || 0;
    if (usadas >= limite) return respuestaJson({ ok: false, error: 'Se alcanzó el límite diario de consultas a PampaIA.' }, 429);
    await kv.put(clave, String(usadas + 1), { expirationTtl: 60 * 60 * 26 });
  }
  const r = await consultarServidorIA({ pregunta: body.pregunta, contexto: body.contexto, sesion: body.sesion }, config);
  return r.ok ? respuestaJson({ ok: true, respuesta: r.respuesta, modelo: r.modelo || r.proveedor }) : respuestaJson({ ok: false, error: r.error }, 502);
}
