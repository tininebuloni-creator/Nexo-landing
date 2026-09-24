(function () {
  const TRIAL_DAYS = 10;
  // Todas las demos viven en el mismo dominio y comparten localStorage: con una clave unica,
  // abrir PampaAgro hacia arrancar tambien el reloj de PampaGanaderia (y viceversa). Por eso la
  // clave lleva el id de la app (lo define pampa-web-trial-guard; si no esta, se toma la carpeta).
  const APP_ID = window.PAMPA_TRIAL_APP_ID || window.location.pathname.split('/').filter(Boolean)[0] || 'app';
  const INIT_KEY = `pampa_trial_init:${APP_ID}`;
  const PANEL_ID = 'pampaTrialControlPanel';
  const FILE_INPUT_ID = 'pampaTrialImportInput';

  function startOfDay(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function getTrialStart() {
    // Usamos localStorage (no sessionStorage) para que la fecha de inicio del trial
    // sobreviva a cerrar el navegador — si no, cada reapertura reiniciaba la cuenta de días.
    let start = localStorage.getItem(INIT_KEY);
    if (!start) {
      // Compatibilidad: si venía de una sesión vieja guardada en sessionStorage, la migramos.
      start = sessionStorage.getItem(INIT_KEY) || new Date().toISOString();
      localStorage.setItem(INIT_KEY, start);
    }
    return start;
  }

  function getDaysLeft(startValue) {
    const start = new Date(startValue || getTrialStart());
    if (Number.isNaN(start.getTime())) return 0;
    const elapsed = Math.floor((startOfDay(new Date()) - startOfDay(start)) / 86400000);
    return Math.max(0, TRIAL_DAYS - elapsed);
  }

  function downloadJson(fileName, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function clone(value) {
    try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
  }

  function getAppState() {
    if (window.PampaTrialProgressAdapter && typeof window.PampaTrialProgressAdapter.exportData === 'function') {
      return clone(window.PampaTrialProgressAdapter.exportData());
    }

    try {
      if (typeof buildExportSnapshot === 'function') {
        const snapshot = buildExportSnapshot();
        const payload = snapshot && snapshot.payload;
        if (payload && payload.payload && payload.payload.data) return clone(payload.payload.data);
        if (payload && payload.data) return clone(payload.data);
        return clone(payload || {});
      }
    } catch (error) {
      console.warn('[trial] No se pudo usar buildExportSnapshot:', error.message);
    }

    try {
      if (typeof state !== 'undefined' && state && typeof state === 'object') return clone(state);
    } catch (error) {}

    const local = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || /license|licencia|trial|token|key/i.test(key)) continue;
      try { local[key] = JSON.parse(localStorage.getItem(key)); }
      catch { local[key] = localStorage.getItem(key); }
    }
    return { localStorage: local };
  }

  async function refreshApp() {
    const calls = ['saveState', 'loadData', 'refresh', 'renderDashboard', 'renderAll', 'renderTables', 'renderEmpresa', 'actualizarDashboard'];
    for (const name of calls) {
      try {
        if (typeof window[name] === 'function') await window[name]();
      } catch (error) {}
    }
  }

  async function restoreAppState(data) {
    if (window.PampaTrialProgressAdapter && typeof window.PampaTrialProgressAdapter.importData === 'function') {
      await window.PampaTrialProgressAdapter.importData(data);
      await refreshApp();
      return;
    }

    let restored = false;
    try {
      if (typeof state !== 'undefined' && state && typeof state === 'object' && data && typeof data === 'object') {
        Object.keys(data).forEach((key) => { state[key] = data[key]; });
        restored = true;
      }
    } catch (error) {}

    if (!restored && data && data.localStorage && typeof data.localStorage === 'object') {
      Object.entries(data.localStorage).forEach(([key, value]) => {
        try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (error) {}
      });
      restored = true;
    }

    await refreshApp();
  }

  function setTrialBlocked(blocked) {
    document.body.classList.toggle('pampa-trial-expired', blocked);
    document.querySelectorAll('button,input,select,textarea,a').forEach((node) => {
      if (node.closest(`#${PANEL_ID}`)) return;
      if (blocked) {
        if (!node.hasAttribute('data-trial-prev-disabled')) node.setAttribute('data-trial-prev-disabled', node.disabled ? '1' : '0');
        if (node.tagName === 'A') node.setAttribute('aria-disabled', 'true');
        else node.disabled = true;
      } else if (node.getAttribute('data-trial-prev-disabled') === '0') {
        node.disabled = false;
        node.removeAttribute('aria-disabled');
        node.removeAttribute('data-trial-prev-disabled');
      }
    });
  }

  function renderPanel(daysLeft) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.innerHTML = `
        <input id="${FILE_INPUT_ID}" type="file" accept=".json,application/json" style="display:none">
        <div class="pampa-trial-status" data-trial-status></div>
        <div class="pampa-trial-actions">
          <button type="button" data-trial-export>Guardar Progreso en mi PC</button>
          <button type="button" data-trial-import>Continuar Mi Prueba</button>
        </div>
      `;
      document.body.prepend(panel);
      panel.querySelector('[data-trial-export]').addEventListener('click', () => window.exportarProgresoTrial());
      panel.querySelector('[data-trial-import]').addEventListener('click', () => panel.querySelector(`#${FILE_INPUT_ID}`).click());
      panel.querySelector(`#${FILE_INPUT_ID}`).addEventListener('change', (event) => window.importarProgresoTrial(event.target.files && event.target.files[0]));
    }

    const expired = daysLeft <= 0;
    panel.classList.toggle('is-expired', expired);
    panel.querySelector('[data-trial-status]').innerHTML = expired
      ? '<strong>Prueba vencida:</strong> pasaron los 10 días. Podés guardar o importar tu respaldo local, pero la edición queda bloqueada.'
      : `<strong>Período de prueba activo:</strong> te quedan <strong>${daysLeft} día(s)</strong> de simulación local.`;
    setTrialBlocked(expired);
  }

  function injectStyles() {
    if (document.getElementById('pampaTrialControlStyles')) return;
    const style = document.createElement('style');
    style.id = 'pampaTrialControlStyles';
    style.textContent = `
      #${PANEL_ID}{position:sticky;top:0;z-index:9998;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#0056b3;color:#fff;border-bottom:1px solid rgba(255,255,255,.25);box-shadow:0 4px 14px rgba(0,0,0,.18);font-family:Arial,sans-serif;font-size:13px}
      #${PANEL_ID}.is-expired{background:#5b1f1f}
      #${PANEL_ID} .pampa-trial-actions{display:flex;gap:8px;flex-wrap:wrap}
      #${PANEL_ID} button{border:0;border-radius:6px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;color:#0f1419;background:#ffc107}
      #${PANEL_ID} [data-trial-export]{background:#28a745;color:#fff}
      body.pampa-trial-expired main,body.pampa-trial-expired .content{filter:saturate(.75)}
      @media (max-width:760px){#${PANEL_ID}{position:relative;align-items:stretch;flex-direction:column}.pampa-trial-actions button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  window.exportarProgresoTrial = function exportarProgresoTrial() {
    const start = getTrialStart();
    const payload = {
      tipo: 'pampa-trial-progress',
      schema_version: 1,
      fecha_inicio_trial: start,
      fecha_exportacion: new Date().toISOString(),
      dias_restantes: getDaysLeft(start),
      app: document.title || location.pathname,
      datos_usuario: getAppState()
    };
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`pampa_trial_progreso_${date}.json`, payload);
  };

  window.importarProgresoTrial = function importarProgresoTrial(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const payload = JSON.parse(event.target.result);
        if (!payload || payload.tipo !== 'pampa-trial-progress' || !payload.fecha_inicio_trial || !payload.datos_usuario) {
          alert('El archivo seleccionado no corresponde a un respaldo válido de trial Pampa.');
          return;
        }
        sessionStorage.setItem(INIT_KEY, payload.fecha_inicio_trial); // compat con versiones viejas
        localStorage.setItem(INIT_KEY, payload.fecha_inicio_trial);
        // Recalcula la licencia de trial con la fecha importada para que badge y cartel coincidan.
        if (typeof window.pampaWebTrialEnsure === 'function') window.pampaWebTrialEnsure();
        const daysLeft = getDaysLeft(payload.fecha_inicio_trial);
        await restoreAppState(payload.datos_usuario);
        renderPanel(daysLeft);
        alert(daysLeft > 0 ? 'Progreso de prueba importado correctamente.' : 'Progreso importado, pero el período de prueba ya venció.');
      } catch (error) {
        console.error('[trial] Error al importar progreso:', error);
        alert('No se pudo leer el respaldo. Verificá que sea el JSON correcto.');
      } finally {
        const input = document.getElementById(FILE_INPUT_ID);
        if (input) input.value = '';
      }
    };
    reader.readAsText(file);
  };

  window.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    renderPanel(getDaysLeft(getTrialStart()));
  });
}());
