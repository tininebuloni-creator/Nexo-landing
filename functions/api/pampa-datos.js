// ARCHIVO GENERADO por scripts/sync-ia-servidor.js desde packages/core-ia/datosExternos.js: no editar acá.
// datosExternos.js — Datos de afuera que las apps suman a sus cálculos y al contexto de PampaIA.
//   - DolarAPI (pública, sin clave): oficial, blue, MEP (bolsa), CCL y mayorista con su fecha.
//   - Agromonitoring (API agro de OpenWeather, con la clave de Pampa): clima actual y pronóstico por punto
//     o por polígono, lluvia acumulada, humedad del suelo y NDVI por lote, y alta de polígonos.
// La clave de Agromonitoring vive solo en el servidor (secreto de la Pages Function o variable de entorno del
// escritorio): la app nunca la ve. Isomórfico (fetch): Node y Pages Functions.

const DOLAR_URL = 'https://dolarapi.com/v1/dolares';
const AGRO_URL = 'https://api.agromonitoring.com/agro/1.0';
// Minutos de caché por tipo: no gastar el cupo de Agromonitoring con cada pregunta.
const CACHE_MIN = { pizarra: 60, dolarHistorico: 360, dolar: 30, clima: 60, pronostico: 180, lluvia: 360, suelo: 180, ndvi: 720 };

const kACelsius = (k) => (k == null ? null : Math.round((Number(k) - 273.15) * 10) / 10);
const msAKmh = (v) => (v == null ? null : Math.round(Number(v) * 3.6 * 10) / 10);
const unixAIso = (t) => (t ? new Date(Number(t) * 1000).toISOString() : null);

async function pedirJson(url, opciones = {}, ms = 15000) {
  let t;
  try {
    const r = await Promise.race([fetch(url, { ...opciones, headers: { Accept: 'application/json', ...(opciones.headers || {}) } }), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('tiempo de espera')), ms); })]);
    const texto = await r.text();
    let data; try { data = JSON.parse(texto); } catch { data = { mensaje: texto.slice(0, 200) }; }
    if (!r.ok) throw new Error(`HTTP ${r.status}${data?.message ? `: ${data.message}` : ''}`);
    return data;
  } finally { clearTimeout(t); }
}

// ─── DolarAPI ─────────────────────────────────────────────────────────────────────────────
async function obtenerDolares() {
  const lista = await pedirJson(DOLAR_URL);
  const nombres = { oficial: 'Oficial', blue: 'Blue', bolsa: 'MEP', contadoconliqui: 'CCL', mayorista: 'Mayorista', cripto: 'Cripto', tarjeta: 'Tarjeta' };
  return { fuente: 'DolarAPI (dolarapi.com, servicio no oficial)', cotizaciones: (Array.isArray(lista) ? lista : []).filter((x) => x && x.casa).map((x) => ({ casa: x.casa, nombre: nombres[x.casa] || x.nombre, compra: Number(x.compra) || null, venta: Number(x.venta) || null, fecha: x.fechaActualizacion || null })) };
}

// Histórico diario del dólar (argentinadatos.com, pública): para convertir cada importe con el dólar de su día.
async function obtenerDolarHistorico(casa = 'bolsa', desde = '') {
  const lista = await pedirJson(`https://api.argentinadatos.com/v1/cotizaciones/dolares/${encodeURIComponent(casa)}`, {}, 20000);
  const inicio = desde || new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10);
  return { fuente: 'argentinadatos.com (histórico diario)', casa, serie: (Array.isArray(lista) ? lista : []).filter((x) => x && x.fecha >= inicio && Number(x.venta) > 0).map((x) => ({ fecha: x.fecha, compra: Number(x.compra) || null, venta: Number(x.venta) })) };
}

// Pizarra de la Cámara Arbitral de Cereales de la Bolsa de Comercio de Rosario: precio del día por grano, en
// pesos y en US$ (estimado "(E)" cuando no hubo operaciones).
const PIZARRA_URL = 'https://www.cac.bcr.com.ar/es/precios-de-pizarra';
const numeroAr = (t) => { const s = String(t || '').replace(/[^0-9.,]/g, ''); return s ? Number(s.replace(/\./g, '').replace(',', '.')) : null; };
function leerPizarra(html) {
  const fecha = (String(html).match(/Precios Pizarra del d[ií]a\s*(\d{2})\/(\d{2})\/(\d{4})/) || []).slice(1);
  const precios = {};
  const granos = { trigo: 'TRIGO', maiz: 'MAIZ', girasol: 'GIRASOL', soja: 'SOJA', sorgo: 'SORGO' };
  const bloques = String(html).split(/<div class="board board-/).slice(1);
  bloques.forEach((b) => {
    const clave = granos[(b.match(/^([a-z]+)/) || [])[1]];
    if (!clave) return;
    const precio = (b.match(/<div class="price">([\s\S]*?)<\/div>/) || [])[1] || '';
    const estimado = /\(E\)/.test(precio) || /S\/C/.test(precio);
    const pesos = numeroAr((precio.match(/\$\s*([0-9.]+,\d{2})/) || [])[1]);
    const usd = numeroAr((b.match(/US\$<\/strong>[\s\S]*?([0-9.]+,\d{2})/) || [])[1]);
    const tendencia = /arrow-up/.test(b) ? 'sube' : /arrow-down/.test(b) ? 'baja' : 'igual';
    if (pesos || usd) precios[clave] = { pesos, usd, estimado, tendencia };
  });
  return { fuente: 'Cámara Arbitral de Cereales · Bolsa de Comercio de Rosario', url: PIZARRA_URL, fecha: fecha.length ? `${fecha[2]}-${fecha[1]}-${fecha[0]}` : null, precios };
}
async function obtenerPizarra() {
  let t;
  try {
    const r = await Promise.race([fetch(PIZARRA_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (PampaN ERP)', Accept: 'text/html' } }), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('tiempo de espera')), 15000); })]);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const p = leerPizarra(await r.text());
    if (!Object.keys(p.precios).length) throw new Error('no se pudieron leer los precios de la pizarra');
    return p;
  } finally { clearTimeout(t); }
}

// ─── Agromonitoring ───────────────────────────────────────────────────────────────────────
const lugar = ({ polyid, lat, lon }) => (polyid ? `polyid=${encodeURIComponent(polyid)}` : `lat=${Number(lat)}&lon=${Number(lon)}`);
const agroUrl = (ruta, clave) => `${AGRO_URL}${ruta}${ruta.includes('?') ? '&' : '?'}appid=${encodeURIComponent(clave)}`;
function normalizarClima(x) {
  return { fecha: unixAIso(x.dt), temperatura: kACelsius(x.main?.temp), humedad: x.main?.humidity ?? null, vientoKmh: msAKmh(x.wind?.speed), rafagaKmh: msAKmh(x.wind?.gust), vientoDireccion: x.wind?.deg ?? null, lluviaMm: Number(x.rain?.['3h'] ?? x.rain?.['1h'] ?? 0) || 0, nubes: x.clouds?.all ?? null, descripcion: x.weather?.[0]?.description || '' };
}
async function climaActual(p, clave) { return normalizarClima(await pedirJson(agroUrl(`/weather?${lugar(p)}`, clave))); }
async function pronostico(p, clave) { const l = await pedirJson(agroUrl(`/weather/forecast?${lugar(p)}`, clave)); return (Array.isArray(l) ? l : []).map(normalizarClima); }
async function lluviaAcumulada(p, clave, dias = 7) {
  const fin = Math.floor(Date.now() / 1000);
  const ini = fin - dias * 86400;
  const l = await pedirJson(agroUrl(`/weather/history/accumulated_precipitation?${lugar(p)}&start=${ini}&end=${fin}`, clave));
  const total = (Array.isArray(l) ? l : []).reduce((s, x) => s + (Number(x.rain) || 0), 0);
  return { dias, mm: Math.round(total * 10) / 10 };
}
async function suelo(polyid, clave) {
  const x = await pedirJson(agroUrl(`/soil?polyid=${encodeURIComponent(polyid)}`, clave));
  return { fecha: unixAIso(x.dt), humedad: x.moisture != null ? Math.round(Number(x.moisture) * 1000) / 10 : null, temperatura0cm: kACelsius(x.t0), temperatura10cm: kACelsius(x.t10) };
}
// NDVI: imágenes de los últimos días (Sentinel-2 / Landsat) con sus estadísticas, de la más nueva a la más vieja.
async function ndvi(polyid, clave, dias = 60) {
  const fin = Math.floor(Date.now() / 1000);
  const imagenes = await pedirJson(agroUrl(`/image/search?polyid=${encodeURIComponent(polyid)}&start=${fin - dias * 86400}&end=${fin}`, clave));
  const utiles = (Array.isArray(imagenes) ? imagenes : []).filter((i) => i.stats?.ndvi && Number(i.cl) <= 40).sort((a, b) => b.dt - a.dt).slice(0, 6);
  const serie = [];
  for (const i of utiles) {
    try {
      const s = await pedirJson(`${i.stats.ndvi}${i.stats.ndvi.includes('appid=') ? '' : `${i.stats.ndvi.includes('?') ? '&' : '?'}appid=${encodeURIComponent(clave)}`}`);
      serie.push({ fecha: unixAIso(i.dt), satelite: i.type, nubes: i.cl, media: s.mean != null ? Math.round(s.mean * 1000) / 1000 : null, min: s.min ?? null, max: s.max ?? null, p25: s.p25 ?? null, p75: s.p75 ?? null });
    } catch (e) { /* una imagen sin estadísticas no frena las demás */ }
  }
  return { serie };
}
async function crearPoligono(nombre, geoJson, clave) {
  if (!geoJson || geoJson.type !== 'Feature' || !['Polygon', 'MultiPolygon'].includes(geoJson.geometry?.type)) throw new Error('El polígono tiene que ser un GeoJSON Feature de tipo Polygon.');
  const x = await pedirJson(agroUrl('/polygons?duplicated=true', clave), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: String(nombre || 'Lote').slice(0, 80), geo_json: geoJson }) });
  return { id: x.id, nombre: x.name, hectareas: x.area != null ? Math.round(x.area * 10) / 10 : null, centro: Array.isArray(x.center) ? { lon: x.center[0], lat: x.center[1] } : null };
}

// ─── Atención de pedidos (Pages Function y escritorio) ───────────────────────────────────────────
// pedido: { tipo, lat, lon, polyid, nombre, geoJson }. cache: { get(clave), put(clave, valor, segundos) } opcional.
async function atenderDatos(pedido, { clave, cache } = {}) {
  const tipo = String(pedido?.tipo || '');
  const conCache = async (k, minutos, fn) => {
    if (cache) { const v = await cache.get(k); if (v) return { ...JSON.parse(v), cache: true }; }
    const valor = { ...(await fn()), obtenido: new Date().toISOString() };
    if (cache) await cache.put(k, JSON.stringify(valor), minutos * 60);
    return valor;
  };
  if (tipo === 'estado') return { ok: true, dolar: true, pizarra: true, agro: Boolean(clave) };
  if (tipo === 'dolar') return { ok: true, ...(await conCache('datos:dolar', CACHE_MIN.dolar, obtenerDolares)) };
  if (tipo === 'pizarra') return { ok: true, ...(await conCache('datos:pizarra', CACHE_MIN.pizarra, obtenerPizarra)) };
  if (tipo === 'dolarHistorico') { const casa = ['bolsa', 'oficial', 'blue', 'contadoconliqui', 'mayorista'].includes(pedido.casa) ? pedido.casa : 'bolsa'; return { ok: true, ...(await conCache(`datos:historico:${casa}`, CACHE_MIN.dolarHistorico, () => obtenerDolarHistorico(casa))) }; }
  if (!clave) return { ok: false, error: 'Agromonitoring no está configurado en el servidor.', status: 503 };
  if (tipo === 'poligono') return { ok: true, poligono: await crearPoligono(pedido.nombre, pedido.geoJson, clave) };
  const p = { polyid: pedido.polyid ? String(pedido.polyid).replace(/[^\w-]/g, '') : '', lat: Number(pedido.lat), lon: Number(pedido.lon) };
  if (!p.polyid && !(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && (p.lat || p.lon))) return { ok: false, error: 'Falta el lote (polígono) o la ubicación.', status: 400 };
  const k = (t) => `datos:${t}:${p.polyid || `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`}`;
  if (tipo === 'clima') return { ok: true, ...(await conCache(k('clima'), CACHE_MIN.clima, async () => ({ actual: await climaActual(p, clave), pronostico: (await pronostico(p, clave)).slice(0, 16) }))) };
  if (tipo === 'lluvia') return { ok: true, ...(await conCache(k('lluvia'), CACHE_MIN.lluvia, () => lluviaAcumulada(p, clave))) };
  if (tipo === 'suelo') { if (!p.polyid) return { ok: false, error: 'La humedad del suelo necesita el polígono del lote.', status: 400 }; return { ok: true, ...(await conCache(k('suelo'), CACHE_MIN.suelo, () => suelo(p.polyid, clave))) }; }
  if (tipo === 'ndvi') { if (!p.polyid) return { ok: false, error: 'El NDVI necesita el polígono del lote.', status: 400 }; return { ok: true, ...(await conCache(k('ndvi'), CACHE_MIN.ndvi, () => ndvi(p.polyid, clave))) }; }
  return { ok: false, error: 'Tipo de dato desconocido.', status: 400 };
}


// ─── Pages Function: /api/pampa-datos ─────────────────────────────────────────────────────────────
const respuestaJson = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const cacheKv = (kv) => (kv ? { get: (k) => kv.get(k), put: (k, v, segundos) => kv.put(k, v, { expirationTtl: Math.max(60, segundos) }) } : null);
// Límite diario por IP para lo que gasta cupo de Agromonitoring (el dólar sale de la caché).
async function dentroDelLimite(env, request, tipo) {
  const kv = env.PAMPA_TRIAL_KV;
  if (!kv || tipo === 'dolar' || tipo === 'estado') return true;
  const limite = tipo === 'poligono' ? 20 : Number(env.PAMPA_DATOS_LIMITE_DIARIO) || 300;
  const clave = `datos-limite:${tipo === 'poligono' ? 'poligono' : 'agro'}:${new Date().toISOString().slice(0, 10)}:${request.headers.get('CF-Connecting-IP') || 'sin-ip'}`;
  const usadas = Number(await kv.get(clave)) || 0;
  if (usadas >= limite) return false;
  await kv.put(clave, String(usadas + 1), { expirationTtl: 60 * 60 * 26 });
  return true;
}
async function responder(pedido, env, request) {
  if (!(await dentroDelLimite(env, request, pedido.tipo))) return respuestaJson({ ok: false, error: 'Se alcanzó el límite diario de consultas de clima y satélite.' }, 429);
  try {
    const r = await atenderDatos(pedido, { clave: env.AGROMONITORING_API_KEY || env.OPENWEATHER_AGRO_API_KEY || '', cache: cacheKv(env.PAMPA_TRIAL_KV) });
    return respuestaJson(r, r.ok ? 200 : r.status || 400);
  } catch (e) {
    return respuestaJson({ ok: false, error: `No se pudo obtener el dato (${e.message}).` }, 502);
  }
}
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  return responder(Object.fromEntries(u.searchParams), env, request);
}
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return respuestaJson({ ok: false, error: 'Pedido inválido.' }, 400); }
  return responder({ ...body, tipo: 'poligono' }, env, request);
}
