// === ASISTENTE DE IA (OCR de documentos + parte de campo por voz) ===
// La clave del proveedor vive solo en el servidor: el cliente solo llama a /api/ia.

let iaEstadoCache = null;
let iaBaseUrlCache = null;
let iaMediaRecorder = null;
let iaAudioChunks = [];
let iaAudioPendiente = null;
let iaDocumentoPendiente = null;
let iaResultadoDocumento = null;
let iaResultadoVoz = null;

async function iaBaseUrl() {
  if (iaBaseUrlCache !== null) return iaBaseUrlCache;

  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    iaBaseUrlCache = '';
    return iaBaseUrlCache;
  }

  if (window.electronAPI?.getServerUrl) {
    try {
      const result = await window.electronAPI.getServerUrl();
      iaBaseUrlCache = (result?.url || result?.lanUrl || '').replace(/\/+$/, '');
      return iaBaseUrlCache;
    } catch (e) {
      console.warn('No se pudo resolver la URL del servidor de IA:', e);
    }
  }

  iaBaseUrlCache = '';
  return iaBaseUrlCache;
}

const IA_CLAVE_STORAGE = 'nexoAgroAiKey';

// En Electron la clave queda cifrada en disco y no vuelve al renderer.
function iaClaveEsGestionadaPorElectron() {
  return Boolean(window.electronAPI?.setAiKey);
}

function iaClaveLocal() {
  if (iaClaveEsGestionadaPorElectron()) return '';
  try {
    return localStorage.getItem(IA_CLAVE_STORAGE) || '';
  } catch {
    return '';
  }
}

function iaEstadoClave() {
  if (iaClaveEsGestionadaPorElectron()) {
    try {
      return window.electronAPI.getAiKeyStatus() || { configurada: false, enmascarada: '' };
    } catch {
      return { configurada: false, enmascarada: '' };
    }
  }

  const clave = iaClaveLocal();
  return {
    configurada: Boolean(clave),
    enmascarada: clave ? `${clave.slice(0, 3)}…${clave.slice(-4)}` : ''
  };
}

async function iaGuardarClave(clave) {
  const limpia = String(clave || '').trim();

  if (iaClaveEsGestionadaPorElectron()) {
    const res = await window.electronAPI.setAiKey(limpia);
    if (!res?.ok) throw new Error(res?.message || 'No se pudo guardar la clave');
    return;
  }

  if (limpia) localStorage.setItem(IA_CLAVE_STORAGE, limpia);
  else localStorage.removeItem(IA_CLAVE_STORAGE);
}

async function iaFetch(ruta, body) {
  const base = await iaBaseUrl();
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';

  const clave = iaClaveLocal();
  if (clave) headers['X-AI-Key'] = clave;

  const res = await fetch(`${base}/api/ia${ruta}`, {
    method: body ? 'POST' : 'GET',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `El asistente de IA respondió ${res.status}`);
  }
  return data;
}

async function iaEstado(forzar = false) {
  if (iaEstadoCache && !forzar) return iaEstadoCache;
  try {
    iaEstadoCache = await iaFetch('/estado');
  } catch (e) {
    iaEstadoCache = { ok: false, configurado: false, error: e.message };
  }
  return iaEstadoCache;
}

// Contexto que se envía a la IA para que sugiera códigos existentes en lugar de inventar.
function iaContexto() {
  return {
    inventario: (state.inventario || []).map((p) => ({ codigo: p.codigo, producto: p.producto, unidad: p.unidad })),
    lotes: (state.lotes || []).map((l) => ({ codigo: l.codigo, nombre: l.nombre })),
    maquinarias: (state.maquinarias || []).map((m) => ({ codigo: m.codigo, equipo: m.equipo }))
  };
}

function iaHoy() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

function iaNumero(valor) {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function iaArchivoABase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

function iaOpcionesInventario(seleccionado) {
  const opciones = (state.inventario || []).map((p) =>
    `<option value="${escapeHtmlRoles(p.codigo)}" ${p.codigo === seleccionado ? 'selected' : ''}>${escapeHtmlRoles(p.codigo)} - ${escapeHtmlRoles(p.producto)}</option>`
  ).join('');
  return `<option value="">— No cargar stock —</option><option value="__nuevo__">➕ Crear producto nuevo</option>${opciones}`;
}

/* ---------- Modal principal ---------- */

function abrirAsistenteIA(pestana = 'documento') {
  cerrarAsistenteIA();

  const modalHTML = `
    <div class="modal-overlay active" id="asistenteIAModal" onclick="if(event.target === this) cerrarAsistenteIA()">
      <div class="modal" style="max-width:860px; width:min(96vw, 860px);">
        <div class="modal-header">
          <div class="modal-title">🤖 Asistente de IA</div>
          <button class="modal-close" onclick="cerrarAsistenteIA()">×</button>
        </div>
        <div class="modal-body">
          <div id="iaEstadoBanner" style="margin-bottom:14px; font-size:12px; color:var(--text-dim);">Verificando el servicio de IA…</div>

          <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
            <button class="btn" id="iaTabDocumento" onclick="iaCambiarPestana('documento')">📷 Documento</button>
            <button class="btn" id="iaTabVoz" onclick="iaCambiarPestana('voz')">🎤 Parte de campo</button>
            <button class="btn" id="iaTabPendientes" onclick="iaCambiarPestana('pendientes')">📥 Pendientes</button>
            <button class="btn" id="iaTabConfig" onclick="iaCambiarPestana('config')">🔑 Configuración</button>
          </div>

          <div id="iaPanelDocumento" style="display:none;">
            <p style="font-size:12px; color:var(--text-dim); margin-bottom:10px;">
              Sacá una foto de la factura, remito o liquidación. La IA extrae proveedor, importes e ítems, y podés confirmar la carga contable y el ingreso a stock.
            </p>
            <input type="file" id="iaArchivoDocumento" accept="image/*" capture="environment" class="form-input" onchange="iaSeleccionarDocumento(this.files[0])">
            <div id="iaPreviewDocumento" style="margin:12px 0;"></div>
            <button class="btn btn-primary" id="iaBtnAnalizar" onclick="iaAnalizarDocumento()" disabled>Analizar documento</button>
            <div id="iaResultadoDocumento" style="margin-top:16px;"></div>
          </div>

          <div id="iaPanelVoz" style="display:none;">
            <p style="font-size:12px; color:var(--text-dim); margin-bottom:10px;">
              Dictá el parte. Ejemplo: "Aplicamos 30 litros de glifosato en el lote Don Pedro con la pulverizadora".
            </p>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
              <button class="btn btn-primary" id="iaBtnGrabar" onclick="iaAlternarGrabacion()">🎤 Grabar</button>
              <button class="btn" onclick="iaInterpretarTextoManual()">Interpretar texto escrito</button>
            </div>
            <textarea class="form-input" id="iaTextoParte" rows="3" placeholder="También podés escribir el parte acá"></textarea>
            <div id="iaResultadoVoz" style="margin-top:16px;"></div>
          </div>

          <div id="iaPanelPendientes" style="display:none;"></div>

          <div id="iaPanelConfig" style="display:none;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="cerrarAsistenteIA()">Cerrar</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  iaCambiarPestana(pestana);
  iaRefrescarBanner();
}

function cerrarAsistenteIA() {
  if (iaMediaRecorder && iaMediaRecorder.state === 'recording') {
    try { iaMediaRecorder.stop(); } catch (e) { /* ignorado */ }
  }
  document.getElementById('asistenteIAModal')?.remove();
}

function iaCambiarPestana(pestana) {
  ['documento', 'voz', 'pendientes', 'config'].forEach((p) => {
    const panel = document.getElementById(`iaPanel${p.charAt(0).toUpperCase()}${p.slice(1)}`);
    const tab = document.getElementById(`iaTab${p.charAt(0).toUpperCase()}${p.slice(1)}`);
    if (panel) panel.style.display = p === pestana ? 'block' : 'none';
    if (tab) tab.classList.toggle('btn-primary', p === pestana);
  });
  if (pestana === 'pendientes') iaRenderPendientes();
  if (pestana === 'config') iaRenderConfig();
}

function iaRenderConfig() {
  const panel = document.getElementById('iaPanelConfig');
  if (!panel) return;

  const estado = iaEstadoClave();
  const donde = iaClaveEsGestionadaPorElectron()
    ? 'Se guarda cifrada (AES-256-GCM) en este equipo.'
    : 'Se guarda solo en este navegador o teléfono.';

  panel.innerHTML = `
    <p style="font-size:12px; color:var(--text-dim); margin-bottom:12px;">
      El asistente usa tu propia cuenta de OpenAI. Pegá la clave que te entregamos o la que generaste en
      <strong>platform.openai.com</strong>. ${donde} Nunca se comparte con otros usuarios.
    </p>
    <div style="margin-bottom:12px; font-size:12px;">
      Estado: ${estado.configurada
        ? `<strong style="color:var(--green);">Configurada</strong> (${escapeHtmlRoles(estado.enmascarada)})`
        : '<strong style="color:var(--orange);">Sin configurar</strong>'}
    </div>
    <div class="form-group">
      <label class="form-label">Clave de OpenAI</label>
      <input class="form-input" id="iaClaveInput" type="password" autocomplete="off" placeholder="sk-...">
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button class="btn btn-primary" onclick="iaGuardarClaveDesdeModal()">Guardar clave</button>
      <button class="btn btn-danger" onclick="iaBorrarClaveDesdeModal()" ${estado.configurada ? '' : 'disabled'}>Quitar clave</button>
    </div>
    <p style="font-size:11px; color:var(--text-dim); margin-top:12px;">
      Sin clave cargada, el resto del ERP funciona igual: solo queda deshabilitado el asistente de IA.
    </p>
  `;
}

async function iaGuardarClaveDesdeModal() {
  const input = document.getElementById('iaClaveInput');
  const clave = (input?.value || '').trim();

  if (!clave) {
    showToast('Pegá la clave antes de guardar', 'error');
    return;
  }

  try {
    await iaGuardarClave(clave);
    if (input) input.value = '';
    iaRenderConfig();
    await iaRefrescarBanner();
    showToast('Clave de IA guardada', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function iaBorrarClaveDesdeModal() {
  try {
    await iaGuardarClave('');
    iaRenderConfig();
    await iaRefrescarBanner();
    showToast('Clave de IA eliminada', 'info');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function iaRefrescarBanner() {
  const banner = document.getElementById('iaEstadoBanner');
  if (!banner) return;

  if (!navigator.onLine) {
    banner.innerHTML = '⚡ <strong>Sin conexión.</strong> Podés grabar y sacar fotos: quedan en pendientes y se procesan cuando vuelva la señal.';
    return;
  }

  const estado = await iaEstado(true);
  if (estado.configurado) {
    banner.innerHTML = `☁️ Asistente listo (modelo ${escapeHtmlRoles(estado.modelos?.texto || '')}).`;
  } else {
    banner.innerHTML = '⚠️ <strong>Falta cargar tu clave de OpenAI.</strong> Andá a la pestaña 🔑 Configuración.';
  }
}

/* ---------- OCR de documentos ---------- */

async function iaSeleccionarDocumento(file) {
  const preview = document.getElementById('iaPreviewDocumento');
  const boton = document.getElementById('iaBtnAnalizar');
  iaDocumentoPendiente = null;
  iaResultadoDocumento = null;
  document.getElementById('iaResultadoDocumento').innerHTML = '';

  if (!file) {
    if (preview) preview.innerHTML = '';
    if (boton) boton.disabled = true;
    return;
  }

  if (file.size > 15 * 1024 * 1024) {
    showToast('La imagen supera los 15 MB', 'error');
    return;
  }

  const base64 = await iaArchivoABase64(file);
  iaDocumentoPendiente = { imagenBase64: base64, mimeType: file.type || 'image/jpeg', nombre: file.name };

  if (preview) {
    preview.innerHTML = `<img src="data:${iaDocumentoPendiente.mimeType};base64,${base64}" alt="Documento" style="max-width:100%; max-height:240px; border-radius:8px; border:1px solid var(--border);">`;
  }
  if (boton) boton.disabled = false;
}

async function iaAnalizarDocumento() {
  if (!iaDocumentoPendiente) return;

  if (!navigator.onLine) {
    iaEncolarPendiente('documento', iaDocumentoPendiente);
    showToast('Sin conexión: el documento quedó en pendientes', 'info');
    return;
  }

  const boton = document.getElementById('iaBtnAnalizar');
  const contenedor = document.getElementById('iaResultadoDocumento');
  if (boton) { boton.disabled = true; boton.textContent = 'Analizando…'; }
  if (contenedor) contenedor.innerHTML = '<div style="font-size:12px;color:var(--text-dim);">Leyendo el documento…</div>';

  try {
    const { datos } = await iaFetch('/documento', {
      imagenBase64: iaDocumentoPendiente.imagenBase64,
      mimeType: iaDocumentoPendiente.mimeType,
      contexto: iaContexto()
    });
    iaResultadoDocumento = datos;
    iaRenderResultadoDocumento(datos);
  } catch (e) {
    if (contenedor) contenedor.innerHTML = `<div style="color:var(--red);font-size:12px;">${escapeHtmlRoles(e.message)}</div>`;
  } finally {
    if (boton) { boton.disabled = false; boton.textContent = 'Analizar documento'; }
  }
}

function iaRenderResultadoDocumento(datos) {
  const contenedor = document.getElementById('iaResultadoDocumento');
  if (!contenedor) return;

  const items = Array.isArray(datos.items) ? datos.items : [];
  const filas = items.map((item, i) => `
    <tr>
      <td>
        <input class="form-input" id="iaItemDesc${i}" value="${escapeHtmlRoles(item.descripcion)}">
      </td>
      <td><input class="form-input" id="iaItemCant${i}" type="number" step="any" value="${iaNumero(item.cantidad)}" style="width:90px;"></td>
      <td><input class="form-input" id="iaItemUnidad${i}" value="${escapeHtmlRoles(item.unidad)}" style="width:80px;"></td>
      <td><input class="form-input" id="iaItemImporte${i}" type="number" step="any" value="${iaNumero(item.importe)}" style="width:110px;"></td>
      <td><select class="form-select" id="iaItemProducto${i}">${iaOpcionesInventario(item.productoSugerido)}</select></td>
    </tr>
  `).join('');

  const confianza = Math.round(iaNumero(datos.confianza) * 100);

  contenedor.innerHTML = `
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">
      Confianza estimada: <strong>${confianza}%</strong>. Revisá y corregí antes de confirmar.
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;">
      <div class="form-group" style="margin:0;"><label class="form-label">Tipo</label><input class="form-input" id="iaDocTipo" value="${escapeHtmlRoles(datos.tipoDocumento)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Proveedor</label><input class="form-input" id="iaDocProveedor" value="${escapeHtmlRoles(datos.proveedor)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">CUIT</label><input class="form-input" id="iaDocCuit" value="${escapeHtmlRoles(datos.cuit)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Número</label><input class="form-input" id="iaDocNumero" value="${escapeHtmlRoles(datos.numero)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Fecha</label><input class="form-input" id="iaDocFecha" type="date" value="${escapeHtmlRoles(datos.fecha || iaHoy())}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Neto</label><input class="form-input" id="iaDocNeto" type="number" step="any" value="${iaNumero(datos.neto)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">IVA</label><input class="form-input" id="iaDocIva" type="number" step="any" value="${iaNumero(datos.iva)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Total</label><input class="form-input" id="iaDocTotal" type="number" step="any" value="${iaNumero(datos.total)}"></div>
      <div class="form-group" style="margin:0;">
        <label class="form-label">Registrar pago en</label>
        <select class="form-select" id="iaDocDestino">
          <option value="caja">Caja</option>
          <option value="bancos">Bancos</option>
          <option value="ninguno">No registrar pago</option>
        </select>
      </div>
    </div>

    ${items.length ? `
      <div style="max-height:240px;overflow:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:14px;">
        <table class="data-table" style="margin:0;">
          <thead><tr><th>Descripción</th><th>Cant.</th><th>Unidad</th><th>Importe</th><th>Producto de inventario</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    ` : '<div style="font-size:12px;color:var(--text-dim);margin-bottom:14px;">La IA no detectó ítems en el documento.</div>'}

    <button class="btn btn-primary" onclick="iaConfirmarDocumento(${items.length})">Confirmar y cargar en el ERP</button>
  `;
}

function iaConfirmarDocumento(cantidadItems) {
  if (!iaResultadoDocumento) return;

  const fecha = document.getElementById('iaDocFecha').value || iaHoy();
  const proveedor = document.getElementById('iaDocProveedor').value.trim();
  const numero = document.getElementById('iaDocNumero').value.trim();
  const tipo = document.getElementById('iaDocTipo').value.trim() || 'Factura';
  const cuit = document.getElementById('iaDocCuit').value.trim();
  const total = iaNumero(document.getElementById('iaDocTotal').value);
  const destino = document.getElementById('iaDocDestino').value;

  const tiposValidos = ['Contrato', 'Factura', 'Comprobante', 'Licencia', 'Permiso', 'Certificado', 'Presupuesto', 'Otro'];
  state.documentos.push({
    nombre: `${tipo} ${numero || 'sin número'} - ${proveedor || 'sin proveedor'}`.trim(),
    tipo: tiposValidos.includes(tipo) ? tipo : 'Comprobante',
    categoria: 'Finanzas',
    fecha,
    descripcion: `Cargado con IA. CUIT ${cuit || '-'}. Neto ${iaNumero(document.getElementById('iaDocNeto').value)} / IVA ${iaNumero(document.getElementById('iaDocIva').value)} / Total ${total}.`,
    proveedor
  });

  if (destino === 'caja' && total > 0) {
    state.caja.push({
      fecha,
      concepto: 'Pago de proveedor',
      tipo: 'Egreso',
      importe: String(total),
      categoria: 'Insumos',
      referencia: numero
    });
  } else if (destino === 'bancos' && total > 0) {
    state.bancos.push({
      fecha,
      banco: 'Otros',
      concepto: 'Pago de proveedor',
      tipo: 'Egreso',
      importe: String(total),
      referencia: numero
    });
  }

  let movimientos = 0;
  for (let i = 0; i < cantidadItems; i++) {
    const seleccion = document.getElementById(`iaItemProducto${i}`)?.value || '';
    if (!seleccion) continue;

    const descripcion = document.getElementById(`iaItemDesc${i}`).value.trim();
    const cantidad = iaNumero(document.getElementById(`iaItemCant${i}`).value);
    const unidad = document.getElementById(`iaItemUnidad${i}`).value.trim() || 'unidades';
    const importe = iaNumero(document.getElementById(`iaItemImporte${i}`).value);
    if (cantidad <= 0) continue;

    let codigo = seleccion;
    if (seleccion === '__nuevo__') {
      const categoria = 'Insumos Agrícolas';
      codigo = generarCodigoAutomatico('inventario', 'codigo', {
        pad: 3,
        byField: 'categoria',
        prefixMap: { 'Insumos Agrícolas': 'AG', 'Insumos Ganaderos': 'GA', 'Alimentación': 'AL', 'Repuestos y Herramientas': 'RH', 'Combustibles': 'CO', 'Productos Terminados': 'PT' }
      }, { categoria });

      state.inventario.push({
        codigo,
        producto: descripcion || 'Producto sin nombre',
        categoria,
        stock: 0,
        unidad,
        costoUnit: cantidad ? importe / cantidad : 0,
        stockMinimo: 0
      });
    }

    const data = {
      fecha,
      producto: codigo,
      tipo: 'Entrada',
      cantidad,
      motivo: 'Compra',
      observaciones: `${tipo} ${numero || ''} - ${proveedor || ''}`.trim()
    };
    state.movimientoStock.unshift(data);
    procesarEfectosPostSave('movimientoStock', data, null);
    movimientos++;
  }

  saveState();
  actualizarSelectoresDinamicos();
  renderTables();
  cerrarAsistenteIA();
  showToast(`Documento cargado. ${movimientos} movimiento(s) de stock generados.`, 'success');
}

/* ---------- Parte de campo por voz ---------- */

async function iaAlternarGrabacion() {
  const boton = document.getElementById('iaBtnGrabar');

  if (iaMediaRecorder && iaMediaRecorder.state === 'recording') {
    iaMediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    showToast('Este dispositivo no permite grabar audio. Escribí el parte.', 'error');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    iaAudioChunks = [];
    iaMediaRecorder = new MediaRecorder(stream);

    iaMediaRecorder.ondataavailable = (e) => { if (e.data.size) iaAudioChunks.push(e.data); };
    iaMediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (boton) { boton.textContent = '🎤 Grabar'; boton.classList.remove('btn-danger'); }

      const blob = new Blob(iaAudioChunks, { type: iaMediaRecorder.mimeType || 'audio/webm' });
      const base64 = await iaArchivoABase64(new File([blob], 'parte.webm', { type: blob.type }));
      iaAudioPendiente = { audioBase64: base64, mimeType: blob.type, nombreArchivo: 'parte.webm' };
      await iaProcesarAudio();
    };

    iaMediaRecorder.start();
    if (boton) { boton.textContent = '⏹️ Detener'; boton.classList.add('btn-danger'); }
  } catch (e) {
    showToast('No se pudo acceder al micrófono', 'error');
  }
}

async function iaProcesarAudio() {
  if (!iaAudioPendiente) return;

  if (!navigator.onLine) {
    iaEncolarPendiente('voz', iaAudioPendiente);
    showToast('Sin conexión: el parte quedó en pendientes', 'info');
    return;
  }

  const contenedor = document.getElementById('iaResultadoVoz');
  if (contenedor) contenedor.innerHTML = '<div style="font-size:12px;color:var(--text-dim);">Transcribiendo el parte…</div>';

  try {
    const { texto, datos } = await iaFetch('/voz', { ...iaAudioPendiente, contexto: iaContexto() });
    const campoTexto = document.getElementById('iaTextoParte');
    if (campoTexto) campoTexto.value = texto;
    iaResultadoVoz = datos;
    iaRenderResultadoVoz(texto, datos);
  } catch (e) {
    if (contenedor) contenedor.innerHTML = `<div style="color:var(--red);font-size:12px;">${escapeHtmlRoles(e.message)}</div>`;
  }
}

async function iaInterpretarTextoManual() {
  const texto = document.getElementById('iaTextoParte')?.value.trim();
  if (!texto) {
    showToast('Escribí o dictá el parte primero', 'error');
    return;
  }

  if (!navigator.onLine) {
    iaEncolarPendiente('texto', { texto });
    showToast('Sin conexión: el parte quedó en pendientes', 'info');
    return;
  }

  const contenedor = document.getElementById('iaResultadoVoz');
  if (contenedor) contenedor.innerHTML = '<div style="font-size:12px;color:var(--text-dim);">Interpretando…</div>';

  try {
    const { datos } = await iaFetch('/parte-campo', { texto, contexto: iaContexto() });
    iaResultadoVoz = datos;
    iaRenderResultadoVoz(texto, datos);
  } catch (e) {
    if (contenedor) contenedor.innerHTML = `<div style="color:var(--red);font-size:12px;">${escapeHtmlRoles(e.message)}</div>`;
  }
}

function iaRenderResultadoVoz(texto, datos) {
  const contenedor = document.getElementById('iaResultadoVoz');
  if (!contenedor) return;

  const acciones = {
    aplicacion: 'Aplicación en lote',
    movimientoStock: 'Movimiento de stock',
    cargacombustible: 'Carga de combustible',
    mantenimiento: 'Mantenimiento',
    desconocida: 'No identificada'
  };

  const faltantes = Array.isArray(datos.faltaInformacion) ? datos.faltaInformacion : [];
  const confianza = Math.round(iaNumero(datos.confianza) * 100);

  contenedor.innerHTML = `
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">
      Transcripción: “${escapeHtmlRoles(texto)}” · Confianza ${confianza}%
    </div>
    ${faltantes.length ? `<div style="font-size:12px;color:var(--orange);margin-bottom:10px;">Falta confirmar: ${escapeHtmlRoles(faltantes.join(', '))}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px;">
      <div class="form-group" style="margin:0;">
        <label class="form-label">Acción</label>
        <select class="form-select" id="iaVozAccion">
          ${Object.entries(acciones).map(([k, v]) => `<option value="${k}" ${k === datos.accion ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin:0;"><label class="form-label">Fecha</label><input class="form-input" id="iaVozFecha" type="date" value="${escapeHtmlRoles(datos.fecha || iaHoy())}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Lote</label><input class="form-input" id="iaVozLote" value="${escapeHtmlRoles(datos.lote)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Producto</label><select class="form-select" id="iaVozProducto">${iaOpcionesInventario(datos.productoSugerido)}</select></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Cantidad</label><input class="form-input" id="iaVozCantidad" type="number" step="any" value="${iaNumero(datos.cantidad)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Equipo</label><input class="form-input" id="iaVozEquipo" value="${escapeHtmlRoles(datos.equipo)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Operario</label><input class="form-input" id="iaVozOperario" value="${escapeHtmlRoles(datos.operario)}"></div>
    </div>
    <button class="btn btn-primary" onclick="iaConfirmarParteCampo()">Confirmar y registrar</button>
  `;
}

function iaConfirmarParteCampo() {
  const accion = document.getElementById('iaVozAccion').value;
  const fecha = document.getElementById('iaVozFecha').value || iaHoy();
  const lote = document.getElementById('iaVozLote').value.trim();
  const producto = document.getElementById('iaVozProducto').value;
  const cantidad = iaNumero(document.getElementById('iaVozCantidad').value);
  const equipo = document.getElementById('iaVozEquipo').value.trim();
  const operario = document.getElementById('iaVozOperario').value.trim();
  const observaciones = `Parte de campo cargado con IA${iaResultadoVoz?.observaciones ? `: ${iaResultadoVoz.observaciones}` : ''}`;

  if (accion === 'desconocida') {
    showToast('Elegí una acción antes de confirmar', 'error');
    return;
  }

  if (accion === 'aplicacion') {
    if (!producto || producto === '__nuevo__' || cantidad <= 0) {
      showToast('Seleccioná un producto del inventario y una cantidad', 'error');
      return;
    }
    const productos = [{ producto, deposito: '', dosis: '', cantidad }];
    if (!descontarStockAplicacion(productos)) return;

    state.aplicaciones.push({
      fecha,
      establecimiento: iaResultadoVoz?.establecimiento || '',
      campaña: '',
      lote,
      hectareas: '',
      tipo: '',
      operario,
      equipo,
      estado: 'Realizada',
      observaciones,
      productos
    });
    state.movimientoStock.unshift({
      fecha, producto, tipo: 'Salida', cantidad, motivo: 'Consumo',
      observaciones: `Aplicación lote ${lote || '-'}`
    });
  } else if (accion === 'movimientoStock') {
    if (!producto || producto === '__nuevo__' || cantidad <= 0) {
      showToast('Seleccioná un producto del inventario y una cantidad', 'error');
      return;
    }
    const data = { fecha, producto, tipo: 'Salida', cantidad, motivo: 'Consumo', observaciones };
    state.movimientoStock.unshift(data);
    procesarEfectosPostSave('movimientoStock', data, null);
  } else if (accion === 'cargacombustible') {
    state.cargacombustible.push({
      fecha,
      equipo,
      tipoCombustible: 'Gasoil',
      cantidad,
      costoUnitario: 0,
      costoTotal: '0',
      operador: operario,
      observaciones
    });
  } else if (accion === 'mantenimiento') {
    state.mantenimiento.push({ fecha, equipo, observaciones });
  }

  saveState();
  actualizarSelectoresDinamicos();
  renderTables();
  cerrarAsistenteIA();
  showToast('Parte de campo registrado', 'success');
}

/* ---------- Cola offline ---------- */

function iaEncolarPendiente(tipo, payload) {
  if (!Array.isArray(state.iaQueue)) state.iaQueue = [];
  state.iaQueue.unshift({ id: `ia-${Date.now()}`, tipo, payload, fecha: new Date().toISOString() });
  saveState();
  iaRenderPendientes();
}

function iaRenderPendientes() {
  const panel = document.getElementById('iaPanelPendientes');
  if (!panel) return;

  const pendientes = state.iaQueue || [];
  if (!pendientes.length) {
    panel.innerHTML = '<div style="font-size:12px;color:var(--text-dim);">No hay documentos ni partes pendientes.</div>';
    return;
  }

  const etiquetas = { documento: '📷 Documento', voz: '🎤 Parte de voz', texto: '📝 Parte escrito' };
  panel.innerHTML = `
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">${pendientes.length} elemento(s) capturados sin conexión.</div>
    <div style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:8px;">
      <table class="data-table" style="margin:0;">
        <thead><tr><th>Tipo</th><th>Capturado</th><th>Acción</th></tr></thead>
        <tbody>
          ${pendientes.map((p) => `
            <tr>
              <td>${etiquetas[p.tipo] || p.tipo}</td>
              <td>${new Date(p.fecha).toLocaleString('es-AR')}</td>
              <td style="text-align:center;">
                <button class="btn btn-primary" onclick="iaProcesarPendiente('${p.id}')">Procesar</button>
                <button class="btn btn-danger" onclick="iaEliminarPendiente('${p.id}')">Descartar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function iaProcesarPendiente(id) {
  const pendiente = (state.iaQueue || []).find((p) => p.id === id);
  if (!pendiente) return;

  if (!navigator.onLine) {
    showToast('Necesitás conexión para procesar los pendientes', 'error');
    return;
  }

  if (pendiente.tipo === 'documento') {
    iaDocumentoPendiente = pendiente.payload;
    iaCambiarPestana('documento');
    const preview = document.getElementById('iaPreviewDocumento');
    if (preview) preview.innerHTML = `<img src="data:${pendiente.payload.mimeType};base64,${pendiente.payload.imagenBase64}" style="max-width:100%; max-height:240px; border-radius:8px; border:1px solid var(--border);">`;
    await iaAnalizarDocumento();
  } else if (pendiente.tipo === 'voz') {
    iaAudioPendiente = pendiente.payload;
    iaCambiarPestana('voz');
    await iaProcesarAudio();
  } else if (pendiente.tipo === 'texto') {
    iaCambiarPestana('voz');
    const campo = document.getElementById('iaTextoParte');
    if (campo) campo.value = pendiente.payload.texto;
    await iaInterpretarTextoManual();
  }

  iaEliminarPendiente(id, true);
}

function iaEliminarPendiente(id, silencioso = false) {
  state.iaQueue = (state.iaQueue || []).filter((p) => p.id !== id);
  saveState();
  iaRenderPendientes();
  if (!silencioso) showToast('Pendiente descartado', 'info');
}

window.addEventListener('online', () => {
  const pendientes = (state.iaQueue || []).length;
  if (pendientes) showToast(`Volvió la conexión: ${pendientes} captura(s) de IA pendientes de procesar`, 'info');
});

// === FIN ASISTENTE DE IA ===

