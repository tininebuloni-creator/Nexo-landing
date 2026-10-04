// Interfaz del núcleo agrícola de Precisión: módulo "Granos y almacenaje" (Stock, LPG, RENSPA y campañas,
// Fiscal) y tarjetas del Centro operativo. Usa PampaAgroCore (cálculos) y PampaAgroDB (IndexedDB).
(function () {
  const A = window.PampaAgroCore;
  const DB = window.PampaAgroDB;
  if (!A || !DB) { console.error('agro-ui: faltan agro-core.js o agro-db.js.'); return; }

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
  const tn = (kg) => `${((Number(kg) || 0) / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} t`;
  const pct = (n) => `${(Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const diasHasta = (f) => (f ? Math.round((Date.parse(`${A.fechaIso(f)}T12:00:00Z`) - Date.parse(`${hoy()}T12:00:00Z`)) / 864e5) : null);
  const COLORES = { SOJA: 'green', MAIZ: 'orange', GIRASOL: 'cyan', TRIGO: 'blue' };
  const opciones = (lista, actual) => lista.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(actual ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const granosOpc = (actual) => opciones(Object.entries(A.CULTIVOS).map(([k, c]) => [k, c.nombre]), actual);
  const estadosOpc = (actual) => opciones(Object.entries(A.ESTADOS_SISA), actual);
  const normativa = (regimen, condicion, fecha) => (typeof window.PAMPA_NORMATIVA_VALOR_VIGENTE === 'function' ? window.PAMPA_NORMATIVA_VALOR_VIGENTE(regimen, condicion, fecha) : undefined);
  const toast = (m) => (typeof window.showToast === 'function' ? window.showToast(m) : alert(m));

  let E = null; // estado cargado de la base
  let root = null;
  let tab = 'stock';
  let mesFiscal = hoy().slice(0, 7);
  let anual = false;
  let lpgEditando = null;

  async function cargar() {
    E = await DB.todoElEstado();
    E.condicionIva = (await DB.meta.get('condicionIva')) || 'RI';
    // Equipos de la versión anterior con costo horario en USD: se pasan a pesos con el último tipo de
    // cambio cargado (queda la nota para confirmarlo; al editar el equipo se borra).
    const tc = [...(E.tiposCambio || [])].sort((a, b) => b.mes.localeCompare(a.mes))[0];
    const pendientes = (E.equipos || []).filter((e) => e.revisar && !Number(e.costoHora) && Number(e.costoHoraUsd) > 0);
    if (tc && pendientes.length) {
      for (const e of pendientes) {
        await DB.guardar('equipos', { ...e, costoHora: Math.round(Number(e.costoHoraUsd) * tc.ars), revisar: `Convertido de USD ${e.costoHoraUsd}/h al tipo de cambio de ${tc.mes} ($ ${tc.ars}): confirmalo editando el equipo.` });
      }
      E = { ...E, ...(await DB.todoElEstado()), condicionIva: E.condicionIva };
    }
    return E;
  }
  const datosCostos = () => ({ condicionIva: E.condicionIva, compras: E.compras, labores: E.labores, equipos: E.equipos, empleados: E.empleados, lotes: E.lotes, lotesCampania: E.lotesCampania, lpg: E.lpg, contratos: E.contratosArrendamiento, movimientosGrano: E.movimientosGrano });
  // Tipo de cambio informativo: el del mes pedido o el último anterior.
  const tipoCambio = (mes) => [...(E.tiposCambio || [])].filter((t) => !mes || t.mes <= mes).sort((a, b) => b.mes.localeCompare(a.mes))[0]?.ars || null;
  const usd = (n, tc) => (tc ? `USD ${Math.round((Number(n) || 0) / tc).toLocaleString('es-AR')}` : 'sin tipo de cambio');
  let campaniaResultados = null;
  const reglas = () => ({ sisa: E.reglasSisa, iibb: E.reglasIibb, normativa });
  const sisa = () => E.sisaProductor[0] || {};
  const ubicacion = (id) => E.ubicaciones.find((u) => u.id === id);
  const lote = (id) => E.lotes.find((l) => l.id === id);
  const campanias = () => ({ gruesa: A.campaniaDe('Soja', hoy()).campania, fina: A.campaniaDe('Trigo', hoy()).campania });

  // ---------- Resúmenes compartidos con el Dashboard ----------
  function resumen() {
    const st = A.stockPorUbicacion(E.movimientosGrano);
    const porGrano = A.stockPorGrano(E.movimientosGrano).porGrano;
    const totalKg = Object.values(porGrano).reduce((s, v) => s + v, 0);
    const capacidadKg = E.ubicaciones.reduce((s, u) => s + (Number(u.capacidadTn) || 0) * 1000, 0);
    // Últimos 30 días (más útil en el tablero que el mes calendario recién empezado).
    const desde = new Date(Date.parse(`${hoy()}T12:00:00Z`) - 30 * 864e5).toISOString().slice(0, 10);
    const lpgMes = E.lpg.filter((l) => String(l.fecha) >= desde);
    // Campaña actual de cada tipo; si todavía no tiene lotes sembrados, la última con datos.
    const c = campanias();
    ['fina', 'gruesa'].forEach((tipo) => {
      if (E.lotesCampania.some((v) => v.tipo === tipo && v.campania === c[tipo])) return;
      const ultima = E.lotesCampania.filter((v) => v.tipo === tipo).map((v) => v.campania).sort().pop();
      if (ultima) c[tipo] = ultima;
    });
    const vinculosActuales = E.lotesCampania.filter((v) => v.campania === (v.tipo === 'fina' ? c.fina : c.gruesa));
    const ha = (tipo) => vinculosActuales.filter((v) => v.tipo === tipo).reduce((s, v) => s + (Number(v.superficieHa) || 0), 0);
    const lotesSinRenspa = E.lotes.filter((l) => !E.lotesCampania.some((v) => v.loteId === l.id && v.renspaId));
    const renspaPorVencer = E.renspa.filter((r) => { const d = diasHasta(r.vence); return d !== null && d <= 30; });
    const alertas = [
      ...A.obligacionesSisa({ config: { ...sisa(), vencimientos: sisa().vencimientos || [] }, stockKg: porGrano, vinculos: vinculosActuales, hoy: hoy() }),
      ...st.avisos.slice(-3).map((t) => ({ nivel: 'danger', texto: `Stock: ${t}` })),
      ...renspaPorVencer.map((r) => ({ nivel: diasHasta(r.vence) < 0 ? 'danger' : 'warn', texto: `RENSPA ${r.numero} (${r.campo || 'sin campo'}) ${diasHasta(r.vence) < 0 ? `venció el ${r.vence}` : `vence en ${diasHasta(r.vence)} día(s)`}.` })),
      ...(lotesSinRenspa.length ? [{ nivel: 'warn', texto: `${lotesSinRenspa.length} lote(s) sin RENSPA vinculado: ${lotesSinRenspa.slice(0, 4).map((l) => l.codigo).join(', ')}.` }] : []),
    ];
    alertas.push(...A.alertasSenasa({ labores: E.labores, productos: E.fitosanitarios, equipos: E.equipos, envases: E.envases, lotes: E.lotes, movimientosGrano: E.movimientosGrano, hoy: hoy() }).map((a) => ({ ...a, texto: `SENASA: ${a.texto}` })));
    alertas.push(...A.alertasCpe({ cpes: E.cpes, lpg: E.lpg, hoy: hoy() }).map((a) => ({ ...a, texto: `ARCA: ${a.texto}` })));
    const lpgDefecto = E.lpg.filter((l) => l.calculo?.usaDefecto).length;
    if (lpgDefecto) alertas.push({ nivel: 'warn', texto: `${lpgDefecto} LPG calculada(s) con la tabla SISA por defecto: revisá Fiscal → Reglas.` });
    const reintegrosPend = E.reintegrosIva.filter((r) => r.estado !== 'COBRADO');
    return {
      st, porGrano, totalKg, capacidadKg, ocupacion: capacidadKg ? totalKg / capacidadKg * 100 : 0,
      lpgMes, kgMes: lpgMes.reduce((s, l) => s + (l.calculo?.kgNetos || 0) * (l.calculo?.signo || 1), 0), netoMes: lpgMes.reduce((s, l) => s + (l.calculo?.neto || 0), 0),
      retIvaMes: lpgMes.reduce((s, l) => s + (l.calculo?.retenciones?.find((r) => r.regimen === 'IVA')?.importe || 0), 0),
      retGanMes: lpgMes.reduce((s, l) => s + (l.calculo?.retenciones?.find((r) => r.regimen === 'GANANCIAS')?.importe || 0), 0),
      haFina: ha('fina'), haGruesa: ha('gruesa'), campania: c, lotesSinRenspa, renspaPorVencer, alertas,
      reintegrosPend, reintegroPendTotal: reintegrosPend.reduce((s, r) => s + (Number(r.importe) || 0), 0),
    };
  }
  const kpi = (color, label, valor, sub) => `<div class="kpi ${color}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(valor)}</div><div class="kpi-sub">${esc(sub)}</div></div>`;
  const alertasHtml = (lista) => (lista.length ? lista.map((a) => `<div class="alerta ${a.nivel === 'danger' ? 'danger' : ''}">${esc(a.texto)}</div>`).join('') : '<div class="nota">Sin alertas.</div>');

  // ---------- Pestaña Stock ----------
  function vistaStock() {
    const r = resumen();
    const stockUb = r.st.stock;
    const filas = E.ubicaciones.map((u) => {
      const kg = stockUb[u.id]?.kg || 0;
      const cap = (Number(u.capacidadTn) || 0) * 1000;
      return `<tr><td><strong>${esc(u.nombre)}</strong><small>${u.tipo === 'CELDA' ? 'Celda' : 'Silobolsa'}${u.metros ? ` · ${esc(u.metros)} m` : ''}</small></td><td>${esc(A.CULTIVOS[u.grano]?.nombre || '-')}</td><td>${esc(u.campo || '-')}</td><td class="num">${tn(cap)}</td><td class="num">${tn(kg)}</td><td class="num">${cap ? pct(kg / cap * 100) : '-'}</td><td>${esc(u.fechaEmbolsado || '-')}</td><td><button class="btn small" data-borrar="ubicaciones" data-id="${esc(u.id)}">Borrar</button></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="nota">Cargá tus silobolsas y celdas.</td></tr>';
    const movs = [...E.movimientosGrano].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 40).map((m) => `<tr><td>${esc(m.fecha)}</td><td>${esc(m.tipo.replace('_', ' ').toLowerCase())}</td><td>${esc(A.CULTIVOS[m.grano]?.nombre || '')}</td><td>${esc(ubicacion(m.ubicacionId)?.nombre || '')}${m.ubicacionDestinoId ? ` → ${esc(ubicacion(m.ubicacionDestinoId)?.nombre || '')}` : ''}</td><td class="num">${tn(m.kg)}</td><td>${esc(m.detalle || (m.loteId ? `Lote ${lote(m.loteId)?.codigo || ''}` : ''))}</td><td>${m.lpgId ? '<small>desde la LPG</small>' : `<button class="btn small" data-borrar="movimientosGrano" data-id="${esc(m.id)}">Borrar</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="nota">Sin movimientos.</td></tr>';
    const ubOpc = opciones(E.ubicaciones.map((u) => [u.id, `${u.nombre} · ${A.CULTIVOS[u.grano]?.nombre || ''}`]));
    return `
      <div class="kpi-grid">${Object.entries(A.CULTIVOS).map(([k, c]) => kpi(COLORES[k], `Stock ${c.nombre}`, tn(r.porGrano[k]), `${E.ubicaciones.filter((u) => u.grano === k).length} ubicación(es) · campaña ${c.campania}`)).join('')}</div>
      ${r.st.avisos.length ? alertasHtml(r.st.avisos.slice(-3).map((t) => ({ nivel: 'danger', texto: t }))) : ''}
      <div class="card"><div class="card-header"><div><div class="card-title">🌾 Silobolsas y celdas</div><div class="card-sub">Ocupación total ${pct(r.ocupacion)} · ${tn(r.totalKg)} de ${tn(r.capacidadKg)}</div></div></div>
        <table class="tabla"><thead><tr><th>Ubicación</th><th>Grano</th><th>Campo</th><th class="num">Capacidad</th><th class="num">Stock</th><th class="num">Ocupación</th><th>Embolsado</th><th></th></tr></thead><tbody>${filas}</tbody></table>
        <form data-form="ubicacion" class="form-grid" style="margin-top:14px">
          <label>Tipo<select name="tipo">${opciones([['SILOBOLSA', 'Silobolsa'], ['CELDA', 'Celda']])}</select></label>
          <label>Nombre<input name="nombre" required placeholder="Silobolsa 1 / Celda A"></label>
          <label>Grano<select name="grano" required>${granosOpc()}</select></label>
          <label>Campo<input name="campo" placeholder="Campo"></label>
          <label>Capacidad (t)<input name="capacidadTn" type="number" min="0" step="0.1" required></label>
          <label>Metros (silobolsa)<input name="metros" type="number" min="0"></label>
          <label>Fecha de embolsado<input name="fechaEmbolsado" type="date"></label>
          <label>&nbsp;<button class="btn primary" type="submit">+ Agregar ubicación</button></label>
        </form></div>
      <div class="card"><div class="card-header"><div class="card-title">↕️ Movimientos de grano</div></div>
        <form data-form="movimiento" class="form-grid" style="margin-bottom:14px">
          <label>Fecha<input name="fecha" type="date" value="${hoy()}" required></label>
          <label>Tipo<select name="tipo">${opciones([['INGRESO_COSECHA', 'Ingreso de cosecha'], ['TRASLADO', 'Traslado'], ['MERMA', 'Merma'], ['AJUSTE', 'Ajuste (kg con signo)']])}</select></label>
          <label>Ubicación<select name="ubicacionId" required>${ubOpc}</select></label>
          <label>Destino (traslado)<select name="ubicacionDestinoId"><option value="">—</option>${ubOpc}</select></label>
          <label>Kilos<input name="kg" type="number" step="1" required></label>
          <label>Lote de origen<select name="loteId"><option value="">—</option>${opciones(E.lotes.map((l) => [l.id, l.codigo]))}</select></label>
          <label>Detalle<input name="detalle"></label>
          <label>&nbsp;<button class="btn primary" type="submit">Registrar</button></label>
        </form>
        <table class="tabla"><thead><tr><th>Fecha</th><th>Tipo</th><th>Grano</th><th>Ubicación</th><th class="num">Kilos</th><th>Detalle</th><th></th></tr></thead><tbody>${movs}</tbody></table></div>`;
  }

  // ---------- Pestaña LPG ----------
  function datosFormLpg(form) {
    const f = new FormData(form);
    const g = (k) => f.get(k) ?? '';
    return {
      numero: g('numero'), coe: g('coe'), fecha: g('fecha'), tipo: g('tipo'), ajuste: g('ajuste'), lpgOrigenId: g('lpgOrigenId'),
      comprador: g('comprador'), cuitComprador: g('cuitComprador'), grano: g('grano'), campania: g('campania'), estadoSisa: g('estadoSisa'), provincia: g('provincia'),
      kgBrutos: g('kgBrutos'), humedad: g('humedad'), impurezasPct: g('impurezasPct'), volatilizacionPct: g('volatilizacionPct'), precioTn: g('precioTn'),
      sellos: f.get('sellos') === 'on', cpe: g('cpe'), kgOrigen: g('kgOrigen'), kgDestino: g('kgDestino'),
      certificadoIva: g('certificadoIva'), certificadoGanancias: g('certificadoGanancias'), certificadoIibb: g('certificadoIibb'),
      salidaUbicacionId: g('salidaUbicacionId'), salidaKg: g('salidaKg'),
      deducciones: Object.keys(A.DEDUCCIONES).map((t) => ({ tipo: t, importe: g(`ded_${t}`) })),
    };
  }
  function desgloseHtml(c) {
    const fila = (t, v, cls = '') => `<div class="${cls}">${t}</div><div class="${cls}" style="text-align:right;font-family:var(--font-mono)">${v}</div>`;
    return `<div class="desglose">
      ${fila(`${esc(c.cultivo)} · ${esc(c.tipoCampania)} ${esc(c.campania)} · ${esc(c.estadoSisaEtiqueta)}`, '')}
      ${fila(`Kilos brutos ${c.kgBrutos.toLocaleString('es-AR')} − mermas (humedad ${pct(c.mermaHumedadPct)}, impurezas ${pct(c.impurezasPct)}, volatilización ${pct(c.volatilizacionPct)})`, `${c.kgNetos.toLocaleString('es-AR')} kg netos`)}
      ${fila(`Subtotal grano (${tn(c.kgNetos)} × ${pesos(c.precioTn)}/t)`, pesos(c.subtotal))}
      ${fila(`IVA ${pct(c.ivaPct)} (débito)`, pesos(c.ivaGrano))}
      ${c.deducciones.map((d) => fila(`− ${esc(d.nombre)}${d.iva ? ` + IVA ${pct(d.ivaPct)}` : ''}`, `− ${pesos(d.total)}`, 'menos')).join('')}
      ${c.retenciones.map((r) => fila(`− Retención ${r.regimen === 'IIBB' ? `IIBB ${esc(r.provincia || '')}` : r.regimen === 'IVA' ? 'IVA' : 'Ganancias'} ${pct(r.alicuotaPct)}<br><small class="nota">${esc(r.norma)}</small>`, `− ${pesos(r.importe)}`, 'menos')).join('')}
      ${fila('Neto a cobrar', pesos(c.neto), 'total')}
      ${c.reintegroIva ? fila('Reintegro de IVA a recibir (SISA Estado 1)', pesos(c.reintegroIva)) : ''}
    </div>${c.avisos.length ? `<div style="margin-top:10px">${alertasHtml(c.avisos.map((t) => ({ nivel: 'warn', texto: t })))}</div>` : ''}<div class="nota">${esc(c.normas.lpg)} · ${esc(c.normas.retenciones)}</div>`;
  }
  function vistaLpg() {
    const l = lpgEditando ? E.lpg.find((x) => x.id === lpgEditando) : null;
    const d = l?.datos || { fecha: hoy(), tipo: 'COMPRAVENTA', estadoSisa: sisa().estado || '1', sellos: true, grano: 'SOJA' };
    const dedVal = (t) => d.deducciones?.find((x) => x.tipo === t)?.importe || '';
    const ubOpc = opciones(E.ubicaciones.map((u) => [u.id, `${u.nombre} · ${A.CULTIVOS[u.grano]?.nombre || ''}`]), d.salidaUbicacionId);
    const lista = [...E.lpg].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((x) => {
      const c = x.calculo || {};
      return `<tr><td>${esc(x.fecha)}</td><td><strong>${esc(x.numero || '—')}</strong><small>COE ${esc(x.coe || 'pendiente')}${x.datos?.ajuste ? ` · ajuste ${esc(x.datos.ajuste.toLowerCase())}` : ''}</small></td><td>${esc(c.cultivo)}<small>${esc(c.tipoCampania)} ${esc(c.campania)}</small></td><td>${esc(x.comprador || '')}<small>SISA ${esc(c.estadoSisa)}</small></td><td class="num">${(c.kgNetos || 0).toLocaleString('es-AR')}</td><td class="num">${pesos(c.subtotal)}</td><td class="num">${pesos(c.totalRetenciones)}</td><td class="num">${pesos(c.neto)}</td><td>${c.usaDefecto ? '<span class="tag orange">Tabla por defecto</span>' : '<span class="tag green">Regla validada</span>'}</td><td><button class="btn small" data-editar-lpg="${esc(x.id)}">Editar</button> <button class="btn small" data-borrar-lpg="${esc(x.id)}">Borrar</button></td></tr>`;
    }).join('') || '<tr><td colspan="10" class="nota">Sin liquidaciones.</td></tr>';
    return `
      <div class="card"><div class="card-header"><div><div class="card-title">🧾 ${l ? `Editar LPG ${esc(l.numero || '')}` : 'Nueva Liquidación Primaria de Granos'}</div><div class="card-sub">Se calcula siempre: mermas, IVA, deducciones con su IVA, Sellos y retenciones SISA del grano. Si falta una regla validada usa la tabla por defecto y avisa.</div></div>${l ? '<button class="btn" data-cancelar-lpg>Cancelar edición</button>' : ''}</div>
      <form data-form="lpg" class="form-grid">
        <label>Número LPG<input name="numero" value="${esc(d.numero || '')}" placeholder="LPG-0001"></label>
        <label>COE<input name="coe" value="${esc(d.coe || '')}" placeholder="Al autorizar en ARCA"></label>
        <label>Fecha<input name="fecha" type="date" value="${esc(d.fecha || hoy())}" required></label>
        <label>Tipo<select name="tipo">${opciones([['COMPRAVENTA', 'Compraventa'], ['CONSIGNACION', 'Consignación']], d.tipo)}</select></label>
        <label>Ajuste<select name="ajuste">${opciones([['', 'No (liquidación)'], ['DEBITO', 'Ajuste de débito'], ['CREDITO', 'Ajuste de crédito']], d.ajuste)}</select></label>
        <label>LPG que ajusta<select name="lpgOrigenId"><option value="">—</option>${opciones(E.lpg.filter((x) => x.id !== l?.id).map((x) => [x.id, `${x.numero || x.fecha} · ${x.calculo?.cultivo || ''}`]), d.lpgOrigenId)}</select></label>
        <label>Comprador / acopio<input name="comprador" value="${esc(d.comprador || '')}"></label>
        <label>CUIT comprador<input name="cuitComprador" value="${esc(d.cuitComprador || '')}"></label>
        <label>Grano<select name="grano" required>${granosOpc(A.grano(d.grano))}</select></label>
        <label>Campaña de la cosecha<select name="campania"><option value="">Según la fecha</option>${opciones([...new Set([...E.lotesCampania.map((v) => v.campania), campanias().gruesa, campanias().fina])].sort().reverse().map((x) => [x, x]), d.campania)}</select></label>
        <label>Estado SISA del productor<select name="estadoSisa">${estadosOpc(A.estadoSisa(d.estadoSisa) || '1')}</select></label>
        <label>Provincia de origen<select name="provincia"><option value="">—</option>${opciones(A.PROVINCIAS.map((p) => [p, p]), d.provincia)}</select></label>
        <label>Kilos brutos<input name="kgBrutos" type="number" min="0" value="${esc(d.kgBrutos || '')}" required></label>
        <label>Humedad (%)<input name="humedad" type="number" step="0.1" value="${esc(d.humedad || '')}" placeholder="base del grano"></label>
        <label>Impurezas / chamico (%)<input name="impurezasPct" type="number" step="0.01" value="${esc(d.impurezasPct || '')}"></label>
        <label>Volatilización (%)<input name="volatilizacionPct" type="number" step="0.01" value="${esc(d.volatilizacionPct || '')}"></label>
        <label>Precio por tonelada<input name="precioTn" type="number" min="0" value="${esc(d.precioTn || '')}" required></label>
        ${Object.entries(A.DEDUCCIONES).map(([t, x]) => `<label>${esc(x.nombre)} ($ neto)<input name="ded_${t}" type="number" min="0" value="${esc(dedVal(t))}"></label>`).join('')}
        <label>Impuesto de Sellos<select name="sellos">${opciones([['on', 'Descontar según provincia'], ['off', 'No corresponde']], d.sellos === false ? 'off' : 'on')}</select></label>
        <label>CPE (carta de porte)<input name="cpe" value="${esc(d.cpe || '')}"></label>
        <label>Kg origen CPE<input name="kgOrigen" type="number" value="${esc(d.kgOrigen || '')}"></label>
        <label>Kg destino CPE<input name="kgDestino" type="number" value="${esc(d.kgDestino || '')}"></label>
        <label>Certificado ret. IVA<input name="certificadoIva" value="${esc(d.certificadoIva || '')}"></label>
        <label>Certificado ret. Ganancias<input name="certificadoGanancias" value="${esc(d.certificadoGanancias || '')}"></label>
        <label>Certificado ret. IIBB<input name="certificadoIibb" value="${esc(d.certificadoIibb || '')}"></label>
        <label>Sale de (silobolsa / celda)<select name="salidaUbicacionId"><option value="">— no descontar stock —</option>${ubOpc}</select></label>
        <label>Kilos que salen<input name="salidaKg" type="number" min="0" value="${esc(d.salidaKg || '')}" placeholder="= kilos brutos"></label>
        <label>&nbsp;<button class="btn primary" type="submit">${l ? 'Guardar cambios' : 'Guardar LPG'}</button></label>
      </form>
      <div id="agroLpgDesglose" style="margin-top:16px"></div></div>
      <div class="card"><div class="card-header"><div class="card-title">📄 Liquidaciones emitidas</div></div>
      <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Fecha</th><th>LPG / COE</th><th>Grano</th><th>Comprador</th><th class="num">Kg netos</th><th class="num">Subtotal</th><th class="num">Retenciones</th><th class="num">Neto</th><th>Retenciones SISA</th><th></th></tr></thead><tbody>${lista}</tbody></table></div></div>`;
  }
  function calcularDesdeForm(form) {
    const d = datosFormLpg(form);
    d.sellos = new FormData(form).get('sellos') !== 'off';
    d.condicionIva = E.condicionIva;
    try { return { d, c: A.calcularLpg(d, reglas()) }; } catch (e) { return { d, error: e.message }; }
  }
  function actualizarDesglose() {
    const form = root.querySelector('form[data-form="lpg"]');
    const box = root.querySelector('#agroLpgDesglose');
    if (!form || !box) return;
    const r = calcularDesdeForm(form);
    box.innerHTML = r.error ? alertasHtml([{ nivel: 'danger', texto: r.error }]) : desgloseHtml(r.c);
  }

  // ---------- Pestaña RENSPA y campañas ----------
  function vistaRenspa() {
    const c = campanias();
    const campList = [...new Set([c.gruesa, c.fina, ...E.lotesCampania.map((v) => v.campania)])].sort().reverse();
    const sel = root?.dataset.campania || c.gruesa;
    const renspaFilas = E.renspa.map((r) => { const d = diasHasta(r.vence); return `<tr><td><strong>${esc(r.numero)}</strong><small>${esc(r.titular || '')}</small></td><td>${esc(r.campo || '-')}</td><td>${esc(r.vence || '-')}</td><td>${d === null ? '' : d < 0 ? '<span class="tag red">Vencido</span>' : d <= 30 ? `<span class="tag orange">Vence en ${d} días</span>` : '<span class="tag green">Vigente</span>'}</td><td><button class="btn small" data-borrar="renspa" data-id="${esc(r.id)}">Borrar</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="nota">Cargá los RENSPA de tus campos.</td></tr>';
    const celda = (loteId, tipo) => {
      const v = E.lotesCampania.find((x) => x.loteId === loteId && x.tipo === tipo && x.campania === (tipo === 'fina' ? A.campaniaDe('Trigo', `${sel.slice(0, 4)}-06-01`).campania : sel));
      if (!v) return '<span class="nota">—</span>';
      const r = E.renspa.find((x) => x.id === v.renspaId);
      return `${esc(A.CULTIVOS[v.cultivo]?.nombre || v.cultivo)} · ${esc(v.superficieHa || 0)} ha<small>RENSPA ${esc(r?.numero || 'sin RENSPA')} · siembra ${esc(v.fechaSiembra || '-')}</small> <button class="btn small" data-borrar="lotesCampania" data-id="${esc(v.id)}">×</button>`;
    };
    const lotesFilas = E.lotes.map((l) => `<tr><td><strong>${esc(l.codigo)}</strong><small>${esc(l.campo || '')}</small></td><td class="num">${esc(l.superficieHa || 0)} ha</td><td>${celda(l.id, 'fina')}</td><td>${celda(l.id, 'gruesa')}</td><td><button class="btn small" data-borrar="lotes" data-id="${esc(l.id)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="5" class="nota">Cargá tus lotes (los de "Campos y lotes" se traen solos).</td></tr>';
    return `
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">🪪 RENSPA (SENASA)</div></div>
          <table class="tabla"><thead><tr><th>RENSPA</th><th>Campo</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>${renspaFilas}</tbody></table>
          <form data-form="renspa" class="form-grid" style="margin-top:12px">
            <label>Número RENSPA<input name="numero" required placeholder="06.123.0.00001/00"></label>
            <label>Campo<input name="campo"></label><label>Titular<input name="titular"></label>
            <label>Vence<input name="vence" type="date"></label>
            <label>&nbsp;<button class="btn primary" type="submit">+ RENSPA</button></label>
          </form></div>
        <div class="card"><div class="card-header"><div class="card-title">🗺️ Lotes</div></div>
          <form data-form="lote" class="form-grid">
            <label>Código<input name="codigo" required placeholder="L-01"></label><label>Campo<input name="campo"></label>
            <label>Superficie (ha)<input name="superficieHa" type="number" step="0.1" min="0"></label>
            <label>&nbsp;<button class="btn primary" type="submit">+ Lote</button></label>
          </form>
          <form data-form="vinculo" class="form-grid" style="margin-top:14px">
            <label>Lote<select name="loteId" required>${opciones(E.lotes.map((l) => [l.id, l.codigo]))}</select></label>
            <label>Cultivo<select name="cultivo" required>${granosOpc()}</select></label>
            <label>Fecha de siembra<input name="fechaSiembra" type="date" value="${hoy()}" required></label>
            <label>Superficie sembrada (ha)<input name="superficieHa" type="number" step="0.1" min="0" required></label>
            <label>RENSPA<select name="renspaId" required>${opciones(E.renspa.map((r) => [r.id, `${r.numero} · ${r.campo || ''}`]))}</select></label>
            <label>&nbsp;<button class="btn primary" type="submit">Vincular a la campaña</button></label>
          </form><div class="nota">La campaña sale del cultivo y la fecha: Trigo es fina; Soja, Maíz y Girasol, gruesa. Un lote puede tener una fina y una gruesa (soja de segunda).</div></div>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">📅 Lotes por campaña</div><select data-campania>${opciones(campList.map((x) => [x, `Campaña ${x}`]), sel)}</select></div>
        <table class="tabla"><thead><tr><th>Lote</th><th class="num">Superficie</th><th>Fina (Trigo)</th><th>Gruesa (Soja · Maíz · Girasol)</th><th></th></tr></thead><tbody>${lotesFilas}</tbody></table></div>`;
  }

  // ---------- Pestaña Fiscal ----------
  function vistaFiscal() {
    const movs = E.comprobantesIva;
    const periodo = anual ? mesFiscal.slice(0, 4) : mesFiscal;
    const p = A.posicionIva(movs, periodo, { anual }) || {};
    const delPeriodo = (f) => String(f || '').slice(0, anual ? 4 : 7) === periodo;
    const ret = E.retenciones.filter((r) => delPeriodo(r.fecha));
    const porReg = ['IVA', 'GANANCIAS', 'IIBB'].map((reg) => ({ reg, filas: ret.filter((r) => r.regimen === reg) }));
    const s = sisa();
    const venc = (t) => (s.vencimientos || []).find((v) => v.tipo === t) || {};
    const efectiva = Object.keys(A.CULTIVOS).flatMap((g) => Object.keys(A.ESTADOS_SISA).map((e) => ({ g, e, ...A.reglaSisa(E.reglasSisa, g, e, hoy()) })));
    const contratos = E.contratosArrendamiento.map((c) => {
      const pagos = c.pagos || [];
      const ret = pagos.reduce((s2, x) => s2 + (x.retencion || 0), 0);
      const pendiente = pagos.filter((x) => x.retencion && !x.depositada).reduce((s2, x) => s2 + x.retencion, 0);
      return `<tr><td><strong>${esc(c.campo)}</strong><small>${esc(c.arrendador || '')} · CUIT ${esc(c.cuit || '-')}</small></td><td>${c.modalidad === 'QUINTALES' ? `${esc(c.cantidad)} qq de ${esc(A.CULTIVOS[c.grano]?.nombre || '')}` : pesos(c.cantidad)}</td><td>${esc(c.vigenciaHasta || '-')}</td><td>${pagos.length} pago(s)${ret ? `<small>Ret. Ganancias ${pesos(ret)} · a depositar ${pesos(pendiente)}</small>` : ''}</td><td><button class="btn small" data-pagar-contrato="${esc(c.id)}">Registrar pago</button>${pendiente ? ` <button class="btn small" data-depositar-contrato="${esc(c.id)}">Marcar depositada</button>` : ''} <button class="btn small" data-borrar="contratosArrendamiento" data-id="${esc(c.id)}">Borrar</button></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="nota">Sin contratos.</td></tr>';
    return `${E.condicionIva !== 'RI' ? alertasHtml([{ nivel: 'warn', texto: 'Monotributo: no liquidás IVA. Las LPG van sin IVA ni retenciones de IVA y Ganancias, y el IVA de compras y gastos es costo. La posición de IVA queda en cero.' }]) : ''}
      <div class="card"><div class="card-header"><div class="card-title">🧮 Posición de IVA</div>
        <div style="display:flex;gap:10px;align-items:center"><input type="month" data-mes-fiscal value="${esc(mesFiscal)}"><label class="nota"><input type="checkbox" data-anual ${anual ? 'checked' : ''}> Anual</label></div></div>
        <div class="kpi-grid">
          ${kpi('red', 'Débito fiscal', pesos(p.debito), 'IVA de las LPG y ventas')}
          ${kpi('green', 'Crédito fiscal', pesos(p.credito), 'IVA de deducciones y compras')}
          ${kpi('purple', 'Retenciones de IVA', pesos(p.retIva), 'RG 4310 · computables')}
          ${kpi('blue', p.aPagar ? 'IVA a pagar' : 'Saldo a favor', pesos(p.aPagar || (p.favorTecnico || 0) + (p.favorLibre || 0)), `Técnico ${pesos(p.favorTecnico)} · libre disponibilidad ${pesos(p.favorLibre)}`)}
        </div>
        <div class="nota">Arrastra saldo técnico anterior ${pesos(p.favorTecnicoAnterior)} y de libre disponibilidad ${pesos(p.favorLibreAnterior)}.</div>
        <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" data-libro="debito">⬇️ Libro IVA Ventas (CSV)</button><button class="btn" data-libro="credito">⬇️ Libro IVA Compras (CSV)</button></div></div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">✂️ Retenciones sufridas del período</div></div>
          <table class="tabla"><thead><tr><th>Régimen</th><th class="num">Cant.</th><th class="num">Total</th><th>Norma</th></tr></thead><tbody>${porReg.map((x) => `<tr><td>${x.reg === 'IIBB' ? 'Ingresos Brutos' : x.reg === 'IVA' ? 'IVA' : 'Ganancias'}</td><td class="num">${x.filas.length}</td><td class="num">${pesos(x.filas.reduce((s2, r) => s2 + r.importe, 0))}</td><td><small>${x.reg === 'IIBB' ? 'Agencia provincial' : esc(A.RG4310)}</small></td></tr>`).join('')}</tbody></table>
          <div class="nota">Con el número de certificado de cada una: ${ret.filter((r) => r.certificado).length} de ${ret.length}. Conciliá con "Mis Retenciones" de ARCA.</div></div>
        <div class="card"><div class="card-header"><div class="card-title">↩️ Reintegros de IVA (SISA Estado 1)</div></div>
          <table class="tabla"><thead><tr><th>Fecha</th><th>LPG</th><th class="num">Importe</th><th>Estado</th></tr></thead><tbody>${E.reintegrosIva.map((r) => `<tr><td>${esc(r.fecha)}</td><td>${esc(E.lpg.find((x) => x.id === r.lpgId)?.numero || '')}</td><td class="num">${pesos(r.importe)}</td><td>${r.estado === 'COBRADO' ? '<span class="tag green">Cobrado</span>' : `<button class="btn small" data-cobrar-reintegro="${esc(r.id)}">Marcar cobrado</button>`}</td></tr>`).join('') || '<tr><td colspan="4" class="nota">Sin reintegros.</td></tr>'}</tbody></table></div>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">🏛️ SISA del productor</div></div>
        ${alertasHtml(A.obligacionesSisa({ config: { ...s, vencimientos: s.vencimientos || [] }, stockKg: A.stockPorGrano(E.movimientosGrano).porGrano, vinculos: E.lotesCampania, hoy: hoy() }))}
        <form data-form="sisa" class="form-grid" style="margin-top:10px">
          <label>CUIT productor<input name="cuit" value="${esc(s.cuit || '')}"></label>
          <label>Estado SISA<select name="estado"><option value="">—</option>${estadosOpc(s.estado)}</select></label>
          <label>Actualizado<input name="actualizado" type="date" value="${esc(s.actualizado || '')}"></label>
          ${[['EXISTENCIAS', 'Vence DDJJ existencias'], ['AREAS_FINA', 'Vence áreas sembradas fina'], ['AREAS_GRUESA', 'Vence áreas sembradas gruesa']].map(([t, n]) => `<label>${n}<input name="vence_${t}" type="date" value="${esc(venc(t).vence || '')}"></label><label>Presentada<select name="presentado_${t}">${opciones([['', 'No'], ['si', 'Sí']], venc(t).presentado ? 'si' : '')}</select></label>`).join('')}
          <label>&nbsp;<button class="btn primary" type="submit">Guardar SISA</button></label>
        </form><div class="nota">Las fechas límite de las declaraciones las cargás vos (ARCA las publica cada campaña).</div></div>
      <div class="card"><div class="card-header"><div><div class="card-title">📐 Reglas de retención SISA (grano × estado)</div><div class="card-sub">Se aplica la regla VALIDADA y vigente más nueva; si no hay, la tabla por defecto (y la LPG avisa).</div></div></div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Grano</th><th>Estado</th><th class="num">Ret. IVA</th><th class="num">Ret. Ganancias</th><th>Reintegro</th><th>Origen</th></tr></thead><tbody>${efectiva.map((x) => `<tr><td>${esc(A.CULTIVOS[x.g].nombre)}</td><td>${esc(x.e)}</td><td class="num">${pct(x.regla.ivaPct)}</td><td class="num">${pct(x.regla.gananciasPct)}</td><td>${x.regla.reintegro ? 'Sí' : 'No'}</td><td>${x.usaDefecto ? '<span class="tag orange">Por defecto</span>' : `<span class="tag green">Validada desde ${esc(x.regla.vigenciaDesde)}</span>`}</td></tr>`).join('')}</tbody></table></div>
        <form data-form="reglaSisa" class="form-grid" style="margin-top:12px">
          <label>Grano<select name="grano">${granosOpc()}</select></label><label>Estado<select name="estado">${estadosOpc('1')}</select></label>
          <label>Ret. IVA (%)<input name="ivaPct" type="number" step="0.01" required></label><label>Ret. Ganancias (%)<input name="gananciasPct" type="number" step="0.01" required></label>
          <label>Reintegro<select name="reintegro">${opciones([['', 'No'], ['si', 'Sí']])}</select></label>
          <label>Vigente desde<input name="vigenciaDesde" type="date" value="${hoy()}" required></label>
          <label>Estado de la regla<select name="estadoRegla">${opciones([['VALIDADA', 'Validada'], ['BORRADOR', 'Borrador']])}</select></label>
          <label>Fuente<input name="fuente" placeholder="RG / comunicado"></label>
          <label>&nbsp;<button class="btn primary" type="submit">+ Regla</button></label>
        </form></div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">🏦 IIBB e Impuesto de Sellos por provincia</div></div>
          <table class="tabla"><thead><tr><th>Provincia</th><th class="num">Ret. IIBB</th><th class="num">Sellos</th></tr></thead><tbody>${A.PROVINCIAS.map((pr) => `<tr><td>${esc(pr)}</td><td class="num">${pct(A.reglaIibb(E.reglasIibb, pr, hoy()).regla.alicuotaPct)}</td><td class="num">${pct(A.SELLOS_PROVINCIA[pr])}</td></tr>`).join('')}</tbody></table>
          <form data-form="reglaIibb" class="form-grid" style="margin-top:10px">
            <label>Provincia<select name="provincia">${opciones(A.PROVINCIAS.map((x) => [x, x]))}</select></label>
            <label>Ret. IIBB (%)<input name="alicuotaPct" type="number" step="0.01" required></label>
            <label>Vigente desde<input name="vigenciaDesde" type="date" value="${hoy()}"></label>
            <label>Fuente<input name="fuente" placeholder="ARBA / API / Rentas"></label>
            <label>&nbsp;<button class="btn primary" type="submit">Guardar</button></label>
          </form><div class="nota">El productor primario queda exento de IIBB por defecto. Sellos: simulador LPG por provincia.</div></div>
        <div class="card"><div class="card-header"><div class="card-title">🤝 Arrendamientos</div></div>
          <table class="tabla"><thead><tr><th>Campo</th><th>Canon</th><th>Hasta</th><th>Pagos</th><th></th></tr></thead><tbody>${contratos}</tbody></table>
          <form data-form="contrato" class="form-grid" style="margin-top:10px">
            <label>Campo<input name="campo" required></label><label>Arrendador<input name="arrendador"></label><label>CUIT<input name="cuit"></label>
            <label>Modalidad<select name="modalidad">${opciones([['QUINTALES', 'Quintales de grano'], ['PESOS', 'Pesos']])}</select></label>
            <label>Grano (quintales)<select name="grano">${granosOpc()}</select></label>
            <label>Canon por pago (qq o $)<input name="cantidad" type="number" min="0" required></label>
            <label>Arrendador inscripto en Ganancias<select name="inscripto">${opciones([['si', 'Sí'], ['', 'No']])}</select></label>
            <label>Persona jurídica<select name="personaJuridica">${opciones([['', 'No'], ['si', 'Sí']])}</select></label>
            <label>Vigente hasta<input name="vigenciaHasta" type="date"></label>
            <label>&nbsp;<button class="btn primary" type="submit">+ Contrato</button></label>
          </form><div class="nota">En pesos: retención de Ganancias ${esc(A.RG830_LOCACION_RURAL.norma)} (6 % sobre el excedente de $11.200 mensuales). Locación rural con destino agropecuario: exenta de IVA. En quintales: descuenta el grano del stock.</div></div>
      </div>`;
  }

  // ---------- Pestaña Compras e insumos ----------
  function vistaCompras() {
    const ing = A.ingresosInsumo(E.compras, E.condicionIva);
    const stock = A.stockInsumos(E.compras, E.labores, E.ajustesInsumo, E.condicionIva);
    const mes = hoy().slice(0, 7);
    const delMes = E.compras.filter((c) => String(c.fecha).slice(0, 7) === mes);
    const valorStock = Object.values(stock).reduce((s, x) => s + Math.max(0, x.cantidad) * (A.precioInsumo(ing, x.insumo, hoy()) || 0), 0);
    const negativos = Object.values(stock).filter((x) => x.cantidad < 0);
    const nombresInsumo = [...new Set(E.compras.filter((c) => c.tipo === 'INSUMO').map((c) => c.insumo))];
    const filasStock = Object.values(stock).sort((a, b) => a.insumo.localeCompare(b.insumo)).map((x) => { const p = A.precioInsumo(ing, x.insumo, hoy()); return `<tr><td>${esc(x.insumo)}</td><td class="num">${x.cantidad.toLocaleString('es-AR')} ${esc(x.unidad)}</td><td class="num">${p === null ? '-' : pesos(p)}</td><td class="num">${p === null ? '-' : pesos(Math.max(0, x.cantidad) * p)}</td><td>${x.cantidad < 0 ? '<span class="tag red">Negativo: falta cargar una compra</span>' : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="nota">Sin insumos.</td></tr>';
    const filasCompras = [...E.compras].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 60).map((c) => `<tr><td>${esc(c.fecha)}</td><td><strong>${esc(c.proveedor || '-')}</strong><small>${esc(c.comprobante || '')}</small></td><td>${c.tipo === 'INSUMO' ? `${esc(c.insumo)} · ${Number(c.cantidad || 0).toLocaleString('es-AR')} ${esc(c.unidad || '')}<small>Al stock</small>` : `${esc(c.categoria)}: ${esc(c.concepto || '')}<small>${c.loteId ? `Lote ${esc(lote(c.loteId)?.codigo || '')}` : 'Estructura'}</small>`}</td><td class="num">${pesos(c.neto)}</td><td class="num">${pesos(c.iva)}</td><td class="num">${pesos(A.costoCompra(c, E.condicionIva))}</td><td><button class="btn small" data-borrar-compra="${esc(c.id)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="7" class="nota">Sin compras.</td></tr>';
    return `
      <div class="kpi-grid">
        ${kpi('orange', 'Compras del mes (neto)', pesos(delMes.reduce((s, c) => s + Number(c.neto || 0), 0)), `${delMes.length} factura(s)`)}
        ${kpi('green', 'IVA crédito del mes', pesos(E.condicionIva === 'RI' ? delMes.reduce((s, c) => s + Number(c.iva || 0), 0) : 0), E.condicionIva === 'RI' ? 'Va a la posición de IVA' : 'Monotributo: el IVA es costo')}
        ${kpi('blue', 'Stock de insumos', pesos(valorStock), `${Object.keys(stock).length} insumo(s) al último precio`)}
        ${kpi(negativos.length ? 'red' : 'purple', 'Insumos en negativo', String(negativos.length), negativos.length ? negativos.map((x) => x.insumo).slice(0, 3).join(', ') : 'Todo cubierto por compras')}
      </div>
      <div class="card"><div class="card-header"><div><div class="card-title">🧾 Nueva compra</div><div class="card-sub">Insumo: entra al stock y es costo cuando se usa en una labor. Servicio: con lote es costo directo; sin lote, estructura. ${E.condicionIva === 'RI' ? 'Responsable inscripto: cuenta el neto y el IVA es crédito fiscal.' : 'Monotributo: cuenta con IVA.'}</div></div></div>
        <form data-form="compra" class="form-grid">
          <label>Fecha<input name="fecha" type="date" value="${hoy()}" required></label>
          <label>Tipo<select name="tipo">${opciones([['INSUMO', 'Insumo (al stock)'], ['SERVICIO', 'Servicio / gasto']])}</select></label>
          <label>Proveedor<input name="proveedor" required></label><label>Comprobante<input name="comprobante" placeholder="A-0001-00001234"></label>
          <label>Insumo<input name="insumo" list="agroInsumos" placeholder="Urea granulada"></label>
          <label>Categoría del insumo<select name="categoriaInsumo">${opciones(A.CATEGORIAS_INSUMO.map((x) => [x, x]))}</select></label>
          <label>Cantidad<input name="cantidad" type="number" step="0.01" min="0"></label><label>Unidad<input name="unidad" placeholder="kg / l / bolsa"></label>
          <label>Categoría del servicio<select name="categoria">${opciones(A.CATEGORIAS_SERVICIO.map((x) => [x, x]))}</select></label>
          <label>Concepto del servicio<input name="concepto"></label>
          <label>Lote (servicio directo)<select name="loteId"><option value="">— estructura —</option>${opciones(E.lotes.map((l) => [l.id, l.codigo]))}</select></label>
          <label>Cultivo<select name="cultivo"><option value="">—</option>${granosOpc()}</select></label>
          <label>Importe neto<input name="neto" type="number" step="0.01" min="0" required></label>
          <label>IVA<select name="ivaPct">${opciones([['21', '21 %'], ['10.5', '10,5 %'], ['27', '27 %'], ['0', 'Sin IVA']])}</select></label>
          <label>Pagada<select name="pagado">${opciones([['SI', 'Sí'], ['NO', 'No']])}</select></label>
          <label>&nbsp;<button class="btn primary" type="submit">Guardar compra</button></label>
        </form><datalist id="agroInsumos">${nombresInsumo.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">📦 Stock de insumos</div></div>
          <table class="tabla"><thead><tr><th>Insumo</th><th class="num">Cantidad</th><th class="num">Último precio</th><th class="num">Valor</th><th></th></tr></thead><tbody>${filasStock}</tbody></table>
          <form data-form="ajusteInsumo" class="form-grid" style="margin-top:10px">
            <label>Insumo<input name="insumo" list="agroInsumos" required></label><label>Cantidad (+ / −)<input name="cantidad" type="number" step="0.01" required></label>
            <label>Fecha<input name="fecha" type="date" value="${hoy()}"></label><label>Motivo<input name="motivo" placeholder="Recuento / rotura"></label>
            <label>&nbsp;<button class="btn" type="submit">Ajustar stock</button></label>
          </form></div>
        <div class="card"><div class="card-header"><div class="card-title">📄 Compras</div></div><div style="overflow-x:auto">
          <table class="tabla"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Detalle</th><th class="num">Neto</th><th class="num">IVA</th><th class="num">Costo</th><th></th></tr></thead><tbody>${filasCompras}</tbody></table></div></div>
      </div>`;
  }

  // ---------- Pestaña Labores ----------
  function costoLabor(l) {
    return A.costosDelPeriodo({ ...datosCostos(), labores: [l], compras: E.compras, empleados: [], contratos: [], lpg: [] }, l.fecha, l.fecha).filter((f) => f.origen.startsWith('Labor')).reduce((s, f) => s + f.importe, 0);
  }
  function vistaLabores() {
    const lista = [...E.labores].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((l) => {
      const costo = l.estado === 'REALIZADA' ? costoLabor(l) : 0;
      return `<tr><td>${esc(l.fecha)}</td><td><strong>${esc(lote(l.loteId)?.codigo || '-')}</strong><small>${esc(A.CULTIVOS[l.cultivo]?.nombre || '')} ${esc(l.campania || '')}</small></td><td>${esc(l.tipo)}</td><td class="num">${esc(l.ha || 0)} ha</td><td>${(l.insumos || []).map((u) => `${esc(u.insumo)} ${esc(u.cantidad)} ${esc(u.unidad || '')}`).join('<br>') || '-'}</td><td>${esc(E.equipos.find((e) => e.id === l.equipoId)?.nombre || '')}${l.horas ? ` · ${esc(l.horas)} h` : ''}${l.contratista ? `<small>Contratista ${esc(l.contratista)}</small>` : ''}</td><td class="num">${l.estado === 'REALIZADA' ? pesos(costo) : '-'}${l.estado === 'REALIZADA' && l.ha ? `<small>${pesos(costo / l.ha)}/ha</small>` : ''}</td><td>${l.estado === 'REALIZADA' ? '<span class="tag green">Realizada</span>' : `<button class="btn small" data-realizar-labor="${esc(l.id)}">Marcar realizada</button>`}</td><td><button class="btn small" data-borrar="labores" data-id="${esc(l.id)}">Borrar</button></td></tr>`;
    }).join('') || '<tr><td colspan="9" class="nota">Sin labores.</td></tr>';
    const linea = (i) => `<label>Insumo ${i}<input name="insumo${i}" list="agroInsumos"></label><label>Cantidad ${i}<input name="cantidad${i}" type="number" step="0.01" min="0"></label><label>Unidad ${i}<input name="unidad${i}" placeholder="kg / l"></label>`;
    const nombresInsumo = [...new Set(E.compras.filter((c) => c.tipo === 'INSUMO').map((c) => c.insumo))];
    return `
      <div class="card"><div class="card-header"><div><div class="card-title">🚜 Nueva labor</div><div class="card-sub">Solo las realizadas son costo: insumos usados al último precio de compra + horas de máquina × costo horario, o el contratista (neto).</div></div></div>
        <form data-form="labor" class="form-grid">
          <label>Fecha<input name="fecha" type="date" value="${hoy()}" required></label>
          <label>Lote<select name="loteId" required>${opciones(E.lotes.map((l) => [l.id, l.codigo]))}</select></label>
          <label>Cultivo<select name="cultivo" required>${granosOpc()}</select></label>
          <label>Tipo<select name="tipo">${opciones(A.TIPOS_LABOR.map((x) => [x, x]))}</select></label>
          <label>Hectáreas<input name="ha" type="number" step="0.1" min="0" required></label>
          <label>Estado<select name="estado">${opciones([['REALIZADA', 'Realizada'], ['PLANIFICADA', 'Planificada']])}</select></label>
          <label>Equipo<select name="equipoId"><option value="">—</option>${opciones(E.equipos.map((e) => [e.id, `${e.nombre} · ${pesos(e.costoHora)}/h`]))}</select></label>
          <label>Horas de máquina<input name="horas" type="number" step="0.1" min="0"></label>
          <label>Contratista<input name="contratista"></label><label>Contratista neto ($)<input name="contratistaNeto" type="number" min="0"></label>
          ${linea(1)}${linea(2)}${linea(3)}
          <label>Ing. agrónomo (receta)<input name="agronomo" placeholder="Solo aplicaciones"></label><label>Matrícula<input name="matricula"></label><label>N.º de receta agronómica<input name="receta"></label><label>Provincia de la receta<input name="provinciaReceta"></label>
          <label>&nbsp;<button class="btn primary" type="submit">Guardar labor</button></label>
        </form><datalist id="agroInsumos">${nombresInsumo.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="nota">La campaña sale del cultivo y la fecha. Si el contratista te factura, cargá su factura en Compras (servicio con lote) en vez del importe acá, para no contarlo dos veces.</div></div>
      <div class="card"><div class="card-header"><div class="card-title">📋 Labores</div></div><div style="overflow-x:auto">
        <table class="tabla"><thead><tr><th>Fecha</th><th>Lote</th><th>Labor</th><th class="num">Superficie</th><th>Insumos</th><th>Máquina / contratista</th><th class="num">Costo</th><th>Estado</th><th></th></tr></thead><tbody>${lista}</tbody></table></div></div>`;
  }

  // ---------- Pestaña Costos y resultados ----------
  function vistaResultados() {
    const camps = [...new Set(E.lotesCampania.map((v) => v.campania))].sort().reverse();
    // Por defecto, la última campaña con ventas (LPG); una campaña recién empezada no tiene resultado.
    const conVentas = camps.find((c) => E.lpg.some((l) => l.calculo?.campania === c));
    const camp = campaniaResultados && camps.includes(campaniaResultados) ? campaniaResultados : conVentas || camps[0] || campanias().gruesa;
    const per = A.periodoCampania(camp, 'gruesa');
    const tc = tipoCambio(per.hasta.slice(0, 7)) || tipoCambio();
    const r = A.resultadoCampania(datosCostos(), camp, { tipoCambio: tc });
    const t = r.totales;
    const filasLote = r.lotes.map((x) => `<tr><td><strong>${esc(x.lote)}</strong><small>${esc(x.campo)}</small></td><td>${esc(A.CULTIVOS[x.cultivo]?.nombre || x.cultivo)}<small>${esc(x.tipo)}</small></td><td class="num">${x.ha.toLocaleString('es-AR')}</td><td class="num">${x.rindeTnHa ? `${x.rindeTnHa.toLocaleString('es-AR')} t/ha` : '-'}</td><td class="num">${pesos(x.ingresos)}${x.stockValuado ? `<small>ventas ${pesos(x.ventas)} · stock ${pesos(x.stockValuado)}</small>` : ''}</td><td class="num">${pesos(x.directos)}</td><td class="num">${pesos(x.margenBruto)}</td><td class="num">${pesos(x.estructura)}</td><td class="num"><strong style="color:${x.resultado < 0 ? 'var(--red)' : '#10b981'}">${pesos(x.resultado)}</strong></td><td class="num">${pesos(x.costoHa)}</td><td class="num">${x.costoTn === null ? '-' : pesos(x.costoTn)}${x.costoTnUsd !== null ? `<small>USD ${x.costoTnUsd.toLocaleString('es-AR')}/t</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="11" class="nota">Vinculá lotes a la campaña en "RENSPA y campañas".</td></tr>';
    const filasGrupo = Object.entries(r.porGrupo).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([g, v]) => `<tr><td>${esc(g)}</td><td class="num">${pesos(v)}</td><td class="num">${r.haTotal ? pesos(v / r.haTotal) : '-'}</td></tr>`).join('') || '<tr><td colspan="3" class="nota">Sin costos en la campaña.</td></tr>';
    const detalle = [...r.filas].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 80).map((f) => `<tr><td>${esc(f.fecha)}</td><td>${esc(f.grupo)}</td><td>${esc(f.origen)}</td><td>${esc(f.concepto)}${f.motivo ? `<small>${esc(f.motivo)}</small>` : ''}</td><td>${f.loteId ? esc(lote(f.loteId)?.codigo || '') : f.directo ? 'Por cultivo' : 'Estructura'}</td><td class="num">${pesos(f.importe)}</td></tr>`).join('');
    const empleados = E.empleados.map((e) => `<tr><td><strong>${esc(e.nombre)}</strong><small>${esc(e.legajo || '')} · ${esc(e.puesto || '')}</small></td><td class="num">${pesos(e.sueldo)}</td><td class="num">${pct(e.cargasPct === '' || e.cargasPct == null ? A.CARGAS_SOCIALES_PCT_DEFECTO : e.cargasPct)}</td><td>${esc(e.ingreso || '-')}${e.baja ? ` → ${esc(e.baja)}` : ''}</td><td><button class="btn small" data-borrar="empleados" data-id="${esc(e.id)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin personal cargado.</td></tr>';
    const equipos = E.equipos.map((e) => `<tr><td><strong>${esc(e.nombre)}</strong><small>${esc(e.codigo || '')}${e.revisar ? ` · ⚠️ ${esc(e.revisar)}${e.costoHoraUsd ? ` (USD ${esc(e.costoHoraUsd)}/h)` : ''}` : ''}</small></td><td class="num">${pesos(e.costoHora)}/h</td><td class="num">${pesos(e.valor)}</td><td class="num">${esc(e.vidaUtilAnios || '-')} años</td><td><button class="btn small" data-editar-equipo="${esc(e.id)}">Editar</button> <button class="btn small" data-borrar="equipos" data-id="${esc(e.id)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin equipos.</td></tr>';
    return `
      <div class="card"><div class="card-header"><div><div class="card-title">💵 Costos y resultado por lote</div><div class="card-sub">Campaña ${esc(camp)} (fina y gruesa) · estructura del período ${esc(r.periodo.desde)} a ${esc(per.hasta)} repartida por hectárea · ${tc ? `USD informativo a $ ${tc.toLocaleString('es-AR')}` : 'cargá el tipo de cambio para ver USD'}</div></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><select data-campania-resultados>${opciones((camps.length ? camps : [camp]).map((x) => [x, `Campaña ${x}`]), camp)}</select>
          <select data-condicion-iva>${opciones([['RI', 'Responsable inscripto'], ['MONOTRIBUTO', 'Monotributo']], E.condicionIva)}</select></div></div>
        <div class="kpi-grid">
          ${kpi('green', 'Producción valuada', pesos(t.ingresos), `Ventas LPG ${pesos(t.ventas)} + sin vender ${pesos(t.stockValuado)} · ${usd(t.ingresos, tc)}`)}
          ${kpi('orange', 'Costos directos', pesos(t.directos), `${usd(t.directos, tc)} · ${r.haTotal ? pesos(t.directos / r.haTotal) + '/ha' : ''}`)}
          ${kpi('blue', 'Margen bruto', pesos(t.margenBruto), `${usd(t.margenBruto, tc)} · ${r.haTotal ? pesos(t.margenBruto / r.haTotal) + '/ha' : ''}`)}
          ${kpi('purple', 'Estructura', pesos(t.estructura), `Personal, amortizaciones, arrendamientos y gastos sin lote · ${usd(t.estructura, tc)}`)}
          ${kpi(t.resultado < 0 ? 'red' : 'green', 'Resultado', pesos(t.resultado), `${usd(t.resultado, tc)} · ${r.haTotal ? `${usd(t.resultado / r.haTotal, tc)}/ha` : ''}`)}
        </div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Lote</th><th>Cultivo</th><th class="num">Ha</th><th class="num">Rinde</th><th class="num">Producción</th><th class="num">Directos</th><th class="num">Margen bruto</th><th class="num">Estructura</th><th class="num">Resultado</th><th class="num">Costo/ha</th><th class="num">Costo/t</th></tr></thead><tbody>${filasLote}</tbody></table></div>
        <div class="nota">Producción valuada: ventas (subtotal neto de las LPG de la campaña) + lo cosechado y todavía no vendido, al último precio de LPG del grano; se reparte según lo cosechado por cada lote (sin cosecha cargada, por hectárea). Rinde: ingresos de cosecha al stock con lote. Los arrendamientos de un campo van solo a los lotes de ese campo.${Object.entries(r.porCultivo).filter(([, c]) => c.sinPrecio).map(([g]) => ` ⚠️ ${A.CULTIVOS[g].nombre}: hay grano sin vender y ninguna LPG para valuarlo.`).join('')}</div></div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">📊 Costos por rubro</div></div><table class="tabla"><thead><tr><th>Rubro</th><th class="num">Total</th><th class="num">Por ha</th></tr></thead><tbody>${filasGrupo}</tbody></table></div>
        <div class="card"><div class="card-header"><div class="card-title">💱 Tipo de cambio (informativo)</div></div>
          <table class="tabla"><thead><tr><th>Mes</th><th class="num">$ por USD</th><th></th></tr></thead><tbody>${[...E.tiposCambio].sort((a, b) => b.mes.localeCompare(a.mes)).slice(0, 12).map((x) => `<tr><td>${esc(x.mes)}</td><td class="num">${pesos(x.ars)}</td><td><button class="btn small" data-borrar-tc="${esc(x.mes)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="3" class="nota">Sin cargar.</td></tr>'}</tbody></table>
          <form data-form="tipoCambio" class="form-grid" style="margin-top:10px"><label>Mes<input name="mes" type="month" value="${hoy().slice(0, 7)}" required></label><label>$ por USD<input name="ars" type="number" step="0.01" min="0" required></label><label>&nbsp;<button class="btn" type="submit">Guardar</button></label></form></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">👷 Personal (estructura)</div></div>
          <table class="tabla"><thead><tr><th>Empleado</th><th class="num">Sueldo</th><th class="num">Cargas</th><th>Período</th><th></th></tr></thead><tbody>${empleados}</tbody></table>
          <form data-form="empleado" class="form-grid" style="margin-top:10px"><label>Nombre<input name="nombre" required></label><label>Legajo<input name="legajo"></label><label>Puesto<input name="puesto"></label><label>Sueldo bruto mensual<input name="sueldo" type="number" min="0" required></label><label>Cargas sociales (%)<input name="cargasPct" type="number" step="0.1" placeholder="${A.CARGAS_SOCIALES_PCT_DEFECTO}"></label><label>Ingreso<input name="ingreso" type="date"></label><label>Baja<input name="baja" type="date"></label><label>&nbsp;<button class="btn primary" type="submit">+ Empleado</button></label></form></div>
        <div class="card"><div class="card-header"><div class="card-title">🚜 Equipos (costo horario y amortización)</div></div>
          <table class="tabla"><thead><tr><th>Equipo</th><th class="num">Costo horario</th><th class="num">Valor</th><th class="num">Vida útil</th><th></th></tr></thead><tbody>${equipos}</tbody></table>
          <form data-form="equipo" class="form-grid" style="margin-top:10px"><input type="hidden" name="id"><label>Código<input name="codigo"></label><label>Nombre<input name="nombre" required></label><label>Costo horario ($)<input name="costoHora" type="number" min="0" required></label><label>Valor de compra ($)<input name="valor" type="number" min="0"></label><label>Valor residual ($)<input name="valorResidual" type="number" min="0"></label><label>Vida útil (años)<input name="vidaUtilAnios" type="number" min="0"></label><label>Alta<input name="fechaAlta" type="date"></label><label>&nbsp;<button class="btn primary" type="submit">Guardar equipo</button></label></form>
          <div class="nota">El costo horario (combustible, mantenimiento y operario) se usa en las labores; la amortización (valor − residual) / vida útil va a estructura.</div></div>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">🔎 Detalle de costos de la campaña</div><span class="tag blue">${r.filas.length} fila(s)</span></div><div style="overflow-x:auto">
        <table class="tabla"><thead><tr><th>Fecha</th><th>Rubro</th><th>Origen</th><th>Concepto</th><th>Imputación</th><th class="num">Importe</th></tr></thead><tbody>${detalle || '<tr><td colspan="6" class="nota">Sin costos.</td></tr>'}</tbody></table></div>
        <div class="nota">Las filas en $ 0 explican por qué no suman (compras que van al stock, labores planificadas, insumos sin precio).</div></div>`;
  }

  // ---------- Pestaña Cartas de Porte (ARCA) ----------
  function vistaCpe() {
    const alertas = A.alertasCpe({ cpes: E.cpes, lpg: E.lpg, hoy: hoy() });
    const ubOpc = (sel) => opciones(E.ubicaciones.map((u) => [u.id, `${u.nombre} · ${A.CULTIVOS[u.grano]?.nombre || ''}`]), sel);
    const filas = [...E.cpes].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((c) => {
      const l = E.lpg.find((x) => x.id === c.lpgId);
      const tag = { PENDIENTE: 'orange', ACTIVA: 'blue', CONFIRMADA: 'green', ANULADA: 'red' }[c.estado] || 'blue';
      return `<tr><td><strong>${esc(c.numero)}</strong><small>${esc(c.fecha)} · ${c.tipo === 'TRASLADO' ? 'Traslado propio' : 'Venta'}</small></td><td>${esc(A.CULTIVOS[c.grano]?.nombre || '')}</td><td>${esc(ubicacion(c.ubicacionId)?.nombre || c.origen || '-')}<small>→ ${esc(c.tipo === 'TRASLADO' ? ubicacion(c.ubicacionDestinoId)?.nombre || '' : `${c.destino || ''} ${c.cuitDestino ? `(${c.cuitDestino})` : ''}`)}</small></td><td>${esc(c.transportista || '-')}<small>${esc(c.patente || '')}</small></td><td class="num">${Number(c.kgOrigen || 0).toLocaleString('es-AR')}</td><td class="num">${c.kgDestino ? Number(c.kgDestino).toLocaleString('es-AR') : '-'}</td><td>${l ? esc(l.numero || l.fecha) : c.tipo === 'VENTA' ? '<span class="nota">sin LPG</span>' : '-'}</td><td><span class="tag ${tag}">${esc(c.estado)}</span></td><td>${c.estado === 'ACTIVA' || c.estado === 'PENDIENTE' ? `<button class="btn small" data-confirmar-cpe="${esc(c.id)}">Confirmar arribo</button> ` : ''}${c.estado !== 'ANULADA' ? `<button class="btn small" data-anular-cpe="${esc(c.id)}">Anular</button>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="nota">Sin cartas de porte.</td></tr>';
    return `
      ${alertasHtml(alertas)}
      <div class="card"><div class="card-header"><div><div class="card-title">🚚 Nueva Carta de Porte</div><div class="card-sub">${esc(A.RG5017)}. La CPE se emite en ARCA (sitio web o app de escritorio con certificado); acá registrás su número para controlarla. Venta: el stock lo descuenta la LPG. Traslado propio: mueve el grano entre tus ubicaciones al confirmar el arribo.</div></div></div>
        <form data-form="cpe" class="form-grid">
          <label>Número CPE / CTG<input name="numero" required></label><label>Fecha<input name="fecha" type="date" value="${hoy()}" required></label>
          <label>Tipo<select name="tipo">${opciones([['VENTA', 'Venta (al comprador)'], ['TRASLADO', 'Traslado propio']])}</select></label>
          <label>Grano<select name="grano">${granosOpc()}</select></label>
          <label>Sale de<select name="ubicacionId"><option value="">— lote / campo —</option>${ubOpc()}</select></label>
          <label>Destino (traslado)<select name="ubicacionDestinoId"><option value="">—</option>${ubOpc()}</select></label>
          <label>Destino (planta / comprador)<input name="destino"></label><label>CUIT destino<input name="cuitDestino"></label>
          <label>Transportista<input name="transportista"></label><label>CUIT transportista<input name="cuitTransportista"></label>
          <label>Patente<input name="patente"></label><label>Chofer<input name="chofer"></label>
          <label>Kg origen<input name="kgOrigen" type="number" min="0" required></label><label>Kg destino (descarga)<input name="kgDestino" type="number" min="0"></label>
          <label>Estado<select name="estado">${opciones(A.ESTADOS_CPE.map((x) => [x, x.toLowerCase()]), 'ACTIVA')}</select></label>
          <label>LPG vinculada<select name="lpgId"><option value="">—</option>${opciones(E.lpg.map((l) => [l.id, `${l.numero || l.fecha} · ${l.calculo?.cultivo || ''}`]))}</select></label>
          <label>&nbsp;<button class="btn primary" type="submit">Guardar CPE</button></label>
        </form></div>
      <div class="card"><div class="card-header"><div class="card-title">📋 Cartas de Porte</div></div><div style="overflow-x:auto">
        <table class="tabla"><thead><tr><th>CPE</th><th>Grano</th><th>Origen → destino</th><th>Transporte</th><th class="num">Kg origen</th><th class="num">Kg destino</th><th>LPG</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div></div>`;
  }

  // ---------- Pestaña SENASA ----------
  function vistaSenasa() {
    const d = { labores: E.labores, productos: E.fitosanitarios, equipos: E.equipos, envases: E.envases, lotes: E.lotes, movimientosGrano: E.movimientosGrano, hoy: hoy() };
    const alertas = A.alertasSenasa(d);
    const car = A.carencias(d);
    const auto = A.envasesDeAplicaciones(d).filter((x) => !E.envases.some((e) => e.id === x.id));
    const prodFilas = E.fitosanitarios.map((p) => `<tr><td><strong>${esc(p.nombre)}</strong><small>${esc(p.principioActivo || '')}</small></td><td>${esc(p.registroSenasa || '—')}</td><td>${esc(p.banda || '-')}</td><td class="num">${esc(p.carenciaDias || 0)} días</td><td class="num">${esc(p.litrosPorEnvase || '-')} ${esc(p.unidad || '')}</td><td><button class="btn small" data-borrar="fitosanitarios" data-id="${esc(p.id)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="6" class="nota">Cargá los productos que usás: n.º de inscripción SENASA, carencia y envase.</td></tr>';
    const carFilas = car.map((c) => `<tr><td>${esc(lote(c.loteId)?.codigo || '')}</td><td>${esc(A.CULTIVOS[c.cultivo]?.nombre || '')} ${esc(c.campania)}</td><td>${esc(c.producto)}</td><td>${esc(c.aplicacion)}</td><td>${esc(c.libera)}</td><td>${c.activa ? `<span class="tag orange">${c.diasRestantes} día(s)</span>` : '<span class="tag green">Liberado</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="nota">Sin aplicaciones con carencia.</td></tr>';
    const aplicadores = E.equipos.filter((e) => e.esAplicador).map((e) => { const dd = e.habilitacionVence ? diasHasta(e.habilitacionVence) : null; return `<tr><td><strong>${esc(e.nombre)}</strong></td><td>${esc(e.habilitacion || '—')}</td><td>${esc(e.habilitacionVence || '-')}</td><td>${!e.habilitacion ? '<span class="tag red">Sin habilitación</span>' : dd !== null && dd < 0 ? '<span class="tag red">Vencida</span>' : dd !== null && dd <= 30 ? '<span class="tag orange">Por vencer</span>' : '<span class="tag green">Vigente</span>'}</td></tr>`; }).join('') || '<tr><td colspan="4" class="nota">Marcá tus pulverizadoras como aplicadoras.</td></tr>';
    const estadoEnv = { PENDIENTE_LAVADO: ['orange', 'Sin triple lavado'], LAVADO: ['blue', 'Lavado, sin entregar'], ENTREGADO_CAT: ['green', 'Entregado al CAT'] };
    const envFilas = [...auto.map((x) => ({ ...x, estado: 'SUGERIDO' })), ...E.envases].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((x) => `<tr><td>${esc(x.fecha)}</td><td>${esc(x.producto)}<small>${esc(x.capacidad || '')}${x.loteId ? ` · ${esc(lote(x.loteId)?.codigo || '')}` : ''}</small></td><td class="num">${esc(x.cantidad)}</td><td>${x.estado === 'SUGERIDO' ? '<span class="tag blue">De la aplicación</span>' : `<span class="tag ${estadoEnv[x.estado]?.[0] || 'blue'}">${esc(estadoEnv[x.estado]?.[1] || x.estado)}</span>`}${x.comprobanteCat ? `<small>CAT ${esc(x.comprobanteCat)}</small>` : ''}</td><td>${x.estado === 'SUGERIDO' ? `<button class="btn small" data-registrar-envase="${esc(x.id)}">Registrar</button>` : x.estado === 'PENDIENTE_LAVADO' ? `<button class="btn small" data-envase-estado="${esc(x.id)}" data-nuevo="LAVADO">Triple lavado hecho</button>` : x.estado === 'LAVADO' ? `<button class="btn small" data-envase-estado="${esc(x.id)}" data-nuevo="ENTREGADO_CAT">Entregado al CAT</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin envases.</td></tr>';
    return `
      <div class="card"><div class="card-header"><div class="card-title">⚠️ Controles SENASA y agroquímicos</div><span class="tag orange">${alertas.length} pendiente(s)</span></div>${alertasHtml(alertas)}
        <div class="nota">Receta agronómica y habilitación de aplicadores: leyes provinciales de agroquímicos. Productos: inscripción y marbete aprobados por SENASA (carencia). Envases vacíos: ${esc(A.LEY_FITO)}.</div></div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">🧪 Registro de fitosanitarios</div></div>
          <table class="tabla"><thead><tr><th>Producto</th><th>N.º SENASA</th><th>Banda</th><th class="num">Carencia</th><th class="num">Envase</th><th></th></tr></thead><tbody>${prodFilas}</tbody></table>
          <form data-form="fitosanitario" class="form-grid" style="margin-top:10px"><label>Nombre comercial<input name="nombre" required list="agroInsumos"></label><label>Principio activo<input name="principioActivo"></label><label>N.º inscripción SENASA<input name="registroSenasa"></label><label>Banda toxicológica<select name="banda">${opciones([['', '—'], ['Ia', 'Ia (roja)'], ['Ib', 'Ib (roja)'], ['II', 'II (amarilla)'], ['III', 'III (azul)'], ['IV', 'IV (verde)']])}</select></label><label>Carencia (días antes de cosecha)<input name="carenciaDias" type="number" min="0"></label><label>Contenido por envase<input name="litrosPorEnvase" type="number" step="0.1" min="0"></label><label>Unidad<select name="unidad">${opciones([['l', 'litros'], ['kg', 'kg']])}</select></label><label>&nbsp;<button class="btn primary" type="submit">+ Producto</button></label></form>
          <datalist id="agroInsumos">${[...new Set(E.compras.filter((c) => c.tipo === 'INSUMO').map((c) => c.insumo))].map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
        <div class="card"><div class="card-header"><div class="card-title">⏳ Carencias por lote</div></div>
          <table class="tabla"><thead><tr><th>Lote</th><th>Cultivo</th><th>Producto</th><th>Aplicación</th><th>Libera</th><th>Estado</th></tr></thead><tbody>${carFilas}</tbody></table></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">🚿 Pulverizadoras (aplicadores)</div></div>
          <table class="tabla"><thead><tr><th>Equipo</th><th>Habilitación</th><th>Vence</th><th>Estado</th></tr></thead><tbody>${aplicadores}</tbody></table>
          <form data-form="aplicador" class="form-grid" style="margin-top:10px"><label>Equipo<select name="equipoId" required>${opciones(E.equipos.map((e) => [e.id, e.nombre]))}</select></label><label>N.º habilitación provincial<input name="habilitacion"></label><label>Vence<input name="habilitacionVence" type="date"></label><label>&nbsp;<button class="btn primary" type="submit">Guardar como aplicador</button></label></form></div>
        <div class="card"><div class="card-header"><div class="card-title">♻️ Envases vacíos (triple lavado y CAT)</div></div>
          <table class="tabla"><thead><tr><th>Fecha</th><th>Producto</th><th class="num">Envases</th><th>Estado</th><th></th></tr></thead><tbody>${envFilas}</tbody></table>
          <div class="nota">Los envases se calculan de cada aplicación (cantidad usada ÷ contenido del envase del producto). Registralos, marcá el triple lavado y la entrega al Centro de Acopio Transitorio con su comprobante.</div></div>
      </div>`;
  }

  // ---------- Render y eventos ----------
  const TABS = [['stock', '🌾 Stock'], ['lpg', '🧾 Liquidaciones (LPG)'], ['cpe', '🚚 Cartas de Porte'], ['renspa', '🪪 RENSPA y campañas'], ['compras', '📦 Compras e insumos'], ['labores', '🚜 Labores'], ['senasa', '🌱 SENASA'], ['resultados', '💵 Costos y resultados'], ['fiscal', '🏛️ Fiscal']];
  function render() {
    if (!root) return;
    const vistas = { stock: vistaStock, lpg: vistaLpg, cpe: vistaCpe, renspa: vistaRenspa, compras: vistaCompras, labores: vistaLabores, senasa: vistaSenasa, resultados: vistaResultados, fiscal: vistaFiscal };
    root.innerHTML = `<div class="tabs">${TABS.map(([k, t]) => `<button class="tab${k === tab ? ' active' : ''}" type="button" data-tab="${k}">${t}</button>`).join('')}</div>${vistas[tab]()}`;
    if (tab === 'lpg') actualizarDesglose();
  }
  async function refrescar() { await cargar(); render(); }
  const descargar = (nombre, texto) => {
    const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  async function alEnviar(ev) {
    const form = ev.target.closest('form[data-form]');
    if (!form || !root.contains(form)) return;
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(form).entries());
    try {
      switch (form.dataset.form) {
        case 'ubicacion': await DB.guardar('ubicaciones', { tipo: f.tipo, nombre: f.nombre, grano: f.grano, campo: f.campo, capacidadTn: Number(f.capacidadTn) || 0, metros: Number(f.metros) || '', fechaEmbolsado: f.fechaEmbolsado }); break;
        case 'movimiento': {
          const u = ubicacion(f.ubicacionId);
          if (!u) throw new Error('Elegí la ubicación.');
          if (f.tipo === 'TRASLADO' && (!f.ubicacionDestinoId || f.ubicacionDestinoId === f.ubicacionId)) throw new Error('Elegí un destino distinto para el traslado.');
          if (f.tipo === 'TRASLADO' && ubicacion(f.ubicacionDestinoId)?.grano !== u.grano) throw new Error('El destino guarda otro grano.');
          const kg = Number(f.kg) || 0;
          if (f.tipo !== 'AJUSTE' && !(kg > 0)) throw new Error('Los kilos tienen que ser mayores a cero.');
          const prueba = A.stockPorUbicacion([...E.movimientosGrano, { ...f, grano: u.grano, kg }]);
          if (prueba.avisos.length > A.stockPorUbicacion(E.movimientosGrano).avisos.length && !confirm(`${prueba.avisos[prueba.avisos.length - 1]}\n\n¿Registrar igual?`)) return;
          await DB.guardar('movimientosGrano', { fecha: f.fecha, tipo: f.tipo, grano: u.grano, ubicacionId: f.ubicacionId, ubicacionDestinoId: f.tipo === 'TRASLADO' ? f.ubicacionDestinoId : '', kg, loteId: f.loteId, detalle: f.detalle });
          break;
        }
        case 'lpg': {
          const r = calcularDesdeForm(form);
          if (r.error) throw new Error(r.error);
          const salidaKg = Number(r.d.salidaKg) || Number(r.d.kgBrutos) || 0;
          const salidas = r.d.salidaUbicacionId ? [{ ubicacionId: r.d.salidaUbicacionId, kg: salidaKg }] : [];
          if (salidas.length && ubicacion(salidas[0].ubicacionId)?.grano !== r.c.grano) throw new Error('La ubicación elegida guarda otro grano.');
          const previa = lpgEditando ? E.lpg.find((x) => x.id === lpgEditando) : null;
          await DB.guardarLpg({ ...(previa || {}), id: previa?.id, numero: r.d.numero, coe: r.d.coe, comprador: r.d.comprador, cuitComprador: r.d.cuitComprador, lpgOrigenId: r.d.lpgOrigenId, cpe: r.d.cpe, datos: r.d, calculo: r.c }, salidas);
          lpgEditando = null;
          toast(`LPG guardada · neto ${pesos(r.c.neto)}${r.c.usaDefecto ? ' (retenciones con la tabla por defecto)' : ''}`);
          break;
        }
        case 'renspa': await DB.guardar('renspa', { numero: f.numero.trim(), campo: f.campo, titular: f.titular, vence: f.vence }); break;
        case 'lote': await DB.guardar('lotes', { codigo: f.codigo.trim(), campo: f.campo, superficieHa: Number(f.superficieHa) || 0 }); break;
        case 'vinculo': {
          const camp = A.campaniaDe(f.cultivo, f.fechaSiembra);
          const v = { loteId: f.loteId, cultivo: A.grano(f.cultivo), tipo: camp.tipo, campania: camp.campania, renspaId: f.renspaId, fechaSiembra: f.fechaSiembra, superficieHa: Number(f.superficieHa) || 0 };
          const val = A.validarVinculo(v, { existentes: E.lotesCampania, renspas: E.renspa, hoy: hoy() });
          if (!val.ok) throw new Error(val.errores.join('\n'));
          await DB.guardar('lotesCampania', v);
          root.dataset.campania = camp.tipo === 'fina' ? A.campaniaDe('Soja', `${camp.campania.slice(0, 4)}-09-01`).campania : camp.campania;
          break;
        }
        case 'sisa': {
          const vencimientos = ['EXISTENCIAS', 'AREAS_FINA', 'AREAS_GRUESA'].map((t) => ({ tipo: t, vence: f[`vence_${t}`] || '', presentado: f[`presentado_${t}`] === 'si' }));
          await DB.guardar('sisaProductor', { ...(sisa().id ? { id: sisa().id } : {}), cuit: f.cuit, estado: f.estado, actualizado: f.actualizado, vencimientos });
          break;
        }
        case 'reglaSisa': await DB.guardar('reglasSisa', { grano: f.grano, estado: f.estado, ivaPct: Number(f.ivaPct), gananciasPct: Number(f.gananciasPct), reintegro: f.reintegro === 'si', vigenciaDesde: f.vigenciaDesde, vigenciaHasta: '', estadoRegla: f.estadoRegla, fuente: f.fuente || 'Carga manual' }); break;
        case 'reglaIibb': await DB.guardar('reglasIibb', { provincia: f.provincia, alicuotaPct: Number(f.alicuotaPct), vigenciaDesde: f.vigenciaDesde || hoy(), vigenciaHasta: '', estadoRegla: 'VALIDADA', fuente: f.fuente || 'Carga manual' }); break;
        case 'compra': {
          const neto = Number(f.neto) || 0;
          const ivaPct = Number(f.ivaPct) || 0;
          if (f.tipo === 'INSUMO' && (!f.insumo.trim() || !(Number(f.cantidad) > 0))) throw new Error('Para un insumo cargá el nombre y la cantidad.');
          const camp = f.cultivo && f.tipo === 'SERVICIO' ? A.campaniaDe(f.cultivo, f.fecha).campania : '';
          await DB.guardarCompra({ fecha: f.fecha, tipo: f.tipo, proveedor: f.proveedor.trim(), comprobante: f.comprobante.trim(), insumo: f.tipo === 'INSUMO' ? f.insumo.trim() : '', categoriaInsumo: f.tipo === 'INSUMO' ? f.categoriaInsumo : '', cantidad: f.tipo === 'INSUMO' ? Number(f.cantidad) : 0, unidad: f.unidad.trim(), categoria: f.tipo === 'SERVICIO' ? f.categoria : '', concepto: f.tipo === 'SERVICIO' ? f.concepto.trim() : '', loteId: f.tipo === 'SERVICIO' ? f.loteId : '', cultivo: f.tipo === 'SERVICIO' ? A.grano(f.cultivo) || '' : '', campania: camp, neto, ivaPct, iva: Math.round(neto * ivaPct) / 100, total: Math.round(neto * (100 + ivaPct)) / 100, pagado: f.pagado });
          break;
        }
        case 'ajusteInsumo': await DB.guardar('ajustesInsumo', { fecha: f.fecha || hoy(), insumo: f.insumo.trim(), cantidad: Number(f.cantidad), motivo: f.motivo }); break;
        case 'labor': {
          const camp = A.campaniaDe(f.cultivo, f.fecha);
          const insumos = [1, 2, 3].map((i) => ({ insumo: (f[`insumo${i}`] || '').trim(), cantidad: Number(f[`cantidad${i}`]) || 0, unidad: (f[`unidad${i}`] || '').trim() })).filter((u) => u.insumo && u.cantidad > 0);
          if (f.equipoId && !(Number(f.horas) > 0)) throw new Error('Indicá las horas de máquina.');
          if (f.tipo === 'Cosecha') {
            const enCarencia = A.carencias({ labores: E.labores, productos: E.fitosanitarios, hoy: f.fecha }).find((c) => c.activa && c.loteId === f.loteId && c.cultivo === A.grano(f.cultivo));
            if (enCarencia && !confirm(`El lote está en carencia por ${enCarencia.producto} hasta el ${enCarencia.libera}. Cosechar antes puede dejar residuos por encima del límite. ¿Guardar igual?`)) return;
          }
          if (f.tipo === 'Aplicación' && f.estado === 'REALIZADA' && (!f.agronomo.trim() || !f.matricula.trim() || !f.receta.trim()) && !confirm('Aplicación sin receta agronómica completa (ingeniero, matrícula y número). La ley provincial la exige. ¿Guardar igual?')) return;
          await DB.guardar('labores', { fecha: f.fecha, loteId: f.loteId, cultivo: A.grano(f.cultivo), campania: camp.campania, tipo: f.tipo, ha: Number(f.ha) || 0, estado: f.estado, equipoId: f.equipoId, horas: Number(f.horas) || 0, contratista: f.contratista.trim(), contratistaNeto: Number(f.contratistaNeto) || 0, insumos, agronomo: f.agronomo.trim(), matricula: f.matricula.trim(), receta: f.receta.trim(), provinciaReceta: f.provinciaReceta.trim() });
          break;
        }
        case 'empleado': await DB.guardar('empleados', { nombre: f.nombre.trim(), legajo: f.legajo, puesto: f.puesto, sueldo: Number(f.sueldo) || 0, cargasPct: f.cargasPct === '' ? '' : Number(f.cargasPct), ingreso: f.ingreso, baja: f.baja, estado: f.baja ? 'BAJA' : 'ACTIVO' }); break;
        case 'equipo': await DB.guardar('equipos', { ...(f.id ? { id: f.id } : {}), codigo: f.codigo, nombre: f.nombre.trim(), costoHora: Number(f.costoHora) || 0, valor: Number(f.valor) || 0, valorResidual: Number(f.valorResidual) || 0, vidaUtilAnios: Number(f.vidaUtilAnios) || 0, fechaAlta: f.fechaAlta, revisar: '' }); break;
        case 'tipoCambio': await DB.db.tiposCambio.put({ mes: f.mes, ars: Number(f.ars) || 0 }); break;
        case 'cpe': {
          if (E.cpes.some((c) => String(c.numero).trim() === f.numero.trim() && c.estado !== 'ANULADA')) throw new Error('Ya hay una Carta de Porte con ese número.');
          if (f.tipo === 'TRASLADO' && (!f.ubicacionId || !f.ubicacionDestinoId || f.ubicacionId === f.ubicacionDestinoId)) throw new Error('Para un traslado propio elegí origen y destino distintos.');
          const cpe = await DB.guardar('cpes', { numero: f.numero.trim(), fecha: f.fecha, tipo: f.tipo, grano: A.grano(f.grano), ubicacionId: f.ubicacionId, ubicacionDestinoId: f.tipo === 'TRASLADO' ? f.ubicacionDestinoId : '', destino: f.destino, cuitDestino: f.cuitDestino, transportista: f.transportista, cuitTransportista: f.cuitTransportista, patente: f.patente, chofer: f.chofer, kgOrigen: Number(f.kgOrigen) || 0, kgDestino: Number(f.kgDestino) || 0, estado: f.estado, lpgId: f.lpgId });
          if (cpe.tipo === 'TRASLADO' && cpe.estado === 'CONFIRMADA') await moverTrasladoCpe(cpe);
          break;
        }
        case 'fitosanitario': await DB.guardar('fitosanitarios', { nombre: f.nombre.trim(), principioActivo: f.principioActivo, registroSenasa: f.registroSenasa.trim(), banda: f.banda, carenciaDias: Number(f.carenciaDias) || 0, litrosPorEnvase: Number(f.litrosPorEnvase) || 0, unidad: f.unidad }); break;
        case 'aplicador': { const e = E.equipos.find((x) => x.id === f.equipoId); await DB.guardar('equipos', { ...e, esAplicador: true, habilitacion: f.habilitacion.trim(), habilitacionVence: f.habilitacionVence }); break; }
        case 'contrato': await DB.guardar('contratosArrendamiento', { campo: f.campo, arrendador: f.arrendador, cuit: f.cuit, modalidad: f.modalidad, grano: f.grano, cantidad: Number(f.cantidad) || 0, inscripto: f.inscripto === 'si', personaJuridica: f.personaJuridica === 'si', vigenciaHasta: f.vigenciaHasta, pagos: [] }); break;
        default: return;
      }
      await refrescar();
    } catch (e) { alert(e.message || e); }
  }

  async function alClic(ev) {
    const b = ev.target.closest('button, [data-tab]');
    if (!b || !root.contains(b)) return;
    const d = b.dataset;
    try {
      if (d.tab) { tab = d.tab; lpgEditando = null; render(); return; }
      if (d.borrar) { if (!confirm('¿Borrar este registro?')) return; await DB.borrar(d.borrar, d.id); return refrescar(); }
      if (d.editarLpg) { lpgEditando = d.editarLpg; render(); root.scrollIntoView({ behavior: 'smooth' }); return; }
      if (d.cancelarLpg !== undefined) { lpgEditando = null; render(); return; }
      if (d.borrarLpg) { if (!confirm('¿Borrar la LPG? Se borran también sus retenciones, su IVA y el egreso de stock.')) return; await DB.borrarLpg(d.borrarLpg); return refrescar(); }
      if (d.cobrarReintegro) { const r = E.reintegrosIva.find((x) => x.id === d.cobrarReintegro); await DB.guardar('reintegrosIva', { ...r, estado: 'COBRADO', cobradoEl: hoy() }); return refrescar(); }
      if (d.libro) { descargar(`libro-iva-${d.libro === 'credito' ? 'compras' : 'ventas'}-${mesFiscal}.csv`, A.libroIvaCsv(E.comprobantesIva, mesFiscal, d.libro)); return; }
      if (d.confirmarCpe) {
        const c = E.cpes.find((x) => x.id === d.confirmarCpe);
        const kg = prompt('Kilos descargados en destino:', c.kgDestino || c.kgOrigen);
        if (kg === null) return;
        const cpe = await DB.guardar('cpes', { ...c, estado: 'CONFIRMADA', kgDestino: Number(kg) || 0 });
        if (cpe.tipo === 'TRASLADO') await moverTrasladoCpe(cpe);
        return refrescar();
      }
      if (d.anularCpe) {
        if (!confirm('¿Anular la Carta de Porte? (anulala también en ARCA)')) return;
        const c = E.cpes.find((x) => x.id === d.anularCpe);
        await DB.guardar('cpes', { ...c, estado: 'ANULADA' });
        if (E.movimientosGrano.some((m) => m.id === `${c.id}-traslado`)) await DB.borrar('movimientosGrano', `${c.id}-traslado`);
        return refrescar();
      }
      if (d.registrarEnvase) {
        const x = A.envasesDeAplicaciones({ labores: E.labores, productos: E.fitosanitarios }).find((y) => y.id === d.registrarEnvase);
        if (x) await DB.guardar('envases', { ...x, estado: 'PENDIENTE_LAVADO' });
        return refrescar();
      }
      if (d.envaseEstado) {
        const x = E.envases.find((y) => y.id === d.envaseEstado);
        let comprobanteCat = x.comprobanteCat || '';
        if (d.nuevo === 'ENTREGADO_CAT') { comprobanteCat = prompt('Comprobante de entrega del CAT:', '') || ''; if (!comprobanteCat && !confirm('¿Marcar entregado sin comprobante?')) return; }
        await DB.guardar('envases', { ...x, estado: d.nuevo, comprobanteCat, [d.nuevo === 'LAVADO' ? 'lavadoEl' : 'entregadoEl']: hoy() });
        return refrescar();
      }
      if (d.borrarCompra) { if (!confirm('¿Borrar la compra? Se borra también su IVA.')) return; await DB.borrarCompra(d.borrarCompra); return refrescar(); }
      if (d.realizarLabor) { const l = E.labores.find((x) => x.id === d.realizarLabor); await DB.guardar('labores', { ...l, estado: 'REALIZADA' }); return refrescar(); }
      if (d.borrarTc) { await DB.db.tiposCambio.delete(d.borrarTc); return refrescar(); }
      if (d.editarEquipo) {
        const e = E.equipos.find((x) => x.id === d.editarEquipo);
        const form = root.querySelector('form[data-form="equipo"]');
        ['id', 'codigo', 'nombre', 'costoHora', 'valor', 'valorResidual', 'vidaUtilAnios', 'fechaAlta'].forEach((k) => { if (form.elements[k]) form.elements[k].value = e[k] ?? ''; });
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (d.pagarContrato) return pagarContrato(d.pagarContrato);
      if (d.depositarContrato) { const c = E.contratosArrendamiento.find((x) => x.id === d.depositarContrato); await DB.guardar('contratosArrendamiento', { ...c, pagos: (c.pagos || []).map((x) => (x.retencion ? { ...x, depositada: true } : x)) }); return refrescar(); }
    } catch (e) { alert(e.message || e); }
  }

  // Traslado propio con CPE confirmada: mueve el grano (kilos de destino si se cargaron).
  async function moverTrasladoCpe(cpe) {
    await DB.guardar('movimientosGrano', { id: `${cpe.id}-traslado`, fecha: cpe.fecha, tipo: 'TRASLADO', grano: cpe.grano, ubicacionId: cpe.ubicacionId, ubicacionDestinoId: cpe.ubicacionDestinoId, kg: Number(cpe.kgDestino) || Number(cpe.kgOrigen) || 0, detalle: `CPE ${cpe.numero}`, cpeId: cpe.id });
  }

  async function pagarContrato(id) {
    const c = E.contratosArrendamiento.find((x) => x.id === id);
    const fecha = prompt('Fecha del pago (AAAA-MM-DD):', hoy());
    if (!fecha) return;
    const pagos = [...(c.pagos || [])];
    if (c.modalidad === 'QUINTALES') {
      const opc = E.ubicaciones.filter((u) => u.grano === c.grano);
      if (!opc.length) { alert(`No hay silobolsas ni celdas de ${A.CULTIVOS[c.grano]?.nombre}.`); return; }
      const idx = Number(prompt(`¿De qué ubicación sale el grano?\n${opc.map((u, i) => `${i + 1}. ${u.nombre}`).join('\n')}`, '1')) - 1;
      const u = opc[idx];
      if (!u) return;
      const kg = Number(c.cantidad) * 100;
      const mov = await DB.guardar('movimientosGrano', { fecha, tipo: 'EGRESO_VENTA', grano: c.grano, ubicacionId: u.id, kg, detalle: `Arrendamiento ${c.campo} (${c.cantidad} qq)` });
      pagos.push({ fecha, kg, movimientoId: mov.id });
    } else {
      const acumuladoMes = pagos.filter((x) => String(x.fecha).slice(0, 7) === fecha.slice(0, 7)).reduce((s, x) => s + (x.importe || 0), 0);
      const r = A.retencionArrendamiento({ importe: c.cantidad, inscripto: c.inscripto, personaJuridica: c.personaJuridica, acumuladoMes });
      pagos.push({ fecha, importe: Number(c.cantidad), retencion: r.retencion, base: r.base, alicuotaPct: r.alicuotaPct, norma: r.norma, depositada: false });
      alert(`Pago de ${pesos(c.cantidad)}: retención de Ganancias ${pesos(r.retencion)} (${r.motivo || `${r.alicuotaPct} % sobre ${pesos(r.base)}`}). Neto a pagar ${pesos(r.neto)}.`);
    }
    await DB.guardar('contratosArrendamiento', { ...c, pagos });
    await refrescar();
  }

  function enlazar(el) {
    if (el.dataset.agroEnlazado) return;
    el.dataset.agroEnlazado = '1';
    el.addEventListener('submit', alEnviar);
    el.addEventListener('click', alClic);
    el.addEventListener('input', (ev) => { if (ev.target.closest('form[data-form="lpg"]')) actualizarDesglose(); });
    el.addEventListener('change', (ev) => {
      if (ev.target.closest('form[data-form="lpg"]')) actualizarDesglose();
      if (ev.target.matches('[data-campania]')) { root.dataset.campania = ev.target.value; render(); }
      if (ev.target.matches('[data-mes-fiscal]')) { mesFiscal = ev.target.value || mesFiscal; render(); }
      if (ev.target.matches('[data-anual]')) { anual = ev.target.checked; render(); }
      if (ev.target.matches('[data-campania-resultados]')) { campaniaResultados = ev.target.value; render(); }
      if (ev.target.matches('[data-condicion-iva]')) {
        DB.meta.set('condicionIva', ev.target.value).then(async () => {
          // El IVA de compras y LPG cambia con la condición: se rehace todo con el mismo cálculo.
          await cargar();
          for (const c of E.compras) await DB.guardarCompra(c);
          for (const l of E.lpg) {
            const datos = { ...(l.datos || {}), condicionIva: E.condicionIva };
            const salidas = datos.salidaUbicacionId ? [{ ubicacionId: datos.salidaUbicacionId, kg: Number(datos.salidaKg) || Number(datos.kgBrutos) || 0 }] : [];
            await DB.guardarLpg({ ...l, datos, calculo: A.calcularLpg(datos, reglas()) }, salidas);
          }
          await refrescar();
          toast(`Condición ${E.condicionIva === 'RI' ? 'responsable inscripto' : 'monotributo'}: compras y LPG recalculadas.`);
        });
      }
    });
  }

  async function montar(el, pestaña) {
    root = el;
    if (pestaña) tab = pestaña;
    el.classList.add('pampa-ui');
    enlazar(el);
    el.innerHTML = '<div class="nota">Cargando…</div>';
    try { await DB.migrarDesdeLocalStorage(); } catch (e) { console.warn('agro: migración de lotes', e); }
    await refrescar();
  }

  // ---------- Centro operativo (Dashboard) ----------
  let graficoStock = null;
  async function montarDashboard(el) {
    if (!el) return;
    el.classList.add('pampa-ui');
    await cargar();
    const r = resumen();
    const vacio = !DB.TABLAS.filter((t) => t !== 'borrados').some((t) => (E[t] || []).length);
    const aviso = vacio && !esEscritorio() ? `<div id="demoBannerDashboard" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;padding:12px 16px;border:1px dashed #3fa66a;border-radius:12px;background:rgba(63,166,106,.08)"><div style="flex:1;min-width:220px"><strong>¿Querés ver la app funcionando con datos?</strong><div class="nota">Cargá un establecimiento de ejemplo con Soja, Trigo, Maíz y Girasol: stock en silobolsas, LPG con retenciones SISA, RENSPA y campañas, fiscal completo y alertas. Se borra con Limpieza profunda.</div></div><button class="btn primary" type="button" data-cargar-ejemplo>📥 Cargar datos de ejemplo</button></div>` : '';
    el.innerHTML = `${aviso}
      <div class="kpi-grid">
        ${kpi('blue', `Superficie fina ${r.campania.fina}`, `${r.haFina.toLocaleString('es-AR')} ha`, 'Trigo')}
        ${kpi('green', `Superficie gruesa ${r.campania.gruesa}`, `${r.haGruesa.toLocaleString('es-AR')} ha`, 'Soja · Maíz · Girasol')}
        ${kpi('orange', 'Stock de granos', tn(r.totalKg), Object.entries(r.porGrano).filter(([, v]) => v).map(([k, v]) => `${A.CULTIVOS[k].nombre} ${tn(v)}`).join(' · ') || 'Sin stock')}
        ${kpi('cyan', 'Ocupación de almacenaje', pct(r.ocupacion), `${E.ubicaciones.length} silobolsa(s) y celda(s) · ${tn(r.capacidadKg)}`)}
        ${kpi('purple', 'LPG últimos 30 días', tn(r.kgMes), `${r.lpgMes.length} liquidación(es) · neto ${pesos(r.netoMes)}`)}
        ${kpi('red', 'Retenciones últimos 30 días', pesos(r.retIvaMes + r.retGanMes), `IVA ${pesos(r.retIvaMes)} · Ganancias ${pesos(r.retGanMes)}${r.reintegroPendTotal ? ` · reintegro pendiente ${pesos(r.reintegroPendTotal)}` : ''}`)}
        ${kpi(r.lotesSinRenspa.length || r.renspaPorVencer.length ? 'red' : 'green', 'RENSPA', `${E.lotes.length - r.lotesSinRenspa.length}/${E.lotes.length}`, `lotes con RENSPA · ${r.renspaPorVencer.length} por vencer`)}
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">🌾 Stock por grano</div><button class="btn small" type="button" data-abrir-granos>Ver granos y almacenaje</button></div><div class="chart-container"><canvas id="agroStockChart"></canvas></div></div>
        <div class="card"><div class="card-header"><div class="card-title">⚠️ Alertas agrícolas y fiscales</div><span class="tag orange">${r.alertas.length} pendiente(s)</span></div>${alertasHtml(r.alertas)}</div>
      </div>`;
    // "Superficie activa" del Centro operativo: suma también los lotes del núcleo agrícola.
    const haLotes = E.lotes.reduce((s, l) => s + (Number(l.superficieHa) || 0), 0);
    const supEl = document.getElementById('dashboardSurface');
    if (supEl && haLotes && /^0\s*ha$/.test(supEl.textContent.trim())) {
      supEl.textContent = `${haLotes.toLocaleString('es-AR')} ha`;
      const sub = document.getElementById('dashboardSurfaceTrend');
      if (sub) sub.textContent = `${E.lotes.length} lote(s) registrado(s)`;
    }
    el.querySelector('[data-cargar-ejemplo]')?.addEventListener('click', () => cargarDatosEjemplo().catch((e) => alert(e.message || e)));
    el.querySelector('[data-abrir-granos]')?.addEventListener('click', () => (typeof window.openModule === 'function' ? window.openModule('Granos') : document.querySelector('button[data-view="Granos"]')?.click()));
    const canvas = el.querySelector('#agroStockChart');
    if (canvas && typeof window.Chart === 'function') {
      if (graficoStock) graficoStock.destroy();
      graficoStock = new window.Chart(canvas, {
        type: 'bar',
        data: { labels: Object.values(A.CULTIVOS).map((c) => c.nombre), datasets: [{ label: 'Toneladas', data: Object.keys(A.CULTIVOS).map((k) => Math.round(r.porGrano[k] / 100) / 10), backgroundColor: Object.values(A.CULTIVOS).map((c) => c.color), borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(45,53,72,.5)' } } } },
      });
    }
  }

  async function hayDatos() { const e = await DB.todoElEstado(); return DB.TABLAS.filter((t) => t !== 'borrados').some((t) => (e[t] || []).length); }

  // ---------- Datos de ejemplo (solo web) ----------
  const esEscritorio = () => Boolean(window.PAMPA_DESKTOP_MODE || window.location.protocol === 'file:');
  function correrFechas(valor, dias) {
    if (Array.isArray(valor)) return valor.map((v) => correrFechas(v, dias));
    if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, correrFechas(v, dias)]));
    if (typeof valor !== 'string') return valor;
    const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
    if (!m) return valor;
    const f = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    f.setUTCDate(f.getUTCDate() + dias);
    return f.toISOString().slice(0, 10) + m[4];
  }
  async function cargarDatosEjemplo() {
    if (esEscritorio()) return;
    let seed;
    try {
      const resp = await fetch('data/datosSemillaDemo.json', { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      seed = await resp.json();
    } catch (e) { alert(`No se pudieron leer los datos de ejemplo (${e.message}).`); return; }
    if (seed?._meta?.tipo !== 'pampa-seed-demo' || !seed.estado) { alert('El archivo de datos de ejemplo no tiene el formato esperado.'); return; }
    if (await hayDatos() && !confirm('Ya hay datos de granos cargados. Los datos de ejemplo los reemplazan. ¿Continuar?')) return;
    const [a, m, d] = String(seed._meta.fechaReferencia).split('-').map(Number);
    const h = new Date();
    const dias = Math.round((Date.UTC(h.getFullYear(), h.getMonth(), h.getDate()) - Date.UTC(a, m - 1, d)) / 864e5);
    const e = correrFechas(seed.estado, dias);
    await DB.vaciar();
    await DB.meta.set('migradoLocalStorage', new Date().toISOString());
    for (const t of ['renspa', 'lotes', 'ubicaciones', 'movimientosGrano', 'sisaProductor', 'reglasSisa', 'reglasIibb', 'contratosArrendamiento', 'equipos', 'empleados', 'fitosanitarios', 'envases']) await DB.guardarVarios(t, e[t] || []);
    await DB.meta.set('condicionIva', 'RI');
    // La campaña sale del cultivo y la fecha (siembra, labor o cosecha): acompaña al corrimiento de fechas.
    for (const v of e.lotesCampania || []) { const c = A.campaniaDe(v.cultivo, v.fechaSiembra); await DB.guardar('lotesCampania', { ...v, tipo: c.tipo, campania: c.campania }); }
    for (const l of e.labores || []) await DB.guardar('labores', { ...l, campania: A.campaniaDe(l.cultivo, l.fecha).campania });
    for (const c of e.compras || []) {
      const neto = Number(c.neto) || 0;
      const ivaPct = Number(c.ivaPct) || 0;
      const { fechaCosecha, ...resto } = c;
      await DB.guardarCompra({ ...resto, campania: c.cultivo ? A.campaniaDe(c.cultivo, fechaCosecha || c.fecha).campania : '', iva: Math.round(neto * ivaPct) / 100, total: Math.round(neto * (100 + ivaPct)) / 100 });
    }
    for (const t of e.tiposCambio || []) await DB.db.tiposCambio.put({ mes: String(t.fecha).slice(0, 7), ars: t.ars });
    await cargar();
    for (const l of e.lpg || []) {
      if (l.datos.fechaCosecha) l.datos.campania = A.campaniaDe(l.datos.grano, l.datos.fechaCosecha).campania;
      const calculo = A.calcularLpg(l.datos, reglas());
      await DB.guardarLpg({ id: l.id, numero: l.numero, coe: l.coe, comprador: l.comprador, cuitComprador: l.cuitComprador, lpgOrigenId: l.lpgOrigenId || '', cpe: l.datos.cpe || '', datos: { ...l.datos, numero: l.numero, coe: l.coe, comprador: l.comprador, cuitComprador: l.cuitComprador, lpgOrigenId: l.lpgOrigenId || '', salidaUbicacionId: l.salida?.ubicacionId || '', salidaKg: l.salida?.kg || '' }, calculo }, l.salida ? [l.salida] : []);
    }
    for (const c of e.cpes || []) await DB.guardar('cpes', c);
    await DB.meta.set('demo', { version: seed._meta.version, cargadoEn: new Date().toISOString() });
    await cargar();
    if (root) render();
    await montarDashboard(document.querySelector('#agroDashboard'));
    alert('Se cargó el establecimiento de ejemplo.\n\nTiene Soja, Trigo, Maíz y Girasol en dos campos, silobolsas y celda con stock, LPG con distintos estados SISA (con mermas, deducciones, Sellos y retenciones calculadas), una nota de crédito, RENSPA y campañas fina y gruesa, arrendamientos y alertas.\n\nPara borrarlo: Limpieza profunda.');
  }

  // ---------- Panel de sincronización (pantalla Conectividad) ----------
  async function panelSincronizacion(main) {
    const S = window.PampaAgroSync;
    const topbar = main?.querySelector('.topbar');
    if (!S || !topbar) return;
    main.querySelector('[data-agro-sync]')?.remove();
    const st = await S.estado();
    const u = st.ultima;
    const hace = u?.cuando ? new Date(u.cuando).toLocaleString('es-AR') : 'nunca';
    topbar.insertAdjacentHTML('afterend', `<section class="pampa-ui" data-agro-sync><div class="card"><div class="card-header"><div><div class="card-title">🔄 Sincronización entre equipos y respaldo</div><div class="card-sub">Los datos viven en cada equipo (funciona sin internet). Para compartirlos, elegí una carpeta que se sincronice sola: la de Google Drive, Dropbox u OneDrive de la computadora, o una carpeta de red. Cada equipo deja ahí su archivo y lee el de los demás; gana el cambio más nuevo y los borrados también viajan.</div></div><span class="tag ${st.conectada ? (u?.estado === 'ok' ? 'green' : 'orange') : 'blue'}">${st.conectada ? (u?.estado === 'ok' ? 'Sincronizado' : u?.estado === 'permiso' ? 'Falta permiso' : 'Conectada') : 'Sin carpeta'}</span></div>
      <div class="kpi-grid">
        <div class="kpi green"><div class="kpi-label">Carpeta</div><div class="kpi-value" style="font-size:18px">${esc(st.carpeta || '—')}</div><div class="kpi-sub">${st.soportaCarpeta ? 'Chrome / Edge / escritorio' : 'Este navegador no permite carpetas: usá Exportar / Importar'}</div></div>
        <div class="kpi blue"><div class="kpi-label">Última sincronización</div><div class="kpi-value" style="font-size:18px">${esc(hace)}</div><div class="kpi-sub">${u?.estado === 'ok' ? `${u.cambios} cambio(s) recibidos · ${u.equipos?.length || 0} equipo(s) más` : esc(u?.mensaje || '')}</div></div>
        <div class="kpi purple"><div class="kpi-label">Este equipo</div><div class="kpi-value" style="font-size:14px">${esc(String(st.dispositivo).slice(0, 8))}</div><div class="kpi-sub">Archivo pampa-precision-${esc(String(st.dispositivo).slice(0, 8))}….json</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${st.soportaCarpeta ? `<button class="btn primary" type="button" data-s="elegir">${st.conectada ? 'Cambiar carpeta' : 'Elegir carpeta de sincronización'}</button>` : ''}
        ${st.conectada ? '<button class="btn" type="button" data-s="ahora">Sincronizar ahora</button><button class="btn" type="button" data-s="desconectar">Desconectar</button>' : ''}
        <button class="btn" type="button" data-s="exportar">⬇️ Exportar archivo de sincronización</button>
        <button class="btn" type="button" data-s="importar">⬆️ Importar archivo (sincronización o respaldo)</button>
        <button class="btn" type="button" data-s="respaldo">💾 Descargar respaldo completo</button>
        <input type="file" accept=".json,application/json" data-s-archivo hidden>
      </div>
      <div class="nota">El respaldo completo incluye granos, LPG, costos, ARCA, SENASA, campos y lotes. Importar combina con lo que ya tenés (no borra nada propio). La limpieza profunda borra solo este equipo y lo desconecta de la carpeta.</div></div></section>`);
    const panel = main.querySelector('[data-agro-sync]');
    const correr = async (fn, ok) => { try { const r = await fn(); if (ok) toast(ok(r)); } catch (e) { if (e?.name !== 'AbortError') alert(e.message || e); } panelSincronizacion(main); };
    panel.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-s]');
      if (!b) return;
      const a = b.dataset.s;
      if (a === 'elegir') correr(() => S.elegirCarpeta(), (r) => (r.estado === 'ok' ? `Carpeta conectada · ${r.cambios} cambio(s) recibidos` : r.mensaje || r.estado));
      if (a === 'ahora') correr(() => S.sincronizar({ interactivo: true }), (r) => (r.estado === 'ok' ? `Sincronizado · ${r.cambios} cambio(s) recibidos de ${r.equipos.length} equipo(s)` : r.mensaje || r.estado));
      if (a === 'desconectar') correr(() => S.desconectarCarpeta(), () => 'Carpeta desconectada (los datos quedan en este equipo).');
      if (a === 'exportar') correr(() => S.exportarArchivo(), () => 'Archivo de sincronización descargado: copialo al otro equipo y usá Importar.');
      if (a === 'respaldo') correr(() => S.descargarRespaldo(), () => 'Respaldo completo descargado.');
      if (a === 'importar') panel.querySelector('[data-s-archivo]').click();
    });
    panel.querySelector('[data-s-archivo]').addEventListener('change', (ev) => {
      const file = ev.target.files?.[0];
      if (file) correr(() => S.importarArchivo(file), (r) => `Importado · ${r.cambios} cambio(s)${r.ls ? ` · ${r.ls} dato(s) de configuración` : ''}`);
    });
  }
  // Si llegaron cambios de otro equipo, se refresca lo que esté abierto.
  window.addEventListener('pampa-agro-sync', (ev) => {
    if (!ev.detail?.cambios) return;
    if (root?.isConnected) refrescar();
    const dash = document.querySelector('#agroDashboard');
    if (dash?.isConnected) montarDashboard(dash);
  });

  // Abre una pestaña del módulo desde otra pantalla de Precisión.
  function irA(pestaña) {
    tab = pestaña;
    lpgEditando = null;
    const boton = document.querySelector('button[data-view="Granos"]');
    if (boton) boton.click();
  }
  // Aviso en las pantallas anteriores (Inventario, Labores) que lleva a las pestañas con costo.
  function avisoEnVistaAnterior(main, pestaña, texto) {
    const topbar = main?.querySelector('.topbar');
    if (!topbar || main.querySelector('[data-agro-aviso]')) return;
    topbar.insertAdjacentHTML('afterend', `<div class="pampa-ui" data-agro-aviso><div class="alerta" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1">${esc(texto)}</span><button class="btn primary small" type="button">Ir a ${esc(TABS.find(([k]) => k === pestaña)?.[1] || pestaña)}</button></div></div>`);
    main.querySelector('[data-agro-aviso] button').addEventListener('click', () => irA(pestaña));
  }

  window.PampaAgroUI = { montar, montarDashboard, hayDatos, cargarDatosEjemplo, irA, avisoEnVistaAnterior, panelSincronizacion, refrescar: () => (root ? refrescar() : null), abrirLpg: () => { tab = 'lpg'; lpgEditando = null; } };
})();
