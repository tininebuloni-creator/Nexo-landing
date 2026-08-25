(function () {
  const panelId = 'pampaiaPanel';
  const adapter = window.PampaIAAdapter || {};
  const getState = () => typeof adapter.getState === 'function' ? adapter.getState() : (window.state || {});
  const getRole = () => typeof adapter.getRole === 'function' ? adapter.getRole() : (window.currentRole || 'propietario');
  const money = (value) => Number(value || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const sum = (items, keys) => (Array.isArray(items) ? items : []).reduce((total, item) => {
    for (const key of keys) {
      const number = Number(String(item?.[key] ?? '').replace(/[^0-9,.-]/g, '').replace(',', '.'));
      if (Number.isFinite(number)) return total + number;
    }
    return total;
  }, 0);

  const isLandingTrialDemo = () => {
    try {
      const license = JSON.parse(localStorage.getItem('pampa-license-cache') || '{}').license;
      return license?.type === 'trial' && localStorage.getItem('pampa-precision-nexo-landing-trial') === 'true';
    } catch {
      return false;
    }
  };

  function mountTrialInputDemos(panel) {
    if (!isLandingTrialDemo() || panel.querySelector('#pampaIATrialInputDemos')) return;
    const demo = document.createElement('section');
    demo.id = 'pampaIATrialInputDemos';
    demo.style.cssText = 'position:relative;z-index:1;margin-top:14px;padding:14px;border:1px solid rgba(245,158,11,.35);border-radius:10px;background:rgba(245,158,11,.08);';
    demo.innerHTML = '<div style="font-size:10px;color:#fbbf24;letter-spacing:.9px;font-family:var(--font-mono);text-transform:uppercase">Demo del trial: voz y escaneo</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-top:10px"><article style="padding:12px;border-radius:8px;background:rgba(0,0,0,.16)"><strong style="color:#fff">🎙️ Carga por voz</strong><p style="margin:7px 0;color:#d6e5db;font-size:12px;line-height:1.45">Ejemplo: “Anotá 40 litros de gasoil en Lote Norte Maíz”.</p><button type="button" class="pampaia-btn" id="pampaIATrialVoiceDemo">▶ Procesar dictado de ejemplo</button><div id="pampaIATrialVoiceResult" style="margin-top:9px;color:#b8d1c2;font-size:12px"></div></article><article style="padding:12px;border-radius:8px;background:rgba(0,0,0,.16)"><strong style="color:#fff">📷 Escaneo de remito</strong><p style="margin:7px 0;color:#d6e5db;font-size:12px;line-height:1.45">Remito de fertilizante precargado para ver la extracción de datos.</p><button type="button" class="pampaia-btn" id="pampaIATrialScanDemo">Escanear remito de ejemplo</button><div id="pampaIATrialScanResult" style="margin-top:9px;color:#b8d1c2;font-size:12px"></div></article></div><p style="margin:11px 0 0;color:#9fc0ad;font-size:11px">Datos demostrativos del trial. El micrófono, la cámara y el OCR real siguen disponibles desde las acciones habituales de PampaIA.</p>';
    panel.appendChild(demo);
    demo.querySelector('#pampaIATrialVoiceDemo').addEventListener('click', () => {
      const log = { recordedAt: new Date().toISOString(), lot: 'Lote_Norte_Maiz', input: '40 litros de gasoil', category: 'Combustible', demo: true };
      localStorage.setItem('pampa-precision-trial-voice-demo', JSON.stringify(log));
      demo.querySelector('#pampaIATrialVoiceResult').innerHTML = '<strong style="color:#fff">Dictado interpretado</strong><br>Lote: Lote_Norte_Maiz · Insumo: gasoil · Cantidad: 40 L · Categoría: combustible.<br><small>Registro demostrativo guardado localmente.</small>';
    });
    demo.querySelector('#pampaIATrialScanDemo').addEventListener('click', () => {
      demo.querySelector('#pampaIATrialScanResult').innerHTML = '<strong style="color:#fff">Remito extraído</strong><table style="width:100%;margin-top:7px;border-collapse:collapse;font-size:11px"><tr><td>Proveedor</td><td><strong>Fertilizantes Centro</strong></td></tr><tr><td>Comprobante</td><td>REM-0008-00452</td></tr><tr><td>Producto</td><td>Urea granulada</td></tr><tr><td>Cantidad</td><td>8.750 kg</td></tr><tr><td>Importe</td><td>USD 6.920</td></tr></table><small>Resultado demostrativo: revisar antes de registrar en una operación real.</small>';
    });
  }

  function render(type) {
    const state = getState();
    const insights = document.querySelector('#pampaiaPanel #pampaiaInsights');
    const answer = document.querySelector('#pampaiaPanel #pampaIAAnswer');
    const role = document.querySelector('#pampaiaPanel #pampaiaRole');
    if (!insights || !answer) return;
    if (role) role.textContent = 'IA ' + String(getRole()).toUpperCase();
    const data = {
      campos: state.campos || [], lotes: state.lotes || [], hacienda: state.hacienda || [],
      inventario: state.inventario || [], maquinarias: state.maquinarias || state.equipos || [],
      mantenimiento: state.mantenimiento || [], caja: state.caja || [], bancos: state.bancos || [],
      costos: (state.costos || []).concat(state.costosOperativos || []),
      cobrar: state.chequesCobrar || [], pagar: state.chequesCubrir || []
    };
    const rows = [];
    if (type === 'finanzas') {
      const saldo = sum(data.caja, ['importe']) + sum(data.bancos, ['importe']);
      rows.push(['ok', 'Caja y bancos registrados: ' + money(saldo)]);
      rows.push(['warn', 'Por cobrar: ' + money(sum(data.cobrar, ['importe'])) + ' · Por pagar: ' + money(sum(data.pagar, ['importe']))]);
      rows.push(['warn', 'Costos registrados: ' + money(sum(data.costos, ['importe', 'costo', 'monto']))]);
      answer.innerHTML = '<strong>Análisis financiero</strong><br>Revisá saldos, compromisos y costos antes de tomar decisiones.';
    } else if (type === 'operacion') {
      rows.push(['ok', 'Campos: ' + data.campos.length + ' · Lotes: ' + data.lotes.length + ' · Hacienda: ' + data.hacienda.length]);
      rows.push([data.mantenimiento.length ? 'warn' : 'ok', data.mantenimiento.length ? 'Hay ' + data.mantenimiento.length + ' mantenimientos para revisar.' : 'No hay mantenimientos cargados.']);
      rows.push([data.inventario.length ? 'ok' : 'warn', data.inventario.length ? 'Inventario disponible para analizar reposición.' : 'No hay inventario cargado.']);
      answer.innerHTML = '<strong>Análisis operativo</strong><br>La prioridad combina producción, mantenimiento e inventario.';
    } else if (type === 'riesgos') {
      rows.push([data.mantenimiento.length ? 'risk' : 'ok', data.mantenimiento.length ? 'Revisar mantenimientos pendientes.' : 'Sin mantenimientos pendientes registrados.']);
      rows.push([data.inventario.length ? 'warn' : 'risk', data.inventario.length ? 'Validar stock crítico y reposición.' : 'Sin inventario para evaluar.']);
      rows.push([data.pagar.length ? 'warn' : 'ok', data.pagar.length ? 'Hay compromisos por pagar para controlar.' : 'Sin compromisos por pagar registrados.']);
      answer.innerHTML = '<strong>Mapa de riesgos</strong><br>Priorizá los puntos marcados antes de la próxima operación.';
    } else {
      rows.push(['ok', 'Empresa: ' + data.campos.length + ' campos, ' + data.lotes.length + ' lotes y ' + data.maquinarias.length + ' equipos.']);
      rows.push(['ok', 'Base de datos lista para análisis por área.']);
      rows.push([data.mantenimiento.length ? 'warn' : 'ok', data.mantenimiento.length ? 'Hay mantenimientos para revisar.' : 'Sin mantenimientos pendientes.']);
      answer.innerHTML = '<strong>Diagnóstico general</strong><br>Seleccioná un análisis o escribí una consulta para trabajar con los datos cargados.';
    }
    insights.innerHTML = rows.map(([level, text]) => '<div class="pampaia-insight"><span class="pampaia-dot ' + level + '"></span><span>' + text + '</span></div>').join('');
  }

  function mount() {
    if (document.getElementById(panelId)) return;
    const mountPoint = document.getElementById('pampaia-dashboard-mount');
    const dashboard = mountPoint?.closest('.view, main, .main') || document.querySelector('#mod-dashboard.view.active, #dashboard.view.active, #mod-dashboard');
    if (!dashboard) return;
    if (dashboard.id === 'mod-dashboard' && dashboard.classList.contains('active')) {
      document.querySelector('.main')?.classList.add('dashboard-compact');
    }
    const style = document.createElement('style');
    style.textContent = ".pampaia-panel{margin:0 0 18px;background:linear-gradient(135deg,#102a1d 0%,#123b27 55%,#0f5132 100%);border:1px solid rgba(245,158,11,.28);border-radius:14px;padding:18px;box-shadow:0 10px 28px rgba(0,0,0,.18);position:relative;overflow:hidden}.pampaia-panel:after{content:'✦';position:absolute;right:28px;top:-18px;font-size:150px;color:rgba(245,158,11,.06);pointer-events:none}.pampaia-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;position:relative;z-index:1}.pampaia-brand{display:flex;gap:12px;align-items:center}.pampaia-icon{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.35);font-size:22px}.pampaia-title{font-size:18px;font-weight:800;color:#fff}.pampaia-sub{font-size:11px;color:#b8d1c2;margin-top:3px}.pampaia-role{font-size:10px;color:#fbbf24;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.28);padding:5px 8px;border-radius:999px;font-family:var(--font-mono);text-transform:uppercase}.pampaia-grid{display:grid;grid-template-columns:1.15fr 1fr;gap:14px;margin-top:14px;position:relative;z-index:1}.pampaia-summary,.pampaia-chat{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px}.pampaia-label{font-size:10px;color:#9fc0ad;text-transform:uppercase;letter-spacing:.9px;font-family:var(--font-mono);margin-bottom:9px}.pampaia-insights{display:grid;gap:8px}.pampaia-insight{display:flex;gap:9px;align-items:flex-start;padding:9px;background:rgba(0,0,0,.12);border-radius:8px;font-size:12px;color:#e7f3ec}.pampaia-dot{width:7px;height:7px;border-radius:50%;margin-top:4px;flex:0 0 7px;background:#22c55e}.pampaia-dot.warn{background:#f59e0b}.pampaia-dot.risk{background:#ef4444}.pampaia-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.pampaia-btn{border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.07);color:#fff;border-radius:7px;padding:8px 10px;font-size:11px;font-weight:700;cursor:pointer}.pampaia-btn:hover{border-color:#f59e0b;color:#fbbf24}.pampaia-question{display:flex;gap:7px;margin-top:8px}.pampaia-question input{flex:1;min-width:0;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:7px;padding:9px 10px;font-size:11px;outline:none}.pampaia-question button{border:0;background:#f59e0b;color:#102a1d;border-radius:7px;padding:0 12px;font-weight:800;cursor:pointer}.pampaia-answer{margin-top:9px;padding:9px 10px;border-left:3px solid #f59e0b;background:rgba(245,158,11,.08);border-radius:0 7px 7px 0;color:#eaf5ee;font-size:11px;line-height:1.45;min-height:34px}.pampaia-foot{margin-top:9px;font-size:9px;color:#7fa38e}.pampaia-report-btn{float:right;margin-top:-3px;border:1px solid rgba(245,158,11,.3);background:transparent;color:#fbbf24;border-radius:6px;padding:5px 8px;font-size:10px;cursor:pointer}@media(max-width:900px){.pampaia-grid{grid-template-columns:1fr}.pampaia-head{flex-direction:column}}\n.pampaia-action-box{margin-top:16px;padding:16px;border:1px solid #dbe4ee;border-radius:12px;background:#f8fafc}\n.pampaia-action-box h4{margin:0 0 10px}\n.pampaia-action-row{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #e5e7eb;font-size:13px}\n.pampaia-action-row:last-child{border-bottom:0}\n.pampaia-badge{font-size:11px;padding:4px 8px;border-radius:999px;background:#e8f5e9;color:#216e39}\n.pampaia-execution{margin-top:14px;padding:12px;border-radius:10px;background:#ecfdf5;border:1px solid #bbf7d0;font-size:13px}\n.pampaia-permission{font-size:12px;color:#64748b;margin-top:8px}\n.pampaia-device-note{font-size:11px;color:#64748b;margin-top:5px}\n@media(max-width:700px){\n  .pampaia-input-tools .btn{min-height:44px;font-size:14px}\n}\n#pampaV10ConfigBtn{position:fixed;top:14px;right:14px;z-index:100000;border:0;border-radius:10px;padding:10px 14px;background:#166534;color:#fff;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.16)}\n#pampaV10Overlay{position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:99999;display:none;align-items:center;justify-content:center;padding:18px}\n#pampaV10Modal{width:min(760px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.25)}\n.pv10-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.pv10-tab{border:1px solid #cbd5e1;background:#fff;padding:8px 12px;border-radius:9px;cursor:pointer}.pv10-tab.active{background:#166534;color:#fff}\n.pv10-sec{display:none}.pv10-sec.active{display:block}.pv10-field{margin:10px 0}.pv10-field label{display:block;font-size:12px;font-weight:700;margin-bottom:5px}.pv10-field input,.pv10-field select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:9px}.pv10-status{margin-top:10px;padding:10px;border-radius:9px;background:#f8fafc;font-size:12px}.pv10-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}\n#pampaIAFullSection{display:none;position:fixed;inset:0;z-index:99980;background:#f8fafc;overflow:auto}\n.pia-wrap{max-width:1180px;margin:0 auto;padding:22px}\n.pia-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}\n.pia-title{font-size:25px;font-weight:800}.pia-sub{font-size:13px;color:#64748b;margin-top:3px}\n.pia-grid{display:grid;grid-template-columns:1.4fr .8fr;gap:16px}\n.pia-card{background:#fff;border:1px solid #dbe4ee;border-radius:15px;padding:16px;box-shadow:0 3px 14px rgba(15,23,42,.05)}\n.pia-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}\n.pia-chat{height:390px;overflow:auto;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px}\n.pia-msg{padding:10px 12px;border-radius:12px;margin:8px 0;max-width:88%;font-size:13px;line-height:1.45}\n.pia-user{background:#dcfce7;margin-left:auto}.pia-ai{background:#fff;border:1px solid #e2e8f0}\n.pia-input{display:flex;gap:8px;margin-top:10px}.pia-input input{flex:1;padding:12px;border:1px solid #cbd5e1;border-radius:10px}\n.pia-field{margin:9px 0}.pia-field label{display:block;font-size:12px;font-weight:700;margin-bottom:5px}\n.pia-drop{border:2px dashed #cbd5e1;border-radius:12px;padding:24px;text-align:center;color:#64748b;cursor:pointer}\n.pia-data{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}\n.pia-data div{border:1px solid #e2e8f0;border-radius:9px;padding:9px;font-size:12px;background:#f8fafc}\n.pia-data strong{display:block;font-size:10px;color:#64748b;text-transform:uppercase;margin-bottom:3px}\n.pia-history{max-height:230px;overflow:auto}\n.pia-history-item{padding:9px 0;border-bottom:1px solid #e2e8f0;font-size:12px}\n@media(max-width:800px){.pia-grid{grid-template-columns:1fr}.pia-wrap{padding:14px}.pia-chat{height:330px}.pia-data{grid-template-columns:1fr}.pia-title{font-size:21px}}";
    document.head.appendChild(style);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = "<section class=\"pampaia-panel\" id=\"pampaiaPanel\">\n          <div class=\"pampaia-head\">\n            <div class=\"pampaia-brand\">\n              <div class=\"pampaia-icon\">✦</div>\n              <div><div class=\"pampaia-title\">PampaIA</div><div class=\"pampaia-sub\">Inteligencia para administración y operación · conectada a los datos del ERP</div></div>\n            </div>\n            <div style=\"display:flex;align-items:center;gap:8px;flex-wrap:wrap\">\n              <button type=\"button\" class=\"btn\" onclick=\"pampaV10OpenConfig()\" style=\"font-size:12px;padding:7px 10px\">⚙️ Configurar PampaIA</button>\n              <div class=\"pampaia-role\" id=\"pampaiaRole\">IA GERENCIAL</div>\n            </div>\n          </div>\n          <div class=\"pampaia-grid\">\n            <div class=\"pampaia-summary\">\n              <div style=\"display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap\">\n                <div class=\"pampaia-label\">Análisis inteligente de hoy</div>\n              </div>\n              <div class=\"pampaia-insights\" id=\"pampaiaInsights\">\n                <div class=\"pampaia-insight\"><span class=\"pampaia-dot\"></span><span>Operación lista para analizar. PampaIA toma como base los registros cargados en el ERP.</span></div>\n                <div class=\"pampaia-insight\"><span class=\"pampaia-dot warn\"></span><span>Las recomendaciones se actualizan según el rol y los módulos habilitados.</span></div>\n                <div class=\"pampaia-insight\"><span class=\"pampaia-dot\"></span><span>Podés consultar finanzas, operación, maquinaria, inventario y productividad.</span></div>\n              </div>\n              <div class=\"pampaia-actions\">\n                <button class=\"pampaia-btn\" onclick=\"pampaIAAnalizar('empresa')\">🏢 Analizar empresa</button>\n                <button class=\"pampaia-btn\" onclick=\"pampaIAAnalizar('operacion')\">🚜 Analizar operación</button>\n                <button class=\"pampaia-btn\" onclick=\"pampaIAAnalizar('finanzas')\">💰 Analizar finanzas</button>\n                <button class=\"pampaia-btn\" onclick=\"pampaIAAnalizar('riesgos')\">⚠️ Detectar riesgos</button>\n              </div>\n            </div>\n            <div class=\"pampaia-chat\">\n              <div class=\"pampaia-label\">Consultá a PampaIA</div>\n              <div class=\"pampaia-question\">\n<div class=\"pampaia-input-tools\" style=\"display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;\">\n  <button type=\"button\" class=\"btn\" id=\"pampaIAMic\" onclick=\"pampaIAToggleVoice()\">🎤 Dictar</button>\n  <button type=\"button\" class=\"btn\" onclick=\"document.getElementById('pampaIAFile').click()\">📄 Cargar PDF / Factura</button>\n  <button type=\"button\" class=\"btn\" onclick=\"pampaIAOpenCamera()\">📷 Sacar foto</button>\n  <input id=\"pampaIAFile\" type=\"file\" accept=\".pdf,.png,.jpg,.jpeg\" style=\"display:none\" onchange=\"pampaIAProcessDocument(this.files[0])\">\n  <input id=\"pampaIACamera\" type=\"file\" accept=\"image/*\" capture=\"environment\" style=\"display:none\" onchange=\"pampaIAProcessDocument(this.files[0])\">\n  <input id=\"pampaIACameraDesktop\" type=\"file\" accept=\"image/*\" capture=\"environment\" style=\"display:none\" onchange=\"pampaIAProcessDocument(this.files[0])\">\n</div>\n<div id=\"pampaIAVoiceStatus\" style=\"font-size:12px;margin-top:6px;color:#64748b;\"></div>\n<input id=\"pampaIAQuestion\" placeholder=\"Ej.: ¿Dónde estoy gastando de más?\" onkeydown=\"if(event.key==='Enter') pampaIAResponder()\"><button onclick=\"pampaIAResponder()\">Consultar</button></div>\n              <div class=\"pampaia-answer\" id=\"pampaIAAnswer\">Elegí una consulta o escribí una pregunta. La respuesta respetará el rol activo.</div>\n              <div class=\"pampaia-foot\">✓ Funcional con los datos cargados en este ERP. Las respuestas actuales son análisis locales por reglas; la conexión a un modelo de IA permitirá lenguaje natural y predicción avanzada.</div>\n            </div>\n          </div>\n        </section>";
    const panel = wrapper.firstElementChild;
    const dashboardSummary = dashboard.querySelector('.dashboard-home-layout') || dashboard.querySelector('.dashboard-top + .dashboard-shortcuts') || dashboard.querySelector('.dashboard-top');
    if (dashboardSummary) dashboardSummary.insertAdjacentElement('afterend', panel);
    else dashboard.appendChild(panel);
    mountTrialInputDemos(panel);
    document.body.insertAdjacentHTML('beforeend', "<div id=\"pampaV10Overlay\" aria-hidden=\"true\"><div id=\"pampaV10Modal\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"pampaV10Title\">\n  <div style=\"display:flex;justify-content:space-between;align-items:center\"><div><h2 id=\"pampaV10Title\" style=\"margin:0\">Configuración de PampaIA</h2><small>Servicio y dispositivo</small></div><button type=\"button\" class=\"btn\" onclick=\"pampaV10CloseConfig()\" aria-label=\"Cerrar configuración\">X</button></div>\n  <div class=\"pv10-tabs\"><button type=\"button\" id=\"pv10tAI\" class=\"pv10-tab active\" onclick=\"pampaV10Tab('ai')\">PampaIA</button><button type=\"button\" id=\"pv10tDev\" class=\"pv10-tab\" onclick=\"pampaV10Tab('dev')\">Dispositivo</button></div>\n  <section id=\"pv10sAI\" class=\"pv10-sec active\"><h3>PampaIA</h3><div class=\"pv10-field\"><label for=\"pv10AIUrl\">Endpoint de IA</label><input id=\"pv10AIUrl\" placeholder=\"/api/ia\"></div><div class=\"pv10-field\"><label for=\"pv10AIMode\">Modo</label><select id=\"pv10AIMode\"><option value=\"server\">IA del servidor</option><option value=\"hybrid\">Híbrida: local + servidor</option></select></div><div class=\"pv10-actions\"><button type=\"button\" class=\"btn btn-primary\" onclick=\"pampaV10Save()\">Guardar</button><button type=\"button\" class=\"btn\" onclick=\"pampaV10TestAI()\">Probar IA</button></div><div id=\"pv10AIStatus\" class=\"pv10-status\">Sin probar.</div></section>\n  <section id=\"pv10sDev\" class=\"pv10-sec\"><h3>Dispositivo</h3><div class=\"pv10-field\"><label for=\"pv10DeviceId\">ID único</label><input id=\"pv10DeviceId\" readonly></div><div id=\"pv10DevStatus\" class=\"pv10-status\">-</div><button type=\"button\" class=\"btn\" onclick=\"pampaV10RefreshDevice()\">Actualizar estado</button></section>\n  <p style=\"font-size:11px;color:#64748b\">Las claves y permisos se administran exclusivamente en el backend.</p>\n</div></div>");
    panel.querySelectorAll('[data-pampaia]').forEach((button) => button.addEventListener('click', () => render(button.dataset.pampaia)));
    panel.querySelectorAll('.pampaia-btn').forEach((button) => {
      const text = button.textContent || '';
      const type = /finanzas/i.test(text) ? 'finanzas' : /operación/i.test(text) ? 'operacion' : /riesgos/i.test(text) ? 'riesgos' : 'empresa';
      button.addEventListener('click', () => render(type));
    });
    const input = panel.querySelector('#pampaIAQuestion');
    const submit = panel.querySelector('.pampaia-question button');
    const reply = () => {
      const question = input?.value.trim();
      if (!question) return;
      const answer = panel.querySelector('#pampaIAAnswer');
      answer.innerHTML = '<strong>Consulta registrada</strong><br>' + question + '<br><small>El análisis local usa los datos disponibles en este ERP.</small>';
      input.value = '';
    };
    submit?.addEventListener('click', reply);
    input?.addEventListener('keydown', (event) => { if (event.key === 'Enter') reply(); });
    render('empresa');
  }

  window.pampaIAAnalizar = render;
  window.pampaIAResponder = () => {
    const panel = document.getElementById(panelId);
    const input = panel?.querySelector('#pampaIAQuestion');
    const button = panel?.querySelector('.pampaia-question button');
    if (input && button) button.click();
  };
  window.pampaIAToggleVoice = () => {
    const panel = document.getElementById(panelId);
    const status = panel?.querySelector('#pampaIAVoiceStatus');
    const input = panel?.querySelector('#pampaIAQuestion');
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      if (status) status.textContent = 'El navegador no dispone de reconocimiento de voz.';
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'es-AR';
    recognition.interimResults = false;
    recognition.onresult = (event) => { if (input) input.value = event.results[0][0].transcript; if (status) status.textContent = 'Dictado listo. Podés consultar PampaIA.'; };
    recognition.onerror = () => { if (status) status.textContent = 'No se pudo tomar el dictado.'; };
    recognition.start();
  };
  window.pampaIAOpenCamera = async () => {
    const panel = document.getElementById(panelId);
    const answer = panel?.querySelector('#pampaIAAnswer');
    if (!navigator.mediaDevices?.getUserMedia) {
      panel?.querySelector('#pampaIACamera')?.click();
      return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'pampaIACameraModal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(15,23,42,.88);display:flex;align-items:center;justify-content:center;padding:18px;';
    overlay.innerHTML = '<div style="width:min(620px,100%);background:#fff;border-radius:12px;padding:16px"><strong style="display:block;margin-bottom:10px">Sacar foto para OCR</strong><video autoplay playsinline style="display:block;width:100%;max-height:60vh;object-fit:contain;background:#111;border-radius:8px"></video><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="btn" data-camera-cancel>Cancelar</button><button type="button" class="btn btn-primary" data-camera-capture>Capturar y analizar</button></div></div>';
    document.body.appendChild(overlay);
    const video = overlay.querySelector('video');
    let stream;
    const close = () => { stream?.getTracks().forEach((track) => track.stop()); overlay.remove(); };
    overlay.querySelector('[data-camera-cancel]').addEventListener('click', close);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream;
      overlay.querySelector('[data-camera-capture]').addEventListener('click', () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => { close(); if (blob) window.pampaIAProcessDocument(new File([blob], 'captura-camera.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', .9);
      });
    } catch (error) {
      close();
      if (answer) answer.innerHTML = '<strong>No se pudo abrir la cámara</strong><br><small>' + String(error.message || 'Permiso de cámara rechazado.') + '<br>Podés elegir una imagen desde el dispositivo.</small>';
      panel?.querySelector('#pampaIACamera')?.click();
    }
  };
  window.pampaIAProcessDocument = async (file) => {
    if (!file) return;
    const panel = document.getElementById(panelId);
    const answer = panel?.querySelector('#pampaIAAnswer');
    if (!answer) return;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      answer.innerHTML = '<strong>PDF recibido</strong><br><small>La extracción PDF todavía no está conectada al backend local. Usá una foto o imagen para OCR.</small>';
      return;
    }
    if (!file.type.startsWith('image/')) {
      answer.innerHTML = '<strong>Formato no compatible</strong><br><small>Seleccioná una foto JPG, PNG o WebP.</small>';
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      answer.innerHTML = '<strong>Archivo demasiado grande</strong><br><small>La imagen debe pesar menos de 15 MB.</small>';
      return;
    }
    answer.innerHTML = '<strong>Analizando documento...</strong><br><small>La imagen se envía al OCR del backend local para extraer proveedor, comprobante e importes.</small>';
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        reader.readAsDataURL(file);
      });
      const state = getState();
      const context = {
        inventario: (state.inventario || []).map((item) => ({ codigo: item.codigo, producto: item.producto, unidad: item.unidad })),
        lotes: (state.lotes || []).map((item) => ({ codigo: item.codigo, nombre: item.nombre })),
        maquinarias: (state.maquinarias || state.equipos || []).map((item) => ({ codigo: item.codigo, equipo: item.equipo || item.nombre }))
      };
      const response = await fetch('/api/ia/documento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagenBase64: base64, mimeType: file.type, contexto: context })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || 'El OCR no respondió.');
      const data = result.datos || {};
      answer.innerHTML = '<strong>Documento analizado</strong><br>' +
        'Proveedor: ' + (data.proveedor || 'Sin detectar') + '<br>' +
        'Comprobante: ' + (data.numero || 'Sin detectar') + '<br>' +
        'Fecha: ' + (data.fecha || 'Sin detectar') + '<br>' +
        'Total: ' + (data.total ?? 'Sin detectar') + '<br>' +
        '<small>Revisá los datos antes de registrarlos.</small>';
    } catch (error) {
      answer.innerHTML = '<strong>No se pudo analizar el documento</strong><br><small>' + String(error.message || error) + '</small>';
    }
  };
  const configStorageKey = 'pampaIA.services';
  const config = () => { try { return JSON.parse(localStorage.getItem(configStorageKey) || '{}'); } catch { return {}; } };
  const configElement = (id) => document.getElementById(id);
  window.pampaV10OpenConfig = () => {
    const overlay = configElement('pampaV10Overlay');
    if (!overlay) return;
    const current = config();
    configElement('pv10AIUrl').value = current.aiUrl || '/api/ia';
    configElement('pv10AIMode').value = current.aiMode || 'server';
    configElement('pv10DeviceId').value = current.deviceId || window.crypto?.randomUUID?.() || 'device-' + Date.now();
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    window.pampaV10RefreshDevice();
  };
  window.pampaV10CloseConfig = () => { const overlay = configElement('pampaV10Overlay'); if (overlay) { overlay.style.display = 'none'; overlay.setAttribute('aria-hidden', 'true'); } };
  window.pampaV10Tab = (tab) => ['ai', 'dev'].forEach((name) => {
    configElement('pv10s' + name.charAt(0).toUpperCase() + name.slice(1))?.classList.toggle('active', name === tab);
    configElement('pv10t' + name.charAt(0).toUpperCase() + name.slice(1))?.classList.toggle('active', name === tab);
  });
  window.pampaV10Save = () => {
    const current = config();
    localStorage.setItem(configStorageKey, JSON.stringify({ ...current, aiUrl: configElement('pv10AIUrl').value.trim() || '/api/ia', aiMode: configElement('pv10AIMode').value, deviceId: configElement('pv10DeviceId').value }));
    configElement('pv10AIStatus').textContent = 'Configuración guardada. Las claves permanecen en el backend.';
  };
  window.pampaV10TestAI = async () => {
    const status = configElement('pv10AIStatus');
    const endpoint = (configElement('pv10AIUrl').value.trim() || '/api/ia').replace(/\/$/, '');
    status.textContent = 'Probando el servicio...';
    try {
      const response = await fetch(endpoint + '/estado', { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      status.textContent = response.ok ? (result.configurada ? 'Servicio disponible y configurado.' : 'Servicio disponible, pero falta configurar la clave en el backend.') : 'El servicio respondió HTTP ' + response.status + '.';
    } catch { status.textContent = 'No se pudo conectar al servicio de IA.'; }
  };
  window.pampaV10RefreshDevice = () => { const status = configElement('pv10DevStatus'); if (status) status.textContent = navigator.onLine ? 'Online. Listo para usar el servicio local.' : 'Offline. Las operaciones se reintentarán al recuperar conexión.'; };
  window.PampaIA = { mount, render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.addEventListener('load', mount, { once: true });
}());
