/* Pampa PBP - Dashboard (portada de la empresa y accesos rápidos, como en PampaAgro)
 * Usa helpers del script principal (api, toast, escapeHTML, money, num, go, loadBackend) y lo que
 * publican los otros módulos (window.pbpData, window.pbpAccountBalances, window.pbpCreditStatus).
 */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = v => escapeHTML(v ?? '');
  const pesos = n => money(Number(n) || 0);
  const todayISO = () => new Date().toLocaleDateString('sv-SE');
  const fmtDate = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
  const daysUntil = iso => Math.round((new Date(String(iso).slice(0, 10) + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
  const data = () => window.pbpData || {};
  const settings = () => data().settings || {};

  /* ---------- roles del sistema (rrhh.txt) y permisos por módulo ---------- */
  const ROLES_ALL = [['USR-DIR-GER', '👑 Director / gerencia'], ['USR-ADM-FAC', '🧾 Administración / facturación'], ['USR-QC-NUT', '🧪 Calidad y nutrición'], ['USR-LOG-DES', '🚚 Logística y despacho'], ['USR-OP-CON', '🖥️ Operador de consola'], ['USR-OP-MAN', '👷 Operario de planta']];
  const ROLES = ROLES_ALL;
  const OWNER = 'USR-DIR-GER';
  const DEFAULT_PERMISSIONS = {
    'USR-ADM-FAC': ['dashboard', 'production', 'inventory', 'supply', 'treasury', 'costs', 'hr', 'tender', 'reports', 'ai'],
    'USR-QC-NUT': ['dashboard', 'production', 'lots', 'recipes', 'quality', 'waste', 'reports', 'ai'],
    'USR-LOG-DES': ['dashboard', 'production', 'inventory', 'installations', 'lots', 'supply', 'reports'],
    'USR-OP-CON': ['dashboard', 'production', 'inventory', 'installations', 'equipment', 'quality', 'waste'],
    'USR-OP-MAN': ['dashboard', 'production', 'inventory', 'installations', 'equipment', 'waste']
  };
  const pages = () => [...document.querySelectorAll('.sidebar .nav-btn')].map(b => ({ page: b.dataset.page, label: b.querySelector('b').textContent }));
  const permissions = () => ({ ...DEFAULT_PERMISSIONS, ...(settings().rolePermissions || {}) });
  const roleName = code => (ROLES.find(r => r[0] === code) || [code, code])[1];
  let currentRole = (() => { try { return localStorage.getItem('pbp:role') || OWNER; } catch { return OWNER; } })();
  /* ---------- versión de la licencia (Básica / Profesional / Max): versiones.js ----------
   * Lo visible = módulos de la versión ∩ permisos del rol. Sin licencia: modo prueba con todo habilitado. */
  const V = window.PBP_VERSIONS;
  const license = () => settings().license || null;
  const policy = () => (V ? V.policyFor(license()) : null);
  const versionAllows = page => { const p = policy(); return !p || p.modules.includes(page); };
  const roleInVersion = code => { const p = policy(); return !p || p.roles.includes(code); };
  const deviceId = (() => { try { let id = localStorage.getItem('pbp:deviceId'); if (!id) { id = (crypto.randomUUID && crypto.randomUUID()) || `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; localStorage.setItem('pbp:deviceId', id); } return id; } catch { return 'sin-id'; } })();
  const deviceName = () => `${/Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : /Windows/i.test(navigator.userAgent) ? 'Windows' : /Mac/i.test(navigator.userAgent) ? 'Mac' : 'Equipo'} · ${deviceId.slice(-6)}`;
  // Ocupa un puesto del rol en este equipo (el servidor controla el cupo de la versión). Sin servidor no bloquea.
  async function claimSeat(role) {
    let res;
    try { res = await fetch('/api/seats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, role, device: deviceName() }), cache: 'no-store' }); } catch { return { offline: true }; }
    const body = await res.json().catch(() => ({}));
    if (body.offline) return { offline: true };
    if (!res.ok) throw new Error(body.error || 'No se pudo asignar el rol en este equipo');
    return body;
  }
  const allowed = page => page === 'home' || (versionAllows(page) && (currentRole === OWNER || (permissions()[currentRole] || []).includes(page)));

  // La navegación pasa por el control de versión y de permisos del rol activo en este equipo
  const baseGo = window.go;
  window.go = page => {
    if (page !== 'home' && !versionAllows(page)) { const tier = V && V.POLICIES[V.minimumTier(page)]; toast(`${V?.MODULE_NAMES[page] || 'Ese módulo'} está incluido en la versión ${tier ? tier.name : 'superior'}`); page = 'home'; }
    else if (!allowed(page)) { toast(`El rol ${roleName(currentRole).replace(/^\S+\s/, '')} no tiene acceso a ese módulo`); page = 'home'; }
    return baseGo(page);
  };
  function applyRole() {
    if (!roleInVersion(currentRole)) { currentRole = OWNER; try { localStorage.setItem('pbp:role', OWNER); } catch {} }
    const p = policy();
    document.querySelectorAll('.sidebar .nav-btn').forEach(b => {
      b.hidden = !allowed(b.dataset.page);
      // Modo prueba: cada módulo muestra la versión que lo incluye
      let badge = b.querySelector('.tier-badge');
      const tier = !p && V ? V.minimumTier(b.dataset.page) : null;
      if (tier && tier !== 'B') { if (!badge) { badge = document.createElement('span'); b.appendChild(badge); } badge.className = `tier-badge tier-${tier}`; badge.textContent = V.POLICIES[tier].name; }
      else if (badge) badge.remove();
    });
    const chip = el('planChip');
    if (chip) {
      const lic = license();
      chip.className = `badge ${p ? 'green' : lic ? 'red' : 'amber'}`;
      chip.textContent = p ? `Versión ${p.name}` : lic ? 'Licencia vencida' : 'Modo prueba';
      chip.title = p ? `${lic.customer}${lic.expiresAt ? ' · vence ' + fmtDate(lic.expiresAt) : ''}` : 'Sin licencia activa: se ven todos los módulos';
    }
    document.querySelectorAll('.sidebar nav').forEach(nav => { const title = nav.previousElementSibling; if (title && title.classList.contains('nav-title')) title.hidden = ![...nav.children].some(b => !b.hidden); });
    el('roleSelector').innerHTML = ROLES.filter(([code]) => roleInVersion(code)).map(([code, name]) => `<option value="${code}" ${code === currentRole ? 'selected' : ''}>${name}</option>`).join('');
    const active = document.querySelector('.page.active');
    if (active && !allowed(active.id.replace('page-', ''))) baseGo('home');
    document.dispatchEvent(new CustomEvent('pbp:role', { detail: currentRole }));
  }
  window.pbpAllowedPage = page => allowed(page);

  /* ---------- PIN del propietario (SHA-256 con sal; funciona también sin HTTPS) ---------- */
  function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text), K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const len = bytes.length, padded = new Uint8Array(((len + 9 + 63) >> 6) << 6); padded.set(bytes); padded[len] = 0x80;
    const view = new DataView(padded.buffer); view.setUint32(padded.length - 4, len * 8);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n)), W = new Uint32Array(64);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) { const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) { const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0, t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0; h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
    }
    return H.map(x => x.toString(16).padStart(8, '0')).join('');
  }
  let pinResolver = null;
  function askPin(mode, help) { // mode: 'verify' | 'create'
    el('pinTitle').textContent = mode === 'create' ? 'Crear PIN del propietario' : 'PIN del propietario';
    el('pinHelp').textContent = help;
    el('pinConfirmField').hidden = mode !== 'create';
    el('pinConfirm').required = mode === 'create';
    el('pinForm').dataset.mode = mode;
    el('pinForm').reset();
    el('pinDialog').showModal();
    setTimeout(() => el('pinInput').focus(), 50);
    return new Promise(resolve => { pinResolver = resolve; });
  }
  const closePin = value => { el('pinDialog').close(); if (pinResolver) { pinResolver(value); pinResolver = null; } };
  el('pinCancel').addEventListener('click', () => closePin(null));
  el('pinCancelX').addEventListener('click', () => closePin(null));
  el('pinDialog').addEventListener('cancel', e => { e.preventDefault(); closePin(null); });
  el('pinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pin = el('pinInput').value;
    if (!/^\d{4}$/.test(pin)) return toast('El PIN es de 4 dígitos');
    if (el('pinForm').dataset.mode === 'create') {
      if (pin !== el('pinConfirm').value) return toast('Los PIN no coinciden');
      const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      const value = { hash: sha256Hex(salt + pin), salt };
      try { await api('/api/settings/ownerPin', { method: 'PUT', body: JSON.stringify({ value }) }); settings().ownerPin = value; toast('PIN del propietario guardado'); closePin(true); } catch (error) { toast(error.message); }
      return;
    }
    const stored = settings().ownerPin;
    if (stored && sha256Hex(stored.salt + pin) === stored.hash) closePin(true);
    else { toast('PIN incorrecto'); el('pinInput').select(); }
  });
  // Acciones reservadas al propietario: piden el PIN si existe
  async function ownerCheck(reason) {
    if (!settings().ownerPin) return currentRole === OWNER || (await askPin('verify', reason)) === true;
    return (await askPin('verify', reason)) === true;
  }
  el('roleSelector').addEventListener('change', async e => {
    const target = e.target.value;
    if (target === currentRole) return;
    let ok;
    if (!settings().ownerPin) ok = target === OWNER || (await askPin('create', 'Antes de pasar a otro rol, cree el PIN de 4 dígitos del propietario: lo va a necesitar para volver a Director o cambiar de rol.')) === true;
    else ok = (await askPin('verify', `Cambiar al rol ${roleName(target).replace(/^\S+\s/, '')} requiere el PIN del propietario.`)) === true;
    if (!ok) { e.target.value = currentRole; return; }
    try { await claimSeat(target); } catch (error) { toast(error.message); e.target.value = currentRole; return; }
    currentRole = target;
    try { localStorage.setItem('pbp:role', target); } catch {}
    applyRole();
    toast(`Rol activo en este equipo: ${roleName(target).replace(/^\S+\s/, '')}`);
  });

  /* ---------- portada de la empresa ---------- */
  const fmtCuit = c => (/^\d{11}$/.test(c || '') ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
  function renderCompany() {
    const c = settings().company || {};
    el('portadaNombre').textContent = c.name || 'Pampa PBP';
    el('portadaSub').textContent = c.activity || 'Planta de alimento balanceado porcino';
    const items = [c.cuit && ['🧾', `CUIT ${fmtCuit(c.cuit)}`], (c.address || c.locality) && ['📍', [c.address, c.locality].filter(Boolean).join(', ')], c.phone && ['📞', c.phone], c.senasaNumber && ['🛡️', `SENASA ${c.senasaNumber}`]].filter(Boolean);
    el('portadaDatos').innerHTML = items.length ? items.map(([i, t]) => `<span>${i} <strong>${esc(t)}</strong></span>`).join('') : '<span>📊 <strong>Gestión integral</strong></span><span>🐖 <strong>Alimento balanceado porcino</strong></span><span>⚙️ <strong>Operación en tiempo real</strong></span>';
    el('portadaFecha').textContent = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  }
  el('editCompany').addEventListener('click', () => {
    const c = settings().company || {};
    const field = (k, label, extra = '') => `<div class="field"><label for="co-${k}">${label}</label><input id="co-${k}" value="${esc(c[k])}" ${extra}></div>`;
    openDialog('Datos de la empresa', `<form id="companyForm"><div class="form-grid">${field('name', 'Nombre de la empresa', 'required maxlength="120"')}${field('activity', 'Actividad', 'maxlength="160"')}${field('cuit', 'CUIT (11 dígitos, sin guiones)', 'pattern="\\d{11}" inputmode="numeric"')}${field('senasaNumber', 'N° de establecimiento SENASA', 'maxlength="40"')}${field('address', 'Dirección', 'maxlength="160"')}${field('locality', 'Localidad', 'maxlength="120"')}${field('phone', 'Teléfono', 'maxlength="40"')}${field('email', 'Email', 'type="email" maxlength="120"')}</div><div class="form-actions"><button type="button" class="ghost-btn" data-close-dialog="homeDialog">Cancelar</button><button type="submit" class="primary-btn">Guardar</button></div></form>`);
    el('companyForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const value = Object.fromEntries(['name', 'activity', 'cuit', 'senasaNumber', 'address', 'locality', 'phone', 'email'].map(k => [k, el(`co-${k}`).value.trim()]));
      try { const r = await api('/api/settings/company', { method: 'PUT', body: JSON.stringify({ value }) }); settings().company = value; renderCompany(); el('homeDialog').close(); toast(r.offline ? 'Guardado sin conexión: se sincroniza al volver la señal' : 'Datos de la empresa guardados'); } catch (error) { toast(error.message); }
    });
  });

  /* ---------- diálogo genérico ---------- */
  function openDialog(title, html) {
    el('homeDialogTitle').textContent = title;
    el('homeDialogBody').innerHTML = html;
    el('homeDialogBody').querySelectorAll('[data-close-dialog]').forEach(b => b.addEventListener('click', () => el('homeDialog').close()));
    if (!el('homeDialog').open) el('homeDialog').showModal();
  }

  /* ---------- alertas ---------- */
  function computeAlerts() {
    const d = data(), list = [], today = todayISO();
    const add = (level, title, detail, date, page) => list.push({ level, title, detail, date, page });
    for (const e of d.equipment || []) {
      if (e.status !== 'Operativo') add(e.status === 'Fuera de servicio' ? 'red' : 'amber', `${e.name}: ${e.status.toLowerCase()}`, `${e.area} · ${e.id}`, '', 'equipment');
      const days = e.nextMaintenance ? daysUntil(e.nextMaintenance) : 99;
      if (days <= 7) add(days < 0 ? 'red' : 'amber', `Mantenimiento ${days < 0 ? 'vencido' : 'próximo'}: ${e.name}`, `${e.area} · criticidad ${e.criticality}`, e.nextMaintenance, 'equipment');
    }
    for (const t of d.transactions || []) if (t.status === 'Pendiente' && t.dueDate) {
      const days = daysUntil(t.dueDate);
      if (days <= 7) add(days < 0 ? 'red' : 'amber', `${t.type === 'Ingreso' ? 'Cobro' : 'Pago'} ${days < 0 ? 'vencido' : 'por vencer'}: ${t.counterparty}`, `${pesos(t.amount)} · ${t.description || t.category}`, t.dueDate, 'treasury');
    }
    for (const c of d.cheques || []) {
      const open = c.direction === 'Recibido' ? ['En cartera', 'Depositado'] : ['Emitido', 'Entregado'];
      if (!open.includes(c.status)) continue;
      const days = daysUntil(c.dueDate);
      if (days <= 7) add(days < 0 ? 'red' : 'amber', `Cheque ${c.direction === 'Recibido' ? 'a cobrar' : 'a cubrir'} ${c.number} · ${c.counterparty}`, `${pesos(c.amount)} · ${c.bank}`, c.dueDate, 'treasury');
      if (c.status === 'Rechazado') add('red', `Cheque rechazado ${c.number}`, c.counterparty, c.dueDate, 'treasury');
    }
    if (window.pbpCreditStatus) for (const c of d.credits || []) {
      if (c.status === 'Cancelado') continue;
      const s = window.pbpCreditStatus(c);
      if (s.next && daysUntil(s.next.date) <= 7) add(daysUntil(s.next.date) < 0 ? 'red' : 'amber', `Cuota ${s.next.n} de ${c.number} (${c.entity})`, pesos(s.next.payment), s.next.date, 'treasury');
    }
    for (const e of d.employees || []) if (e.status !== 'Baja' && e.trainingDue) {
      const days = daysUntil(e.trainingDue);
      if (days <= 30) add(days < 0 ? 'red' : 'amber', `Capacitación ${days < 0 ? 'vencida' : 'por vencer'}: ${e.name}`, e.position, e.trainingDue, 'hr');
    }
    const trn = window.pbpTrainingSummary ? window.pbpTrainingSummary() : null;
    const missingTrn = trn ? trn.people.filter(p => p.emp.status === 'Activo' && p.pending.some(i => i.state === 'missing')) : [];
    if (missingTrn.length) add('blue', `${missingTrn.length} persona${missingTrn.length === 1 ? '' : 's'} con capacitaciones obligatorias sin registrar`, missingTrn.map(p => `${p.emp.name} (${p.pending.filter(i => i.state === 'missing').map(i => i.topic.name).join(', ')})`).join(' · '), '', 'hr');
    const qs = window.pbpQualitySummary ? window.pbpQualitySummary() : null;
    const lastAudit = [...(d.qualityAudits || [])].sort((a, z) => z.date.localeCompare(a.date))[0];
    if (lastAudit && qs) { const s = qs.auditScore(lastAudit); if (s.ok < s.total) add('blue', `Auditoría de calidad: ${s.total - s.ok} controles pendientes`, (lastAudit.items || []).filter(x => !x.ok).map(x => x.text).join(', '), lastAudit.date, 'quality'); }
    if (qs) for (const c of d.qualityBatchControls || []) { if (daysUntil(c.date) < -7) continue; const e = qs.evalControl(c); if (!e.ok) add(e.pccOk ? 'amber' : 'red', `${e.pccOk ? 'Desvío de calidad' : 'Desvío en el PCC térmico'}: lote ${c.batchId}`, c.notes || 'Revisar controles de proceso', c.date, 'quality'); }
    // Telemetría del PLC: PCC térmico del acondicionador y amperaje del molino (últimas 24 h)
    const plc = qs && qs.plc ? qs.plc() : null;
    for (const p of plc?.parameters || []) {
      if (p.equipmentName === 'ACONDICIONADOR' && p.outCount) {
        const temp = p.parameterMeasured === 'TEMPERATURA', lo = p.lastOut;
        add(p.criticalCount ? 'red' : 'amber', `PCC térmico (PLC): ${p.outCount} lectura${p.outCount === 1 ? '' : 's'} de ${temp ? 'temperatura' : 'retención'} fuera de rango`, `Últimas 24 h · entre ${num(p.min, 1)} y ${num(p.max, 1)} ${temp ? '°C' : 's'}${lo?.batchId ? ` · lote ${lo.batchId}` : ''}`, lo ? lo.loggedAt.slice(0, 10) : '', 'quality');
      }
      if (p.equipmentName === 'MOLINO_MARTILLOS' && p.last && p.last.statusFlag !== 'OK') add(p.last.statusFlag === 'CRITICO' ? 'red' : 'amber', `Molino de martillos: amperaje ${p.last.statusFlag === 'CRITICO' ? 'crítico' : 'en alerta'}`, `Última lectura del PLC: ${num(+p.last.valueNumeric, 1)} A`, p.last.loggedAt.slice(0, 10), 'production');
    }
    const running = (d.batches || []).find(b => b.status === 'En proceso'), plcTemp = (plc?.parameters || []).find(p => p.equipmentName === 'ACONDICIONADOR' && p.parameterMeasured === 'TEMPERATURA');
    if (running && plcTemp && Date.now() - new Date(plcTemp.lastAt) > 30 * 60000) add('blue', 'PLC del acondicionador sin lecturas recientes', `Lote ${running.id} en proceso · última lectura ${new Date(plcTemp.lastAt).toLocaleString('es-AR')}`, '', 'quality');
    for (const a of d.labAnalyses || []) if (a.verdict === 'Rechazado' && daysUntil(a.date) >= -30) add('amber', `Materia prima rechazada: ${a.rawMaterial} (${a.supplierLot || a.supplier})`, a.notes || 'Fuera de límites de laboratorio', a.date, 'quality');
    const lastHom = [...(d.homogeneityTests || [])].sort((a, z) => z.date.localeCompare(a.date))[0];
    if (!lastHom || daysUntil(lastHom.date) < -30) add('blue', 'Ensayo mensual de homogeneidad pendiente', lastHom ? `Último ensayo: ${fmtDate(lastHom.date)}` : 'Sin ensayos registrados', '', 'quality');
    // Residuos: envases sin lavar, residuos peligrosos acumulados y certificados pendientes
    const unwashed = (d.wasteContainers || []).filter(c => c.status === 'Pendiente triple lavado');
    if (unwashed.length) add('amber', `${unwashed.reduce((s, c) => s + c.quantity, 0)} envases pendientes de triple lavado`, unwashed.map(c => c.product).join(', '), unwashed.map(c => c.date).sort()[0], 'waste');
    for (const r of d.wasteOther || []) if (r.disposition === 'Almacenamiento transitorio' && daysUntil(r.date) < -60) add('amber', `Residuo almacenado hace más de 60 días: ${r.type}`, `${num(r.quantity)} ${r.unit} · coordinar retiro con operador habilitado`, r.date, 'waste');
    const noCert = (d.wasteDeliveries || []).filter(x => !x.certificate);
    if (noCert.length) add('blue', `${noCert.length} entrega${noCert.length === 1 ? '' : 's'} de residuos sin certificado de disposición final`, noCert.map(x => x.receiver).join(', '), '', 'waste');
    // Inventario e instalaciones: stock crítico, agotado, silos llenos y limpiezas atrasadas
    const inv = window.pbpInventorySummary ? window.pbpInventorySummary() : null;
    if (inv) {
      for (const s of inv.items) if (s.level !== 'ok') add(s.level === 'out' ? 'red' : 'amber', `${s.level === 'out' ? 'Sin stock' : 'Stock crítico'}: ${s.item.name}`, `${num(s.stock, 1)} ${s.item.unit} · mínimo ${num(s.item.minStock)}${s.days !== null ? ` · alcanza para ${num(s.days, 1)} días` : ''}`, '', 'inventory');
      for (const x of inv.installations) {
        if (x.pct !== null && x.pct > 95) add(x.pct > 100 ? 'red' : 'amber', `${x.ins.code} ${x.pct > 100 ? 'excedida' : 'casi llena'} (${num(x.pct, 0)}%)`, `${x.ins.name} · ${num(x.used, 1)} de ${num(x.ins.capacity)} ${x.ins.unit}`, '', 'installations');
        if (x.ins.status !== 'Fuera de servicio' && (!x.ins.lastCleaning || inv.daysSince(x.ins.lastCleaning) > 60)) add('blue', `Limpieza pendiente: ${x.ins.code}`, x.ins.lastCleaning ? `Última limpieza hace ${inv.daysSince(x.ins.lastCleaning)} días` : 'Sin limpieza registrada', x.ins.lastCleaning || '', 'installations');
      }
    }
    for (const b of d.batches || []) if (b.status === 'Control') add('blue', `Lote ${b.id} en control de calidad`, `${b.phase} · ${num(+b.volume)} TM`, '', 'production');
    const order = { red: 0, amber: 1, blue: 2 };
    return list.filter(a => allowed(a.page)).sort((a, z) => order[a.level] - order[z.level] || String(a.date || '9').localeCompare(String(z.date || '9')));
  }
  window.pbpComputeAlerts = () => computeAlerts();
  const alertColor = { red: 'var(--red)', amber: 'var(--orange)', blue: 'var(--blue)' };
  const alertHtml = a => `<div class="alert" style="--alert:${alertColor[a.level]};cursor:pointer" data-alert-page="${a.page}"><b>${esc(a.title)}</b><time>${a.date ? fmtDate(a.date) : ''}</time><p>${esc(a.detail)}</p></div>`;
  function renderAlerts() {
    const alerts = computeAlerts(), urgent = alerts.filter(a => a.level !== 'blue').length;
    el('alertCount').hidden = !urgent; el('alertCount').textContent = urgent;
    el('homeAlerts').innerHTML = alerts.length ? alerts.slice(0, 6).map(alertHtml).join('') + (alerts.length > 6 ? `<p class="text-muted">y ${alerts.length - 6} alertas más.</p>` : '') : '<div class="alert" style="--alert:var(--ok)"><b>Sin alertas</b><time></time><p>Planta, finanzas y personal al día.</p></div>';
    return alerts;
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-alert-page]');
    if (a && (el('homeAlerts').contains(a) || el('homeDialogBody').contains(a))) { if (el('homeDialog').open) el('homeDialog').close(); window.go(a.dataset.alertPage); }
  });

  /* ---------- resumen ---------- */
  function renderSummary() {
    const d = data(), month = todayISO().slice(0, 7);
    const prod = window.pbpProductionTons ? window.pbpProductionTons(month) : { tons: Number((d.settings || {}).costTons?.[month]) || 0, source: 'manual' }, tons = prod.tons;
    const bal = window.pbpAccountBalances ? window.pbpAccountBalances(d) : null;
    const eq = d.equipment || [], operating = eq.filter(e => e.status === 'Operativo').length;
    const alerts = computeAlerts(), urgent = alerts.filter(a => a.level !== 'blue').length;
    const cards = [
      ['dashboard', 'var(--accent)', 'Producción del mes', tons ? `${num(tons)} TM` : '—', tons ? (prod.source === 'inventario' ? 'Producción terminada (Inventario)' : 'Carga manual en Costos') : 'Sin producción registrada'],
      ['treasury', 'var(--ok)', 'Saldo disponible', bal ? pesos(bal.cash + bal.banksArs) : '—', 'Caja y bancos'],
      ['equipment', 'var(--blue)', 'Equipos operativos', `${operating}/${eq.length}`, eq.length - operating ? `${eq.length - operating} ${eq.length - operating === 1 ? 'requiere' : 'requieren'} atención` : 'Todos operativos'],
      ['home', urgent ? 'var(--red)' : 'var(--ok)', 'Alertas', String(urgent), urgent ? 'Vencidas o próximas a vencer' : 'Sin urgencias']
    ].filter(([page]) => allowed(page));
    el('homeSummary').innerHTML = cards.map(([page, color, label, value, foot]) => `<article class="metric linkable" style="--metric-color:${color}" data-summary-page="${page}"><span class="metric-label">${label}</span><div class="metric-value">${esc(value)}</div><span class="metric-foot">${esc(foot)}</span></article>`).join('');
  }
  el('homeSummary').addEventListener('click', e => { const m = e.target.closest('[data-summary-page]'); if (!m) return; if (m.dataset.summaryPage === 'home') openAlerts(); else window.go(m.dataset.summaryPage); });

  /* ---------- accesos rápidos ---------- */
  function openAlerts() {
    const alerts = renderAlerts();
    const groups = [['red', 'Vencidas o críticas'], ['amber', 'Próximas a vencer'], ['blue', 'Para revisar']];
    openDialog(`Alertas (${alerts.length})`, alerts.length ? groups.map(([lvl, name]) => { const g = alerts.filter(a => a.level === lvl); return g.length ? `<div class="dialog-section"><h3>${name}</h3><div class="alert-list">${g.map(alertHtml).join('')}</div></div>` : ''; }).join('') : '<p class="text-muted">No hay alertas.</p>');
  }
  async function systemInfo() { const r = await fetch('/api/system', { cache: 'no-store' }); if (!r.ok) throw new Error('Servidor no disponible'); return r.json(); }
  const fmtSize = b => (b > 1048576 ? `${num(b / 1048576, 1)} MB` : `${num(b / 1024, 0)} KB`);
  async function openConnectivity() {
    const st = window.PampaOffline ? window.PampaOffline.status() : { online: navigator.onLine, pending: 0, failed: [] };
    let sys = null, tiles = 0, swActive = false;
    try { sys = await systemInfo(); } catch {}
    try { tiles = (await (await caches.open('pampa-pbp-tiles-v1')).keys()).length; } catch {}
    try { swActive = !!(navigator.serviceWorker && navigator.serviceWorker.controller); } catch {}
    const mep = sys?.mep || settings().mepRate;
    const total = sys ? Object.values(sys.counts).reduce((s, n) => s + n, 0) : 0;
    openDialog('Conectividad', `<div class="kv">
      <span>Servidor de la planta</span><b>${sys ? '🟢 En línea' : '🔴 No disponible (trabajando con los datos guardados en este equipo)'}</b>
      <span>Base de datos</span><b>${sys ? (sys.storage === 'sqlite' ? 'Archivo local SQLite' : '⚠️ Modo prueba en memoria (se pierde al cerrar)') : '—'}</b>
      ${sys?.dbFile ? `<span>Archivo</span><b>${esc(sys.dbFile)}</b>` : ''}
      ${sys ? `<span>Registros</span><b>${num(total)} en ${Object.keys(sys.counts).length} tablas</b><span>Último respaldo</span><b>${sys.backups[0] ? `${new Date(sys.backups[0].date).toLocaleString('es-AR')} (${sys.backups.length} guardados)` : 'Sin respaldos'}</b>` : ''}
      <span>Cambios sin sincronizar</span><b>${st.pending ? `🟠 ${st.pending}` : '🟢 Ninguno'}</b>
      ${st.failed?.length ? `<span>Rechazados por el servidor</span><b>🔴 ${st.failed.length}: ${st.failed.slice(-3).map(f => esc(f.error)).join(' · ')}</b>` : ''}
      <span>App sin conexión</span><b>${swActive ? '🟢 Disponible (instalada en este equipo)' : '🟠 Se activa al abrir por localhost o HTTPS'}</b>
      <span>Mapas offline</span><b>${tiles ? `${num(tiles)} imágenes guardadas` : 'Sin descargar'}</b>
      <span>Dólar MEP (DolarAPI)</span><b>${mep ? `${money(mep.venta)} · ${mep.fecha ? new Date(mep.fecha).toLocaleString('es-AR') : ''}` : 'Sin cotización'}</b>
    </div><div class="form-actions"><button class="ghost-btn" id="hcMaps">Descargar mapas offline</button>${st.failed?.length ? '<button class="ghost-btn" id="hcDiscard">Descartar rechazados</button>' : ''}<button class="primary-btn" id="hcSync" ${st.pending ? '' : 'disabled'}>Sincronizar ahora</button></div>`);
    el('hcMaps').addEventListener('click', () => { el('homeDialog').close(); window.go('lots'); setTimeout(() => el('downloadOfflineMaps')?.click(), 400); });
    el('hcSync').addEventListener('click', async () => { try { const n = await window.PampaOffline.flush(); toast(n ? `Sincronizados ${n} cambios` : 'No se pudo conectar con el servidor'); openConnectivity(); } catch (error) { toast(error.message); } });
    el('hcDiscard')?.addEventListener('click', () => { window.PampaOffline.discardFailed(); openConnectivity(); });
  }
  async function openBackup() {
    let sys;
    try { sys = await systemInfo(); } catch { return toast('Respaldo y limpieza necesitan conexión con el servidor de la planta'); }
    const sqlite = sys.storage === 'sqlite';
    openDialog('Limpieza + Respaldo', `<div class="dialog-section" style="margin-top:0"><h3>Copias de seguridad</h3>
      ${sqlite ? `<p class="text-muted">Se hace una copia automática por día y se guardan las últimas 14 en <b>${esc(sys.backupsDir)}</b>. Para restaurar: cerrar la app y reemplazar el archivo de la base por la copia.</p>
      <div class="table-wrap"><table><thead><tr><th>Copia</th><th>Fecha</th><th>Tamaño</th><th></th></tr></thead><tbody>${sys.backups.map(b => `<tr><td>${esc(b.name)}</td><td>${new Date(b.date).toLocaleString('es-AR')}</td><td>${fmtSize(b.size)}</td><td><a class="ghost-btn" href="api/backups/${encodeURIComponent(b.name)}" download>Descargar</a></td></tr>`).join('') || '<tr><td colspan="4">Sin copias todavía</td></tr>'}</tbody></table></div>
      <div class="form-actions"><button class="primary-btn" id="hbNow">Crear respaldo ahora</button></div>` : '<p class="text-muted">⚠️ El servidor está en modo prueba (en memoria): no hay base para respaldar.</p>'}</div>
      <div class="dialog-section"><h3>Limpieza de datos de ejemplo</h3><p class="text-muted">La app arranca con datos de ejemplo para conocerla. Antes de empezar a usarla con datos reales, se pueden borrar: se hace un respaldo automático antes y no se tocan los registros cargados por ustedes.</p>
      <p><b>${num(sys.demoRecords)}</b> registros de ejemplo encontrados.</p><div class="form-actions"><button class="danger-btn" id="hbClean" ${sys.demoRecords ? '' : 'disabled'}>Eliminar datos de ejemplo</button></div></div>`);
    el('hbNow')?.addEventListener('click', async () => { try { const r = await fetch('/api/backup', { method: 'POST' }); const j = await r.json(); if (!r.ok) throw new Error(j.error); toast(`Respaldo creado: ${j.file}`); openBackup(); } catch (error) { toast(error.message); } });
    el('hbClean').addEventListener('click', async () => {
      if (!(await ownerCheck('Eliminar los datos de ejemplo requiere el PIN del propietario.'))) return;
      if (!confirm(`Se eliminarán ${sys.demoRecords} registros de ejemplo (lotes, equipos, movimientos, legajos, etc.). Antes se hace un respaldo. ¿Continuar?`)) return;
      try { const r = await fetch('/api/cleanup-demo', { method: 'POST' }); const j = await r.json(); if (!r.ok) throw new Error(j.error); el('homeDialog').close(); toast(`Datos de ejemplo eliminados (${Object.values(j.removed).reduce((s, n) => s + n, 0)} registros). Respaldo previo: ${j.backup || '—'}`); loadBackend(); } catch (error) { toast(error.message); }
    });
  }
  async function importFile(file) {
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { return toast('El archivo no es un JSON válido'); }
    const counts = ['batches', 'equipment', 'lots', 'recipes', 'transactions', 'costs', 'employees', 'bankAccounts', 'cheques', 'credits'].filter(k => Array.isArray(parsed[k]));
    if (!counts.length) return toast('El archivo no parece una exportación de Pampa PBP');
    if (!(await ownerCheck('Importar datos reemplaza la información actual y requiere el PIN del propietario.'))) return;
    if (!confirm(`Se reemplazarán los datos actuales por los del archivo${parsed.exportedAt ? ` exportado el ${new Date(parsed.exportedAt).toLocaleString('es-AR')}` : ''}. Antes se hace un respaldo automático. ¿Continuar?`)) return;
    try {
      const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: parsed }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      toast(`Datos importados (${Object.values(j.imported).reduce((s, n) => s + n, 0)} registros). Respaldo previo: ${j.backup || '—'}`);
      loadBackend();
    } catch (error) { toast(`No se importó nada: ${error.message}`); }
  }
  el('importFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });

  const QUICK = [
    ['production', '🏭 Lote de producción', 'Orden de fabricación', () => document.querySelector('#page-production .open-batch')?.click()],
    ['treasury', '💰 Cobro o pago', 'Tesorería', () => { document.querySelector('.subtab[data-subtab=tesoreria]')?.click(); document.querySelector('#page-treasury .open-tx')?.click(); }],
    ['treasury', '🏦 Movimiento de caja o banco', 'Finanzas operativo', () => { document.querySelector('.subtab[data-subtab=operativo]')?.click(); document.querySelector('[data-op-new=movement]')?.click(); }],
    ['treasury', '📥 Cheque por cobrar', 'Finanzas operativo', () => { document.querySelector('.subtab[data-subtab=operativo]')?.click(); document.querySelector('[data-op-new=chequeIn]')?.click(); }],
    ['treasury', '📤 Cheque por cubrir', 'Finanzas operativo', () => { document.querySelector('.subtab[data-subtab=operativo]')?.click(); document.querySelector('[data-op-new=chequeOut]')?.click(); }],
    ['treasury', '💳 Nuevo crédito', 'Finanzas operativo', () => { document.querySelector('.subtab[data-subtab=operativo]')?.click(); document.querySelector('[data-op-new=credit]')?.click(); }],
    ['costs', '📊 Registrar costo', 'Costos del período', () => document.querySelector('#page-costs .open-cost')?.click()],
    ['lots', '🌾 Lote agropecuario', 'Origen de la materia prima', () => document.querySelector('#page-lots .open-lot')?.click()],
    ['recipes', '🧪 Nueva receta', 'Formulación', () => document.querySelector('#page-recipes .open-recipe')?.click()],
    ['equipment', '⚙️ Registrar equipo', 'Equipamiento', () => document.querySelector('#page-equipment .open-equipment')?.click()],
    ['hr', '👥 Nuevo legajo', 'RRHH', () => document.querySelector('#page-hr .open-employee')?.click()],
    ['quality', '🌡️ Control de calidad de lote', 'Calidad y bioseguridad', () => window.pbpOpenQualityControl?.()],
    ['inventory', '🚛 Recepción de mercadería', 'Inventario', () => window.pbpOpenInventoryMovement?.({ type: 'Recepción' })],
    ['inventory', '📦 Despacho de alimento', 'Inventario', () => window.pbpOpenInventoryMovement?.({ type: 'Despacho', itemId: 'ITM-PT-ENG' })],
    ['waste', '♻️ Registrar residuo', 'Residuos y envases', () => window.pbpOpenWasteForm?.('other')],
    ['dashboard', '📟 Lectura de telemetría', 'Control de planta', () => setTimeout(() => el('telemetryInput')?.focus(), 300)]
  ];
  function openQuick() {
    const items = QUICK.map((q, i) => [q, i]).filter(([q]) => allowed(q[0]));
    openDialog('Nueva operación', `<div class="quick-grid">${items.map(([[, t, s], i]) => `<button data-quick="${i}">${t}<small>${s}</small></button>`).join('')}</div>`);
    el('homeDialogBody').querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => { const q = QUICK[+b.dataset.quick]; el('homeDialog').close(); window.go(q[0]); setTimeout(q[3], 120); }));
  }
  function openRoles() {
    const perms = permissions(), list = pages().filter(p => versionAllows(p.page)), emps = (data().employees || []).filter(e => e.status !== 'Baja');
    const isOwner = currentRole === OWNER, ROLES = ROLES_ALL.filter(([c]) => roleInVersion(c));
    openDialog('Roles y usuarios', `<p class="text-muted">Rol activo en este equipo: <b>${roleName(currentRole)}</b>. Los usuarios son las personas cargadas en RRHH con su rol del sistema. ${isOwner ? '' : 'Solo el propietario (Director / gerencia) modifica los permisos.'}</p>
      <div class="dialog-section"><h3>Permisos por módulo</h3><div class="table-wrap"><table class="perm-table"><thead><tr><th>Módulo</th>${ROLES.map(([c, n]) => `<th title="${esc(n)}">${n.split(' ')[0]}<br><small>${c.replace('USR-', '')}</small></th>`).join('')}</tr></thead><tbody>
      ${list.map(p => `<tr><td>${esc(p.label)}</td>${ROLES.map(([c]) => `<td><input type="checkbox" data-role="${c}" data-page="${p.page}" ${c === OWNER || p.page === 'home' || (perms[c] || []).includes(p.page) ? 'checked' : ''} ${c === OWNER || p.page === 'home' || !isOwner ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="dialog-section"><h3>Usuarios por rol</h3><div class="kv">${ROLES.map(([c, n]) => { const people = emps.filter(e => e.systemRole === c); return `<span>${n}</span><b>${people.length ? people.map(e => esc(e.name)).join(', ') : '<span class="text-muted">Sin personas asignadas</span>'}</b>`; }).join('')}</div></div>
      <div class="form-actions"><button class="ghost-btn" id="rlHr">Ir a RRHH</button><button class="ghost-btn" id="rlPin">${settings().ownerPin ? 'Cambiar PIN del propietario' : 'Crear PIN del propietario'}</button>${isOwner ? '<button class="primary-btn" id="rlSave">Guardar permisos</button>' : ''}</div>`);
    el('rlHr').addEventListener('click', () => { el('homeDialog').close(); window.go('hr'); });
    el('rlPin').addEventListener('click', async () => {
      if (settings().ownerPin && !(await askPin('verify', 'Ingrese el PIN actual para cambiarlo.'))) return;
      await askPin('create', 'Elija el nuevo PIN de 4 dígitos del propietario.');
      openRoles();
    });
    el('rlSave')?.addEventListener('click', async () => {
      if (settings().ownerPin && !(await askPin('verify', 'Guardar los permisos requiere el PIN del propietario.'))) return;
      const value = {};
      ROLES_ALL.filter(([c]) => c !== OWNER && roleInVersion(c)).forEach(([c]) => { value[c] = [...el('homeDialogBody').querySelectorAll(`input[data-role="${c}"]:checked`)].map(i => i.dataset.page).filter(p => p !== 'home'); });
      try { const r = await api('/api/settings/rolePermissions', { method: 'PUT', body: JSON.stringify({ value }) }); settings().rolePermissions = value; applyRole(); el('homeDialog').close(); toast(r.offline ? 'Guardado sin conexión: se sincroniza al volver la señal' : 'Permisos guardados'); } catch (error) { toast(error.message); }
    });
  }
  function openWhatsApp() {
    const contacts = settings().whatsappContacts || {}, company = (settings().company || {}).name || 'Pampa PBP';
    const message = role => {
      const alerts = computeAlerts().filter(a => (permissions()[role] || []).includes(a.page) || role === OWNER).filter(a => a.level !== 'blue').slice(0, 5);
      return `Hola, te escribo desde ${company.replace(/\.$/, '')}.${alerts.length ? `\nPendientes:\n${alerts.map(a => `• ${a.title}${a.date ? ` (${fmtDate(a.date)})` : ''}`).join('\n')}` : ''}`;
    };
    const first = ROLES[0][0];
    openDialog('WhatsApp por rol', `<form id="waForm"><div class="form-grid"><div class="field"><label for="waRole">Rol destinatario</label><select id="waRole">${ROLES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select></div><div class="field"><label for="waPhone">WhatsApp (con código de país)</label><input id="waPhone" inputmode="tel" placeholder="5493415551234" value="${esc(contacts[first] || '')}"></div>
      <div class="field full"><label for="waText">Mensaje</label><textarea id="waText" rows="7">${esc(message(first))}</textarea></div></div>
      <div class="form-actions"><button type="button" class="ghost-btn" id="waSave">Guardar contacto del rol</button><button type="submit" class="primary-btn">Abrir WhatsApp</button></div></form>`);
    el('waRole').addEventListener('change', () => { el('waPhone').value = contacts[el('waRole').value] || ''; el('waText').value = message(el('waRole').value); });
    el('waSave').addEventListener('click', async () => {
      const value = { ...contacts, [el('waRole').value]: el('waPhone').value.replace(/\D/g, '') };
      try { const r = await api('/api/settings/whatsappContacts', { method: 'PUT', body: JSON.stringify({ value }) }); settings().whatsappContacts = r.value || value; Object.assign(contacts, value); toast('Contacto guardado'); } catch (error) { toast(error.message); }
    });
    el('waForm').addEventListener('submit', e => {
      e.preventDefault();
      const phone = el('waPhone').value.replace(/\D/g, '');
      if (phone.length < 10) return toast('Ingrese el número con código de país y área, sin 0 ni 15 (ej. 5493415551234)');
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(el('waText').value)}`, '_blank', 'noopener,noreferrer');
    });
  }
  /* ---------- licencia, versiones y cupos por rol ---------- */
  function openLicense() {
    const lic = license(), p = policy(), isOwner = currentRole === OWNER;
    const status = p ? `<b>Versión ${p.name}</b> · ${esc(lic.customer)} · ${lic.expiresAt ? `vence el ${fmtDate(lic.expiresAt)}` : 'sin vencimiento'} · licencia ${esc(String(lic.licenseId || '').slice(0, 8))}`
      : lic ? `<b>La licencia de ${esc(lic.customer)} venció el ${fmtDate(lic.expiresAt)}.</b> La app sigue en modo prueba hasta activar una nueva.`
        : '<b>Modo prueba.</b> Sin licencia activa se ven todos los módulos; en el menú cada uno indica la versión que lo incluye.';
    const caps = pol => pol.roles.map(r => `${esc(V.ROLE_NAMES[r])}: ${pol.roleCaps[r] < 0 ? 'sin límite' : pol.roleCaps[r]}`).join('<br>');
    openDialog('Licencia y versiones', `<div class="status-strip" style="--status-color:${p ? 'var(--ok)' : 'var(--orange)'};margin-bottom:14px">${status}</div>
      <div class="dialog-section"><h3>Versiones de Pampa PBP</h3><div class="table-wrap"><table><thead><tr><th>Versión</th><th>Módulos</th><th>Roles y equipos por rol</th></tr></thead><tbody>
      ${V.ORDER.map(code => { const pol = V.POLICIES[code], prev = code === 'B' ? [] : V.POLICIES[V.ORDER[V.ORDER.indexOf(code) - 1]].modules; return `<tr${p && p.code === code ? ' style="background:rgba(16,185,129,.08)"' : ''}><td><b>${pol.name}</b>${p && p.code === code ? '<br><span class="badge green">Actual</span>' : ''}<br><small class="text-muted">${V.totalSeats(pol) < 0 ? 'equipos ilimitados' : V.totalSeats(pol) + ' equipos'}</small></td><td style="white-space:normal;min-width:220px"><small>${esc(pol.summary)}</small><br>${pol.modules.filter(m => !prev.includes(m)).map(m => `<span class="badge blue" style="margin:2px 2px 0 0">${esc(V.MODULE_NAMES[m])}</span>`).join('')}</td><td style="white-space:normal"><small>${caps(pol)}</small></td></tr>`; }).join('')}
      </tbody></table></div><p class="text-muted" style="font-size:12px">Cada usuario ve los módulos de la versión que además tenga habilitados su rol (Roles y usuarios).</p></div>
      ${p ? '<div class="dialog-section"><h3>Equipos por rol</h3><div id="licSeats"><p class="text-muted">Consultando…</p></div></div>' : ''}
      ${isOwner ? `<div class="dialog-section"><h3>${lic ? 'Cambiar licencia' : 'Activar licencia'}</h3><div class="field full"><label for="licToken">Licencia (texto que empieza con PAMPAN1.)</label><textarea id="licToken" rows="3" placeholder="PAMPAN1.…" style="width:100%;font-family:var(--font-mono);font-size:12px"></textarea></div>
        <div class="form-actions">${lic ? '<button class="ghost-btn" id="licRemove">Quitar licencia</button>' : ''}<button class="primary-btn" id="licActivate">Activar</button></div></div>` : '<p class="text-muted">Solo el propietario (Director / gerencia) activa o cambia la licencia.</p>'}`);
    if (p) loadSeats(p, isOwner);
    el('licActivate')?.addEventListener('click', async () => {
      const token = el('licToken').value.trim();
      if (!token) return toast('Pegue el texto de la licencia');
      if (settings().ownerPin && !(await askPin('verify', 'Activar la licencia requiere el PIN del propietario.'))) return;
      try {
        const res = await fetch('/api/license', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.offline) throw new Error(body.error || 'Se necesita conexión con el servidor de la planta para activar la licencia');
        settings().license = body.license; await claimSeat(currentRole).catch(() => {});
        applyRole(); el('homeDialog').close();
        toast(`Licencia activada: versión ${V.POLICIES[body.plan]?.name || ''}`);
        if (typeof loadBackend === 'function') loadBackend();
      } catch (error) { toast(error.message); }
    });
    el('licRemove')?.addEventListener('click', async () => {
      if (!confirm('¿Quitar la licencia de esta planta? La app vuelve al modo prueba.')) return;
      if (settings().ownerPin && !(await askPin('verify', 'Quitar la licencia requiere el PIN del propietario.'))) return;
      try { const res = await fetch('/api/license', { method: 'DELETE' }); if (!res.ok) throw new Error('No se pudo quitar la licencia'); settings().license = null; applyRole(); el('homeDialog').close(); toast('Licencia quitada'); } catch (error) { toast(error.message); }
    });
  }
  async function loadSeats(p, isOwner) {
    const box = el('licSeats'); if (!box) return;
    try {
      const res = await fetch('/api/seats', { cache: 'no-store' }), body = await res.json();
      if (!res.ok || body.offline) throw new Error();
      box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Rol</th><th>Cupo</th><th>Equipos</th></tr></thead><tbody>${p.roles.map(r => { const holders = Object.entries(body.seats?.[r] || {}), cap = p.roleCaps[r];
        return `<tr><td>${esc(V.ROLE_NAMES[r])}</td><td>${holders.length} de ${cap < 0 ? '∞' : cap}</td><td style="white-space:normal">${holders.map(([id, s]) => `<span class="badge ${id === deviceId ? 'green' : 'blue'}" style="margin:2px">${esc(s.device || id.slice(-6))}${id === deviceId ? ' (este equipo)' : ''} · ${fmtDate(String(s.lastSeen).slice(0, 10))}${isOwner && id !== deviceId ? ` <button class="ghost-btn" data-seat-free="${esc(r)}|${esc(id)}" style="padding:0 6px;font-size:10px;width:auto">Liberar</button>` : ''}</span>`).join('') || '<span class="text-muted">Libre</span>'}</td></tr>`; }).join('')}</tbody></table></div><p class="text-muted" style="font-size:12px">Un equipo ocupa el puesto del rol que tiene activo; se libera solo después de ${15} días sin uso.</p>`;
      box.querySelectorAll('[data-seat-free]').forEach(b => b.addEventListener('click', async () => {
        const [role, id] = b.dataset.seatFree.split('|');
        try { await fetch(`/api/seats/${encodeURIComponent(role)}/${encodeURIComponent(id)}`, { method: 'DELETE' }); loadSeats(p, isOwner); toast('Puesto liberado'); } catch { toast('No se pudo liberar el puesto'); }
      }));
    } catch { box.innerHTML = '<p class="text-muted">Sin conexión con el servidor de la planta.</p>'; }
  }
  el('planChip')?.addEventListener('click', () => { window.go('home'); openLicense(); });
  const ACTIONS = { license: openLicense, roles: openRoles, connectivity: openConnectivity, import: () => el('importFile').click(), export: () => el('exportBtn').click(), backup: openBackup, quick: openQuick, alerts: openAlerts, whatsapp: openWhatsApp };
  document.getElementById('page-home').addEventListener('click', e => { const b = e.target.closest('[data-home-action]'); if (b) ACTIONS[b.dataset.homeAction](); });

  /* ---------- estado de sincronización en el botón ---------- */
  function paintSync() {
    const st = window.PampaOffline ? window.PampaOffline.status() : { online: navigator.onLine, pending: 0 };
    el('syncDot').className = `sync-dot ${!st.online ? 'off' : st.pending ? 'pending' : 'ok'}`;
  }
  document.addEventListener('pbp:offline-status', paintSync);
  window.addEventListener('online', paintSync); window.addEventListener('offline', paintSync);

  function render() { renderCompany(); applyRole(); renderSummary(); renderAlerts(); paintSync(); }
  let seatChecked = false;
  document.addEventListener('pbp:bootstrap', () => {
    if (seatChecked || !policy()) return; seatChecked = true;
    claimSeat(currentRole).catch(error => toast(`${error.message}`));
  });
  document.addEventListener('pbp:bootstrap', () => setTimeout(render, 0));
  document.addEventListener('pbp:inventory', () => { renderSummary(); renderAlerts(); });
  document.addEventListener('pbp:plc', () => renderAlerts());
  render();
  // Página inicial: el dashboard (o la indicada en la dirección, si el rol la permite)
  const initial = location.hash.slice(1);
  if (!initial || !allowed(initial)) baseGo('home');
})();
