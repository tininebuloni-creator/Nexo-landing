// ARCHIVO GENERADO por scripts/sync-trial-guard.js desde packages/core-licensing: no editar acá.
// trial-status-core.js — CANÓNICO del control de días del trial web del lado del servidor.
//
// scripts/sync-trial-guard.js lo copia (tal cual, sin imports) dentro de:
//   - apps/pampaagro/public/_worker.js                       (Cloudflare Worker de la app)
//   - Nexo-landing/functions/api/pampa-trial-status.js       (Pages Function de la landing,
//                                                             donde se publican los trials)
//
// Qué resuelve: los 10 días se contaban solo en el navegador, así que borrando los datos del
// sitio (o con otro navegador) la prueba arrancaba de cero. Ahora el servidor recuerda el
// primer inicio de cada trial y ese vencimiento manda sobre el del navegador.
//
// Cómo identifica a quien ya probó, sin guardar datos personales:
//   - la IP de la conexión y un identificador aleatorio del navegador (lo genera la app y lo
//     guarda en localStorage, cookie e IndexedDB), ambos guardados como hash SHA-256;
//   - las dos claves quedan enlazadas al mismo registro: cambiar de IP con el mismo navegador,
//     o borrar el navegador desde la misma IP, sigue viendo la misma prueba;
//   - si aparecen dos registros, manda el que vence primero.
// Se guarda solo { app, activatedAt, expiresAt }: ni la IP ni datos del usuario.
//
// GET /api/pampa-trial-status?app=<id>&d=<dispositivo>              → estado
// GET /api/pampa-trial-status?app=<id>&d=<dispositivo>&pampa_trial=1 → registra si no existe
//     (&desde=<ISO> opcional: inicio de un trial local anterior a este control; se acota a los
//      últimos DIAS_TRIAL días para que no sirva para alargar la prueba)

const APPS_TRIAL = ['agro', 'ganaderia', 'tambo', 'topografia', 'porcinos', 'precision'];
const DIAS_TRIAL = 10;
const CONSERVAR_DIAS = 730; // cuánto se recuerda una prueba ya usada
const DIA_MS = 24 * 60 * 60 * 1000;

async function sha256Hex(texto) {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

function ipDelCliente(request) {
  const cruda = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
  return cruda.split(',')[0].trim().slice(0, 64);
}

function respuestaJson(datos, status = 200) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function responderEstadoTrial(request, kv, opciones = {}) {
  const ahora = opciones.ahora || Date.now();
  const url = new URL(request.url);
  const app = String(url.searchParams.get('app') || opciones.appPorDefecto || '').toLowerCase();
  if (!APPS_TRIAL.includes(app)) return respuestaJson({ ok: false, error: 'App desconocida.' }, 400);
  if (!kv) return respuestaJson({ ok: false, error: 'Control de trial sin almacenamiento configurado.' }, 503);

  const sal = String(opciones.sal || 'pampa-trial');
  const ip = ipDelCliente(request);
  const d = String(url.searchParams.get('d') || '');
  const dispositivo = /^[a-z0-9-]{16,64}$/i.test(d) ? d.toLowerCase() : '';
  const base = `pampa-trial:v2:${app}`;
  const claves = [];
  if (ip) claves.push(`${base}:ip:${await sha256Hex(`${sal}|ip|${ip}`)}`);
  if (dispositivo) claves.push(`${base}:dev:${await sha256Hex(`${sal}|dev|${dispositivo}`)}`);
  if (!claves.length) return respuestaJson({ ok: false, error: 'No se pudo identificar la conexión.' }, 400);
  // Registros del control anterior (clave con la IP sin cifrar): se leen y se reemplazan.
  const legado = ip ? `pampa-trial-ip:${app}:${ip}` : '';

  const leer = (clave) => kv.get(clave, 'json').catch(() => null);
  const guardados = await Promise.all(claves.map(leer));
  const anterior = legado ? await leer(legado) : null;
  const candidatos = [...guardados, anterior].filter((r) => r && r.expiresAt && !Number.isNaN(new Date(r.expiresAt).getTime()));
  let registro = candidatos.sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))[0] || null;

  if (!registro && url.searchParams.get('pampa_trial') === '1') {
    const desde = new Date(url.searchParams.get('desde') || '').getTime();
    const inicio = Number.isFinite(desde) ? Math.min(ahora, Math.max(ahora - DIAS_TRIAL * DIA_MS, desde)) : ahora;
    registro = { app, activatedAt: new Date(inicio).toISOString(), expiresAt: new Date(inicio + DIAS_TRIAL * DIA_MS).toISOString() };
  }

  if (registro) {
    const limpio = { app, activatedAt: registro.activatedAt || null, expiresAt: registro.expiresAt };
    const escribir = claves.filter((clave, i) => !guardados[i] || guardados[i].expiresAt !== limpio.expiresAt);
    await Promise.all(escribir.map((clave) => kv.put(clave, JSON.stringify(limpio), { expirationTtl: CONSERVAR_DIAS * 24 * 60 * 60 })));
    if (anterior) await kv.delete(legado).catch(() => {});
  }

  if (!registro) return respuestaJson({ ok: true, app, trialActive: false, trialExhausted: false });
  const vence = new Date(registro.expiresAt).getTime();
  const vencido = vence <= ahora;
  return respuestaJson({
    ok: true,
    app,
    trialActive: !vencido,
    trialExhausted: vencido,
    activatedAt: registro.activatedAt || null,
    expiresAt: registro.expiresAt,
    diasRestantes: vencido ? 0 : Math.ceil((vence - ahora) / DIA_MS),
  });
}

// Pages Function de la landing: atiende los trials de todas las apps publicadas (?app=).
export async function onRequestGet({ request, env }) {
  return responderEstadoTrial(request, env.PAMPA_TRIAL_KV, { sal: env.TRIAL_SALT });
}
