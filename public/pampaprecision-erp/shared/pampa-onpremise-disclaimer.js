/* Aviso comun para instalaciones Self-Hosted / On-Premise. No reemplaza el contrato firmado. */
(function () {
  'use strict';

  const VERSION = '2026-09-01';
  const KEY = `pampa-onpremise-accepted-${VERSION}`;
  const MODAL_ID = 'pampa-onpremise-disclaimer';

  function appName() {
    return document.title.split('|')[0].trim() || 'Pampa ERP';
  }

  function render() {
    if (document.getElementById(MODAL_ID) || localStorage.getItem(KEY)) return;
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.innerHTML = `
      <div class="pampa-onpremise-backdrop">
        <section class="pampa-onpremise-card" role="dialog" aria-modal="true" aria-labelledby="pampa-onpremise-title">
          <div class="pampa-onpremise-kicker">Instalación local · ${appName()}</div>
          <h2 id="pampa-onpremise-title">Aviso de uso Self-Hosted</h2>
          <p class="pampa-onpremise-intro">Esta aplicación funciona en los dispositivos y servidores administrados por el Licenciatario.</p>
          <div class="pampa-onpremise-notice">
            <p><strong>Custodia fiscal y sanitaria.</strong> El Licenciatario administra exclusivamente sus datos de ARCA, SENASA, financieros, productivos y personales. El Licenciante no accede ni controla la infraestructura local, sus copias de respaldo, usuarios, permisos o medidas de seguridad.</p>
            <p><strong>Instalación en dispositivos.</strong> La instalación fuera de tiendas oficiales y la habilitación de fuentes desconocidas, cuando corresponda, queda bajo autorización y riesgo del Licenciatario. Deben aplicarse controles de seguridad, antivirus, actualizaciones y políticas internas.</p>
            <p><strong>Validación profesional.</strong> Los cálculos fiscales, laborales, sanitarios y productivos son asistencia del sistema. El Licenciatario y sus asesores deben revisar y aprobar cada operación antes de presentarla, pagarla o ejecutarla.</p>
          </div>
          <label class="pampa-onpremise-check"><input type="checkbox" id="pampa-onpremise-accept-check"><span>Leí el aviso y acepto estas condiciones de uso local. Entiendo que no reemplaza el contrato ni la validación de profesionales.</span></label>
          <div class="pampa-onpremise-actions"><button type="button" id="pampa-onpremise-continue" disabled>Aceptar y continuar</button><button type="button" id="pampa-onpremise-exit">Salir</button></div>
          <small class="pampa-onpremise-foot">Versión ${VERSION} · Registrar esta aceptación no constituye asesoramiento legal.</small>
        </section>
      </div>
      <style>
        #${MODAL_ID} { position: fixed; inset: 0; z-index: 10000; font-family: Inter, "Segoe UI", sans-serif; }
        .pampa-onpremise-backdrop { position: absolute; inset: 0; display: grid; place-items: center; padding: 18px; overflow-y: auto; background: rgba(5, 9, 13, .82); }
        .pampa-onpremise-card { width: min(680px, 100%); padding: 26px; border: 1px solid #475569; border-radius: 10px; color: #e2e8f0; background: #1e2433; box-shadow: 0 24px 70px rgba(0,0,0,.4); }
        .pampa-onpremise-kicker { color: #fbbf24; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; }
        .pampa-onpremise-card h2 { margin: 8px 0; color: #fff; font-size: 25px; }
        .pampa-onpremise-intro { color: #cbd5e1; line-height: 1.5; }
        .pampa-onpremise-notice { max-height: 310px; overflow-y: auto; margin: 18px 0; padding: 14px 16px; border-left: 4px solid #f59e0b; color: #cbd5e1; background: #252b3b; line-height: 1.55; font-size: 13px; }
        .pampa-onpremise-notice p { margin: 0 0 14px; }
        .pampa-onpremise-notice p:last-child { margin-bottom: 0; }
        .pampa-onpremise-notice strong { color: #fff; }
        .pampa-onpremise-check { display: flex; gap: 10px; align-items: flex-start; color: #f8fafc; font-size: 13px; line-height: 1.45; cursor: pointer; }
        .pampa-onpremise-check input { width: 19px; height: 19px; flex: 0 0 19px; margin: 0; accent-color: #f59e0b; }
        .pampa-onpremise-actions { display: flex; gap: 10px; margin-top: 22px; }
        .pampa-onpremise-actions button { flex: 1; padding: 11px 14px; border: 1px solid #475569; border-radius: 7px; color: #e2e8f0; background: #252b3b; font-weight: 700; cursor: pointer; }
        .pampa-onpremise-actions button:first-child { border-color: #f59e0b; color: #17120a; background: #f59e0b; }
        .pampa-onpremise-actions button:first-child:disabled { border-color: #475569; color: #64748b; background: #334155; cursor: not-allowed; }
        .pampa-onpremise-foot { display: block; margin-top: 15px; color: #94a3b8; line-height: 1.4; }
        @media (max-width: 520px) { .pampa-onpremise-card { padding: 20px 16px; } .pampa-onpremise-card h2 { font-size: 21px; } .pampa-onpremise-actions { flex-direction: column; } }
      </style>`;
    document.body.appendChild(root);
    const check = root.querySelector('#pampa-onpremise-accept-check');
    const continueButton = root.querySelector('#pampa-onpremise-continue');
    check.addEventListener('change', () => { continueButton.disabled = !check.checked; });
    continueButton.addEventListener('click', () => {
      if (!check.checked) return;
      localStorage.setItem(KEY, JSON.stringify({ accepted: true, version: VERSION, acceptedAt: new Date().toISOString(), app: appName() }));
      root.remove();
    });
    root.querySelector('#pampa-onpremise-exit').addEventListener('click', () => {
      root.querySelector('.pampa-onpremise-intro').textContent = 'Debés aceptar el aviso para continuar usando la aplicación.';
      root.querySelector('.pampa-onpremise-notice').hidden = true;
      root.querySelector('.pampa-onpremise-check').hidden = true;
      continueButton.hidden = true;
      root.querySelector('#pampa-onpremise-exit').textContent = 'Cerrar';
    });
  }

  window.PampaOnPremiseDisclaimer = { show: render, version: VERSION };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
  else render();
}());
