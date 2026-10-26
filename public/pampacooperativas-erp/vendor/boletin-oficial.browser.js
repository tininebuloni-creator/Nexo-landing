// Normas nuevas del Boletín Oficial (pantalla). Lo arma el servidor de escritorio (boletin-oficial.js en
// @pampa/core-fiscal-arca): este script muestra un cartel cuando hay emisiones bloqueadas por normas sin revisar y un
// panel para revisarlas ("Revisada" / "No aplica"). Copia idéntica en todas las apps: se edita en el paquete.
// <script src="boletin-oficial.browser.js" data-api="(opcional, base del servidor)" data-target="(opcional, selector)">
// Sin servidor (prueba web) no muestra nada: la lectura del Boletín se hace desde la app de escritorio.
(function () {
  'use strict';
  if (window.PampaBoletinOficial) return;
  const script = document.currentScript || {};
  const dataset = script.dataset || {};
  const RUTA = '/pampa-normativa/boletin';
  const ORIGEN_BOLETIN = 'https://www.boletinoficial.gob.ar/';
  let datos = null;
  let sinServidor = false;
  let verTodas = false;

  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const enlace = (url) => (String(url || '').startsWith(ORIGEN_BOLETIN) ? url : '#');
  const fecha = (f) => (f && f.length === 8 ? `${f.slice(6, 8)}/${f.slice(4, 6)}/${f.slice(0, 4)}` : '-');
  const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-AR') : '-');

  async function base() {
    if (dataset.api) return dataset.api.replace(/\/$/, '');
    if (window.electronAPI && typeof window.electronAPI.getServerUrl === 'function') {
      const r = await window.electronAPI.getServerUrl();
      if (r && r.ok && r.url) return String(r.url).replace(/\/$/, '');
      return null; // servidor todavía arrancando
    }
    return location.protocol === 'file:' ? null : '';
  }

  async function pedir(sufijo = '', opciones = {}) {
    // Apps con servidor en red y sesión (Cooperativas): se usa su propio cliente, que manda el token.
    if (!dataset.api && window.OfflineSync && typeof window.OfflineSync.api === 'function') {
      return window.OfflineSync.api(`${RUTA}${sufijo}`, { method: opciones.method || 'GET', body: opciones.body ? JSON.parse(opciones.body) : undefined });
    }
    const b = await base();
    if (b === null) throw new Error('El servidor local todavía no está listo.');
    const res = await fetch(`${b}${RUTA}${sufijo}`, { cache: 'no-store', ...opciones, headers: { Accept: 'application/json', ...(opciones.body ? { 'Content-Type': 'application/json' } : {}) } });
    const tipo = res.headers.get('content-type') || '';
    if (!tipo.includes('application/json')) { sinServidor = true; throw new Error('sin servidor'); }
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  async function refrescar() {
    if (sinServidor) return;
    try {
      datos = await pedir();
    } catch {
      return; // sin servidor (web) o arrancando: se reintenta en la próxima vuelta
    }
    pintarCartel();
    pintarTarjeta();
    if (document.getElementById('pampaBoletinModal')) pintarPanel();
  }

  const pendientes = () => (datos ? datos.normas.filter((n) => n.bloquea) : []);

  function pintarCartel() {
    let cartel = document.getElementById('pampaBoletinCartel');
    const bloqueos = datos ? Object.values(datos.bloqueos || {}) : [];
    if (!bloqueos.length) { if (cartel) cartel.remove(); return; }
    if (!cartel) {
      cartel = document.createElement('button');
      cartel.type = 'button';
      cartel.id = 'pampaBoletinCartel';
      cartel.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:10000;max-width:min(420px,calc(100vw - 32px));padding:10px 14px;border-radius:10px;border:1px solid #dc2626;background:#fef2f2;color:#7f1d1d;font:600 13px system-ui,sans-serif;text-align:left;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer';
      cartel.addEventListener('click', abrir);
      document.body.appendChild(cartel);
    }
    const que = bloqueos.map((b) => b.nombre).join(', ');
    cartel.textContent = `Emisión bloqueada (${que}): ${pendientes().length} norma(s) nueva(s) del Boletín Oficial para revisar. Tocá para verlas.`;
  }

  // Tarjeta chica dentro del módulo fiscal de la app (si existe), con el estado y el botón para abrir el panel.
  function pintarTarjeta() {
    const destino = document.querySelector(dataset.target || '#pampaNormativeCard, #mod-fiscal, #mod-arca, #arca, #fiscal');
    if (!destino || !datos) return;
    let tarjeta = document.getElementById('pampaBoletinTarjeta');
    if (!tarjeta) {
      tarjeta = document.createElement('div');
      tarjeta.id = 'pampaBoletinTarjeta';
      tarjeta.style.cssText = 'margin-top:14px;padding:12px 14px;border:1px solid #d6d3d1;border-radius:10px;background:#fafaf9;color:#1c1917;font:13px system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between';
      destino.appendChild(tarjeta);
    }
    const n = pendientes().length;
    tarjeta.innerHTML = `<div><strong>Normativa del Boletín Oficial</strong> (ARCA, SENASA, Agricultura, INASE)<br><span style="color:${n ? '#b91c1c' : '#57534e'}">${n ? `${n} norma(s) sin revisar bloquean la emisión` : 'Sin normas pendientes que afecten la emisión'} · última lectura ${esc(fechaHora(datos.ultimaCorrida))}${datos.ultimoError ? ` · <span style="color:#b45309">${esc(datos.ultimoError)}</span>` : ''}</span></div><button type="button" style="padding:7px 12px;border-radius:8px;border:1px solid #a8a29e;background:#fff;color:#1c1917;cursor:pointer;font:600 13px system-ui,sans-serif">Ver normas</button>`;
    tarjeta.querySelector('button').addEventListener('click', abrir);
  }

  function chipOperaciones(n) {
    const propias = (datos.operaciones || []).filter((op) => n.operaciones.includes(op.id));
    if (!n.detalleLeido) return '<span style="color:#78716c">Leyendo el texto…</span>';
    if (!propias.length) return '<span style="color:#78716c">No afecta las emisiones de esta app</span>';
    return propias.map((op) => `<span style="display:inline-block;margin:1px 2px;padding:1px 7px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:600">${esc(op.nombre)}</span>`).join('');
  }

  function estadoNorma(n) {
    if (n.estado === 'REVISADA') return `<span style="color:#15803d;font-weight:600">Revisada</span><br><small>${esc(n.revisadoPor || '')} · ${esc(fechaHora(n.revisadoEn))}${n.nota ? `<br>${esc(n.nota)}` : ''}</small>`;
    if (n.estado === 'NO_APLICA') return `<span style="color:#57534e;font-weight:600">No aplica</span><br><small>${esc(n.revisadoPor || '')} · ${esc(fechaHora(n.revisadoEn))}${n.nota ? `<br>${esc(n.nota)}` : ''}</small>`;
    if (n.bloquea) return '<span style="color:#b91c1c;font-weight:600">Pendiente · bloquea</span>';
    if (n.previa) return '<span style="color:#78716c">Anterior a la instalación</span>';
    return '<span style="color:#78716c">Para leer</span>';
  }

  function pintarPanel() {
    const cuerpo = document.getElementById('pampaBoletinCuerpo');
    if (!cuerpo || !datos) return;
    const lista = datos.normas.filter((n) => verTodas || n.bloquea || (n.estado === 'PENDIENTE' && !n.previa && n.operaciones.length));
    const boton = (id, estado, texto, fondo) => `<button type="button" data-id="${esc(id)}" data-estado="${estado}" style="margin:2px 0;padding:5px 9px;border-radius:7px;border:1px solid ${fondo};background:#fff;color:${fondo};cursor:pointer;font:600 12px system-ui,sans-serif">${texto}</button>`;
    cuerpo.innerHTML = `
      <p style="margin:0 0 8px;color:#57534e">Leído hasta el ${esc(fecha(datos.ultimoDiaLeido))} · última lectura ${esc(fechaHora(datos.ultimaCorrida))}${datos.actualizando ? ' · buscando…' : ''}${datos.ultimoError ? `<br><span style="color:#b45309">${esc(datos.ultimoError)}</span>` : ''}</p>
      <p style="margin:0 0 10px;color:#57534e">Mientras una norma que afecta una emisión siga pendiente, esa emisión queda bloqueada. Leela en el Boletín y marcala como <strong>Revisada</strong> (ya se adaptó o no cambia nada de lo que hacés) o <strong>No aplica</strong>.</p>
      <label style="display:inline-flex;gap:6px;align-items:center;margin-bottom:8px;color:#1c1917;font:13px system-ui,sans-serif;text-transform:none;letter-spacing:normal"><input type="checkbox" id="pampaBoletinTodas" ${verTodas ? 'checked' : ''}> Mostrar todas las normas leídas (${datos.normas.length})</label>
      <div style="overflow:auto;max-height:60vh;border:1px solid #e7e5e4;border-radius:8px">
        <table id="pampaBoletinTabla" style="border-collapse:collapse;width:100%;font-size:12.5px;color:#1c1917;background:#fff">
          <thead><tr style="background:#f5f5f4;text-align:left">${['Fecha', 'Norma', 'Qué dispone (art. 1°)', 'Afecta', 'Estado', ''].map((t) => `<th style="padding:7px 8px;border-bottom:1px solid #e7e5e4;position:sticky;top:0;background:#f5f5f4;color:#44403c;text-transform:none;letter-spacing:normal;font:600 12px system-ui,sans-serif">${t}</th>`).join('')}</tr></thead>
          <tbody>${lista.length ? lista.map((n) => `
            <tr style="vertical-align:top;border-bottom:1px solid #f5f5f4">
              <td style="padding:7px 8px;white-space:nowrap">${esc(fecha(n.fecha))}</td>
              <td style="padding:7px 8px;min-width:150px"><strong>${esc(n.organismoNombre)}</strong><br><a href="${esc(enlace(n.url))}" target="_blank" rel="noopener noreferrer">${esc(n.norma)}</a>${n.tema ? `<br><small style="color:#57534e">${esc(n.tema)}</small>` : ''}</td>
              <td style="padding:7px 8px;min-width:220px">${esc(n.resumen || '-')}</td>
              <td style="padding:7px 8px;min-width:120px">${chipOperaciones(n)}</td>
              <td style="padding:7px 8px;min-width:110px">${estadoNorma(n)}</td>
              <td style="padding:7px 8px;white-space:nowrap">${n.estado === 'PENDIENTE' ? `${boton(n.id, 'REVISADA', 'Revisada', '#15803d')}<br>${boton(n.id, 'NO_APLICA', 'No aplica', '#57534e')}` : ''}</td>
            </tr>`).join('') : `<tr><td colspan="6" style="padding:14px;color:#57534e">${verTodas ? 'Todavía no se leyó ninguna norma.' : 'No hay normas pendientes que afecten las emisiones de esta app.'}</td></tr>`}</tbody>
        </table>
      </div>`;
    cuerpo.querySelector('#pampaBoletinTodas').addEventListener('change', (e) => { verTodas = e.target.checked; pintarPanel(); });
    cuerpo.querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', () => marcar(b.dataset.id, b.dataset.estado)));
  }

  async function marcar(id, estado) {
    const n = datos.normas.find((x) => x.id === id);
    const nota = prompt(estado === 'NO_APLICA'
      ? `¿Por qué ${n ? n.norma : 'esta norma'} no aplica? (queda en el registro)`
      : `Nota de la revisión de ${n ? n.norma : 'esta norma'} (opcional: qué se revisó o adaptó):`, '');
    if (nota === null) return;
    if (estado === 'NO_APLICA' && !nota.trim()) { alert('Escribí el motivo por el que no aplica.'); return; }
    let usuario = '';
    try { usuario = (window.PAMPA_USUARIO_ACTUAL && (window.PAMPA_USUARIO_ACTUAL.nombre || window.PAMPA_USUARIO_ACTUAL.usuario)) || ''; } catch { /* sin sesión */ }
    try {
      datos = await pedir(`/${encodeURIComponent(id)}/revisar`, { method: 'POST', body: JSON.stringify({ estado, nota, usuario }) });
      pintarPanel(); pintarCartel(); pintarTarjeta();
    } catch (e) {
      alert(`No se pudo guardar la revisión: ${e.message}`);
    }
  }

  async function buscarAhora(boton) {
    boton.disabled = true;
    boton.textContent = 'Buscando…';
    try {
      datos = await pedir('/actualizar', { method: 'POST' });
      pintarPanel(); pintarCartel(); pintarTarjeta();
    } catch (e) {
      alert(`No se pudo leer el Boletín Oficial: ${e.message}`);
    } finally {
      boton.disabled = false;
      boton.textContent = 'Buscar ahora';
    }
  }

  function cerrar() {
    const m = document.getElementById('pampaBoletinModal');
    if (m) m.remove();
  }

  async function abrir() {
    if (!datos) await refrescar();
    if (!datos) { alert('La normativa del Boletín Oficial se revisa desde la app de escritorio.'); return; }
    cerrar();
    const m = document.createElement('div');
    m.id = 'pampaBoletinModal';
    m.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px';
    m.innerHTML = `
      <style>#pampaBoletinModal td{color:#1c1917;background:#fff;border-bottom:1px solid #f5f5f4;font:12.5px system-ui,sans-serif;text-transform:none}#pampaBoletinModal td a{color:#1d4ed8}</style>
      <div role="dialog" aria-modal="true" aria-label="Normativa del Boletín Oficial" style="width:min(1100px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#1c1917;border-radius:12px;padding:16px 18px;font:13px system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.35)">
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px">
          <strong style="font-size:16px">Normativa del Boletín Oficial</strong>
          <span><button type="button" id="pampaBoletinBuscar" style="padding:7px 12px;border-radius:8px;border:1px solid #a8a29e;background:#fff;color:#1c1917;cursor:pointer;font:600 13px system-ui,sans-serif">Buscar ahora</button>
          <button type="button" id="pampaBoletinCerrar" style="padding:7px 12px;border-radius:8px;border:1px solid #a8a29e;background:#fff;color:#1c1917;cursor:pointer;font:600 13px system-ui,sans-serif">Cerrar</button></span>
        </div>
        <div id="pampaBoletinCuerpo"></div>
      </div>`;
    m.addEventListener('click', (e) => { if (e.target === m) cerrar(); });
    document.body.appendChild(m);
    m.querySelector('#pampaBoletinCerrar').addEventListener('click', cerrar);
    m.querySelector('#pampaBoletinBuscar').addEventListener('click', (e) => buscarAhora(e.currentTarget));
    pintarPanel();
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
  window.PampaBoletinOficial = { abrir, refrescar, datos: () => datos };
  function iniciar() {
    setTimeout(refrescar, 3000);
    setInterval(refrescar, 10 * 60 * 1000);
    window.addEventListener('focus', refrescar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
}());
