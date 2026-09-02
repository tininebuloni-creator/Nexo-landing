(function () {
  'use strict';

  const appName = (document.title.split('|')[0] || 'Pampa ERP').trim();
  const noticeId = 'pampa-local-data-notice';
  const storageKey = `pampa-local-data-notice-${appName}-2026-09-01`;

  function showNotice() {
    if (document.getElementById(noticeId) || localStorage.getItem(storageKey)) return;

    const notice = document.createElement('aside');
    notice.id = noticeId;
    notice.setAttribute('role', 'dialog');
    notice.setAttribute('aria-label', 'Aviso sobre datos de la demo');
    notice.innerHTML = `
      <div class="pampa-local-data-card">
        <div>
          <strong>Datos de la demo</strong>
          <p>Los datos cargados aqui no se guardan. Tus datos quedan en tu campo y bajo tu control.</p>
        </div>
        <button type="button" aria-label="Cerrar aviso">Entendido</button>
      </div>
      <style>
        #${noticeId} { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: start center; padding: 18px; pointer-events: none; font-family: Inter, "Segoe UI", sans-serif; }
        .pampa-local-data-card { width: min(510px, 100%); display: flex; align-items: center; gap: 16px; padding: 14px 16px; border: 1px solid #60a5fa; border-radius: 8px; color: #eff6ff; background: #1d4ed8; box-shadow: 0 14px 32px rgba(15, 23, 42, .3); pointer-events: auto; }
        .pampa-local-data-card strong { display: block; font-size: 14px; }
        .pampa-local-data-card p { margin: 4px 0 0; font-size: 12px; line-height: 1.45; color: #dbeafe; }
        .pampa-local-data-card button { flex: 0 0 auto; border: 1px solid #bfdbfe; border-radius: 6px; padding: 8px 10px; color: #1e3a8a; background: #eff6ff; font-size: 12px; font-weight: 700; cursor: pointer; }
        @media (max-width: 520px) { .pampa-local-data-card { align-items: flex-start; gap: 10px; } .pampa-local-data-card button { padding: 7px 8px; } }
      </style>`;

    document.body.appendChild(notice);
    notice.querySelector('button').addEventListener('click', () => {
      localStorage.setItem(storageKey, 'seen');
      notice.remove();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showNotice, { once: true });
  else showNotice();
}());
