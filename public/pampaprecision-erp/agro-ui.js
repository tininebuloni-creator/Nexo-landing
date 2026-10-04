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
    E.datosExternos = await DB.db.datosExternos.toArray();
    E.datosExternosEstado = await DB.meta.get('datosExternosEstado');
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
  const datosCostos = () => ({ preciosReferencia: preciosPizarra(), condicionIva: E.condicionIva, compras: E.compras, labores: E.labores, equipos: E.equipos, empleados: E.empleados, lotes: E.lotes, lotesCampania: E.lotesCampania, lpg: E.lpg, contratos: E.contratosArrendamiento, movimientosGrano: E.movimientosGrano });
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
    alertas.push(...A.alertasSenasa({ labores: E.labores, productos: E.fitosanitarios, equipos: E.equipos, envases: E.envases, recetas: E.recetas, lotes: E.lotes, movimientosGrano: E.movimientosGrano, hoy: hoy() }).map((a) => ({ ...a, texto: `SENASA: ${a.texto}` })));
    alertas.push(...A.alertasEquipos({ equipos: E.equipos, labores: E.labores, mantenimientos: E.mantenimientos, hoy: hoy() }).map((a) => ({ ...a, texto: `Equipo: ${a.texto}` })));
    alertas.push(...A.alertasFinanzas({ cheques: E.cheques, creditos: E.creditos, movimientos: E.movimientosFondos, compras: E.compras, hoy: hoy() }).map((a) => ({ ...a, texto: `Finanzas: ${a.texto}` })));
    alertas.push(...alertasExternas().map((a) => ({ ...a, texto: `Clima: ${a.texto}` })));
    alertas.push(...A.alertasResiduos({ residuos: E.residuos, ubicaciones: E.ubicaciones, movimientosGrano: E.movimientosGrano, hoy: hoy() }).map((a) => ({ ...a, texto: `Residuos: ${a.texto}` })));
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
        <div style="grid-column:1/-1">${pizarraHtml({ boton: true })}</div>
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
          <label>Vence el pago<input name="vencimiento" type="date"></label><label>Pagada<select name="pagado">${opciones([['SI', 'Sí'], ['NO', 'No']])}</select></label>
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
          <label>Horas de máquina<input name="horas" type="number" step="0.1" min="0"></label><label>Operador<input name="operador" list="agroOperadores"></label>
          <label>Contratista<input name="contratista"></label><label>Contratista neto ($)<input name="contratistaNeto" type="number" min="0"></label>
          ${linea(1)}${linea(2)}${linea(3)}
          <label>Receta agronómica<select name="recetaId"><option value="">— Sin receta / externa —</option>${opciones(E.recetas.filter((r) => r.estado === 'EMITIDA').map((r) => [r.id, `${r.numero} · ${lote(r.loteId)?.codigo || ''} · ${(r.productos || []).map((p) => p.producto).join(', ')}`]))}</select></label><label>Receta externa: ing. agrónomo<input name="agronomo" placeholder="Solo si no está en la lista"></label><label>Matrícula<input name="matricula"></label><label>N.º de receta<input name="receta"></label><label>Provincia de la receta<input name="provinciaReceta"></label><label>Viento (km/h)<input name="viento" type="number" step="0.1" min="0" placeholder="Aplicaciones"></label><label>Temperatura (°C)<input name="temperatura" type="number" step="0.1"></label><label>Humedad relativa (%)<input name="humedad" type="number" step="1" min="0" max="100"></label><label>Inversión térmica<select name="inversionTermica"><option value="">—</option><option value="NO">No</option><option value="SI">Sí</option></select></label>
          <label>&nbsp;<button class="btn primary" type="submit">Guardar labor</button></label>
        </form><datalist id="agroOperadores">${[...new Set(E.labores.map((l) => l.operador).filter(Boolean))].map((n) => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="agroInsumos">${nombresInsumo.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
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
    // US$ día por día: cada movimiento con el MEP de su fecha (histórico de argentinadatos); sin histórico, el tipo de cambio del mes.
    const u = A.resultadoCampaniaUsd(r, { lpg: E.lpg, serie: serieMep(), hoy: hoy() });
    const enUsd = (k, divisor = 1) => (u ? `USD ${Math.round(u[k] / divisor).toLocaleString('es-AR')}` : usd(t[k] / divisor, tc));
    const loteUsd = (x) => u?.lotes.find((y) => y.loteId === x.loteId && y.cultivo === x.cultivo);
    const filasLote = r.lotes.map((x) => `<tr><td><strong>${esc(x.lote)}</strong><small>${esc(x.campo)}</small></td><td>${esc(A.CULTIVOS[x.cultivo]?.nombre || x.cultivo)}<small>${esc(x.tipo)}</small></td><td class="num">${x.ha.toLocaleString('es-AR')}</td><td class="num">${x.rindeTnHa ? `${x.rindeTnHa.toLocaleString('es-AR')} t/ha` : '-'}</td><td class="num">${pesos(x.ingresos)}${x.stockValuado ? `<small>ventas ${pesos(x.ventas)} · stock ${pesos(x.stockValuado)}</small>` : ''}</td><td class="num">${pesos(x.directos)}</td><td class="num">${pesos(x.margenBruto)}</td><td class="num">${pesos(x.estructura)}</td><td class="num"><strong style="color:${x.resultado < 0 ? 'var(--red)' : '#10b981'}">${pesos(x.resultado)}</strong></td><td class="num">${pesos(x.costoHa)}</td><td class="num">${x.costoTn === null ? '-' : pesos(x.costoTn)}${(u ? loteUsd(x)?.costoTn : x.costoTnUsd) != null ? `<small>USD ${(u ? loteUsd(x).costoTn : x.costoTnUsd).toLocaleString('es-AR')}/t</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="11" class="nota">Vinculá lotes a la campaña en "RENSPA y campañas".</td></tr>';
    const filasGrupo = Object.entries(r.porGrupo).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([g, v]) => `<tr><td>${esc(g)}</td><td class="num">${pesos(v)}</td><td class="num">${r.haTotal ? pesos(v / r.haTotal) : '-'}</td></tr>`).join('') || '<tr><td colspan="3" class="nota">Sin costos en la campaña.</td></tr>';
    const detalle = [...r.filas].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 80).map((f) => `<tr><td>${esc(f.fecha)}</td><td>${esc(f.grupo)}</td><td>${esc(f.origen)}</td><td>${esc(f.concepto)}${f.motivo ? `<small>${esc(f.motivo)}</small>` : ''}</td><td>${f.loteId ? esc(lote(f.loteId)?.codigo || '') : f.directo ? 'Por cultivo' : 'Estructura'}</td><td class="num">${pesos(f.importe)}</td></tr>`).join('');
    const empleados = E.empleados.map((e) => `<tr><td><strong>${esc(e.nombre)}</strong><small>${esc(e.legajo || '')} · ${esc(e.puesto || '')}</small></td><td class="num">${pesos(e.sueldo)}</td><td class="num">${pct(e.cargasPct === '' || e.cargasPct == null ? A.CARGAS_SOCIALES_PCT_DEFECTO : e.cargasPct)}</td><td>${esc(e.ingreso || '-')}${e.baja ? ` → ${esc(e.baja)}` : ''}</td><td><button class="btn small" data-borrar="empleados" data-id="${esc(e.id)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin personal cargado.</td></tr>';
    const equipos = E.equipos.map((e) => `<tr><td><strong>${esc(e.nombre)}</strong><small>${esc(e.codigo || '')}${e.revisar ? ` · ⚠️ ${esc(e.revisar)}${e.costoHoraUsd ? ` (USD ${esc(e.costoHoraUsd)}/h)` : ''}` : ''}</small></td><td class="num">${pesos(e.costoHora)}/h</td><td class="num">${pesos(e.valor)}</td><td class="num">${esc(e.vidaUtilAnios || '-')} años</td><td><button class="btn small" data-editar-equipo="${esc(e.id)}">Editar</button> <button class="btn small" data-borrar="equipos" data-id="${esc(e.id)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin equipos.</td></tr>';
    return `
      <div class="card"><div class="card-header"><div><div class="card-title">💵 Costos y resultado por lote</div><div class="card-sub">Campaña ${esc(camp)} (fina y gruesa) · estructura del período ${esc(r.periodo.desde)} a ${esc(per.hasta)} repartida por hectárea · ${u ? `USD día por día con el MEP de cada movimiento (último ${pesos(u.dolarHoy?.venta)} del ${esc(u.dolarHoy?.fecha || '')})${u.sinCotizacion ? ` · ${u.sinCotizacion} movimiento(s) anteriores al histórico` : ''}` : tc ? `USD informativo a $ ${tc.toLocaleString('es-AR')}` : 'cargá el tipo de cambio para ver USD'}</div></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><select data-campania-resultados>${opciones((camps.length ? camps : [camp]).map((x) => [x, `Campaña ${x}`]), camp)}</select>
          <select data-condicion-iva>${opciones([['RI', 'Responsable inscripto'], ['MONOTRIBUTO', 'Monotributo']], E.condicionIva)}</select></div></div>
        <div class="kpi-grid">
          ${kpi('green', 'Producción valuada', pesos(t.ingresos), `Ventas LPG ${pesos(t.ventas)} + sin vender ${pesos(t.stockValuado)}${Object.values(r.porCultivo).some((c) => c.fuentePrecio === 'pizarra Rosario' && c.kgSinVender) ? ' (a pizarra Rosario)' : ''} · ${enUsd('ingresos')}`)}
          ${kpi('orange', 'Costos directos', pesos(t.directos), `${enUsd('directos')} · ${r.haTotal ? pesos(t.directos / r.haTotal) + '/ha' : ''}`)}
          ${kpi('blue', 'Margen bruto', pesos(t.margenBruto), `${enUsd('margenBruto')} · ${r.haTotal ? pesos(t.margenBruto / r.haTotal) + '/ha' : ''}`)}
          ${kpi('purple', 'Estructura', pesos(t.estructura), `Personal, amortizaciones, arrendamientos y gastos sin lote · ${enUsd('estructura')}`)}
          ${kpi(t.resultado < 0 ? 'red' : 'green', 'Resultado', pesos(t.resultado), `${enUsd('resultado')} · ${r.haTotal ? `${enUsd('resultado', r.haTotal)}/ha` : ''}`)}
        </div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Lote</th><th>Cultivo</th><th class="num">Ha</th><th class="num">Rinde</th><th class="num">Producción</th><th class="num">Directos</th><th class="num">Margen bruto</th><th class="num">Estructura</th><th class="num">Resultado</th><th class="num">Costo/ha</th><th class="num">Costo/t</th></tr></thead><tbody>${filasLote}</tbody></table></div>
        <div class="nota">Producción valuada: ventas (subtotal neto de las LPG de la campaña) + lo cosechado y todavía no vendido, al último precio de LPG del grano; se reparte según lo cosechado por cada lote (sin cosecha cargada, por hectárea). Rinde: ingresos de cosecha al stock con lote. Los arrendamientos de un campo van solo a los lotes de ese campo.${Object.entries(r.porCultivo).filter(([, c]) => c.sinPrecio).map(([g]) => ` ⚠️ ${A.CULTIVOS[g].nombre}: hay grano sin vender y ninguna LPG para valuarlo.`).join('')}</div></div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">📊 Costos por rubro</div></div><table class="tabla"><thead><tr><th>Rubro</th><th class="num">Total</th><th class="num">Por ha</th></tr></thead><tbody>${filasGrupo}</tbody></table></div>
        <div class="card"><div class="card-header"><div class="card-title">💱 Tipo de cambio (informativo)</div></div>${cotizacionHtml()}
          <table class="tabla"><thead><tr><th>Mes</th><th class="num">$ por USD</th><th></th></tr></thead><tbody>${[...E.tiposCambio].sort((a, b) => b.mes.localeCompare(a.mes)).slice(0, 12).map((x) => `<tr><td>${esc(x.mes)}</td><td class="num">${pesos(x.ars)}</td><td><button class="btn small" data-borrar-tc="${esc(x.mes)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="3" class="nota">Sin cargar.</td></tr>'}</tbody></table>
          <form data-form="tipoCambio" class="form-grid" style="margin-top:10px"><label>Mes<input name="mes" type="month" value="${hoy().slice(0, 7)}" required></label><label>$ por USD<input name="ars" type="number" step="0.01" min="0" required></label><label>&nbsp;<button class="btn" type="submit">Guardar</button></label></form></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">👷 Personal (estructura)</div></div>
          <table class="tabla"><thead><tr><th>Empleado</th><th class="num">Sueldo</th><th class="num">Cargas</th><th>Período</th><th></th></tr></thead><tbody>${empleados}</tbody></table>
          <form data-form="empleado" class="form-grid" style="margin-top:10px"><label>Nombre<input name="nombre" required></label><label>Legajo<input name="legajo"></label><label>Puesto<input name="puesto"></label><label>Sueldo bruto mensual<input name="sueldo" type="number" min="0" required></label><label>Cargas sociales (%)<input name="cargasPct" type="number" step="0.1" placeholder="${A.CARGAS_SOCIALES_PCT_DEFECTO}"></label><label>Ingreso<input name="ingreso" type="date"></label><label>Baja<input name="baja" type="date"></label><label>&nbsp;<button class="btn primary" type="submit">+ Empleado</button></label></form></div>
        <div class="card"><div class="card-header"><div class="card-title">🚜 Equipos (costo horario y amortización)</div></div>
          <table class="tabla"><thead><tr><th>Equipo</th><th class="num">Costo horario</th><th class="num">Valor</th><th class="num">Vida útil</th><th></th></tr></thead><tbody>${equipos}</tbody></table>
          <button class="btn small" type="button" data-abrir-modulo="Plan de equipamiento" style="margin-top:10px">🚜 Cargar y editar equipos, mantenimiento y vencimientos en Equipo</button>
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
    const d = { labores: E.labores, productos: E.fitosanitarios, equipos: E.equipos, envases: E.envases, recetas: E.recetas, lotes: E.lotes, movimientosGrano: E.movimientosGrano, hoy: hoy() };
    const alertas = A.alertasSenasa({ ...d, envases: [], recetas: [] });
    const car = A.carencias(d);
    const auto = A.envasesDeAplicaciones(d).filter((x) => !E.envases.some((e) => e.id === x.id));
    const prodFilas = E.fitosanitarios.map((p) => `<tr><td><strong>${esc(p.nombre)}</strong><small>${esc(p.principioActivo || '')}</small></td><td>${esc(p.registroSenasa || '—')}</td><td>${esc(p.banda || '-')}</td><td class="num">${esc(p.carenciaDias || 0)} días</td><td class="num">${esc(p.litrosPorEnvase || '-')} ${esc(p.unidad || '')}</td><td><button class="btn small" data-borrar="fitosanitarios" data-id="${esc(p.id)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="6" class="nota">Cargá los productos que usás: n.º de inscripción SENASA, carencia y envase.</td></tr>';
    const carFilas = car.map((c) => `<tr><td>${esc(lote(c.loteId)?.codigo || '')}</td><td>${esc(A.CULTIVOS[c.cultivo]?.nombre || '')} ${esc(c.campania)}</td><td>${esc(c.producto)}</td><td>${esc(c.aplicacion)}</td><td>${esc(c.libera)}</td><td>${c.activa ? `<span class="tag orange">${c.diasRestantes} día(s)</span>` : '<span class="tag green">Liberado</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="nota">Sin aplicaciones con carencia.</td></tr>';
    const aplicadores = E.equipos.filter((e) => e.esAplicador).map((e) => { const dd = e.habilitacionVence ? diasHasta(e.habilitacionVence) : null; return `<tr><td><strong>${esc(e.nombre)}</strong></td><td>${esc(e.habilitacion || '—')}</td><td>${esc(e.habilitacionVence || '-')}</td><td>${!e.habilitacion ? '<span class="tag red">Sin habilitación</span>' : dd !== null && dd < 0 ? '<span class="tag red">Vencida</span>' : dd !== null && dd <= 30 ? '<span class="tag orange">Por vencer</span>' : '<span class="tag green">Vigente</span>'}</td></tr>`; }).join('') || '<tr><td colspan="4" class="nota">Marcá tus pulverizadoras como aplicadoras.</td></tr>';
    const estadoEnv = { PENDIENTE_LAVADO: ['orange', 'Sin triple lavado'], LAVADO: ['blue', 'Lavado, sin entregar'], ENTREGADO_CAT: ['green', 'Entregado al CAT'] };
    const envFilas = [...auto.map((x) => ({ ...x, estado: 'SUGERIDO' })), ...E.envases].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((x) => `<tr><td>${esc(x.fecha)}</td><td>${esc(x.producto)}<small>${esc(x.capacidad || '')}${x.loteId ? ` · ${esc(lote(x.loteId)?.codigo || '')}` : ''}</small></td><td class="num">${esc(x.cantidad)}</td><td>${x.estado === 'SUGERIDO' ? '<span class="tag blue">De la aplicación</span>' : `<span class="tag ${estadoEnv[x.estado]?.[0] || 'blue'}">${esc(estadoEnv[x.estado]?.[1] || x.estado)}</span>`}${x.comprobanteCat ? `<small>CAT ${esc(x.comprobanteCat)}</small>` : ''}</td><td>${x.estado === 'SUGERIDO' ? `<button class="btn small" data-registrar-envase="${esc(x.id)}">Registrar</button>` : x.estado === 'PENDIENTE_LAVADO' ? `<button class="btn small" data-envase-estado="${esc(x.id)}" data-nuevo="LAVADO">Triple lavado hecho</button>` : x.estado === 'LAVADO' ? `<button class="btn small" data-envase-estado="${esc(x.id)}" data-nuevo="ENTREGADO_CAT">Entregado al CAT</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin envases.</td></tr>';
    return `
      <div class="card"><div class="card-header"><div class="card-title">⚠️ Controles SENASA y agroquímicos</div><span class="tag orange">${alertas.length} pendiente(s)</span></div>${alertasHtml(alertas)}
        <div class="nota">Habilitación de aplicadores: leyes provinciales de agroquímicos. Productos: inscripción y marbete aprobados por SENASA (carencia). Envases vacíos: ${esc(A.LEY_FITO)}.</div></div>
      ${cardRecetas()}
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
        <div class="card"><div class="card-header"><div class="card-title">♻️ Envases vacíos</div></div><div class="nota">Los envases, las silobolsas vacías y los demás residuos están en la pestaña <strong>♻️ Residuos</strong>.</div><button class="btn small" type="button" data-ir-tab="residuos">Ir a Residuos</button></div>
      </div>`;
  }

  // ---------- Recetas agronómicas (pestaña SENASA y recetas) ----------
  const ESTADO_RECETA = { EMITIDA: ['blue', 'Emitida'], APLICADA: ['green', 'Aplicada'], ANULADA: ['red', 'Anulada'] };
  function proximoNumeroReceta() {
    const anio = hoy().slice(0, 4);
    const usados = E.recetas.map((r) => String(r.numero).match(new RegExp(`^RA-${anio}-(\\d+)$`))?.[1]).filter(Boolean);
    const ancho = Math.max(4, ...usados.map((x) => x.length));
    return `RA-${anio}-${String((usados.length ? Math.max(...usados.map(Number)) : 0) + 1).padStart(ancho, '0')}`;
  }
  function cardRecetas() {
    const ultima = [...E.recetas].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || {};
    const filas = [...E.recetas].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((r) => {
      const obs = A.controlesReceta(r, { productos: E.fitosanitarios, equipos: E.equipos, hoy: hoy() });
      const aplic = E.labores.find((l) => l.recetaId === r.id && l.estado === 'REALIZADA');
      const [color, texto] = ESTADO_RECETA[r.estado] || ['blue', r.estado];
      return `<tr><td><strong>${esc(r.numero)}</strong><small>${esc(r.fecha)} · vence ${esc(r.vence || '-')}</small></td><td>${esc(lote(r.loteId)?.codigo || '-')} · ${esc(A.CULTIVOS[r.cultivo]?.nombre || '')}<small>${esc(r.ha || 0)} ha · ${esc(r.objetivo || '')}</small></td><td>${(r.productos || []).map((p) => `${esc(p.producto)} ${esc(p.dosis)} ${esc(p.unidad || 'l')}/ha`).join('<br>')}<small>${r.tipoAplicacion === 'AEREA' ? 'Aérea' : 'Terrestre'}${r.volumenCaldo ? ` · caldo ${esc(r.volumenCaldo)} l/ha` : ''}</small></td><td>${esc(r.agronomo || '')}<small>Mat. ${esc(r.matricula || '-')}</small></td><td><span class="tag ${color}">${texto}</span>${aplic ? `<small>Aplicada el ${esc(aplic.fecha)}</small>` : ''}${obs.length ? `<small title="${esc(obs.map((o) => o.texto).join('\n'))}">⚠️ ${obs.length} observación(es)</small>` : ''}</td><td><button class="btn small" type="button" data-imprimir-receta="${esc(r.id)}">Imprimir</button>${r.estado === 'EMITIDA' ? ` <button class="btn small" type="button" data-anular-receta="${esc(r.id)}">Anular</button>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="nota">Sin recetas. Emitila antes de aplicar y elegila en la labor de aplicación.</td></tr>';
    const obsTodas = E.recetas.filter((r) => r.estado !== 'ANULADA').flatMap((r) => A.controlesReceta(r, { productos: E.fitosanitarios, equipos: E.equipos, hoy: hoy() }));
    const prod = (i) => `<label>Producto ${i}<input name="producto${i}" list="agroFitos" ${i === 1 ? 'required' : ''}></label><label>Dosis ${i} (por ha)<input name="dosis${i}" type="number" step="0.001" min="0" ${i === 1 ? 'required' : ''}></label><label>Unidad ${i}<select name="unidad${i}">${opciones([['l', 'l/ha'], ['kg', 'kg/ha'], ['cm3', 'cm³/ha'], ['g', 'g/ha']])}</select></label>`;
    return `
      <div class="card"><div class="card-header"><div><div class="card-title">📝 Recetas agronómicas</div><div class="card-sub">La firma un ingeniero agrónomo matriculado antes de aplicar (leyes provinciales de agroquímicos). Se controla contra la aplicación: producto, dosis, vigencia, aplicador, distancias y clima.</div></div><span class="tag ${obsTodas.length ? 'orange' : 'green'}">${obsTodas.length} observación(es)</span></div>
        ${obsTodas.length ? alertasHtml(obsTodas.map((o) => ({ nivel: o.nivel, texto: o.texto }))) : ''}
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Receta</th><th>Lote</th><th>Productos y dosis</th><th>Ing. agrónomo</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
        <details style="margin-top:10px"><summary class="btn primary" style="display:inline-block">+ Nueva receta</summary>
        <form data-form="receta" class="form-grid" style="margin-top:10px">
          <label>N.º de receta<input name="numero" value="${esc(proximoNumeroReceta())}" required></label><label>Fecha de emisión<input name="fecha" type="date" value="${hoy()}" required></label><label>Vence<input name="vence" type="date" value="${A.sumarDiasIso(hoy(), A.VIGENCIA_RECETA_DIAS)}"></label>
          <label>Provincia<select name="provincia">${opciones([...A.PROVINCIAS.map((p) => [p, p]), ['OTRA', 'OTRA']], ultima.provincia || 'CORDOBA')}</select></label>
          <label>Ing. agrónomo<input name="agronomo" value="${esc(ultima.agronomo || '')}" required></label><label>Matrícula<input name="matricula" value="${esc(ultima.matricula || '')}" required></label>
          <label>Lote<select name="loteId" required>${opciones(E.lotes.map((l) => [l.id, l.codigo]))}</select></label><label>Cultivo<select name="cultivo" required>${granosOpc()}</select></label><label>Superficie (ha)<input name="ha" type="number" step="0.1" min="0" required></label>
          <label>Objetivo (plaga, maleza o enfermedad)<input name="objetivo" required placeholder="Ej. Rama negra, chinche"></label><label>Tipo de aplicación<select name="tipoAplicacion">${opciones([['TERRESTRE', 'Terrestre'], ['AEREA', 'Aérea']])}</select></label><label>Volumen de caldo (l/ha)<input name="volumenCaldo" type="number" step="0.1" min="0"></label>
          ${prod(1)}${prod(2)}${prod(3)}
          <label>Aplicador (equipo propio)<select name="aplicadorEquipoId"><option value="">— Contratista —</option>${opciones(E.equipos.filter((e) => e.esAplicador).map((e) => [e.id, e.nombre]))}</select></label><label>Contratista aplicador<input name="aplicadorContratista" placeholder="Razón social y n.º de habilitación"></label>
          <label>Distancia a zona urbana (m)<input name="distanciaUrbanaM" type="number" min="0"></label><label>Distancia mínima exigida (m)<input name="distanciaMinimaM" type="number" min="0" placeholder="Si no es Córdoba: ley u ordenanza"></label>
          <label style="grid-column:1/-1">Observaciones / recomendaciones<input name="observaciones" placeholder="Boquillas, horario, bordes, cursos de agua…"></label>
          <label>&nbsp;<button class="btn primary" type="submit">Emitir receta</button></label>
        </form><datalist id="agroFitos">${E.fitosanitarios.map((p) => `<option value="${esc(p.nombre)}">`).join('')}</datalist>
        <div class="nota">Córdoba: distancias de la Ley 9164 según la banda del producto (terrestre Ia, Ib y II: 500 m; aérea Ia, Ib y II: 1.500 m; aérea III y IV: 500 m). En otras provincias cargá la distancia que fija la ley o la ordenanza municipal. Vigencia por defecto: ${A.VIGENCIA_RECETA_DIAS} días (ajustala a tu provincia).</div></details></div>`;
  }
  function imprimirReceta(r) {
    const l = lote(r.loteId);
    const eq = E.equipos.find((e) => e.id === r.aplicadorEquipoId);
    const dm = A.distanciaMinima(r, E.fitosanitarios);
    const fila = (k, v) => `<tr><th style="text-align:left;padding:4px 10px 4px 0;vertical-align:top;width:34%">${esc(k)}</th><td style="padding:4px 0">${v}</td></tr>`;
    const productos = (r.productos || []).map((p) => { const f = E.fitosanitarios.find((x) => String(x.nombre).trim().toLowerCase() === String(p.producto).trim().toLowerCase()); return `<tr><td>${esc(p.producto)}</td><td>${esc(f?.principioActivo || '')}</td><td>${esc(f?.registroSenasa || '—')}</td><td>${esc(f?.banda || '—')}</td><td style="text-align:right">${esc(p.dosis)} ${esc(p.unidad || 'l')}/ha</td><td style="text-align:right">${esc((Number(p.dosis) * Number(r.ha || 0)).toLocaleString('es-AR'))} ${esc(p.unidad || 'l')}</td><td style="text-align:right">${esc(f?.carenciaDias ?? '—')} días</td></tr>`; }).join('');
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Receta ${esc(r.numero)}</title><style>body{font:13px Arial,sans-serif;color:#111;margin:28px}h1{font-size:20px;margin:0}table{border-collapse:collapse;width:100%}.prod th,.prod td{border:1px solid #999;padding:5px}.firma{margin-top:60px;display:flex;justify-content:space-between}.firma div{border-top:1px solid #000;width:40%;text-align:center;padding-top:4px}</style></head><body>
      <h1>Receta agronómica N.º ${esc(r.numero)}</h1><p>Emitida el ${esc(r.fecha)} · Vence el ${esc(r.vence || '-')} · Provincia: ${esc(r.provincia || '')}</p>
      <table>${fila('Ingeniero agrónomo', `${esc(r.agronomo)} · Matrícula ${esc(r.matricula)}`)}${fila('Lote', `${esc(l?.codigo || '')} · ${esc(l?.campo || '')}${l?.latitud ? ` · ${esc(l.latitud)}, ${esc(l.longitud)}` : ''}`)}${fila('Cultivo y superficie', `${esc(A.CULTIVOS[r.cultivo]?.nombre || '')} · ${esc(r.ha)} ha`)}${fila('Objetivo', esc(r.objetivo || ''))}${fila('Aplicación', `${r.tipoAplicacion === 'AEREA' ? 'Aérea' : 'Terrestre'}${r.volumenCaldo ? ` · caldo ${esc(r.volumenCaldo)} l/ha` : ''}`)}${fila('Aplicador', esc(eq ? `${eq.nombre} · habilitación ${eq.habilitacion || '—'} (vence ${eq.habilitacionVence || '—'})` : r.aplicadorContratista || '—'))}${fila('Distancia a zona urbana', `${esc(r.distanciaUrbanaM ?? '—')} m${dm.metros ? ` (mínimo ${dm.metros} m · ${esc(dm.norma)})` : ''}`)}</table>
      <h3>Productos</h3><table class="prod"><tr><th>Producto</th><th>Principio activo</th><th>N.º SENASA</th><th>Banda</th><th>Dosis</th><th>Total</th><th>Carencia</th></tr>${productos}</table>
      <h3>Condiciones de aplicación</h3><p>Viento entre ${A.CONDICIONES_APLICACION.vientoMin} y ${A.CONDICIONES_APLICACION.vientoMax} km/h, temperatura hasta ${A.CONDICIONES_APLICACION.temperaturaMax} °C, humedad relativa desde ${A.CONDICIONES_APLICACION.humedadMin} % y sin inversión térmica. Respetar la carencia antes de cosechar. Envases: triple lavado, perforado y entrega al CAT (Ley 27.279).</p>
      ${r.observaciones ? `<p><strong>Observaciones:</strong> ${esc(r.observaciones)}</p>` : ''}
      <div class="firma"><div>Firma y sello del ingeniero agrónomo</div><div>Firma del aplicador</div></div></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('El navegador bloqueó la ventana: permití las ventanas emergentes para imprimir la receta.'); return; }
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }

  // ---------- Pestaña Residuos ----------
  const ESTADO_RESIDUO = { ALMACENADO: ['orange', 'Almacenado'], ENTREGADO: ['green', 'Entregado'] };
  function vistaResiduos() {
    const d = { labores: E.labores, productos: E.fitosanitarios };
    const alertas = [
      ...A.alertasResiduos({ residuos: E.residuos, ubicaciones: E.ubicaciones, movimientosGrano: E.movimientosGrano, hoy: hoy() }),
      ...A.alertasSenasa({ envases: E.envases, hoy: hoy() }),
    ];
    const vacias = A.silobolsasVacias({ ubicaciones: E.ubicaciones, movimientosGrano: E.movimientosGrano, residuos: E.residuos });
    const filasVacias = vacias.map((s) => `<tr><td><strong>${esc(s.nombre)}</strong><small>vacía desde el ${esc(s.desde)}</small></td><td class="num">${esc(s.metros || '-')} m</td><td class="num">~${s.kg.toLocaleString('es-AR')} kg</td><td><button class="btn small" type="button" data-retiro-silobolsa="${esc(s.ubicacionId)}">Registrar retiro</button></td></tr>`).join('') || '<tr><td colspan="4" class="nota">Sin silobolsas vacías pendientes de retiro.</td></tr>';
    const filas = [...E.residuos].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((r) => {
      const t = A.TIPOS_RESIDUO[r.tipo] || A.TIPOS_RESIDUO.OTRO;
      const [color, texto] = ESTADO_RESIDUO[r.estado] || ['blue', r.estado];
      return `<tr><td>${esc(r.fecha)}</td><td><strong>${esc(t.nombre)}</strong>${t.peligroso ? ' <span class="tag red">Peligroso</span>' : ''}<small>${esc(r.descripcion || '')}</small></td><td class="num">${esc(r.cantidad)} ${esc(r.unidad || t.unidad)}</td><td><span class="tag ${color}">${texto}</span>${r.estado === 'ENTREGADO' ? `<small>${esc(r.entregaFecha || '')} · ${esc(r.destino || '')}${r.comprobante ? ` · ${t.peligroso ? 'manifiesto' : 'comprobante'} ${esc(r.comprobante)}` : ''}</small>` : ''}</td><td>${r.estado !== 'ENTREGADO' ? `<button class="btn small" type="button" data-entregar-residuo="${esc(r.id)}">Entregar</button> ` : ''}<button class="btn small" type="button" data-borrar="residuos" data-id="${esc(r.id)}">Borrar</button></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="nota">Sin residuos registrados.</td></tr>';
    const auto = A.envasesDeAplicaciones(d).filter((x) => !E.envases.some((e) => e.id === x.id));
    const estadoEnv = { PENDIENTE_LAVADO: ['orange', 'Sin triple lavado'], LAVADO: ['blue', 'Lavado, sin entregar'], ENTREGADO_CAT: ['green', 'Entregado al CAT'] };
    const envFilas = [...auto.map((x) => ({ ...x, estado: 'SUGERIDO' })), ...E.envases].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((x) => `<tr><td>${esc(x.fecha)}</td><td>${esc(x.producto)}<small>${esc(x.capacidad || '')}${x.loteId ? ` · ${esc(lote(x.loteId)?.codigo || '')}` : ''}</small></td><td class="num">${esc(x.cantidad)}</td><td>${x.estado === 'SUGERIDO' ? '<span class="tag blue">De la aplicación</span>' : `<span class="tag ${estadoEnv[x.estado]?.[0] || 'blue'}">${esc(estadoEnv[x.estado]?.[1] || x.estado)}</span>`}${x.comprobanteCat ? `<small>CAT ${esc(x.comprobanteCat)}</small>` : ''}</td><td>${x.estado === 'SUGERIDO' ? `<button class="btn small" data-registrar-envase="${esc(x.id)}">Registrar</button>` : x.estado === 'PENDIENTE_LAVADO' ? `<button class="btn small" data-envase-estado="${esc(x.id)}" data-nuevo="LAVADO">Triple lavado hecho</button>` : x.estado === 'LAVADO' ? `<button class="btn small" data-envase-estado="${esc(x.id)}" data-nuevo="ENTREGADO_CAT">Entregado al CAT</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin envases.</td></tr>';
    return `
      <div class="card"><div class="card-header"><div class="card-title">♻️ Residuos agrícolas</div><span class="tag ${alertas.length ? 'orange' : 'green'}">${alertas.length} pendiente(s)</span></div>${alertasHtml(alertas)}
        <div class="nota">${esc(A.LEY_RESIDUOS)}. Los peligrosos (aceites, filtros, baterías) se entregan a un operador habilitado y se guarda el manifiesto; los plásticos y silobolsas, a un reciclador o programa de recupero.</div></div>
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">🧪 Envases vacíos de fitosanitarios (triple lavado y CAT)</div></div>
          <table class="tabla"><thead><tr><th>Fecha</th><th>Producto</th><th class="num">Envases</th><th>Estado</th><th></th></tr></thead><tbody>${envFilas}</tbody></table>
          <div class="nota">Salen de cada aplicación (cantidad usada ÷ contenido del envase del producto). Ley 27.279: triple lavado, perforado y entrega al Centro de Almacenamiento Transitorio con su comprobante.</div></div>
        <div class="card"><div class="card-header"><div class="card-title">🛍️ Silobolsas vacías</div></div>
          <table class="tabla"><thead><tr><th>Silobolsa</th><th class="num">Largo</th><th class="num">Plástico</th><th></th></tr></thead><tbody>${filasVacias}</tbody></table>
          <div class="nota">Una silobolsa que tuvo grano y quedó vacía se retira para reciclado. Kilos estimados: ${A.KG_POR_METRO_SILOBOLSA} kg por metro (bolsa de 9 pies).</div></div>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">📦 Registro de residuos</div></div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Fecha</th><th>Residuo</th><th class="num">Cantidad</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
        <form data-form="residuo" class="form-grid" style="margin-top:10px"><label>Fecha<input name="fecha" type="date" value="${hoy()}" required></label><label>Tipo<select name="tipo">${opciones(Object.entries(A.TIPOS_RESIDUO).map(([k, t]) => [k, `${t.nombre}${t.peligroso ? ' (peligroso)' : ''}`]))}</select></label><label>Cantidad<input name="cantidad" type="number" step="0.1" min="0" required></label><label>Unidad<input name="unidad" placeholder="kg / l / u"></label><label>Detalle<input name="descripcion" placeholder="Ej. aceite de motor del tractor TR-01"></label><label>&nbsp;<button class="btn primary" type="submit">Registrar residuo</button></label></form></div>`;
  }

  // ================= Módulo Equipo =================
  const equipoPor = (id) => E.equipos.find((e) => e.id === id);
  function alertasEquipoActuales() { return A.alertasEquipos({ equipos: E.equipos, labores: E.labores, mantenimientos: E.mantenimientos, hoy: hoy() }); }
  function vistaEquipos() {
    const activos = E.equipos.filter((e) => !e.baja);
    const amort = E.equipos.map((e) => ({ e, a: A.amortizacionEquipo(e, hoy()) }));
    const mant = A.mantenimientoEquipos({ equipos: activos, labores: E.labores, hoy: hoy() });
    const totalValor = activos.reduce((s, e) => s + (Number(e.valor) || 0), 0);
    const totalLibro = amort.filter((x) => !x.e.baja).reduce((s, x) => s + x.a.valorLibro, 0);
    const amortAnual = amort.filter((x) => !x.e.baja && !x.a.amortizado).reduce((s, x) => s + x.a.anual, 0);
    const alertas = alertasEquipoActuales();
    const venc = (e) => A.vencimientosEquipo(e, hoy()).map((v) => `<span class="tag ${v.estado === 'VENCIDO' ? 'red' : v.estado === 'POR_VENCER' ? 'orange' : 'green'}">${esc(v.nombre)} ${esc(v.vence)}</span>`).join(' ');
    const filas = amort.sort((a, b) => Number(Boolean(a.e.baja)) - Number(Boolean(b.e.baja)) || String(a.e.nombre).localeCompare(String(b.e.nombre))).map(({ e, a }) => {
      const m = mant.find((x) => x.id === e.id);
      return `<tr${e.baja ? ' style="opacity:.55"' : ''}><td><strong>${esc(e.nombre)}</strong><small>${esc([e.codigo, e.categoria, [e.marca, e.modelo].filter(Boolean).join(' '), e.anio, e.patente].filter(Boolean).join(' · '))}${e.baja ? ` · baja ${esc(e.baja)}` : ''}</small></td><td class="num">${pesos(e.valor)}<small>residual ${pesos(e.valorResidual)} · ${esc(e.vidaUtilAnios || 0)} años</small></td><td class="num">${pesos(a.anual)}<small>${a.amortizado ? 'amortizado' : `${pesos(a.mensual)}/mes`}</small></td><td class="num">${pesos(a.valorLibro)}</td><td class="num">${pesos(e.costoHora)}/h</td><td class="num">${m ? `${m.horometro.toLocaleString('es-AR')} h<small>${m.vencido ? '<span class="tag red">service vencido</span>' : `service en ${Math.round(m.restan)} h`}</small>` : '-'}</td><td>${venc(e) || '<small>—</small>'}</td><td><button class="btn small" type="button" data-editar-equipo="${esc(e.id)}">Editar</button></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="nota">Cargá tus equipos: tractores, sembradoras, pulverizadoras, cosechadora, tolvas y camiones.</td></tr>';
    return `
      <div class="kpi-grid">
        ${kpi('blue', 'Equipos activos', String(activos.length), `${E.equipos.length - activos.length} dado(s) de baja`)}
        ${kpi('green', 'Valor de compra', pesos(totalValor), 'equipos activos')}
        ${kpi('purple', 'Valor libro', pesos(totalLibro), 'valor de compra − amortización acumulada')}
        ${kpi('orange', 'Amortización anual', pesos(amortAnual), 'va a estructura en Costos')}
        ${kpi(alertas.some((x) => x.nivel === 'danger') ? 'red' : alertas.length ? 'orange' : 'green', 'Alertas', String(alertas.length), 'service, seguro, VTV y habilitaciones')}
      </div>
      ${alertas.length ? `<div class="card"><div class="card-header"><div class="card-title">⚠️ Alertas de mantenimiento y vencimientos</div></div>${alertasHtml(alertas)}</div>` : ''}
      <div class="card"><div class="card-header"><div><div class="card-title">🚜 Equipos disponibles</div><div class="card-sub">Amortización lineal: (valor − residual) ÷ vida útil, desde el alta y hasta la baja. El costo horario (combustible, mantenimiento y operario) se imputa a las labores.</div></div></div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Equipo</th><th class="num">Valor</th><th class="num">Amortización anual</th><th class="num">Valor libro</th><th class="num">Costo horario</th><th class="num">Horómetro</th><th>Vencimientos</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
        <form data-form="equipo" class="form-grid" style="margin-top:12px"><input type="hidden" name="id">
          <label>Código<input name="codigo" placeholder="TR-01"></label><label>Nombre<input name="nombre" required placeholder="Tractor John Deere 6130"></label><label>Tipo<select name="categoria">${opciones(A.CATEGORIAS_EQUIPO.map((c) => [c, c]))}</select></label>
          <label>Marca<input name="marca"></label><label>Modelo<input name="modelo"></label><label>Año<input name="anio" type="number" min="1950" max="2100"></label><label>Patente / n.º de serie<input name="patente"></label>
          <label>Alta<input name="fechaAlta" type="date"></label><label>Valor de compra ($)<input name="valor" type="number" min="0"></label><label>Valor residual ($)<input name="valorResidual" type="number" min="0"></label><label>Vida útil (años)<input name="vidaUtilAnios" type="number" min="0"></label>
          <label>Costo horario ($)<input name="costoHora" type="number" min="0" required></label><label>Seguro + patente anual ($)<input name="costosFijosAnuales" type="number" min="0"></label>
          <label>Horómetro al alta (h)<input name="horometro" type="number" min="0" step="0.1"></label><label>Service cada (h)<input name="serviceCadaHoras" type="number" min="0" placeholder="250"></label><label>Horómetro del último service (h)<input name="horasUltimoService" type="number" min="0" step="0.1"></label>
          <label>Seguro vence<input name="seguroVence" type="date"></label><label>VTV / RTO vence<input name="vtvVence" type="date"></label><label>Baja (venta o desguace)<input name="baja" type="date"></label>
          <label>&nbsp;<button class="btn primary" type="submit">Guardar equipo</button></label>
        </form></div>`;
  }
  function vistaMantenimiento() {
    const activos = E.equipos.filter((e) => !e.baja);
    const mant = A.mantenimientoEquipos({ equipos: activos, labores: E.labores, hoy: hoy() });
    const alertas = alertasEquipoActuales();
    const servicios = mant.map((m) => `<tr><td><strong>${esc(m.nombre)}</strong></td><td class="num">${m.horometro.toLocaleString('es-AR')} h</td><td class="num">${Math.round(m.desdeService).toLocaleString('es-AR')} h<small>×${m.factorMedio} por tipo de labor</small></td><td class="num">${m.intervalo} h${m.intervaloDefecto ? '<small>por defecto</small>' : ''}</td><td>${m.vencido ? '<span class="tag red">Vencido</span>' : m.restan <= m.intervalo * 0.15 ? `<span class="tag orange">${Math.round(m.restan)} h</span>` : `<span class="tag green">${Math.round(m.restan)} h</span>`}${m.dias !== null && !m.vencido ? `<small>~${m.dias} día(s)</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin equipos activos.</td></tr>';
    const registros = [...E.mantenimientos].sort((a, b) => Number(b.estado === 'PENDIENTE') - Number(a.estado === 'PENDIENTE') || String(b.fecha).localeCompare(String(a.fecha))).map((m) => `<tr><td>${esc(m.fecha || '-')}</td><td><strong>${esc(equipoPor(m.equipoId)?.nombre || '-')}</strong></td><td>${esc(A.TIPOS_MANTENIMIENTO[m.tipo] || m.tipo)}<small>${m.litros ? `${esc(m.litros)} l · ` : ''}${esc(m.detalle || '')}</small></td><td class="num">${m.horometro ? `${Number(m.horometro).toLocaleString('es-AR')} h` : '-'}</td><td>${esc(m.proveedor || '')}<small>${esc(m.comprobante || '')}</small></td><td class="num">${m.costo ? pesos(m.costo) : '-'}</td><td>${m.estado === 'PENDIENTE' ? `<span class="tag orange">Pendiente</span> <button class="btn small" type="button" data-realizar-mantenimiento="${esc(m.id)}">Marcar hecho</button>` : '<span class="tag green">Hecho</span>'} <button class="btn small" type="button" data-borrar="mantenimientos" data-id="${esc(m.id)}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="7" class="nota">Sin registros de mantenimiento.</td></tr>';
    return `
      <div class="card"><div class="card-header"><div class="card-title">⚠️ Alertas de mantenimiento</div><span class="tag ${alertas.length ? 'orange' : 'green'}">${alertas.length} pendiente(s)</span></div>${alertasHtml(alertas)}</div>
      <div class="card"><div class="card-header"><div><div class="card-title">⏱️ Próximo service por horas</div><div class="card-sub">Horas de las labores realizadas, ponderadas por tipo de labor (cosecha ×1,25, labranza ×1,2, siembra ×1,15), desde el horómetro del último service.</div></div></div>
        <table class="tabla"><thead><tr><th>Equipo</th><th class="num">Horómetro</th><th class="num">Desde el service</th><th class="num">Intervalo</th><th>Faltan</th></tr></thead><tbody>${servicios}</tbody></table></div>
      <div class="card"><div class="card-header"><div><div class="card-title">🔧 Services, reparaciones, combustible y órdenes pendientes</div><div class="card-sub">Un service hecho con horómetro reinicia la cuenta de horas. El costo se registra para comparar con el costo horario (Costos operativos); no se suma de nuevo a los costos de las labores.</div></div></div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Fecha</th><th>Equipo</th><th>Trabajo</th><th class="num">Horómetro</th><th>Taller / comprobante</th><th class="num">Costo</th><th>Estado</th></tr></thead><tbody>${registros}</tbody></table></div>
        <form data-form="mantenimiento" class="form-grid" style="margin-top:12px">
          <label>Equipo<select name="equipoId" required>${opciones(activos.map((e) => [e.id, e.nombre]))}</select></label><label>Tipo<select name="tipo">${opciones(Object.entries(A.TIPOS_MANTENIMIENTO))}</select></label><label>Estado<select name="estado">${opciones([['REALIZADO', 'Hecho'], ['PENDIENTE', 'Pendiente (orden)']])}</select></label><label>Fecha<input name="fecha" type="date" value="${hoy()}"></label>
          <label>Horómetro (h)<input name="horometro" type="number" min="0" step="0.1"></label><label>Litros (combustible)<input name="litros" type="number" min="0" step="0.1"></label><label>Detalle<input name="detalle" placeholder="Cambio de aceite y filtros"></label><label>Taller / proveedor<input name="proveedor"></label><label>Comprobante<input name="comprobante"></label><label>Costo ($)<input name="costo" type="number" min="0"></label>
          <label>Aceite usado (l)<input name="aceiteLitros" type="number" min="0" placeholder="Va a Residuos"></label><label>Filtros usados (u)<input name="filtros" type="number" min="0"></label>
          <label>&nbsp;<button class="btn primary" type="submit">Guardar</button></label>
        </form><div class="nota">El aceite y los filtros usados se registran solos en ♻️ Residuos (residuos peligrosos: entrega a operador habilitado con manifiesto).</div></div>`;
  }
  function vistaEquipoCostos() {
    const co = A.costosOperativosEquipos({ equipos: E.equipos.filter((e) => !e.baja), labores: E.labores, mantenimientos: E.mantenimientos, compras: E.compras, condicionIva: E.condicionIva, hoy: hoy() });
    const filas = co.map((c) => `<tr><td><strong>${esc(c.nombre)}</strong></td><td class="num">${c.horas.toLocaleString('es-AR')} h</td><td class="num">${pesos(c.combustible)}${c.litrosHora ? `<small>${c.litrosHora.toLocaleString('es-AR')} l/h</small>` : ''}</td><td class="num">${pesos(c.mantenimiento)}</td><td class="num">${pesos(c.fijos)}</td><td class="num">${pesos(c.amortizacion)}</td><td class="num"><strong>${pesos(c.total)}</strong>${c.porHora ? `<small>${pesos(c.porHora)}/h</small>` : ''}</td><td class="num">${c.operativoPorHora !== null ? pesos(c.operativoPorHora) + '/h' : '-'}<small>cargado ${pesos(c.costoHoraCargado)}/h</small></td><td>${c.diferenciaPct === null ? '<small>sin horas</small>' : Math.abs(c.diferenciaPct) <= 15 ? '<span class="tag green">Acorde</span>' : `<span class="tag ${c.diferenciaPct > 0 ? 'red' : 'orange'}">${c.diferenciaPct > 0 ? '+' : ''}${c.diferenciaPct} %</span>`}</td></tr>`).join('') || '<tr><td colspan="9" class="nota">Sin equipos activos.</td></tr>';
    const t = co.reduce((s, c) => ({ total: s.total + c.total, horas: s.horas + c.horas }), { total: 0, horas: 0 });
    return `
      <div class="kpi-grid">
        ${kpi('orange', 'Costo total de equipos (12 meses)', pesos(t.total), 'amortización + mantenimiento + combustible + seguros')}
        ${kpi('blue', 'Horas trabajadas', `${t.horas.toLocaleString('es-AR')} h`, 'labores realizadas con equipo propio')}
        ${kpi('purple', 'Costo promedio por hora', t.horas ? pesos(t.total / t.horas) : '-', 'todos los equipos')}
      </div>
      <div class="card"><div class="card-header"><div><div class="card-title">💲 Costos operativos por equipo (últimos 12 meses)</div><div class="card-sub">Combustible (cargas registradas en Mantenimiento y, si lo cargás en las labores, insumos de categoría Combustible), mantenimiento registrado, seguro y patente, y amortización. "Operativo real" (combustible + mantenimiento por hora) contra el costo horario cargado: si difiere más de 15 %, conviene actualizarlo.</div></div></div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Equipo</th><th class="num">Horas</th><th class="num">Combustible</th><th class="num">Mantenimiento</th><th class="num">Seguro y patente</th><th class="num">Amortización</th><th class="num">Total</th><th class="num">Operativo real</th><th>vs. cargado</th></tr></thead><tbody>${filas}</tbody></table></div>
        <div class="nota">En Costos y resultados se imputan las horas de cada labor × el costo horario cargado (labores) y la amortización (estructura). Esta tabla no suma costos nuevos: sirve para calibrar el costo horario.</div></div>`;
  }
  function vistaPlanificacion() { return '<div id="planEquipamientoLegacy"><div class="nota">Cargando la planificación…</div></div>'; }

  // ================= Módulo Finanzas =================
  let cuentaOperacion = '';
  const nombreCuenta = (id) => E.cuentas.find((c) => c.id === id)?.nombre || '-';
  function resumenFinanzas() {
    const saldos = A.saldosCuentas(E.cuentas, E.movimientosFondos);
    const cobrar = A.cuentasACobrar({ lpg: E.lpg, movimientos: E.movimientosFondos });
    const pagar = A.cuentasAPagar({ compras: E.compras, movimientos: E.movimientosFondos });
    const mes = hoy().slice(0, 7);
    const movMes = E.movimientosFondos.filter((m) => String(m.fecha).slice(0, 7) === mes && m.tipo !== 'TRANSFERENCIA');
    const flujo = movMes.reduce((s, m) => s + (m.tipo === 'INGRESO' ? 1 : -1) * (Number(m.importe) || 0), 0);
    const chequesCobrar = E.cheques.filter((c) => c.sentido === 'RECIBIDO' && c.estado === 'EN_CARTERA').reduce((s, c) => s + (Number(c.importe) || 0), 0);
    const chequesPagar = E.cheques.filter((c) => c.sentido === 'EMITIDO' && c.estado === 'EMITIDO').reduce((s, c) => s + (Number(c.importe) || 0), 0);
    const creditos = E.creditos.map((cr) => ({ cr, e: A.estadoCredito(cr, E.movimientosFondos, hoy()) })).filter((x) => !x.e.cancelado);
    const alertas = A.alertasFinanzas({ cheques: E.cheques, creditos: E.creditos, movimientos: E.movimientosFondos, compras: E.compras, hoy: hoy() });
    return { saldos, cobrar, pagar, flujo, chequesCobrar, chequesPagar, creditos, alertas, fondos: saldos.reduce((s, c) => s + c.saldo, 0), totalCobrar: cobrar.reduce((s, x) => s + x.saldo, 0), totalPagar: pagar.reduce((s, x) => s + x.saldo, 0) };
  }
  function kpisFinanzas(f) {
    return `<div class="kpi-grid">
      ${kpi('green', 'Saldo de fondos', pesos(f.fondos), `${f.saldos.length} cuenta(s)`)}
      ${kpi('blue', 'A cobrar', pesos(f.totalCobrar + f.chequesCobrar), `LPG ${pesos(f.totalCobrar)} · cheques ${pesos(f.chequesCobrar)}`)}
      ${kpi('red', 'A pagar', pesos(f.totalPagar + f.chequesPagar), `facturas ${pesos(f.totalPagar)} · cheques ${pesos(f.chequesPagar)}`)}
      ${kpi(f.flujo < 0 ? 'orange' : 'purple', 'Flujo neto del mes', pesos(f.flujo), 'ingresos − egresos de caja y bancos')}
      ${kpi('orange', 'Créditos abiertos', pesos(f.creditos.reduce((s, x) => s + x.e.saldoCapital, 0)), `${f.creditos.length} crédito(s) · ${f.creditos.reduce((s, x) => s + x.e.vencidas, 0)} cuota(s) vencida(s)`)}
    </div>${f.alertas.length ? `<div class="card"><div class="card-header"><div class="card-title">⚠️ Vencimientos</div></div>${alertasHtml(f.alertas)}</div>` : ''}`;
  }
  const selectorCuenta = () => `<label class="nota" style="display:flex;gap:8px;align-items:center">Cuenta para cobrar y pagar<select data-cuenta-operacion>${opciones(E.cuentas.map((c) => [c.id, c.nombre]), cuentaOperacion || E.cuentas[0]?.id)}</select></label>`;
  function vistaFondos() {
    const f = resumenFinanzas();
    const cuentas = f.saldos.map((c) => `<tr><td><strong>${esc(c.nombre)}</strong><small>${c.tipo === 'BANCO' ? `${esc(c.banco || 'Banco')}${c.cbu ? ` · CBU ${esc(c.cbu)}` : ''}` : 'Caja'}</small></td><td class="num">${pesos(c.saldoInicial)}</td><td class="num">${c.movimientos}</td><td class="num"><strong>${pesos(c.saldo)}</strong></td></tr>`).join('') || '<tr><td colspan="4" class="nota">Creá la caja y tus cuentas bancarias.</td></tr>';
    const movs = [...E.movimientosFondos].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 60).map((m) => `<tr><td>${esc(m.fecha)}</td><td>${m.tipo === 'TRANSFERENCIA' ? `${esc(nombreCuenta(m.cuentaId))} → ${esc(nombreCuenta(m.cuentaDestinoId))}` : esc(nombreCuenta(m.cuentaId))}</td><td>${esc(m.concepto || '')}<small>${esc({ LPG: 'Cobro de LPG', COMPRA: 'Pago de compra', CHEQUE: 'Cheque', CREDITO: 'Crédito' }[m.origen] || m.categoria || '')}</small></td><td class="num" style="color:${m.tipo === 'INGRESO' ? 'var(--green, #3fa66a)' : m.tipo === 'EGRESO' ? 'var(--red, #ef4444)' : 'inherit'}">${m.tipo === 'EGRESO' ? '−' : ''}${pesos(m.importe)}</td><td>${m.origen ? '' : `<button class="btn small" type="button" data-borrar="movimientosFondos" data-id="${esc(m.id)}">Borrar</button>`}</td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin movimientos.</td></tr>';
    return `${kpisFinanzas(f)}
      <div class="grid-2">
        <div class="card"><div class="card-header"><div class="card-title">🏦 Caja y bancos</div></div>
          <table class="tabla"><thead><tr><th>Cuenta</th><th class="num">Saldo inicial</th><th class="num">Movs.</th><th class="num">Saldo</th></tr></thead><tbody>${cuentas}</tbody></table>
          <form data-form="cuenta" class="form-grid" style="margin-top:10px"><label>Nombre<input name="nombre" required placeholder="Banco Nación cta. cte."></label><label>Tipo<select name="tipo">${opciones([['BANCO', 'Banco'], ['CAJA', 'Caja']])}</select></label><label>Banco<input name="banco"></label><label>CBU / alias<input name="cbu"></label><label>Saldo inicial ($)<input name="saldoInicial" type="number" step="0.01"></label><label>&nbsp;<button class="btn" type="submit">+ Cuenta</button></label></form></div>
        <div class="card"><div class="card-header"><div class="card-title">➕ Movimiento</div></div>
          <form data-form="movimiento" class="form-grid"><label>Fecha<input name="fecha" type="date" value="${hoy()}" required></label><label>Tipo<select name="tipo">${opciones([['EGRESO', 'Egreso'], ['INGRESO', 'Ingreso'], ['TRANSFERENCIA', 'Transferencia entre cuentas']])}</select></label><label>Cuenta<select name="cuentaId" required>${opciones(E.cuentas.map((c) => [c.id, c.nombre]))}</select></label><label>Cuenta destino (transferencia)<select name="cuentaDestinoId"><option value="">—</option>${opciones(E.cuentas.map((c) => [c.id, c.nombre]))}</select></label><label>Concepto<input name="concepto" required placeholder="Sueldos, impuestos, retiro…"></label><label>Categoría<select name="categoria">${opciones(['Sueldos y cargas', 'Impuestos', 'Arrendamiento', 'Gastos bancarios', 'Retiro de socios', 'Aporte de socios', 'Otro'].map((x) => [x, x]))}</select></label><label>Importe ($)<input name="importe" type="number" step="0.01" min="0" required></label><label>&nbsp;<button class="btn primary" type="submit">Registrar</button></label></form>
          <div class="nota">Los cobros de LPG, los pagos de compras, los cheques y las cuotas de créditos se registran desde sus pestañas y quedan vinculados.</div></div>
      </div>
      <div class="card"><div class="card-header"><div class="card-title">📒 Movimientos</div></div><div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Fecha</th><th>Cuenta</th><th>Concepto</th><th class="num">Importe</th><th></th></tr></thead><tbody>${movs}</tbody></table></div></div>`;
  }
  function vistaCobrarPagar() {
    const f = resumenFinanzas();
    const cobrar = f.cobrar.map((x) => `<tr><td>${esc(x.fecha)}</td><td><strong>LPG ${esc(x.numero)}</strong><small>${esc(x.comprador)} · ${esc(A.CULTIVOS[x.grano]?.nombre || '')}</small></td><td class="num">${pesos(x.total)}</td><td class="num">${pesos(x.cobrado)}</td><td class="num"><strong>${pesos(x.saldo)}</strong></td><td><button class="btn small" type="button" data-cobrar-lpg="${esc(x.id)}">Cobrar</button></td></tr>`).join('') || '<tr><td colspan="6" class="nota">No hay LPG pendientes de cobro.</td></tr>';
    const pagar = f.pagar.map((x) => `<tr><td>${esc(x.fecha)}${x.vencimiento ? `<small>vence ${esc(x.vencimiento)}</small>` : ''}</td><td><strong>${esc(x.proveedor)}</strong><small>${esc(x.comprobante)} · ${esc(x.concepto)}</small></td><td class="num">${pesos(x.total)}</td><td class="num">${pesos(x.pagado)}</td><td class="num"><strong>${pesos(x.saldo)}</strong></td><td><button class="btn small" type="button" data-pagar-compra="${esc(x.id)}">Pagar</button></td></tr>`).join('') || '<tr><td colspan="6" class="nota">No hay facturas de compra pendientes de pago.</td></tr>';
    const estadoCh = { EN_CARTERA: ['blue', 'En cartera'], DEPOSITADO: ['green', 'Depositado'], ENDOSADO: ['purple', 'Endosado'], RECHAZADO: ['red', 'Rechazado'], EMITIDO: ['orange', 'Emitido'], DEBITADO: ['green', 'Debitado'], ANULADO: ['red', 'Anulado'] };
    const cheques = [...E.cheques].sort((a, b) => String(a.vencimiento).localeCompare(String(b.vencimiento))).map((c) => `<tr><td>${esc(c.vencimiento)}</td><td><strong>${c.sentido === 'RECIBIDO' ? 'Recibido' : 'Emitido'} ${esc(c.numero)}</strong><small>${esc(c.banco || '')}${c.tercero ? ` · ${esc(c.tercero)}` : ''}${c.echeq ? ' · e-cheq' : ''}</small></td><td class="num">${pesos(c.importe)}</td><td><span class="tag ${estadoCh[c.estado]?.[0] || 'blue'}">${esc(estadoCh[c.estado]?.[1] || c.estado)}</span></td><td>${c.estado === 'EN_CARTERA' ? `<button class="btn small" type="button" data-cheque="${esc(c.id)}" data-accion="DEPOSITADO">Depositar</button> <button class="btn small" type="button" data-cheque="${esc(c.id)}" data-accion="ENDOSADO">Endosar</button> <button class="btn small" type="button" data-cheque="${esc(c.id)}" data-accion="RECHAZADO">Rechazado</button>` : c.estado === 'EMITIDO' ? `<button class="btn small" type="button" data-cheque="${esc(c.id)}" data-accion="DEBITADO">Debitado</button> <button class="btn small" type="button" data-cheque="${esc(c.id)}" data-accion="ANULADO">Anular</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin cheques.</td></tr>';
    return `${kpisFinanzas(f)}
      <div class="card"><div class="card-header"><div class="card-title">🧾 A cobrar: LPG</div>${selectorCuenta()}</div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Fecha</th><th>Liquidación</th><th class="num">Neto</th><th class="num">Cobrado</th><th class="num">Saldo</th><th></th></tr></thead><tbody>${cobrar}</tbody></table></div></div>
      <div class="card"><div class="card-header"><div class="card-title">📤 A pagar: facturas de compra</div></div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Fecha</th><th>Proveedor</th><th class="num">Total</th><th class="num">Pagado</th><th class="num">Saldo</th><th></th></tr></thead><tbody>${pagar}</tbody></table></div>
        <div class="nota">Son las compras cargadas como "no pagadas" en Compras y gastos (total con IVA). El pago sale de la cuenta elegida arriba.</div></div>
      <div class="card"><div class="card-header"><div class="card-title">🧾 Cheques y e-cheqs</div></div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Vence</th><th>Cheque</th><th class="num">Importe</th><th>Estado</th><th></th></tr></thead><tbody>${cheques}</tbody></table></div>
        <form data-form="cheque" class="form-grid" style="margin-top:10px"><label>Sentido<select name="sentido">${opciones([['RECIBIDO', 'Recibido (a cobrar)'], ['EMITIDO', 'Emitido (a pagar)']])}</select></label><label>Número<input name="numero" required></label><label>Banco<input name="banco"></label><label>Librador / beneficiario<input name="tercero"></label><label>Emisión<input name="fecha" type="date" value="${hoy()}"></label><label>Vencimiento<input name="vencimiento" type="date" required></label><label>Importe ($)<input name="importe" type="number" step="0.01" min="0" required></label><label>e-cheq<select name="echeq">${opciones([['NO', 'No'], ['SI', 'Sí']])}</select></label><label>&nbsp;<button class="btn primary" type="submit">+ Cheque</button></label></form></div>`;
  }
  function vistaCreditos() {
    const f = resumenFinanzas();
    const filas = E.creditos.map((cr) => {
      const e = A.estadoCredito(cr, E.movimientosFondos, hoy());
      return `<tr><td><strong>${esc(cr.entidad)}</strong><small>${esc(cr.destino || '')} · ${esc(cr.fecha || '')}</small></td><td class="num">${pesos(cr.capital)}<small>${esc(cr.tasaAnual)} % TNA · ${esc(cr.cuotas)} cuotas</small></td><td class="num">${e.plan[0] ? pesos(e.plan[0].cuota) : '-'}</td><td class="num">${e.pagadas}/${e.plan.length}</td><td>${e.cancelado ? '<span class="tag green">Cancelado</span>' : `${e.vencidas ? `<span class="tag red">${e.vencidas} vencida(s)</span>` : ''}<small>próxima ${esc(e.proxima.vence)}</small>`}</td><td class="num">${pesos(e.saldoCapital)}</td><td>${e.cancelado ? '' : `<button class="btn small" type="button" data-pagar-cuota="${esc(cr.id)}">Pagar cuota ${e.proxima.numero}</button>`}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="nota">Sin créditos.</td></tr>';
    return `${kpisFinanzas(f)}
      <div class="card"><div class="card-header"><div><div class="card-title">🏦 Créditos</div><div class="card-sub">Sistema francés (cuota fija) con tasa nominal anual. Las cuotas se pagan desde la cuenta elegida.</div></div>${selectorCuenta()}</div>
        <div style="overflow-x:auto"><table class="tabla"><thead><tr><th>Entidad</th><th class="num">Capital</th><th class="num">Cuota</th><th class="num">Pagadas</th><th>Estado</th><th class="num">Saldo de capital</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
        <form data-form="credito" class="form-grid" style="margin-top:10px"><label>Entidad<input name="entidad" required placeholder="Banco Nación"></label><label>Destino<input name="destino" placeholder="Prendario sembradora"></label><label>Fecha<input name="fecha" type="date" value="${hoy()}"></label><label>Capital ($)<input name="capital" type="number" min="0" required></label><label>Tasa nominal anual (%)<input name="tasaAnual" type="number" step="0.01" min="0" required></label><label>Cuotas<input name="cuotas" type="number" min="1" required></label><label>Primera cuota<input name="primeraCuota" type="date" required></label><label>Acreditado en<select name="cuentaId"><option value="">— No registrar ingreso —</option>${opciones(E.cuentas.map((c) => [c.id, c.nombre]))}</select></label><label>&nbsp;<button class="btn primary" type="submit">+ Crédito</button></label></form></div>`;
  }
  async function efectosMantenimiento(m, { aceite = 0, filtros = 0 }) {
    if (m.estado !== 'REALIZADO') return;
    const e = equipoPor(m.equipoId);
    if (e && m.tipo === 'SERVICE' && m.horometro !== '' && m.horometro != null) await DB.guardar('equipos', { ...e, horasUltimoService: Number(m.horometro) });
    if (aceite > 0) await DB.guardar('residuos', { fecha: m.fecha || hoy(), tipo: 'ACEITE_USADO', cantidad: aceite, unidad: 'l', descripcion: `${e?.nombre || ''}: ${m.detalle || A.TIPOS_MANTENIMIENTO[m.tipo]}`, estado: 'ALMACENADO', origenMantenimientoId: m.id });
    if (filtros > 0) await DB.guardar('residuos', { fecha: m.fecha || hoy(), tipo: 'FILTROS', cantidad: filtros, unidad: 'u', descripcion: `${e?.nombre || ''}: ${m.detalle || A.TIPOS_MANTENIMIENTO[m.tipo]}`, estado: 'ALMACENADO', origenMantenimientoId: m.id });
  }
  async function movimientoFondos(datos) {
    if (!E.cuentas.length) throw new Error('Primero creá una cuenta (caja o banco) en Caja y bancos.');
    return DB.guardar('movimientosFondos', { fecha: hoy(), cuentaId: cuentaOperacion || E.cuentas[0].id, ...datos });
  }

  // ================= Datos externos: dólar (DolarAPI), clima, suelo y NDVI (Agromonitoring) =================
  // Se piden a /api/pampa-datos (la función de Cloudflare en la web, el servidor local en escritorio), que guarda
  // la clave de Agromonitoring. Se guardan en una caché local (funciona sin conexión y no gasta el cupo).
  const MIN_CACHE_EXTERNO = { pizarra: 60, dolarHistorico: 360, dolar: 30, clima: 60, lluvia: 360, suelo: 180, ndvi: 720 };
  const datoExterno = (clave) => (E?.datosExternos || []).find((d) => d.clave === clave);
  async function pedirDatoExterno(params, opciones) {
    const r = await fetch(params ? `/api/pampa-datos?${new URLSearchParams(params)}` : '/api/pampa-datos', { cache: 'no-store', ...(opciones || {}) });
    const data = await r.json().catch(() => ({ ok: false, error: 'el servidor de datos no está disponible' }));
    if (!data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }
  let actualizandoExternos = null;
  async function actualizarDatosExternos({ forzar = false } = {}) {
    if (actualizandoExternos) return actualizandoExternos;
    actualizandoExternos = (async () => {
      const previos = Object.fromEntries((await DB.db.datosExternos.toArray()).map((d) => [d.clave, d]));
      const vigente = (k, min) => !forzar && previos[k] && Date.now() - Date.parse(previos[k].fecha) < min * 60000;
      const guardar = (clave, valor) => DB.db.datosExternos.put({ clave, valor, fecha: new Date().toISOString() });
      const errores = [];
      let cambios = 0;
      for (const [clave, params, nombre] of [['dolar', { tipo: 'dolar' }, 'Dólar'], ['pizarra', { tipo: 'pizarra' }, 'Pizarra Rosario'], ['dolarHistorico', { tipo: 'dolarHistorico', casa: 'bolsa' }, 'Histórico del MEP']]) {
        if (vigente(clave, MIN_CACHE_EXTERNO[clave])) continue;
        try { await guardar(clave, await pedirDatoExterno(params)); cambios++; } catch (e) { errores.push(`${nombre}: ${e.message}`); }
      }
      const lotes = (await DB.todo('lotes')).filter((l) => l.agroPolyId || (Number(l.latitud) && Number(l.longitud))).slice(0, 12);
      let sinServidorAgro = false;
      for (const l of lotes) {
        if (sinServidorAgro) break;
        const lugar = l.agroPolyId ? { polyid: l.agroPolyId } : { lat: l.latitud, lon: l.longitud };
        const tareas = ['clima', 'lluvia', ...(l.agroPolyId ? ['suelo', 'ndvi'] : [])];
        for (const tipo of tareas) {
          const k = `${tipo}:${l.id}`;
          if (vigente(k, MIN_CACHE_EXTERNO[tipo])) continue;
          try { await guardar(k, await pedirDatoExterno({ tipo, ...lugar })); cambios++; } catch (e) {
            errores.push(`${l.codigo} (${tipo}): ${e.message}`);
            if (/no está configurado|no está disponible/.test(e.message)) { sinServidorAgro = true; break; }
          }
        }
      }
      await DB.meta.set('datosExternosEstado', { cuando: new Date().toISOString(), errores: errores.slice(0, 6), lotesConUbicacion: lotes.length });
      if (cambios || forzar) window.dispatchEvent(new CustomEvent('pampa-datos-externos', { detail: { cambios } }));
      return { cambios, errores };
    })().finally(() => { actualizandoExternos = null; });
    return actualizandoExternos;
  }
  window.addEventListener('pampa-datos-externos', () => { if (root?.isConnected) refrescar(); const dash = document.querySelector('#agroDashboard'); if (dash?.isConnected) montarDashboard(dash); });

  const serieMep = () => datoExterno('dolarHistorico')?.valor?.serie || [];
  const pizarra = () => datoExterno('pizarra')?.valor || null;
  const preciosPizarra = () => Object.fromEntries(Object.entries(pizarra()?.precios || {}).filter(([g, p]) => A.CULTIVOS[g] && p.pesos).map(([g, p]) => [g, p.pesos]));
  const NOTA_GRANOS_AR = 'En <a href="https://granos.ar/" target="_blank" rel="noopener noreferrer">GRANOS.AR</a> están todos los datos del mercado actualizados al momento (pizarras, futuros, dólar, fletes, hacienda) para todos los ítems de la app.';
  function enlacesMercadoHtml() {
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><a class="btn small" href="https://granos.ar/" target="_blank" rel="noopener noreferrer" title="Monitor agropecuario: pizarras, futuros, dólar, fletes, hacienda y clima. Ahí están todos los datos necesarios actualizados al momento para todos los ítems de la app.">📈 GRANOS.AR</a><a class="btn small" href="https://agroenso.netlify.app/" target="_blank" rel="noopener noreferrer" title="AgroENSO · El Niño en tu zona: cómo pega en los cultivos de tu zona, con las últimas 35 campañas.">🌱 AgroENSO</a></div>`;
  }
  function pizarraHtml({ boton = false } = {}) {
    const p = pizarra();
    if (!p?.precios || !Object.keys(p.precios).length) return `<div class="nota">Pizarra de Rosario: sin datos todavía (se trae sola cuando hay conexión). ${NOTA_GRANOS_AR}</div>`;
    const items = Object.keys(A.CULTIVOS).filter((g) => p.precios[g]).map((g) => { const x = p.precios[g]; return `${esc(A.CULTIVOS[g].nombre)} <strong>${pesos(x.pesos)}</strong>/t${x.usd ? ` (US$ ${x.usd.toLocaleString('es-AR')})` : ''}${x.estimado ? ' (E)' : ''}${x.tendencia === 'sube' ? ' ▲' : x.tendencia === 'baja' ? ' ▼' : ''}${boton ? ` <button class="btn small" type="button" data-usar-pizarra="${esc(g)}" data-precio="${esc(x.pesos)}">Usar</button>` : ''}`; }).join(' · ');
    return `<div class="nota">🌾 Pizarra Rosario del ${esc(p.fecha || '')} (Cámara Arbitral de Cereales, BCR): ${items}. ${NOTA_GRANOS_AR}</div>`;
  }

  // Dólar del día (para el tipo de cambio informativo de Costos y para PampaIA).
  function cotizacionHtml({ nota = true } = {}) {
    const dol = datoExterno('dolar')?.valor;
    if (!dol?.cotizaciones?.length) return '<div class="nota">Cotización del día: sin datos todavía (se trae sola cuando hay conexión).</div>';
    const c = (casa) => dol.cotizaciones.find((x) => x.casa === casa);
    const mep = c('bolsa');
    const dias = A.diasDesde(mep?.fecha, hoy());
    const lista = ['bolsa', 'oficial', 'blue', 'contadoconliqui'].map(c).filter(Boolean).map((x) => `${esc(x.nombre)} <strong>${pesos(x.venta)}</strong>`).join(' · ');
    return `<div class="nota">💵 Hoy (venta): ${lista} · ${esc(dol.fuente || 'DolarAPI')}, ${esc(String(mep?.fecha || '').slice(0, 16).replace('T', ' '))}${dias > 2 ? ` · ⚠️ cotización de hace ${dias} días` : ''}.${nota ? ` ${NOTA_GRANOS_AR}` : ''}</div>${serieMep().length ? '<button class="btn small" type="button" data-completar-tc>Completar los meses sin tipo de cambio con el MEP promedio</button> ' : ''}${mep ? `<button class="btn small" type="button" data-usar-mep="${esc(mep.venta)}">Usar MEP ${pesos(mep.venta)} para ${esc(hoy().slice(0, 7))}</button>` : ''}`;
  }

  // ================= Módulo Clima y satélite =================
  const lotesClima = () => E.lotes.map((l) => ({ l, clima: datoExterno(`clima:${l.id}`)?.valor, lluvia: datoExterno(`lluvia:${l.id}`)?.valor, suelo: datoExterno(`suelo:${l.id}`)?.valor, ndvi: datoExterno(`ndvi:${l.id}`)?.valor, fecha: datoExterno(`clima:${l.id}`)?.fecha }));
  const horaCorta = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')} h`; };
  function estadoExternosHtml() {
    const e = E.datosExternosEstado;
    if (!e) return '<div class="nota">Todavía no se consultó el clima.</div>';
    return `<div class="nota">Última consulta: ${esc(horaCorta(e.cuando))}${e.errores?.length ? ` · ⚠️ ${esc(e.errores.join(' · '))}` : ''}</div>`;
  }
  function bajoPotencialDe(loteId) {
    const mapa = [...(E.mapasRinde || [])].filter((m) => m.loteId === loteId).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
    if (!mapa) return null;
    const z = A.zonificar(A.limpiarMapaRinde(mapa.puntos).validos);
    return z ? z.zonas[0].pct : null;
  }
  function alertasExternas() {
    const out = [];
    lotesClima().forEach(({ l, clima, ndvi }) => {
      if (clima) out.push(...A.alertasClima({ clima, lote: l.codigo }));
      if (ndvi?.serie) out.push(...A.alertasNdvi({ serie: ndvi.serie, lote: l.codigo, bajoPotencialPct: bajoPotencialDe(l.id) }));
    });
    return out;
  }
  function vistaClimaLotes() {
    const filas = lotesClima().map(({ l, clima, lluvia, fecha }) => {
      if (!clima) {
        return `<div class="card"><div class="card-header"><div class="card-title">📍 ${esc(l.codigo)} · ${esc(l.campo || '')}</div></div>${Number(l.latitud) ? '<div class="nota">Ubicación cargada: el clima se trae en la próxima actualización.</div>' : `<form data-form="ubicacionLote" class="form-grid"><input type="hidden" name="loteId" value="${esc(l.id)}"><label>Latitud<input name="latitud" type="number" step="0.00001" placeholder="-33.91234" required></label><label>Longitud<input name="longitud" type="number" step="0.00001" placeholder="-61.84321" required></label><label>&nbsp;<button class="btn" type="submit">Guardar ubicación</button></label></form><div class="nota">Con la ubicación (o el polígono en NDVI y suelo) se trae el clima y el pronóstico del lote.</div>`}</div>`;
      }
      const a = clima.actual || {};
      const ahora = A.evaluarCondicion(a);
      const v = A.ventanasAplicacion((clima.pronostico || []).slice(0, 16));
      const ventanas = v.ventanas.slice(0, 4).map((w) => `${horaCorta(w.desde)} a ${horaCorta(new Date(Date.parse(w.hasta) + 3 * 3600 * 1000).toISOString())}`).join(' · ');
      const alertas = A.alertasClima({ clima, lote: l.codigo });
      const pasos = v.pasos.slice(0, 8).map((p) => `<td class="num" title="${esc(p.motivos.join(', ') || 'apta')}" style="color:${p.apta ? 'var(--green, #3fa66a)' : 'var(--orange, #f59e0b)'}">${esc(horaCorta(p.fecha).split(' ')[1])} h<br>${esc(p.temperatura)}°<br>${esc(p.vientoKmh)} km/h<br>${esc(p.humedad)} %${p.lluviaMm ? `<br>${esc(p.lluviaMm)} mm` : ''}</td>`).join('');
      return `<div class="card"><div class="card-header"><div><div class="card-title">🌦️ ${esc(l.codigo)} · ${esc(l.campo || '')}</div><div class="card-sub">${esc(a.descripcion || '')} · ${esc(a.temperatura)} °C · humedad ${esc(a.humedad)} % · viento ${esc(a.vientoKmh)} km/h${a.rafagaKmh ? ` (ráfagas ${esc(a.rafagaKmh)})` : ''} · ${esc(horaCorta(fecha))}</div></div><span class="tag ${ahora.apta ? 'green' : 'orange'}">${ahora.apta ? 'Apto para aplicar ahora' : `No apto: ${esc(ahora.motivos.join(', '))}`}</span></div>
        ${alertas.length ? alertasHtml(alertas) : ''}
        <div class="nota">🗓️ Ventanas aptas en las próximas 48 h: <strong>${esc(ventanas || 'ninguna')}</strong> · lluvia prevista ${esc(v.lluviaPrevista)} mm${lluvia?.mm != null ? ` · llovieron ${esc(lluvia.mm)} mm en los últimos ${esc(lluvia.dias)} días` : ''}</div>
        <div style="overflow-x:auto"><table class="tabla"><tbody><tr>${pasos}</tr></tbody></table></div></div>`;
    }).join('') || '<div class="card"><div class="nota">Cargá los lotes en RENSPA y campañas.</div></div>';
    return `<div class="card"><div class="card-header"><div><div class="card-title">🌦️ Clima, pronóstico y ventanas de aplicación</div><div class="card-sub">Condiciones de aplicación de la receta: viento ${A.CONDICIONES_APLICACION.vientoMin}–${A.CONDICIONES_APLICACION.vientoMax} km/h, hasta ${A.CONDICIONES_APLICACION.temperaturaMax} °C, humedad desde ${A.CONDICIONES_APLICACION.humedadMin} % y sin lluvia. Fuente: Agromonitoring (OpenWeather).</div></div><button class="btn small" type="button" data-actualizar-externos>Actualizar ahora</button></div>${estadoExternosHtml()}</div>${filas}`;
  }
  function geoJsonImportados() {
    try {
      return (JSON.parse(localStorage.getItem('pampa-imported-geojson') || '[]') || []).flatMap((item, i) => (item.geoJson?.features || []).filter((f) => ['Polygon', 'MultiPolygon'].includes(f.geometry?.type)).map((f, j) => ({ id: `${i}-${j}`, nombre: `${item.name || 'GeoJSON'} · ${f.properties?.name || f.properties?.lote || f.properties?.codigo || `polígono ${j + 1}`}`, feature: { type: 'Feature', properties: f.properties || {}, geometry: f.geometry } })));
    } catch { return []; }
  }
  function vistaSatelite() {
    const importados = geoJsonImportados();
    const filas = lotesClima().map(({ l, suelo, ndvi }) => {
      if (!l.agroPolyId) {
        return `<div class="card"><div class="card-header"><div class="card-title">🛰️ ${esc(l.codigo)} · ${esc(l.campo || '')}</div><span class="tag blue">Sin polígono</span></div>
          <form data-form="poligonoLote" class="form-grid"><input type="hidden" name="loteId" value="${esc(l.id)}"><label>Polígono importado<select name="importado"><option value="">— Pegar GeoJSON abajo —</option>${opciones(importados.map((x) => [x.id, x.nombre]))}</select></label><label style="grid-column:1/-1">o GeoJSON del lote (Feature Polygon)<textarea name="geojson" rows="2" placeholder='{"type":"Feature","geometry":{"type":"Polygon","coordinates":[...]}}'></textarea></label><label>&nbsp;<button class="btn" type="submit">Registrar polígono</button></label></form></div>`;
      }
      const serie = ndvi?.serie || [];
      const alertas = A.alertasNdvi({ serie, lote: l.codigo, bajoPotencialPct: bajoPotencialDe(l.id) });
      return `<div class="card"><div class="card-header"><div><div class="card-title">🛰️ ${esc(l.codigo)} · ${esc(l.campo || '')}</div><div class="card-sub">Polígono ${esc(l.agroPolyId)}${l.agroHa ? ` · ${esc(l.agroHa)} ha` : ''}${suelo ? ` · humedad del suelo ${esc(suelo.humedad)} % · ${esc(suelo.temperatura10cm)} °C a 10 cm` : ''}</div></div>${serie[0] ? `<span class="tag ${serie[0].media >= 0.5 ? 'green' : serie[0].media >= 0.3 ? 'orange' : 'red'}">NDVI ${esc(serie[0].media)}</span>` : '<span class="tag blue">Sin imágenes recientes</span>'}</div>
        ${alertas.length ? alertasHtml(alertas) : ''}
        <table class="tabla"><thead><tr><th>Imagen</th><th>Satélite</th><th class="num">Nubes</th><th class="num">NDVI medio</th><th class="num">Mín – máx</th></tr></thead><tbody>${serie.map((s) => `<tr><td>${esc(String(s.fecha).slice(0, 10))}</td><td>${esc(s.satelite || '')}</td><td class="num">${esc(s.nubes)} %</td><td class="num"><strong>${esc(s.media)}</strong></td><td class="num">${esc(s.min)} – ${esc(s.max)}</td></tr>`).join('') || '<tr><td colspan="5" class="nota">Sin imágenes con pocas nubes en los últimos 60 días.</td></tr>'}</tbody></table></div>`;
    }).join('');
    return `<div class="card"><div class="card-header"><div><div class="card-title">🛰️ NDVI y humedad del suelo por lote</div><div class="card-sub">Agromonitoring: imágenes Sentinel-2 y Landsat (sin nubes) y humedad del suelo. Cada lote necesita su polígono; la cuenta tiene un límite de hectáreas, registrá los lotes que quieras seguir.</div></div><button class="btn small" type="button" data-actualizar-externos>Actualizar ahora</button></div>${estadoExternosHtml()}</div>${filas}`;
  }
  function vistaTelemetria() { return '<div id="telemetriaLegacy"><div class="nota">Cargando…</div></div>'; }

  // ---------- Render y eventos ----------
  const TABS = [['stock', '🌾 Stock'], ['lpg', '🧾 Liquidaciones (LPG)'], ['cpe', '🚚 Cartas de Porte'], ['renspa', '🪪 RENSPA y campañas'], ['compras', '📦 Compras e insumos'], ['labores', '🚜 Labores'], ['senasa', '🌱 SENASA y recetas'], ['residuos', '♻️ Residuos'], ['resultados', '💵 Costos y resultados'], ['fiscal', '🏛️ Fiscal'], ['equipos', '🚜 Equipos'], ['mantenimiento', '🔧 Mantenimiento'], ['equipoCostos', '💲 Costos operativos'], ['planificacion', '📐 Planificación'], ['fondos', '🏦 Caja y bancos'], ['cobrarPagar', '🧾 A cobrar, a pagar y cheques'], ['creditos', '💳 Créditos'], ['climaLotes', '🌦️ Clima y aplicación'], ['satelite', '🛰️ NDVI y suelo'], ['telemetria', '📡 Telemetría']];
  const CONJUNTOS = {
    granos: ['stock', 'lpg', 'cpe', 'renspa', 'compras', 'labores', 'senasa', 'residuos', 'resultados', 'fiscal'],
    equipo: ['equipos', 'mantenimiento', 'equipoCostos', 'planificacion'],
    costos: ['compras', 'resultados', 'equipoCostos'],
    finanzas: ['fondos', 'cobrarPagar', 'creditos', 'lpg'],
    clima: ['climaLotes', 'satelite', 'telemetria'],
  };
  const VISTA_CONJUNTO = { equipo: 'Plan de equipamiento', costos: 'Costos', finanzas: 'Finanzas', clima: 'Telemetria y clima' };
  const ETIQUETA_CONJUNTO = { costos: { compras: '📦 Compras y gastos', resultados: '💵 Costos por lote y campaña' }, finanzas: { lpg: '🧾 Liquidaciones (LPG)' } };
  let conjunto = 'granos';
  // Permisos del rol activo (precision-roles.js): solo las pestañas que el rol puede ver.
  const rolActivo = () => (typeof window.PampaRolActivo === 'function' ? window.PampaRolActivo() : null);
  // Rol activo y versión contratada (Básica y Profesional no tienen LPG, Cartas de Porte, fiscal ni costos).
  const planActual = () => (typeof window.PampaPlanPrecision === 'function' ? window.PampaPlanPrecision() : 'trial');
  const puedeTab = (k) => {
    const R = window.PampaRolesPrecision;
    if (!R) return true;
    if (conjunto === 'granos' || !VISTA_CONJUNTO[conjunto]) return R.tabEnPlan(planActual(), k) && R.puedeTab(rolActivo(), k);
    return R.vistaEnPlan(planActual(), VISTA_CONJUNTO[conjunto]) && R.puedeVista(rolActivo(), VISTA_CONJUNTO[conjunto]);
  };
  function aplicarPermisos() { if (root?.isConnected) render(); const dash = document.querySelector('#agroDashboard'); if (dash?.isConnected) montarDashboard(dash); }
  function render() {
    if (!root) return;
    const permitidas = CONJUNTOS[conjunto].filter((k) => puedeTab(k)).map((k) => [k, ETIQUETA_CONJUNTO[conjunto]?.[k] || TABS.find(([x]) => x === k)[1]]);
    if (!permitidas.length) { root.innerHTML = `<div class="card"><div class="nota">Tu rol (${esc(rolActivo()?.nombre || '')}) no tiene acceso a granos, costos ni fiscal.</div></div>`; return; }
    if (!puedeTab(tab)) tab = permitidas[0][0];
    const vistas = { stock: vistaStock, lpg: vistaLpg, cpe: vistaCpe, renspa: vistaRenspa, compras: vistaCompras, labores: vistaLabores, senasa: vistaSenasa, residuos: vistaResiduos, resultados: vistaResultados, equipos: vistaEquipos, mantenimiento: vistaMantenimiento, equipoCostos: vistaEquipoCostos, planificacion: vistaPlanificacion, fondos: vistaFondos, cobrarPagar: vistaCobrarPagar, creditos: vistaCreditos, climaLotes: vistaClimaLotes, satelite: vistaSatelite, telemetria: vistaTelemetria, fiscal: vistaFiscal };
    root.innerHTML = `<div class="tabs">${permitidas.map(([k, t]) => `<button class="tab${k === tab ? ' active' : ''}" type="button" data-tab="${k}">${t}</button>`).join('')}</div>${vistas[tab]()}`;
    if (tab === 'lpg') actualizarDesglose();
    // La planificación de equipamiento (catálogo por escala) es la pantalla anterior, montada adentro.
    if (tab === 'planificacion') window.PampaPrecisionLegacy?.montarPlanEquipamiento(root.querySelector('#planEquipamientoLegacy'));
    if (tab === 'telemetria') window.PampaPrecisionLegacy?.montarTelemetria(root.querySelector('#telemetriaLegacy'));
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
          await DB.guardarCompra({ fecha: f.fecha, tipo: f.tipo, proveedor: f.proveedor.trim(), comprobante: f.comprobante.trim(), insumo: f.tipo === 'INSUMO' ? f.insumo.trim() : '', categoriaInsumo: f.tipo === 'INSUMO' ? f.categoriaInsumo : '', cantidad: f.tipo === 'INSUMO' ? Number(f.cantidad) : 0, unidad: f.unidad.trim(), categoria: f.tipo === 'SERVICIO' ? f.categoria : '', concepto: f.tipo === 'SERVICIO' ? f.concepto.trim() : '', loteId: f.tipo === 'SERVICIO' ? f.loteId : '', cultivo: f.tipo === 'SERVICIO' ? A.grano(f.cultivo) || '' : '', campania: camp, neto, ivaPct, iva: Math.round(neto * ivaPct) / 100, total: Math.round(neto * (100 + ivaPct)) / 100, pagado: f.pagado, vencimiento: f.vencimiento || '' });
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
          const recetaElegida = E.recetas.find((r) => r.id === f.recetaId);
          if (f.tipo === 'Aplicación' && f.estado === 'REALIZADA' && !recetaElegida && (!f.agronomo.trim() || !f.matricula.trim() || !f.receta.trim()) && !confirm('Aplicación sin receta agronómica (elegila de la lista o cargá ingeniero, matrícula y número). La ley provincial la exige. ¿Guardar igual?')) return;
          const clima = f.tipo === 'Aplicación' ? { viento: f.viento === '' ? '' : Number(f.viento), temperatura: f.temperatura === '' ? '' : Number(f.temperatura), humedad: f.humedad === '' ? '' : Number(f.humedad), inversionTermica: f.inversionTermica } : {};
          // Controles contra la receta y de las condiciones de aplicación, antes de guardar.
          const controles = A.controlesAplicacion({ tipo: f.tipo, estado: f.estado, fecha: f.fecha, loteId: f.loteId, ha: Number(f.ha) || 0, recetaId: recetaElegida?.id || '', agronomo: f.agronomo, matricula: f.matricula, receta: f.receta, insumos, ...clima }, { recetas: E.recetas, productos: E.fitosanitarios, lotes: E.lotes }).filter((c) => !/sin receta agronómica/.test(c.texto));
          if (controles.length && !confirm(`La aplicación tiene observaciones:\n\n${controles.map((c) => `• ${c.texto}`).join('\n')}\n\n¿Guardarla igual?`)) return;
          await DB.guardar('labores', { fecha: f.fecha, loteId: f.loteId, cultivo: A.grano(f.cultivo), campania: camp.campania, tipo: f.tipo, ha: Number(f.ha) || 0, estado: f.estado, equipoId: f.equipoId, horas: Number(f.horas) || 0, operador: (f.operador || '').trim(), contratista: f.contratista.trim(), contratistaNeto: Number(f.contratistaNeto) || 0, insumos, recetaId: recetaElegida?.id || '', agronomo: recetaElegida?.agronomo || f.agronomo.trim(), matricula: recetaElegida?.matricula || f.matricula.trim(), receta: recetaElegida?.numero || f.receta.trim(), provinciaReceta: recetaElegida?.provincia || f.provinciaReceta.trim(), ...clima });
          // La receta queda aplicada solo si es la de ese lote.
          if (recetaElegida && f.estado === 'REALIZADA' && (!recetaElegida.loteId || recetaElegida.loteId === f.loteId)) await DB.guardar('recetas', { ...recetaElegida, estado: 'APLICADA' });
          break;
        }
        case 'empleado': await DB.guardar('empleados', { nombre: f.nombre.trim(), legajo: f.legajo, puesto: f.puesto, sueldo: Number(f.sueldo) || 0, cargasPct: f.cargasPct === '' ? '' : Number(f.cargasPct), ingreso: f.ingreso, baja: f.baja, estado: f.baja ? 'BAJA' : 'ACTIVO' }); break;
        case 'equipo': {
          const n = (k) => (f[k] === undefined ? undefined : f[k] === '' ? '' : Number(f[k]));
          const datos = { codigo: f.codigo, nombre: f.nombre.trim(), costoHora: Number(f.costoHora) || 0, valor: Number(f.valor) || 0, valorResidual: Number(f.valorResidual) || 0, vidaUtilAnios: Number(f.vidaUtilAnios) || 0, fechaAlta: f.fechaAlta, horometro: Number(f.horometro) || 0, serviceCadaHoras: Number(f.serviceCadaHoras) || 0, horasUltimoService: n('horasUltimoService'), revisar: '' };
          ['categoria', 'marca', 'modelo', 'anio', 'patente', 'seguroVence', 'vtvVence', 'baja'].forEach((k) => { if (f[k] !== undefined) datos[k] = String(f[k]).trim(); });
          if (f.costosFijosAnuales !== undefined) datos.costosFijosAnuales = Number(f.costosFijosAnuales) || 0;
          await DB.guardar('equipos', { ...(f.id ? { id: f.id } : {}), ...datos });
          break;
        }
        case 'tipoCambio': await DB.db.tiposCambio.put({ mes: f.mes, ars: Number(f.ars) || 0 }); break;
        case 'cpe': {
          if (E.cpes.some((c) => String(c.numero).trim() === f.numero.trim() && c.estado !== 'ANULADA')) throw new Error('Ya hay una Carta de Porte con ese número.');
          if (f.tipo === 'TRASLADO' && (!f.ubicacionId || !f.ubicacionDestinoId || f.ubicacionId === f.ubicacionDestinoId)) throw new Error('Para un traslado propio elegí origen y destino distintos.');
          const cpe = await DB.guardar('cpes', { numero: f.numero.trim(), fecha: f.fecha, tipo: f.tipo, grano: A.grano(f.grano), ubicacionId: f.ubicacionId, ubicacionDestinoId: f.tipo === 'TRASLADO' ? f.ubicacionDestinoId : '', destino: f.destino, cuitDestino: f.cuitDestino, transportista: f.transportista, cuitTransportista: f.cuitTransportista, patente: f.patente, chofer: f.chofer, kgOrigen: Number(f.kgOrigen) || 0, kgDestino: Number(f.kgDestino) || 0, estado: f.estado, lpgId: f.lpgId });
          if (cpe.tipo === 'TRASLADO' && cpe.estado === 'CONFIRMADA') await moverTrasladoCpe(cpe);
          break;
        }
        case 'ubicacionLote': {
          const l = E.lotes.find((x) => x.id === f.loteId);
          await DB.guardar('lotes', { ...l, latitud: Number(f.latitud), longitud: Number(f.longitud) });
          await cargar();
          actualizarDatosExternos({ forzar: true });
          break;
        }
        case 'poligonoLote': {
          const l = E.lotes.find((x) => x.id === f.loteId);
          let geoJson = f.importado ? geoJsonImportados().find((x) => x.id === f.importado)?.feature : null;
          if (!geoJson && f.geojson.trim()) { try { const g = JSON.parse(f.geojson); geoJson = g.type === 'FeatureCollection' ? g.features?.[0] : g.type === 'Feature' ? g : { type: 'Feature', properties: {}, geometry: g }; } catch { throw new Error('El GeoJSON no es válido.'); } }
          if (!geoJson) throw new Error('Elegí un polígono importado o pegá el GeoJSON del lote.');
          const r = await pedirDatoExterno(null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: `${l.codigo} · ${l.campo || ''}`.trim(), geoJson }) });
          await DB.guardar('lotes', { ...l, agroPolyId: r.poligono.id, agroHa: r.poligono.hectareas, ...(r.poligono.centro ? { latitud: r.poligono.centro.lat, longitud: r.poligono.centro.lon } : {}) });
          await cargar();
          toast(`Polígono de ${l.codigo} registrado (${r.poligono.hectareas} ha).`);
          actualizarDatosExternos({ forzar: true });
          break;
        }
        case 'mantenimiento': {
          const m = await DB.guardar('mantenimientos', { equipoId: f.equipoId, tipo: f.tipo, estado: f.estado, fecha: f.fecha, horometro: f.horometro === '' ? '' : Number(f.horometro), detalle: f.detalle.trim(), proveedor: f.proveedor.trim(), comprobante: f.comprobante.trim(), costo: Number(f.costo) || 0, litros: Number(f.litros) || 0 });
          await efectosMantenimiento(m, { aceite: Number(f.aceiteLitros) || 0, filtros: Number(f.filtros) || 0 });
          break;
        }
        case 'cuenta': await DB.guardar('cuentas', { nombre: f.nombre.trim(), tipo: f.tipo, banco: f.banco.trim(), cbu: f.cbu.trim(), saldoInicial: Number(f.saldoInicial) || 0 }); break;
        case 'movimiento': {
          if (f.tipo === 'TRANSFERENCIA' && (!f.cuentaDestinoId || f.cuentaDestinoId === f.cuentaId)) throw new Error('Para una transferencia elegí una cuenta destino distinta.');
          await DB.guardar('movimientosFondos', { fecha: f.fecha, tipo: f.tipo, cuentaId: f.cuentaId, cuentaDestinoId: f.tipo === 'TRANSFERENCIA' ? f.cuentaDestinoId : '', concepto: f.concepto.trim(), categoria: f.tipo === 'TRANSFERENCIA' ? '' : f.categoria, importe: Number(f.importe) || 0 });
          break;
        }
        case 'cheque': await DB.guardar('cheques', { sentido: f.sentido, numero: f.numero.trim(), banco: f.banco.trim(), tercero: f.tercero.trim(), fecha: f.fecha, vencimiento: f.vencimiento, importe: Number(f.importe) || 0, echeq: f.echeq === 'SI', estado: f.sentido === 'RECIBIDO' ? 'EN_CARTERA' : 'EMITIDO' }); break;
        case 'credito': {
          const cr = await DB.guardar('creditos', { entidad: f.entidad.trim(), destino: f.destino.trim(), fecha: f.fecha, capital: Number(f.capital) || 0, tasaAnual: Number(f.tasaAnual) || 0, cuotas: Number(f.cuotas) || 1, primeraCuota: f.primeraCuota });
          if (f.cuentaId) await DB.guardar('movimientosFondos', { fecha: f.fecha || hoy(), tipo: 'INGRESO', cuentaId: f.cuentaId, concepto: `Acreditación crédito ${cr.entidad}`, importe: cr.capital, origen: 'CREDITO_ALTA', origenId: cr.id });
          break;
        }
        case 'receta': {
          if (E.recetas.some((r) => String(r.numero).trim() === f.numero.trim() && r.estado !== 'ANULADA')) throw new Error('Ya hay una receta con ese número.');
          const productos = [1, 2, 3].map((i) => ({ producto: (f[`producto${i}`] || '').trim(), dosis: Number(f[`dosis${i}`]) || 0, unidad: f[`unidad${i}`] || 'l' })).filter((p) => p.producto);
          if (!productos.length) throw new Error('Cargá al menos un producto con su dosis.');
          const receta = { numero: f.numero.trim(), fecha: f.fecha, vence: f.vence, provincia: f.provincia, agronomo: f.agronomo.trim(), matricula: f.matricula.trim(), loteId: f.loteId, cultivo: A.grano(f.cultivo), ha: Number(f.ha) || 0, objetivo: f.objetivo.trim(), tipoAplicacion: f.tipoAplicacion, volumenCaldo: Number(f.volumenCaldo) || '', productos, aplicadorEquipoId: f.aplicadorEquipoId, aplicadorContratista: f.aplicadorContratista.trim(), distanciaUrbanaM: f.distanciaUrbanaM === '' ? '' : Number(f.distanciaUrbanaM), distanciaMinimaM: f.distanciaMinimaM === '' ? '' : Number(f.distanciaMinimaM), observaciones: f.observaciones.trim(), estado: 'EMITIDA' };
          const obs = A.controlesReceta(receta, { productos: E.fitosanitarios, equipos: E.equipos, hoy: hoy() }).filter((o) => o.nivel === 'danger');
          if (obs.length && !confirm(`La receta tiene observaciones:\n\n${obs.map((o) => `• ${o.texto}`).join('\n')}\n\n¿Emitirla igual?`)) return;
          await DB.guardar('recetas', receta);
          break;
        }
        case 'residuo': {
          const t = A.TIPOS_RESIDUO[f.tipo] || A.TIPOS_RESIDUO.OTRO;
          await DB.guardar('residuos', { fecha: f.fecha, tipo: f.tipo, cantidad: Number(f.cantidad) || 0, unidad: f.unidad.trim() || t.unidad, descripcion: f.descripcion.trim(), estado: 'ALMACENADO' });
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
      if (d.irTab) { tab = d.irTab; return render(); }
      if (d.actualizarExternos !== undefined) { toast('Consultando dólar, clima y satélite…'); await actualizarDatosExternos({ forzar: true }); return refrescar(); }
      if (d.usarPizarra) {
        const form = root.querySelector('form[data-form="lpg"]');
        if (form) { if (form.elements.grano) form.elements.grano.value = d.usarPizarra; form.elements.precioTn.value = d.precio; actualizarDesglose(); toast(`Precio de pizarra de ${A.CULTIVOS[d.usarPizarra]?.nombre}: ${pesos(d.precio)}/t`); }
        return;
      }
      if (d.completarTc !== undefined) {
        const prom = A.promediosMensuales(serieMep());
        const cargados = new Set(E.tiposCambio.map((x) => x.mes));
        const meses = [...new Set([...E.compras, ...E.labores, ...E.lpg.map((l) => l.calculo || {})].map((x) => String(x.fecha || '').slice(0, 7)).filter(Boolean))].filter((m) => prom[m] && !cargados.has(m));
        for (const m of meses) await DB.db.tiposCambio.put({ mes: m, ars: prom[m], fuente: 'MEP promedio mensual (argentinadatos)', updatedAt: new Date().toISOString() });
        toast(meses.length ? `Tipo de cambio cargado en ${meses.length} mes(es) con el MEP promedio.` : 'Todos los meses con movimientos ya tienen tipo de cambio.');
        return refrescar();
      }
      if (d.usarMep) { await DB.db.tiposCambio.put({ mes: hoy().slice(0, 7), ars: Number(d.usarMep), fuente: 'DolarAPI · MEP (venta)', updatedAt: new Date().toISOString() }); toast(`Tipo de cambio de ${hoy().slice(0, 7)}: MEP ${pesos(d.usarMep)}.`); return refrescar(); }
      if (d.realizarMantenimiento) {
        const m = E.mantenimientos.find((x) => x.id === d.realizarMantenimiento);
        const horo = prompt('Horómetro al hacer el trabajo (h):', m.horometro || '');
        if (horo === null) return;
        const costo = prompt('Costo ($):', m.costo || '');
        if (costo === null) return;
        const hecho = await DB.guardar('mantenimientos', { ...m, estado: 'REALIZADO', fecha: hoy(), horometro: horo === '' ? '' : Number(horo), costo: Number(costo) || 0 });
        await efectosMantenimiento(hecho, {});
        return refrescar();
      }
      if (d.cobrarLpg) {
        const x = A.cuentasACobrar({ lpg: E.lpg, movimientos: E.movimientosFondos }).find((y) => y.id === d.cobrarLpg);
        const imp = prompt(`Importe cobrado de la LPG ${x.numero} en ${nombreCuenta(cuentaOperacion || E.cuentas[0]?.id)}:`, Math.round(x.saldo * 100) / 100);
        if (imp === null) return;
        await movimientoFondos({ tipo: 'INGRESO', concepto: `Cobro LPG ${x.numero} · ${x.comprador}`, importe: Number(imp) || 0, origen: 'LPG', origenId: x.id });
        return refrescar();
      }
      if (d.pagarCompra) {
        const x = A.cuentasAPagar({ compras: E.compras, movimientos: E.movimientosFondos }).find((y) => y.id === d.pagarCompra);
        const imp = prompt(`Importe pagado a ${x.proveedor} desde ${nombreCuenta(cuentaOperacion || E.cuentas[0]?.id)}:`, Math.round(x.saldo * 100) / 100);
        if (imp === null) return;
        await movimientoFondos({ tipo: 'EGRESO', concepto: `Pago ${x.comprobante || ''} · ${x.proveedor}`.trim(), importe: Number(imp) || 0, origen: 'COMPRA', origenId: x.id });
        return refrescar();
      }
      if (d.cheque) {
        const c = E.cheques.find((x) => x.id === d.cheque);
        if (d.accion === 'DEPOSITADO') await movimientoFondos({ tipo: 'INGRESO', concepto: `Depósito cheque ${c.numero} · ${c.tercero || c.banco || ''}`, importe: Number(c.importe) || 0, origen: 'CHEQUE', origenId: c.id });
        if (d.accion === 'DEBITADO') await movimientoFondos({ tipo: 'EGRESO', concepto: `Débito cheque ${c.numero} · ${c.tercero || ''}`, importe: Number(c.importe) || 0, origen: 'CHEQUE', origenId: c.id });
        if (d.accion === 'ENDOSADO') { const a = prompt('Endosado a:', ''); if (a === null) return; await DB.guardar('cheques', { ...c, estado: 'ENDOSADO', endosadoA: a.trim(), endosadoEl: hoy() }); return refrescar(); }
        if ((d.accion === 'RECHAZADO' || d.accion === 'ANULADO') && !confirm(`¿Marcar el cheque ${c.numero} como ${d.accion === 'RECHAZADO' ? 'rechazado' : 'anulado'}?`)) return;
        await DB.guardar('cheques', { ...c, estado: d.accion, [`${d.accion.toLowerCase()}El`]: hoy() });
        return refrescar();
      }
      if (d.pagarCuota) {
        const cr = E.creditos.find((x) => x.id === d.pagarCuota);
        const e = A.estadoCredito(cr, E.movimientosFondos, hoy());
        if (!e.proxima || !confirm(`¿Pagar la cuota ${e.proxima.numero} de ${cr.entidad} por $ ${Math.round(e.proxima.cuota).toLocaleString('es-AR')} desde ${nombreCuenta(cuentaOperacion || E.cuentas[0]?.id)}?`)) return;
        await movimientoFondos({ tipo: 'EGRESO', concepto: `Cuota ${e.proxima.numero} crédito ${cr.entidad} (interés ${Math.round(e.proxima.interes).toLocaleString('es-AR')})`, importe: e.proxima.cuota, origen: 'CREDITO', origenId: cr.id });
        return refrescar();
      }
      if (d.imprimirReceta) { const r = E.recetas.find((x) => x.id === d.imprimirReceta); if (r) imprimirReceta(r); return; }
      if (d.anularReceta) { if (!confirm('¿Anular la receta? Queda en el registro como anulada.')) return; const r = E.recetas.find((x) => x.id === d.anularReceta); await DB.guardar('recetas', { ...r, estado: 'ANULADA', anuladaEl: hoy() }); return refrescar(); }
      if (d.retiroSilobolsa) {
        const s2 = A.silobolsasVacias({ ubicaciones: E.ubicaciones, movimientosGrano: E.movimientosGrano, residuos: E.residuos }).find((x) => x.ubicacionId === d.retiroSilobolsa);
        if (!s2) return refrescar();
        const kg = prompt(`Kilos de plástico de ${s2.nombre} (estimado):`, s2.kg);
        if (kg === null) return;
        await DB.guardar('residuos', { fecha: hoy(), tipo: 'SILOBOLSA', ubicacionId: s2.ubicacionId, cantidad: Number(kg) || 0, unidad: 'kg', descripcion: `${s2.nombre} (${s2.metros || '?'} m)`, estado: 'ALMACENADO' });
        return refrescar();
      }
      if (d.entregarResiduo) {
        const r = E.residuos.find((x) => x.id === d.entregarResiduo);
        const t = A.TIPOS_RESIDUO[r.tipo] || A.TIPOS_RESIDUO.OTRO;
        const destino = prompt(t.peligroso ? 'Operador habilitado que lo retiró:' : 'Destino (reciclador, programa o CAT):', r.destino || '');
        if (destino === null) return;
        const comprobante = prompt(t.peligroso ? 'N.º de manifiesto de transporte:' : 'N.º de comprobante o remito (opcional):', r.comprobante || '');
        if (comprobante === null) return;
        if (t.peligroso && !comprobante.trim() && !confirm('Es un residuo peligroso: sin manifiesto queda una alerta. ¿Marcarlo entregado igual?')) return;
        await DB.guardar('residuos', { ...r, estado: 'ENTREGADO', entregaFecha: hoy(), destino: destino.trim(), comprobante: comprobante.trim() });
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
      if (d.realizarLabor) { const l = E.labores.find((x) => x.id === d.realizarLabor); await DB.guardar('labores', { ...l, estado: 'REALIZADA' }); const rec = E.recetas.find((r) => r.id === l.recetaId); if (rec && rec.estado === 'EMITIDA') await DB.guardar('recetas', { ...rec, estado: 'APLICADA' }); return refrescar(); }
      if (d.borrarTc) { await DB.db.tiposCambio.delete(d.borrarTc); return refrescar(); }
      if (d.abrirModulo) { if (typeof window.openModule === 'function') window.openModule(d.abrirModulo); return; }
      if (d.editarEquipo && !root.querySelector('form[data-form="equipo"]')) { if (typeof window.openModule === 'function') window.openModule('Plan de equipamiento'); return; }
      if (d.editarEquipo) {
        const e = E.equipos.find((x) => x.id === d.editarEquipo);
        const form = root.querySelector('form[data-form="equipo"]');
        ['id', 'codigo', 'nombre', 'categoria', 'marca', 'modelo', 'anio', 'patente', 'costoHora', 'costosFijosAnuales', 'valor', 'valorResidual', 'vidaUtilAnios', 'fechaAlta', 'horometro', 'serviceCadaHoras', 'horasUltimoService', 'seguroVence', 'vtvVence', 'baja'].forEach((k) => { if (form.elements[k]) form.elements[k].value = e[k] ?? ''; });
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
      if (ev.target.matches('[data-cuenta-operacion]')) cuentaOperacion = ev.target.value;
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

  async function montar(el, pestaña, opciones = {}) {
    root = el;
    conjunto = CONJUNTOS[opciones.conjunto] ? opciones.conjunto : 'granos';
    if (pestaña) tab = pestaña;
    if (!CONJUNTOS[conjunto].includes(tab)) tab = CONJUNTOS[conjunto][0];
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
        ${kpi('orange', 'Stock de granos', tn(r.totalKg), (() => { const pp = preciosPizarra(); const valor = Object.entries(r.porGrano).reduce((sum, [g, kg]) => sum + (pp[g] ? kg / 1000 * pp[g] : 0), 0); return valor ? `a pizarra Rosario ≈ ${pesos(valor)} · ` : ''; })() + Object.entries(r.porGrano).filter(([, v]) => v).map(([k, v]) => `${A.CULTIVOS[k].nombre} ${tn(v)}`).join(' · ') || 'Sin stock')}
        ${kpi('cyan', 'Ocupación de almacenaje', pct(r.ocupacion), `${E.ubicaciones.length} silobolsa(s) y celda(s) · ${tn(r.capacidadKg)}`)}
        ${puedeTab('lpg') ? kpi('purple', 'LPG últimos 30 días', tn(r.kgMes), `${r.lpgMes.length} liquidación(es) · neto ${pesos(r.netoMes)}`) : ''}
        ${!puedeTab('lpg') ? '' : kpi('red', 'Retenciones últimos 30 días', pesos(r.retIvaMes + r.retGanMes), `IVA ${pesos(r.retIvaMes)} · Ganancias ${pesos(r.retGanMes)}${r.reintegroPendTotal ? ` · reintegro pendiente ${pesos(r.reintegroPendTotal)}` : ''}`)}
        ${kpi(r.lotesSinRenspa.length || r.renspaPorVencer.length ? 'red' : 'green', 'RENSPA', `${E.lotes.length - r.lotesSinRenspa.length}/${E.lotes.length}`, `lotes con RENSPA · ${r.renspaPorVencer.length} por vencer`)}
      </div>
      <div class="grid-2">
        <div class="card" style="grid-column:1/-1"><div class="card-header"><div class="card-title">📈 Mercado</div>${enlacesMercadoHtml()}</div>${pizarraHtml()}${cotizacionHtml({ nota: false }).replace(/<button[\s\S]*$/, '')}</div>
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

  // PampaIA (asistente-ia.js): calcula con el mismo estado y el mismo resumen que el tablero.
  async function instantaneaIA() { await cargar(); return { E, r: resumen(), hoy: hoy(), tipoCambio: tipoCambio() }; }

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
    for (const t of ['renspa', 'lotes', 'ubicaciones', 'movimientosGrano', 'sisaProductor', 'reglasSisa', 'reglasIibb', 'contratosArrendamiento', 'equipos', 'empleados', 'fitosanitarios', 'envases', 'mapasRinde', 'prescripciones', 'recetas', 'residuos', 'mantenimientos', 'cuentas', 'movimientosFondos', 'cheques', 'creditos']) await DB.guardarVarios(t, e[t] || []);
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

  window.PampaAgroUI = { montar, montarDashboard, hayDatos, instantaneaIA, aplicarPermisos, actualizarDatosExternos, cargarDatosEjemplo, irA, avisoEnVistaAnterior, panelSincronizacion, refrescar: () => (root ? refrescar() : null), abrirLpg: () => { tab = 'lpg'; lpgEditando = null; } };
})();
