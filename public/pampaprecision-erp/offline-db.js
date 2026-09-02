/**
 * Pampa Precision ERP - Offline Database Manager
 * Gestiona IndexedDB para almacenamiento offline de toda la aplicación
 * Estrategia: Cache-First, Network-Second, con sincronización automática
 */

class OfflineDatabase {
  constructor() {
    this.dbName = 'PampaPrecisionERP';
    this.version = 1;
    this.db = null;
    this.pendingSync = [];
    this.lastSync = null;
  }

  /**
   * Inicializar la base de datos
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ IndexedDB inicializado:', this.dbName);
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Object stores para caché de datos
        if (!db.objectStoreNames.contains('api-cache')) {
          db.createObjectStore('api-cache', { keyPath: 'endpoint' });
        }
        
        // Almacén para cambios pendientes (offline edits)
        if (!db.objectStoreNames.contains('pending-sync')) {
          db.createObjectStore('pending-sync', { keyPath: 'id', autoIncrement: true });
        }

        // Almacén de metadata (timestamps, estados)
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }

        console.log('📦 IndexedDB schema creado');
      };
    });
  }

  /**
   * Guardar respuesta de API en caché
   */
  async cacheResponse(endpoint, data) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['api-cache'], 'readwrite');
      const store = tx.objectStore('api-cache');

      const cacheEntry = {
        endpoint: endpoint,
        data: data,
        timestamp: new Date().toISOString()
      };

      const request = store.put(cacheEntry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(cacheEntry);
    });
  }

  /**
   * Obtener respuesta del caché
   */
  async getCachedResponse(endpoint) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['api-cache'], 'readonly');
      const store = tx.objectStore('api-cache');
      const request = store.get(endpoint);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  /**
   * Guardar cambio pendiente para sincronizar más tarde
   */
  async addPendingSync(action, data) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending-sync'], 'readwrite');
      const store = tx.objectStore('pending-sync');

      const pendingItem = {
        action: action,
        data: data,
        timestamp: new Date().toISOString(),
        synced: false
      };

      const request = store.add(pendingItem);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log('💾 Cambio pendiente guardado:', action, data);
        resolve(request.result);
      };
    });
  }

  /**
   * Obtener todos los cambios pendientes
   */
  async getPendingSync() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending-sync'], 'readonly');
      const store = tx.objectStore('pending-sync');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  /**
   * Marcar cambio como sincronizado
   */
  async markSynced(id) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending-sync'], 'readwrite');
      const store = tx.objectStore('pending-sync');
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (item) {
          item.synced = true;
          const updateRequest = store.put(item);
          updateRequest.onerror = () => reject(updateRequest.error);
          updateRequest.onsuccess = () => resolve(item);
        } else {
          reject(new Error('Item no encontrado'));
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Limpiar cambios sincronizados
   */
  async clearSyncedItems() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['pending-sync'], 'readwrite');
      const store = tx.objectStore('pending-sync');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const items = getAllRequest.result;
        const synced = items.filter(item => item.synced);

        synced.forEach(item => {
          store.delete(item.id);
        });

        const countRequest = store.count();
        countRequest.onsuccess = () => {
          console.log(`🗑️ ${synced.length} items sincronizados eliminados. Pendientes: ${countRequest.result}`);
          resolve(synced.length);
        };
      };
      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Guardar metadata (último sync, etc.)
   */
  async setMetadata(key, value) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['metadata'], 'readwrite');
      const store = tx.objectStore('metadata');

      const request = store.put({ key: key, value: value, timestamp: new Date().toISOString() });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Obtener metadata
   */
  async getMetadata(key) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['metadata'], 'readonly');
      const store = tx.objectStore('metadata');
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  /**
   * Limpiar toda la base de datos
   */
  async clear() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['api-cache', 'pending-sync', 'metadata'], 'readwrite');
      
      tx.objectStore('api-cache').clear();
      tx.objectStore('pending-sync').clear();
      tx.objectStore('metadata').clear();

      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        console.log('🗑️ Base de datos local limpiada');
        resolve();
      };
    });
  }

  /**
   * Obtener tamaño aproximado de la base de datos
   */
  async getSize() {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      const tx = this.db.transaction(['api-cache', 'pending-sync'], 'readonly');
      let totalSize = 0;

      const cacheStore = tx.objectStore('api-cache');
      const cacheRequest = cacheStore.getAll();

      cacheRequest.onsuccess = () => {
        cacheRequest.result.forEach(item => {
          totalSize += JSON.stringify(item).length;
        });

        const pendingStore = tx.objectStore('pending-sync');
        const pendingRequest = pendingStore.getAll();

        pendingRequest.onsuccess = () => {
          pendingRequest.result.forEach(item => {
            totalSize += JSON.stringify(item).length;
          });

          const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
          resolve({ bytes: totalSize, mb: parseFloat(sizeInMB) });
        };
      };
    });
  }
}

// Instancia global
const offlineDB = new OfflineDatabase();

// Inicializar al cargar
offlineDB.init().catch(console.error);
