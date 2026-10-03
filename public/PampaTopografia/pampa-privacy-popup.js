(function () {
  'use strict';

  const appName = (document.title.split('|')[0] || 'Pampa ERP').trim();
  const noticeId = 'pampa-local-data-notice';
  const storageKey = `pampa-local-data-notice-${appName}-2026-09-30`;

  function showNotice() {
    if (document.getElementById(noticeId) || localStorage.getItem(storageKey)) return;

    const notice = document.createElement('aside');
    notice.id = noticeId;
    notice.setAttribute('role', 'dialog');
    notice.setAttribute('aria-label', 'Aviso sobre privacidad de tus datos');
    notice.innerHTML = `
      <div class="pampa-local-data-card">
        <div>
          <strong>Tus datos, bajo tu control</strong>
          <p>Lo que cargás queda guardado en tu equipo. Nadie más tiene acceso a tus datos: no se envían a nuestros servidores.</p>
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

// Almacenamiento persistente: sin esto el navegador puede borrar los datos para liberar espacio
// (Safari en iPhone los borra si el sitio no se abre en 7 días, salvo que la app esté instalada).
(function () {
  'use strict';
  if (typeof navigator === 'undefined' || /Electron/i.test(navigator.userAgent || '')) return;
  const appName = (document.title.split('|')[0] || 'Pampa ERP').trim();
  const claveRecomendacion = `pampa-recomendar-instalar-${appName}`;
  const noticeId = 'pampa-install-notice';

  function instalada() {
    return Boolean((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
  }

  function leer(clave) {
    try { return localStorage.getItem(clave); } catch (e) { return null; }
  }
  function escribir(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (e) { /* sin almacenamiento */ }
  }

  function recomendarInstalar() {
    if (instalada() || document.getElementById(noticeId)) return;
    const ultima = Number(leer(claveRecomendacion) || 0);
    if (ultima && Date.now() - ultima < 30 * 86400000) return;
    const esIphone = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    const aviso = document.createElement('aside');
    aviso.id = noticeId;
    aviso.setAttribute('role', 'dialog');
    aviso.setAttribute('aria-label', 'Recomendación para no perder datos');
    aviso.innerHTML = `
      <div class="pampa-install-card">
        <div>
          <strong>Instalá la app en este equipo</strong>
          <p>Así el navegador no borra tus datos para liberar espacio. ${esIphone ? 'En iPhone: botón Compartir → "Agregar a inicio".' : 'En el celular: menú ⋮ → "Instalar app" o "Agregar a la pantalla de inicio". En la computadora: el ícono de instalar en la barra de direcciones.'} Igual, descargá un respaldo de vez en cuando.</p>
        </div>
        <button type="button" aria-label="Cerrar recomendación">Entendido</button>
      </div>
      <style>
        #${noticeId} { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999; display: grid; place-items: end center; padding: 14px; pointer-events: none; font-family: Inter, "Segoe UI", sans-serif; }
        .pampa-install-card { width: min(540px, 100%); display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: 1px solid #fbbf24; border-radius: 8px; color: #fffbeb; background: #92400e; box-shadow: 0 14px 32px rgba(15, 23, 42, .3); pointer-events: auto; }
        .pampa-install-card strong { display: block; font-size: 13px; }
        .pampa-install-card p { margin: 4px 0 0; font-size: 12px; line-height: 1.45; color: #fef3c7; }
        .pampa-install-card button { flex: 0 0 auto; border: 1px solid #fde68a; border-radius: 6px; padding: 7px 10px; color: #78350f; background: #fffbeb; font-size: 12px; font-weight: 700; cursor: pointer; }
      </style>`;
    document.body.appendChild(aviso);
    aviso.querySelector('button').addEventListener('click', () => {
      escribir(claveRecomendacion, String(Date.now()));
      aviso.remove();
    });
  }

  function pedirPersistencia() {
    const st = navigator.storage;
    if (!st || typeof st.persist !== 'function' || typeof st.persisted !== 'function') {
      recomendarInstalar();
      return;
    }
    st.persisted()
      .then((ya) => ya || st.persist())
      .then((ok) => { if (!ok) recomendarInstalar(); })
      .catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(pedirPersistencia, 1500), { once: true });
  else setTimeout(pedirPersistencia, 1500);
}());
