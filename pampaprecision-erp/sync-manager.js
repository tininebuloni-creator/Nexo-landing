/**
 * Pampa Precision ERP - Sync Manager
 * Sincroniza datos offline a: Carpeta local, Drive/WebDAV, o Servidor REST propio
 */

class SyncManager {
  constructor() {
    this.config = null;
    this.syncInterval = 2 * 60 * 1000; // 2 minutos
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.loadConfig();
  }

  /**
   * Cargar configuración de sincronización guardada
   */
  loadConfig() {
    try {
      const saved = localStorage.getItem('pampa-sync-config');
      this.config = saved ? JSON.parse(saved) : {
        enabled: false,
        destination: null, // 'local', 'drive', 'server'
        localPath: null,
        driveUrl: null,
        driveUsername: null,
        drivePassword: null,
        serverUrl: null,
        serverApiKey: null
      };
    } catch (err) {
      console.error('Error cargando config de sync:', err);
      this.config = { enabled: false, destination: null };
    }
  }

  /**
   * Guardar configuración
   */
  saveConfig(config) {
    try {
      this.config = { ...this.config, ...config };
      localStorage.setItem('pampa-sync-config', JSON.stringify(this.config));
      console.log('✅ Configuración de sincronización guardada:', this.config.destination);
      return true;
    } catch (err) {
      console.error('Error guardando config:', err);
      return false;
    }
  }

  /**
   * Configurar sincronización a carpeta local
   */
  configureLocalSync(path) {
    return this.saveConfig({
      destination: 'local',
      localPath: path,
      enabled: true
    });
  }

  /**
   * Configurar sincronización a Drive/WebDAV
   */
  configureDriveSync(url, username, password) {
    return this.saveConfig({
      destination: 'drive',
      driveUrl: url,
      driveUsername: username,
      drivePassword: password,
      enabled: true
    });
  }

  /**
   * Configurar sincronización a servidor REST propio
   */
  configureServerSync(serverUrl, apiKey) {
    return this.saveConfig({
      destination: 'server',
      serverUrl: serverUrl,
      serverApiKey: apiKey,
      enabled: true
    });
  }

  /**
   * Desabilitar sincronización
   */
  disableSync() {
    return this.saveConfig({ enabled: false, destination: null });
  }

  /**
   * Obtener configuración actual
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Sincronizar cambios pendientes
   */
  async sync() {
    if (!this.config.enabled || !this.config.destination) {
      console.log('⏸️ Sincronización deshabilitada');
      return { success: false, message: 'Sincronización no configurada' };
    }

    if (this.isSyncing) {
      console.log('⏳ Sincronización ya en progreso...');
      return { success: false, message: 'Sync en progreso' };
    }

    if (!navigator.onLine) {
      console.log('📵 Sin conexión - sincronización pospuesta');
      return { success: false, message: 'Sin conexión' };
    }

    this.isSyncing = true;

    try {
      const pendingItems = await offlineDB.getPendingSync();
      
      if (pendingItems.length === 0) {
        console.log('✅ Todo sincronizado, sin cambios pendientes');
        this.lastSyncTime = new Date();
        return { success: true, itemsSynced: 0, message: 'Sin cambios pendientes' };
      }

      console.log(`🔄 Sincronizando ${pendingItems.length} cambios a ${this.config.destination}...`);

      let syncedCount = 0;
      const errors = [];

      for (const item of pendingItems) {
        try {
          const result = await this.syncItem(item);
          if (result) {
            await offlineDB.markSynced(item.id);
            syncedCount++;
          } else {
            errors.push(`Error sincronizando item ${item.id}`);
          }
        } catch (err) {
          errors.push(`Item ${item.id}: ${err.message}`);
        }
      }

      // Limpiar items sincronizados
      await offlineDB.clearSyncedItems();

      // Guardar marca de último sync
      await offlineDB.setMetadata('lastSync', new Date().toISOString());
      this.lastSyncTime = new Date();

      const result = {
        success: errors.length === 0,
        itemsSynced: syncedCount,
        errors: errors,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Sincronización completada: ${syncedCount} items`, errors.length > 0 ? errors : '');
      return result;

    } catch (error) {
      console.error('❌ Error en sincronización:', error);
      return { success: false, error: error.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sincronizar un item individual
   */
  async syncItem(item) {
    switch (this.config.destination) {
      case 'local':
        return this.syncToLocal(item);
      case 'drive':
        return this.syncToDrive(item);
      case 'server':
        return this.syncToServer(item);
      default:
        throw new Error('Destino de sincronización no configurado');
    }
  }

  /**
   * Sincronizar a carpeta local
   */
  async syncToLocal(item) {
    try {
      // Simular descarga de archivo con datos
      const dataStr = JSON.stringify(item, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sync-${item.id}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      console.log(`💾 Item ${item.id} descargado a carpeta local`);
      return true;
    } catch (err) {
      console.error('Error en sincronización local:', err);
      return false;
    }
  }

  /**
   * Sincronizar a Drive/WebDAV
   */
  async syncToDrive(item) {
    try {
      const driveUrl = this.config.driveUrl;
      const auth = btoa(`${this.config.driveUsername}:${this.config.drivePassword}`);

      const response = await fetch(`${driveUrl}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        body: JSON.stringify({
          id: item.id,
          action: item.action,
          data: item.data,
          timestamp: item.timestamp
        })
      });

      if (!response.ok) {
        throw new Error(`Drive error: ${response.status}`);
      }

      const result = await response.json();
      console.log(`☁️ Item ${item.id} sincronizado a Drive`);
      return result.success || true;
    } catch (err) {
      console.error('Error sincronización Drive:', err);
      return false;
    }
  }

  /**
   * Sincronizar a servidor REST propio
   */
  async syncToServer(item) {
    try {
      const response = await fetch(`${this.config.serverUrl}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.serverApiKey
        },
        body: JSON.stringify({
          id: item.id,
          action: item.action,
          data: item.data,
          timestamp: item.timestamp
        })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const result = await response.json();
      console.log(`🔗 Item ${item.id} sincronizado al servidor`);
      return result.success || true;
    } catch (err) {
      console.error('Error sincronización servidor:', err);
      return false;
    }
  }

  /**
   * Obtener estado de sincronización
   */
  async getStatus() {
    const pendingItems = await offlineDB.getPendingSync();
    const metadata = await offlineDB.getMetadata('lastSync');
    const dbSize = await offlineDB.getSize();

    return {
      enabled: this.config.enabled,
      destination: this.config.destination,
      isSyncing: this.isSyncing,
      lastSync: metadata?.value,
      pendingChanges: pendingItems.length,
      pendingUnsynced: pendingItems.filter(p => !p.synced).length,
      databaseSize: dbSize,
      nextSyncIn: this.getNextSyncTime()
    };
  }

  /**
   * Obtener tiempo hasta próximo sync automático
   */
  getNextSyncTime() {
    if (!this.lastSyncTime) return 'Próximamente';
    const nextSync = new Date(this.lastSyncTime.getTime() + this.syncInterval);
    return nextSync.toLocaleTimeString('es-AR');
  }

  /**
   * Iniciar sincronización automática periódica
   */
  startAutoSync() {
    if (!this.config.enabled) return;

    // Sincronizar inmediatamente al conectar
    window.addEventListener('online', () => {
      console.log('🔌 Conexión restaurada - sincronizando...');
      this.sync().catch(console.error);
    });

    // Sincronizar periódicamente
    setInterval(() => {
      if (navigator.onLine && this.config.enabled) {
        this.sync().catch(console.error);
      }
    }, this.syncInterval);

    console.log('⚙️ Sincronización automática iniciada cada', this.syncInterval / 1000, 'segundos');
  }
}

// Instancia global
const syncManager = new SyncManager();

// Iniciar auto-sync si está configurado
if (syncManager.config.enabled) {
  syncManager.startAutoSync();
}
