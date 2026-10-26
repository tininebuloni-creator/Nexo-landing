// Impresión de comprobantes electrónicos (pantalla). Abre una ventana con la factura o nota lista para imprimir o
// guardar en PDF: letra y código del tipo, emisor, receptor, detalle, IVA por alícuota, CAE con vencimiento y el QR
// oficial de ARCA (RG 4892) como imagen (usa window.qrcode de vendor/qrcode.js si está cargado). Copia idéntica en las
// apps que la usan: se edita en @pampa/core-fiscal-arca.
// PampaComprobante.imprimir({
//   tipo: 'Factura A' | 'Nota de crédito B' | ..., puntoVenta, numero, fecha: 'AAAA-MM-DD',
//   emisor: { nombre, cuit, domicilio, condicionIva, iibb, inicioActividades },
//   receptor: { nombre, documento, condicionIva, domicilio },
//   items: [{ descripcion, cantidad, unidad, precio, alicuota, importe }],
//   totales: { neto, iva, exento, noGravado, total, porAlicuota: [{ alicuota, base, iva }] },
//   cae, vencimientoCae, qr (URL de ARCA), asociado: { tipo, puntoVenta, numero }, leyenda (aviso en rojo, p. ej. simulación),
//   observaciones: [] })
(function () {
  'use strict';
  if (window.PampaComprobante) return;
  const CODIGOS = { 'Factura A': 1, 'Nota de débito A': 2, 'Nota de crédito A': 3, 'Factura B': 6, 'Nota de débito B': 7, 'Nota de crédito B': 8, 'Factura C': 11, 'Nota de débito C': 12, 'Nota de crédito C': 13 };
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const pesos = (n) => Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
  const fecha = (f) => { const t = String(f || ''); const m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : t; };
  const nro = (pv, n) => `${String(Number(pv) || 0).padStart(5, '0')}-${String(Number(n) || 0).padStart(8, '0')}`;
  const cuit = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d; };

  function imagenQr(url) {
    if (!url || typeof window.qrcode !== 'function') return '';
    try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); return q.createDataURL(3, 4); } catch { return ''; }
  }

  function html(c) {
    const tipo = String(c.tipo || 'Comprobante');
    const letra = /[ABC]$/.test(tipo) ? tipo.slice(-1) : '';
    const codigo = CODIGOS[tipo];
    const e = c.emisor || {}, r = c.receptor || {}, t = c.totales || {};
    // Solo la A discrimina el IVA en el detalle; en la B los precios van con el IVA incluido (y abajo el IVA contenido).
    const items = (c.items || []).map((it) => {
      const conIva = letra === 'B' ? 1 + Number(it.alicuota || 0) / 100 : 1;
      const importe = Number(it.importe ?? Number(it.cantidad || 0) * Number(it.precio || 0)) * conIva;
      return `<tr><td>${esc(it.descripcion)}</td><td class="n">${esc(it.cantidad ?? '')} ${esc(it.unidad || '')}</td><td class="n">${it.precio !== undefined && it.precio !== '' ? pesos(Number(it.precio) * conIva) : ''}</td>${letra === 'A' ? `<td class="n">${it.alicuota !== undefined ? `${esc(it.alicuota)} %` : ''}</td>` : ''}<td class="n">${pesos(importe)}</td></tr>`;
    }).join('');
    const ivas = letra === 'A' ? (t.porAlicuota || []).filter((g) => Number(g.iva)).map((g) => `<tr><td>IVA ${esc(g.alicuota)} %</td><td class="n">${pesos(g.iva)}</td></tr>`).join('') : '';
    const qr = imagenQr(c.qr);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(tipo)} ${nro(c.puntoVenta, c.numero)}</title><style>
      *{box-sizing:border-box}body{font:12px Arial,Helvetica,sans-serif;color:#111;margin:24px}
      .cab{display:grid;grid-template-columns:1fr 70px 1fr;border:1px solid #111}.cab>div{padding:10px}
      .letra{border-left:1px solid #111;border-right:1px solid #111;text-align:center}.letra b{display:block;font-size:38px;line-height:1}
      h1{font-size:18px;margin:0 0 4px}.sec{border:1px solid #111;border-top:0;padding:8px 10px}
      table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:5px 6px;border-bottom:1px solid #ddd;text-align:left}th{background:#f1f1f1}
      .n{text-align:right;white-space:nowrap}.tot{width:300px;margin-left:auto}.tot td{border:0}.tot tr:last-child td{font-weight:bold;font-size:14px;border-top:1px solid #111}
      .pie{display:flex;gap:14px;align-items:center;border:1px solid #111;margin-top:12px;padding:10px}.aviso{color:#b91c1c;font-weight:bold;margin:0 0 8px}
      @media print{body{margin:10mm}.noimp{display:none}}</style></head><body>
      ${c.leyenda ? `<p class="aviso">${esc(c.leyenda)}</p>` : ''}
      <div class="cab"><div><h1>${esc(e.nombre || '')}</h1>${e.domicilio ? `${esc(e.domicilio)}<br>` : ''}${e.condicionIva ? `${esc(e.condicionIva)}` : ''}</div>
        <div class="letra"><b>${esc(letra || '-')}</b>${codigo ? `Cód. ${String(codigo).padStart(2, '0')}` : ''}</div>
        <div><h1>${esc(tipo.replace(/ [ABC]$/, ''))}</h1>N.º <b>${nro(c.puntoVenta, c.numero)}</b><br>Fecha: ${esc(fecha(c.fecha))}<br>CUIT: ${esc(cuit(e.cuit))}${e.iibb ? `<br>Ingresos Brutos: ${esc(e.iibb)}` : ''}${e.inicioActividades ? `<br>Inicio de actividades: ${esc(fecha(e.inicioActividades))}` : ''}</div></div>
      <div class="sec"><b>${esc(r.nombre || 'Consumidor final')}</b>${r.documento ? ` · ${String(r.documento).replace(/\D/g, '').length === 11 ? 'CUIT' : 'Doc.'} ${esc(cuit(r.documento))}` : ''}${r.condicionIva ? ` · ${esc(r.condicionIva)}` : ''}${r.domicilio ? `<br>${esc(r.domicilio)}` : ''}
        ${c.asociado && c.asociado.numero ? `<br>Comprobante asociado: ${esc(c.asociado.tipo || '')} ${nro(c.asociado.puntoVenta, c.asociado.numero)}` : ''}</div>
      <table><thead><tr><th>Detalle</th><th class="n">Cantidad</th><th class="n">Precio unit.</th>${letra === 'A' ? '<th class="n">IVA</th>' : ''}<th class="n">Importe</th></tr></thead><tbody>${items || '<tr><td colspan="5">—</td></tr>'}</tbody></table>
      <table class="tot"><tbody>
        ${letra === 'A' ? `<tr><td>Neto gravado</td><td class="n">${pesos(t.neto)}</td></tr>${ivas}` : ''}
        ${Number(t.exento) ? `<tr><td>Exento</td><td class="n">${pesos(t.exento)}</td></tr>` : ''}${Number(t.noGravado) ? `<tr><td>No gravado</td><td class="n">${pesos(t.noGravado)}</td></tr>` : ''}
        <tr><td>Total</td><td class="n">${pesos(t.total)}</td></tr></tbody></table>
      ${letra === 'B' && Number(t.iva) ? `<p>IVA contenido: ${pesos(t.iva)} (Régimen de Transparencia Fiscal al Consumidor, Ley 27.743).</p>` : ''}
      <div class="pie">${qr ? `<img alt="QR de ARCA" src="${qr}" width="120" height="120">` : ''}<div>${c.cae ? `<b>CAE N.º ${esc(c.cae)}</b><br>Vencimiento del CAE: ${esc(fecha(c.vencimientoCae))}<br>Comprobante autorizado por ARCA.${c.qr && !qr ? `<br>Verificación: ${esc(c.qr)}` : ''}` : '<b>Sin CAE: no es un comprobante válido.</b>'}
        ${(c.observaciones || []).length ? `<br><small>${c.observaciones.map(esc).join('<br>')}</small>` : ''}</div></div>
      <p class="noimp"><button onclick="print()">Imprimir / guardar PDF</button></p>
      <script>setTimeout(function(){print()},300)<\/script></body></html>`;
  }

  function imprimir(comprobante) {
    const w = window.open('', '_blank');
    if (!w) { alert('El navegador bloqueó la ventana de impresión: permitila para imprimir el comprobante.'); return false; }
    w.document.write(html(comprobante || {}));
    w.document.close();
    return true;
  }

  window.PampaComprobante = { imprimir, html };
}());
