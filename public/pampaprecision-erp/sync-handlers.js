/**
 * Pampa Precision ERP - Sync Module Handlers
 * Handlers para configuración y gestión de sincronización
 */

/**
 * Cargar módulo de Conectividad
 */
async function loadConnectivityModule() {
  const moduleBody = document.querySelector('[data-view="Conectividad y sincronizacion"]')?.closest('section');
  if (!moduleBody) return;

  // Actualizar estado de red
  document.getElementById('syncNetworkState').textContent = navigator.onLine ? 'Online' : 'Offline';
  
  // Actualizar estado de sincronización
  const status = await syncManager.getStatus();
  document.getElementById('syncPendingCount').textContent = status.pendingUnsynced;
  document.getElementById('syncLastTime').textContent = status.lastSync ? new Date(status.lastSync).toLocaleTimeString('es-AR') : 'Nunca';
  document.getElementById('syncDbSize').textContent = status.databaseSize.mb + ' MB';

  // Actualizar estado de destinos
  const config = syncManager.getConfig();
  
  if (config.destination === 'local') {
    document.getElementById('syncLocalStatus').innerHTML = '<span class="pill green">✓ Configurado</span>';
    document.getElementById('syncConfigPill').innerHTML = '<span class="pill green">Local</span>';
  } else {
    document.getElementById('syncLocalStatus').innerHTML = '<span class="pill">Disponible</span>';
  }

  if (config.destination === 'drive') {
    document.getElementById('syncDriveStatus').innerHTML = '<span class="pill green">✓ Configurado</span>';
    document.getElementById('syncConfigPill').innerHTML = '<span class="pill green">Drive/WebDAV</span>';
  } else {
    document.getElementById('syncDriveStatus').innerHTML = '<span class="pill yellow">No configurado</span>';
  }

  if (config.destination === 'server') {
    document.getElementById('syncServerStatus').innerHTML = '<span class="pill green">✓ Configurado</span>';
    document.getElementById('syncConfigPill').innerHTML = '<span class="pill green">Servidor REST</span>';
  } else {
    document.getElementById('syncServerStatus').innerHTML = '<span class="pill yellow">No configurado</span>';
  }

  // Mostrar cola de cambios
  const queueEl = document.getElementById('syncQueueStatus');
  if (status.pendingUnsynced > 0) {
    queueEl.innerHTML = `
      <div class="job">
        <i class="status yellow"></i>
        <div>
          <strong>Cambios pendientes de sincronizar</strong>
          <span>${status.pendingUnsynced} registros en cola local</span>
        </div>
        <b>${Math.round(status.pendingUnsynced / 10)}%</b>
      </div>
    `;
  } else if (status.lastSync) {
    queueEl.innerHTML = `
      <div class="job">
        <i class="status"></i>
        <div>
          <strong>Todo sincronizado</strong>
          <span>Último sync: ${new Date(status.lastSync).toLocaleString('es-AR')}</span>
        </div>
        <b>✓</b>
      </div>
    `;
  } else {
    queueEl.innerHTML = '<i>Selecciona un destino y haz clic en "Sincronizar ahora"</i>';
  }

  // Listener para cambios de conexión
  window.removeEventListener('online', updateConnectivityStatus);
  window.removeEventListener('offline', updateConnectivityStatus);
  window.addEventListener('online', updateConnectivityStatus);
  window.addEventListener('offline', updateConnectivityStatus);
}

/**
 * Actualizar estado de conectividad
 */
function updateConnectivityStatus() {
  const state = navigator.onLine ? 'Online' : 'Offline';
  const pill = document.getElementById('syncStatusPill');
  if (pill) {
    pill.innerHTML = navigator.onLine ? '<span class="pill">Online</span>' : '<span class="pill yellow">Offline</span>';
  }
  loadConnectivityModule();
}

/**
 * Sincronizar cambios pendientes
 */
async function syncNow() {
  const config = syncManager.getConfig();
  
  if (!config.enabled || !config.destination) {
    showToast('⚠️ Debes configurar un destino de sincronización primero');
    return;
  }

  showToast('🔄 Sincronizando cambios...');
  
  try {
    const result = await syncManager.sync();
    if (result.success) {
      showToast(`✅ Sincronización completada: ${result.itemsSynced} cambios enviados`);
      loadConnectivityModule();
    } else {
      showToast(`⚠️ ${result.message || 'Error en la sincronización'}`);
    }
  } catch (error) {
    showToast(`❌ Error: ${error.message}`);
  }
}

/**
 * Handlers para acciones del módulo de Conectividad
 */
function registerConnectivityHandlers() {
  document.addEventListener('click', async (e) => {
    const label = e.target.dataset?.action;
    
    if (label === 'Sincronizar ahora') {
      syncNow();
    } else if (label === 'Configurar Carpeta Local') {
      openNewForm('Configurar Carpeta Local', [
        { id: 'localPath', label: 'Ruta local', placeholder: '/respaldos/pampa-erp', full: true }
      ], formData => {
        const path = formData.get('localPath');
        if (path) {
          syncManager.configureLocalSync(path);
          showToast('✅ Sincronización a carpeta local configurada');
          loadConnectivityModule();
        }
      });
    } else if (label === 'Configurar Drive WebDAV') {
      openNewForm('Configurar Drive / WebDAV', [
        { id: 'driveUrl', label: 'URL del servidor', placeholder: 'https://cloud.miempresa.local', full: true },
        { id: 'driveUsername', label: 'Usuario', placeholder: 'usuario@empresa' },
        { id: 'drivePassword', label: 'Contraseña', type: 'password', placeholder: '••••••' }
      ], formData => {
        const url = formData.get('driveUrl');
        const username = formData.get('driveUsername');
        const password = formData.get('drivePassword');
        if (url && username && password) {
          syncManager.configureDriveSync(url, username, password);
          showToast('✅ Sincronización a Drive configurada');
          loadConnectivityModule();
        }
      });
    } else if (label === 'Configurar Servidor Propio') {
      openNewForm('Configurar Servidor REST Propio', [
        { id: 'serverUrl', label: 'URL del servidor', placeholder: 'https://erp.miempresa.local', full: true },
        { id: 'apiKey', label: 'API Key', placeholder: 'sk_live_XXXXXXXXXXXXX', full: true }
      ], formData => {
        const url = formData.get('serverUrl');
        const apiKey = formData.get('apiKey');
        if (url && apiKey) {
          syncManager.configureServerSync(url, apiKey);
          showToast('✅ Sincronización a servidor propio configurada');
          loadConnectivityModule();
        }
      });
    }
  });
}

// Inicializar handlers cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', registerConnectivityHandlers);
} else {
  registerConnectivityHandlers();
}
