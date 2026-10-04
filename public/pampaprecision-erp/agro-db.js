// Base local del núcleo agrícola de Precisión (IndexedDB vía Dexie). Fuente de verdad en web y escritorio:
// si hay servidor, cada alta o cambio se encola en la cola de sincronización existente (offline-db.js).
(function () {
  if (typeof Dexie === 'undefined') { console.error('agro-db: falta Dexie (vendor/dexie.min.js).'); return; }
  const db = new Dexie('PampaPrecisionAgro');
  db.version(1).stores({
    lotes: '&id, codigo, campo, renspaId',
    renspa: '&id, numero, campo, vence',
    lotesCampania: '&id, loteId, campania, tipo, cultivo, [loteId+campania+tipo]',
    ubicaciones: '&id, tipo, grano, campo',
    movimientosGrano: '&id, fecha, grano, ubicacionId, tipo, loteId, lpgId',
    lpg: '&id, fecha, grano, estadoSisa, campania, numero, coe, lpgOrigenId',
    retenciones: '&id, lpgId, regimen, fecha, certificado, provincia',
    reintegrosIva: '&id, lpgId, estado',
    comprobantesIva: '&id, fecha, lado, origen, origenId',
    reglasSisa: '&id, [grano+estado], vigenciaDesde, estadoRegla',
    reglasIibb: '&id, provincia, vigenciaDesde, estadoRegla',
    sisaProductor: '&id, cuit, estado, actualizado',
    contratosArrendamiento: '&id, campo, modalidad, vigenciaHasta',
    meta: '&clave',
  });
  // Versión 2: costos (compras, labores, ajustes de insumos, equipos, personal y tipo de cambio).
  db.version(2).stores({
    compras: '&id, fecha, tipo, insumo, loteId, proveedor',
    labores: '&id, fecha, loteId, campania, tipo, estado',
    ajustesInsumo: '&id, fecha, insumo',
    equipos: '&id, codigo',
    empleados: '&id, legajo, estado',
    tiposCambio: '&mes',
  });
  // Versión 3: ARCA (cartas de porte) y SENASA (registro de fitosanitarios y envases vacíos).
  db.version(3).stores({
    cpes: '&id, numero, fecha, estado, lpgId, tipo',
    fitosanitarios: '&id, nombre, registroSenasa',
    envases: '&id, fecha, producto, estado, origenLaborId',
  });
  // Versión 4: marcas de borrado, para que un borrado viaje a los otros equipos al sincronizar.
  db.version(4).stores({ borrados: '&id, tabla, rowId, borradoEn' });
  // Versión 5: mapas de rinde (puntos del monitor de cosecha) y prescripciones variables (PampaIA Premium).
  db.version(5).stores({ mapasRinde: '&id, loteId, campania, fecha', prescripciones: '&id, mapaId, loteId, fecha' });
  // Versión 6: recetas agronómicas y residuos agrícolas (silobolsas, plásticos y peligrosos).
  db.version(6).stores({ recetas: '&id, numero, fecha, loteId, estado', residuos: '&id, fecha, tipo, estado, ubicacionId' });
  // Versión 7: mantenimiento de equipos y finanzas (cuentas, movimientos de fondos, cheques y créditos).
  db.version(7).stores({ mantenimientos: '&id, equipoId, fecha, tipo, estado', cuentas: '&id, nombre, tipo', movimientosFondos: '&id, fecha, cuentaId, tipo, origen, origenId', cheques: '&id, numero, vencimiento, sentido, estado', creditos: '&id, entidad, fecha' });
  const TABLAS = db.tables.map((t) => t.name).filter((n) => n !== 'meta');

  const nuevoId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const dispositivo = (() => {
    try {
      let id = localStorage.getItem('pampa-agro-dispositivo');
      if (!id) { id = nuevoId(); localStorage.setItem('pampa-agro-dispositivo', id); }
      return id;
    } catch { return 'web'; }
  })();
  // Avisos de cambio (la sincronización por carpeta se dispara sola unos segundos después).
  const oyentes = new Set();
  const alCambiar = (fn) => { oyentes.add(fn); return () => oyentes.delete(fn); };
  const avisar = () => oyentes.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });
  const encolar = (tabla, fila, accion = 'UPSERT') => {
    try { window.offlineDB?.addPendingSync?.(`agro.${tabla}.${accion}`, fila); } catch (e) { /* sin cola: queda local */ }
    avisar();
  };
  const marcarBorrado = (tabla, rowId) => db.borrados.put({ id: `${tabla}|${rowId}`, tabla, rowId, borradoEn: new Date().toISOString() });

  async function guardar(tabla, fila) {
    const ahora = new Date().toISOString();
    const previa = fila.id ? await db[tabla].get(fila.id) : null;
    const r = { ...previa, ...fila, id: fila.id || nuevoId(), createdAt: previa?.createdAt || fila.createdAt || ahora, updatedAt: ahora };
    r.syncKey = r.syncKey || `${dispositivo}:${r.id}`;
    await db[tabla].put(r);
    encolar(tabla, r);
    return r;
  }
  async function guardarVarios(tabla, filas) {
    const out = [];
    for (const f of filas) out.push(await guardar(tabla, f));
    return out;
  }
  async function borrar(tabla, id) {
    const fila = await db[tabla].get(id);
    await db[tabla].delete(id);
    await marcarBorrado(tabla, id);
    if (fila) encolar(tabla, { id, syncKey: fila.syncKey }, 'DELETE');
  }
  const todo = (tabla) => db[tabla].toArray();
  async function todoElEstado() {
    const filas = await Promise.all(TABLAS.map((t) => db[t].toArray()));
    return Object.fromEntries(TABLAS.map((t, i) => [t, filas[i]]));
  }
  async function vaciar() { await Promise.all(TABLAS.map((t) => db[t].clear())); await db.meta.clear(); }
  const meta = { get: async (clave) => (await db.meta.get(clave))?.valor, set: (clave, valor) => db.meta.put({ clave, valor }) };

  // Guarda la LPG calculada con sus retenciones, reintegro, comprobantes de IVA y egresos de stock en una
  // sola transacción. salidas: [{ubicacionId, kg}] (desde qué silobolsas/celdas sale el grano).
  async function guardarLpg(lpg, salidas = []) {
    const c = lpg.calculo;
    const id = lpg.id || nuevoId();
    const ahora = new Date().toISOString();
    let guardada;
    await db.transaction('rw', [db.lpg, db.retenciones, db.reintegrosIva, db.comprobantesIva, db.movimientosGrano], async () => {
      // Al editar se rehacen sus registros derivados.
      await Promise.all([db.retenciones, db.reintegrosIva].map((t) => t.where('lpgId').equals(id).delete()));
      await db.comprobantesIva.where('origenId').equals(id).delete();
      await db.movimientosGrano.where('lpgId').equals(id).delete();
      guardada = { ...lpg, id, fecha: c.fecha, grano: c.grano, estadoSisa: c.estadoSisa, campania: c.campania, numero: lpg.numero || '', coe: lpg.coe || '', lpgOrigenId: lpg.lpgOrigenId || '', syncKey: lpg.syncKey || `${dispositivo}:${id}`, createdAt: lpg.createdAt || ahora, updatedAt: ahora };
      await db.lpg.put(guardada);
      for (const r of c.retenciones.filter((x) => x.importe)) {
        await db.retenciones.put({ id: `${id}-${r.regimen}`, lpgId: id, fecha: c.fecha, grano: c.grano, ...r, syncKey: `${guardada.syncKey}-${r.regimen}` });
      }
      if (c.reintegroIva) await db.reintegrosIva.put({ id: `${id}-reintegro`, lpgId: id, fecha: c.fecha, importe: c.reintegroIva, estado: lpg.reintegroCobrado ? 'COBRADO' : 'PENDIENTE', syncKey: `${guardada.syncKey}-reintegro` });
      const movsIva = window.PampaAgroCore.movimientosIvaDeLpg(guardada);
      for (const [i, m] of movsIva.entries()) await db.comprobantesIva.put({ ...m, id: `${id}-iva-${i}`, origenId: id, syncKey: `${guardada.syncKey}-iva-${i}` });
      // Egreso del stock (una nota de crédito devuelve el grano).
      const signo = c.signo || 1;
      for (const [i, s] of salidas.filter((x) => x.ubicacionId && Number(x.kg)).entries()) {
        await db.movimientosGrano.put({ id: `${id}-egreso-${i}`, fecha: c.fecha, grano: c.grano, ubicacionId: s.ubicacionId, tipo: signo < 0 ? 'AJUSTE' : 'EGRESO_VENTA', kg: signo < 0 ? Number(s.kg) : Number(s.kg), lpgId: id, detalle: `LPG ${guardada.numero || ''}`.trim(), syncKey: `${guardada.syncKey}-egreso-${i}` });
      }
    });
    encolar('lpg', guardada);
    return guardada;
  }
  async function borrarLpg(id) {
    await db.transaction('rw', [db.lpg, db.retenciones, db.reintegrosIva, db.comprobantesIva, db.movimientosGrano], async () => {
      await db.lpg.delete(id);
      await Promise.all([db.retenciones, db.reintegrosIva].map((t) => t.where('lpgId').equals(id).delete()));
      await db.comprobantesIva.where('origenId').equals(id).delete();
      await db.movimientosGrano.where('lpgId').equals(id).delete();
    });
    await marcarBorrado('lpg', id);
    encolar('lpg', { id }, 'DELETE');
  }

  // Compra con su crédito fiscal (responsable inscripto) en una transacción.
  async function guardarCompra(compra) {
    const condicion = (await meta.get('condicionIva')) || 'RI';
    const id = compra.id || nuevoId();
    const ahora = new Date().toISOString();
    let guardada;
    await db.transaction('rw', [db.compras, db.comprobantesIva], async () => {
      await db.comprobantesIva.where('origenId').equals(id).delete();
      const previa = await db.compras.get(id);
      guardada = { ...previa, ...compra, id, syncKey: compra.syncKey || previa?.syncKey || `${dispositivo}:${id}`, createdAt: previa?.createdAt || ahora, updatedAt: ahora };
      await db.compras.put(guardada);
      const movs = window.PampaAgroCore.movimientosIvaDeCompra(guardada, condicion);
      for (const [i, m] of movs.entries()) await db.comprobantesIva.put({ ...m, id: `${id}-iva-${i}`, origenId: id, syncKey: `${guardada.syncKey}-iva-${i}` });
    });
    encolar('compras', guardada);
    return guardada;
  }
  async function borrarCompra(id) {
    await db.transaction('rw', [db.compras, db.comprobantesIva], async () => {
      await db.compras.delete(id);
      await db.comprobantesIva.where('origenId').equals(id).delete();
    });
    await marcarBorrado('compras', id);
    encolar('compras', { id }, 'DELETE');
  }

  // Una sola vez: los equipos que Precisión tenía en localStorage (costo horario en USD) pasan a la base.
  async function migrarEquipos() {
    if (await meta.get('migradoEquipos')) return 0;
    let equipos = [];
    try { equipos = JSON.parse(localStorage.getItem('pampa-equipment') || '[]') || []; } catch { equipos = []; }
    let n = 0;
    for (const e of equipos) {
      if (!e?.code || (await db.equipos.where('codigo').equals(e.code).first())) continue;
      await guardar('equipos', { codigo: e.code, nombre: [e.code, e.brand, e.model].filter(Boolean).join(' '), costoHora: 0, costoHoraUsd: Number(e.hourlyCostUsd) || 0, valor: 0, valorResidual: 0, vidaUtilAnios: 0, fechaAlta: '', revisar: 'Costo horario cargado en USD en la versión anterior: pasalo a pesos.' });
      n++;
    }
    await meta.set('migradoEquipos', new Date().toISOString());
    return n;
  }

  // Una sola vez: los lotes y campos que Precisión tenía en localStorage pasan a la base.
  async function migrarDesdeLocalStorage() {
    await migrarEquipos();
    if (await meta.get('migradoLocalStorage')) return 0;
    let lotes = [];
    try { lotes = JSON.parse(localStorage.getItem('pampa-lot-details') || '[]') || []; } catch { lotes = []; }
    let n = 0;
    for (const l of lotes) {
      if (!l?.code) continue;
      const existe = await db.lotes.where('codigo').equals(l.code).first();
      if (existe) continue;
      await guardar('lotes', { codigo: l.code, campo: l.field || '', superficieHa: Number(l.surface) || 0, latitud: l.latitude ?? null, longitud: l.longitude ?? null, origen: 'localStorage' });
      n++;
    }
    await meta.set('migradoLocalStorage', new Date().toISOString());
    return n;
  }

  window.PampaAgroDB = { db, TABLAS, dispositivo, alCambiar, guardar, guardarVarios, borrar, todo, todoElEstado, vaciar, meta, guardarLpg, borrarLpg, guardarCompra, borrarCompra, migrarDesdeLocalStorage, nuevoId };
})();
