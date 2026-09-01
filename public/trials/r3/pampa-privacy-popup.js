/**
 * PAMPA Privacy Data Popup
 * Shared privacy notice component for all ERP apps
 * Stores acceptance in localStorage with key: 'pampa-privacy-accepted-${version}'
 */

(function() {
  const POPUP_KEY = 'pampa-privacy-accepted-2026-08-30';
  const POPUP_ID = 'pampa-privacy-modal';
  
  function createPrivacyPopup() {
    const existing = document.getElementById(POPUP_ID);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = POPUP_ID;
    modal.innerHTML = `
      <div class="pampa-privacy-backdrop">
        <div class="pampa-privacy-card">
          <div class="pampa-privacy-header">
            <h2>Privacidad y Protección de Datos</h2>
            <p class="pampa-privacy-subtitle">Información sobre el tratamiento de tus datos personales</p>
          </div>
          
          <div class="pampa-privacy-content">
            <p><strong>¿Qué datos recopilamos?</strong></p>
            <ul>
              <li>Información de tu empresa: razón social, CUIT, domicilio fiscal</li>
              <li>Datos operativos: campos, lotes, animales, maquinaria, movimientos</li>
              <li>Información financiera: ventas, costos, bancos, créditos (almacenada localmente)</li>
              <li>Credenciales: usuario, rol, permisos asignados</li>
              <li>Eventos de auditoría: acciones realizadas, cambios, sincronización</li>
            </ul>

            <p><strong>¿Cómo protegemos tus datos?</strong></p>
            <ul>
              <li><strong>Almacenamiento local:</strong> La mayoría de los datos se guardan en tu navegador/dispositivo, no en servidores remotos</li>
              <li><strong>Cifrado en tránsito:</strong> Si sincronizas, los datos viajan encriptados (HTTPS/TLS)</li>
              <li><strong>Sin servidor central obligatorio:</strong> Puedes usar Pampa ERP completamente offline</li>
              <li><strong>Acceso controlado:</strong> Solo los usuarios autenticados en tu dispositivo acceden a los datos</li>
              <li><strong>Respaldos locales:</strong> Tú controlas cuándo y dónde hacer respaldos</li>
            </ul>

            <p><strong>¿Qué datos podés exportar o compartir?</strong></p>
            <ul>
              <li>Reportes en CSV/JSON: totalmente bajo tu control</li>
              <li>Sincronización opcional: solo si configuras un servidor propio o aceptas sincronizar con Cloudflare</li>
              <li>Integración fiscal (ARCA/SENASA): solo los datos mínimos requeridos por ley</li>
            </ul>

            <p><strong>Derecho de acceso, rectificación y supresión</strong></p>
            <p>
              Todos tus datos personales en Pampa ERP están almacenados localmente en tu dispositivo.
              Puedes acceder, editar, exportar o eliminar cualquier dato en cualquier momento usando las opciones de Limpieza profunda o Descargar respaldo.
            </p>

            <p><strong>Contacto y privacidad</strong></p>
            <p>
              Para dudas sobre privacidad, escribí a: <strong>privacidad@pampania.com.ar</strong>
            </p>
          </div>

          <div class="pampa-privacy-actions">
            <button id="pampa-privacy-accept" class="pampa-btn-primary">
              ✓ Aceptar y continuar
            </button>
            <button id="pampa-privacy-decline" class="pampa-btn-secondary">
              Rechazar (se cerrará la app)
            </button>
          </div>

          <p class="pampa-privacy-footer">
            Al usar Pampa ERP aceptas esta política de privacidad.
            Última actualización: 30 de agosto de 2026.
          </p>
        </div>
      </div>

      <style>
        #${POPUP_ID} * {
          box-sizing: border-box;
        }

        #${POPUP_ID} {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
        }

        .pampa-privacy-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 9998;
        }

        .pampa-privacy-card {
          position: relative;
          z-index: 10000;
          background: white;
          border-radius: 12px;
          max-width: 600px;
          width: 100%;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }

        .pampa-privacy-header {
          padding: 24px;
          border-bottom: 1px solid #e5e7eb;
          background: linear-gradient(135deg, #174936 0%, #1f5a3e 100%);
          color: white;
        }

        .pampa-privacy-header h2 {
          margin: 0 0 8px 0;
          font-size: 24px;
          font-weight: 700;
        }

        .pampa-privacy-subtitle {
          margin: 0;
          font-size: 14px;
          opacity: 0.9;
        }

        .pampa-privacy-content {
          padding: 24px;
          font-size: 14px;
          line-height: 1.6;
          color: #1f2937;
        }

        .pampa-privacy-content p {
          margin: 16px 0 8px 0;
        }

        .pampa-privacy-content p strong {
          color: #174936;
          font-weight: 600;
        }

        .pampa-privacy-content ul {
          margin: 8px 0 0 0;
          padding-left: 20px;
        }

        .pampa-privacy-content li {
          margin: 6px 0;
        }

        .pampa-privacy-actions {
          display: flex;
          gap: 12px;
          padding: 20px 24px;
          border-top: 1px solid #e5e7eb;
          background: #f9fafb;
        }

        .pampa-btn-primary,
        .pampa-btn-secondary {
          flex: 1;
          padding: 12px 16px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .pampa-btn-primary {
          background: #174936;
          color: white;
        }

        .pampa-btn-primary:hover {
          background: #12372a;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(23, 73, 54, 0.3);
        }

        .pampa-btn-secondary {
          background: white;
          color: #1f2937;
          border: 1px solid #d1d5db;
        }

        .pampa-btn-secondary:hover {
          background: #f3f4f6;
          border-color: #9ca3af;
        }

        .pampa-privacy-footer {
          padding: 12px 24px;
          font-size: 12px;
          color: #6b7280;
          border-top: 1px solid #e5e7eb;
          margin: 0;
          text-align: center;
        }

        @media (max-width: 640px) {
          .pampa-privacy-card {
            max-height: 90vh;
          }

          .pampa-privacy-header {
            padding: 16px;
          }

          .pampa-privacy-header h2 {
            font-size: 20px;
          }

          .pampa-privacy-content {
            padding: 16px;
            font-size: 13px;
          }

          .pampa-privacy-actions {
            flex-direction: column;
          }
        }
      </style>
    `;

    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('pampa-privacy-accept').addEventListener('click', () => {
      localStorage.setItem(POPUP_KEY, JSON.stringify({ accepted: true, timestamp: new Date().toISOString() }));
      modal.remove();
    });

    document.getElementById('pampa-privacy-decline').addEventListener('click', () => {
      alert('Debes aceptar la política de privacidad para usar Pampa ERP.\nLa aplicación se cerrará.');
      window.close();
    });

    // Prevent closing by clicking backdrop
    document.querySelector('.pampa-privacy-backdrop').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        e.preventDefault();
      }
    });
  }

  /**
   * Show privacy popup if not yet accepted
   * Call this function when the app initializes
   */
  window.showPampaPrivacyPopup = function() {
    const accepted = localStorage.getItem(POPUP_KEY);
    if (!accepted) {
      createPrivacyPopup();
      return false; // Not yet accepted
    }
    return true; // Already accepted
  };

  /**
   * Reset privacy acceptance (for testing or re-showing)
   */
  window.resetPampaPrivacyPopup = function() {
    localStorage.removeItem(POPUP_KEY);
    createPrivacyPopup();
  };

  /**
   * Get privacy acceptance status
   */
  window.getPampaPrivacyStatus = function() {
    const record = localStorage.getItem(POPUP_KEY);
    if (!record) return { accepted: false };
    try {
      return JSON.parse(record);
    } catch {
      return { accepted: false };
    }
  };

  // Auto-show on page load if needed (optional, comment if you prefer manual call)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showPampaPrivacyPopup);
  } else {
    showPampaPrivacyPopup();
  }
})();
