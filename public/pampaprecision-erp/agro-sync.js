// Sincronización entre equipos y respaldo de Precisión (local-first).
//  - Carpeta compartida (la de Drive, Dropbox u OneDrive de la computadora, o una carpeta de red): cada
//    equipo escribe "pampa-precision-<equipo>.json" con su copia completa y lee la de los demás; se combinan
//    con PampaAgroCore.fusionarDatos (gana la versión más nueva; los borrados viajan como marcas).
//  - Sin carpeta (navegadores sin acceso a carpetas, celulares): exportar / importar el mismo archivo.
//  - Respaldo: la misma copia + los datos de localStorage de Precisión; restaurar combina, no pisa.
(function () {
  const A = window.PampaAgroCore;
  const DB = window.PampaAgroDB;
  if (!A || !DB) { console.error('agro-sync: faltan agro-core.js o agro-db.js.'); return; }
  const PREFIJO = 'pampa-precision-';
  const archivoPropio = () => `${PREFIJO}${DB.dispositivo}.json`;
  const notificar = (detalle) => window.dispatchEvent(new CustomEvent('pampa-agro-sync', { detail: detalle }));

  async function instantanea() {
    const e = await DB.todoElEstado();
    const tablas = {};
    DB.TABLAS.filter((t) => t !== 'borrados').forEach((t) => { tablas[t] = e[t] || []; });
    return { tipo: 'pampa-precision-sync', version: 1, dispositivo: DB.dispositivo, generado: new Date().toISOString(), tablas, borrados: (e.borrados || []).map(({ tabla, rowId, borradoEn }) => ({ tabla, rowId, borradoEn })), condicionIva: await DB.meta.get('condicionIva') };
  }

  // Reemplaza el contenido local por el resultado combinado (en una transacción).
  async function aplicar(resultado) {
    const tablas = DB.db.tables.filter((t) => t.name !== 'meta');
    await DB.db.transaction('rw', tablas, async () => {
      for (const [t, filas] of Object.entries(resultado.tablas)) {
        if (!DB.db[t] || t === 'borrados') continue;
        await DB.db[t].clear();
        if (filas.length) await DB.db[t].bulkPut(filas);
      }
      await DB.db.borrados.clear();
      if (resultado.borrados.length) await DB.db.borrados.bulkPut(resultado.borrados.map((b) => ({ ...b, id: `${b.tabla}|${b.rowId}` })));
    });
  }
  async function combinarCon(remotas) {
    let acum = await instantanea();
    let cambios = 0;
    for (const r of remotas) {
      if (r?.tipo !== 'pampa-precision-sync' && r?.tipo !== 'pampa-precision-respaldo') continue;
      const f = A.fusionarDatos(acum, r);
      cambios += f.cambios;
      acum = { ...acum, tablas: f.tablas, borrados: f.borrados };
      if (!(await DB.meta.get('condicionIva')) && r.condicionIva) await DB.meta.set('condicionIva', r.condicionIva);
    }
    if (cambios) await aplicar(acum);
    return { cambios };
  }

  // ---------- Carpeta compartida ----------
  const carpeta = () => DB.meta.get('carpetaSync');
  const soportaCarpeta = () => typeof window.showDirectoryPicker === 'function';
  async function permiso(h, interactivo) {
    const opt = { mode: 'readwrite' };
    if (typeof h.queryPermission !== 'function' || (await h.queryPermission(opt)) === 'granted') return true;
    if (!interactivo) return false;
    return (await h.requestPermission(opt)) === 'granted';
  }
  async function elegirCarpeta() {
    if (!soportaCarpeta()) throw new Error('Este navegador no permite elegir una carpeta. Usá Chrome o Edge en la computadora (o la app de escritorio), o sincronizá con Exportar / Importar archivo.');
    const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'pampa-precision-sync' });
    await DB.meta.set('carpetaSync', h);
    await DB.meta.set('carpetaSyncNombre', h.name);
    return sincronizar({ interactivo: true });
  }
  async function desconectarCarpeta() { await DB.meta.set('carpetaSync', null); await DB.meta.set('carpetaSyncNombre', ''); notificar(await estado()); }
  let enCurso = false;
  async function sincronizar({ interactivo = false } = {}) {
    const h = await carpeta();
    if (!h) return { estado: 'sin-carpeta' };
    if (enCurso) return { estado: 'en-curso' };
    if (!(await permiso(h, interactivo))) { const r = { estado: 'permiso', mensaje: 'Tocá "Sincronizar ahora" para volver a dar acceso a la carpeta.' }; notificar(r); return r; }
    enCurso = true;
    try {
      const remotas = [];
      const equipos = [];
      for await (const [nombre, entrada] of h.entries()) {
        if (entrada.kind !== 'file' || !nombre.startsWith(PREFIJO) || !nombre.endsWith('.json') || nombre === archivoPropio()) continue;
        try {
          const datos = JSON.parse(await (await entrada.getFile()).text());
          remotas.push(datos);
          equipos.push({ dispositivo: datos.dispositivo, generado: datos.generado });
        } catch (e) { console.warn('agro-sync: archivo ilegible', nombre, e); }
      }
      const { cambios } = await combinarCon(remotas);
      const archivo = await h.getFileHandle(archivoPropio(), { create: true });
      const w = await archivo.createWritable();
      await w.write(JSON.stringify(await instantanea()));
      await w.close();
      const r = { estado: 'ok', cambios, equipos, carpeta: h.name, cuando: new Date().toISOString() };
      await DB.meta.set('ultimaSync', r);
      notificar(r);
      return r;
    } catch (e) {
      const r = { estado: 'error', mensaje: e.message || String(e) };
      notificar(r);
      return r;
    } finally { enCurso = false; }
  }
  async function estado() {
    return { soportaCarpeta: soportaCarpeta(), carpeta: (await DB.meta.get('carpetaSyncNombre')) || '', conectada: Boolean(await carpeta()), ultima: (await DB.meta.get('ultimaSync')) || null, dispositivo: DB.dispositivo };
  }

  // ---------- Archivo (sin carpeta) y respaldo ----------
  const descargar = (nombre, texto) => {
    const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  async function exportarArchivo() { descargar(archivoPropio(), JSON.stringify(await instantanea())); }
  async function descargarRespaldo() {
    const snap = await instantanea();
    snap.tipo = 'pampa-precision-respaldo';
    snap.localStorage = Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('pampa-') || /^PampaPrecision/i.test(k)).map((k) => [k, localStorage.getItem(k)]));
    descargar(`pampa-precision-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(snap, null, 1));
    try { localStorage.setItem('pampa-last-sync', new Date().toLocaleString('es-AR')); localStorage.removeItem('pampa-backup-needed'); } catch (e) { /* sin espacio */ }
  }
  // Restaurar o importar: combina con lo que hay (no borra lo propio); localStorage solo completa lo que falta.
  async function importarArchivo(file) {
    const datos = JSON.parse(await file.text());
    if (!/^pampa-precision-(sync|respaldo)$/.test(String(datos?.tipo))) throw new Error('El archivo no es un respaldo ni una sincronización de Pampa Precisión.');
    const { cambios } = await combinarCon([datos]);
    let ls = 0;
    Object.entries(datos.localStorage || {}).forEach(([k, v]) => { if (localStorage.getItem(k) === null) { try { localStorage.setItem(k, v); ls++; } catch (e) { /* sin espacio */ } } });
    notificar({ estado: 'ok', cambios, importado: file.name, cuando: new Date().toISOString() });
    return { cambios, ls };
  }

  // ---------- Automática ----------
  let timer = null;
  const programar = (ms = 4000) => { clearTimeout(timer); timer = setTimeout(() => sincronizar().catch((e) => console.warn('agro-sync', e)), ms); };
  DB.alCambiar(() => programar());
  window.addEventListener('focus', () => programar(500));
  window.addEventListener('online', () => programar(500));
  setInterval(() => programar(0), 2 * 60 * 1000);
  setTimeout(() => programar(0), 3000);

  window.PampaAgroSync = { instantanea, sincronizar, elegirCarpeta, desconectarCarpeta, estado, exportarArchivo, descargarRespaldo, importarArchivo, soportaCarpeta };
})();
