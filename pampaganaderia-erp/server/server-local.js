const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { obtenerEstadoCache } = require('../services/services-afipManager');
const { cotizarTasaMunicipal, validarPagoMunicipal } = require('../services/fiscalMunicipalService');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.join(ROOT, 'datos-productor.json');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function leerDatos() {
  try {
    return { boletosMarca: [], notificaciones: [], pesajes: [], ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (error) {
    return { boletosMarca: [], notificaciones: [], pesajes: [] };
  }
}

function guardarDatos(datos) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(datos, null, 2), 'utf8');
}

function responder(res, status, datos) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(datos));
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let cuerpo = '';
    req.on('data', fragmento => { cuerpo += fragmento; });
    req.on('end', () => {
      try { resolve(cuerpo ? JSON.parse(cuerpo) : {}); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function servirArchivo(req, res, ruta) {
  const rutaDecodificada = decodeURIComponent(ruta);
  const rutaRelativa = ruta === '/' || rutaDecodificada === '/GESTION GANADERA.html' ? '/index.html' : rutaDecodificada;
  const archivo = path.resolve(ROOT, `.${rutaRelativa}`);
  if (!archivo.startsWith(ROOT) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Archivo no encontrado');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(archivo).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(archivo).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const datos = leerDatos();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  try {
    if (url.pathname === '/api/balanza/peso-vivo' && req.method === 'GET') {
      responder(res, 200, { peso: 0 });
      return;
    }
    if (url.pathname === '/api/balanza/rfid-actual' && req.method === 'GET') {
      responder(res, 200, { caravana: 'SIN_LECTURA' });
      return;
    }
    if (url.pathname === '/api/sistema/telemetria-afip' && req.method === 'GET') {
      responder(res, 200, obtenerEstadoCache());
      return;
    }
    if (url.pathname === '/api/dashboard/movimientos-hacienda' && req.method === 'GET') {
      responder(res, 200, { success: true, porCategoria: [], historicoMensual: [] });
      return;
    }
    if (url.pathname === '/api/fiscal/tasa-municipal/cotizar' && req.method === 'POST') {
      const cuerpo = await leerCuerpo(req);
      responder(res, 200, { success: true, cotizacion: cotizarTasaMunicipal(cuerpo) });
      return;
    }
    if (url.pathname === '/api/fiscal/tasa-municipal/validar' && req.method === 'POST') {
      const cuerpo = await leerCuerpo(req);
      try {
        responder(res, 200, { success: true, cotizacion: validarPagoMunicipal(cuerpo) });
      } catch (error) {
        responder(res, 422, { success: false, codigo: error.codigo, message: error.message, cotizacion: error.cotizacion });
      }
      return;
    }
    if (url.pathname.startsWith('/api/boletos-marca/') && req.method === 'GET') {
      const numero = decodeURIComponent(url.pathname.replace('/api/boletos-marca/', '')).trim();
      const boleto = datos.boletosMarca.find(item => item.nroBoleto === numero);
      if (!boleto) {
        responder(res, 404, { valido: false, message: 'Boleto no registrado localmente. Cargalo antes de emitir el DUT.' });
        return;
      }
      const vigente = boleto.estado !== false && (!boleto.fechaVencimiento || new Date(boleto.fechaVencimiento) >= new Date());
      responder(res, vigente ? 200 : 422, { valido: vigente, boleto, message: vigente ? 'Boleto de marca válido.' : 'El boleto de marca está vencido o inactivo.' });
      return;
    }
    if (url.pathname === '/api/boletos-marca' && req.method === 'POST') {
      const cuerpo = await leerCuerpo(req);
      if (!cuerpo.nroBoleto || !cuerpo.tipoGanado || !cuerpo.fechaVencimiento) {
        responder(res, 400, { success: false, message: 'Faltan número, tipo de ganado o vencimiento.' });
        return;
      }
      const existente = datos.boletosMarca.find(item => item.nroBoleto === cuerpo.nroBoleto);
      if (existente) {
        responder(res, 409, { success: false, message: 'El boleto ya está registrado.' });
        return;
      }
      const boleto = { nroBoleto: cuerpo.nroBoleto, tipoGanado: cuerpo.tipoGanado, fechaVencimiento: cuerpo.fechaVencimiento, estado: cuerpo.estado !== false };
      datos.boletosMarca.push(boleto);
      guardarDatos(datos);
      responder(res, 201, { success: true, boleto });
      return;
    }
    if (url.pathname === '/api/boletos-marca' && req.method === 'GET') {
      responder(res, 200, { boletos: datos.boletosMarca });
      return;
    }
    if (url.pathname === '/api/logistica/auditar-cierre-viaje' && req.method === 'POST') {
      const cuerpo = await leerCuerpo(req);
      const origen = Number(cuerpo.pesoOrigen || 0);
      const destino = Number(cuerpo.pesoDestino || 0);
      const tolerancia = Number(cuerpo.tolerancia || 4.5);
      const perdida = origen - destino;
      const porcentaje = origen > 0 ? (perdida / origen) * 100 : 0;
      responder(res, 200, { success: true, auditoria: { perdidaFisicaKg: perdida, porcentajeMermaReal: porcentaje, esCritica: porcentaje > tolerancia, alertaContable: porcentaje > tolerancia ? 'La merma supera la tolerancia.' : 'Merma dentro del rango esperado.' } });
      return;
    }
    if (url.pathname === '/api/logistica/notificar-chofer' && req.method === 'POST') {
      const cuerpo = await leerCuerpo(req);
      datos.notificaciones.push({ ...cuerpo, fecha: new Date().toISOString() });
      guardarDatos(datos);
      responder(res, 200, { success: true, message: 'Notificación guardada localmente.' });
      return;
    }
    if (url.pathname === '/api/balanza/registrar-animal' && req.method === 'POST') {
      const cuerpo = await leerCuerpo(req);
      datos.pesajes.push({ ...cuerpo, fecha: new Date().toISOString() });
      guardarDatos(datos);
      responder(res, 200, { success: true, message: 'Pesada guardada localmente.' });
      return;
    }
    if (url.pathname === '/api/logistica/emitir-dut-lote' && req.method === 'POST') {
      responder(res, 503, { success: false, message: 'Sincronización DUT pendiente de conectar el adaptador oficial ARCA/SENASA.', resultados: [] });
      return;
    }
    if (url.pathname === '/api/logistica/emitir-dut' && req.method === 'POST') {
      responder(res, 503, { success: false, message: 'Emisión DUT pendiente de configurar credenciales AFIP/SENASA.' });
      return;
    }
    servirArchivo(req, res, url.pathname);
  } catch (error) {
    responder(res, 500, { success: false, message: 'Error interno del servidor local.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PampaGanaderia ERP disponible en http://127.0.0.1:${PORT}/`);
  console.log('Datos locales: datos-productor.json');
});
