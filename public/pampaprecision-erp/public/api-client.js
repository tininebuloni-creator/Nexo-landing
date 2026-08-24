/**
 * Pampa Precision ERP - API Client
 * Cliente para interactuar con el backend REST
 */

const API_URL = window.location.origin + '/api';

class PampaAPI {
  constructor() {
    this.baseURL = API_URL;
    this.token = localStorage.getItem('auth-token');
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API Error: ${endpoint}`, error);
      throw error;
    }
  }

  // ============================================================
  // TENANTS
  // ============================================================
  async getTenants() {
    return this.request('/tenants');
  }

  async createTenant(name) {
    return this.request('/tenants', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  // ============================================================
  // ESTABLISHMENTS
  // ============================================================
  async getEstablishments(tenantId) {
    return this.request(`/tenants/${tenantId}/establishments`);
  }

  async createEstablishment(tenantId, data) {
    return this.request(`/tenants/${tenantId}/establishments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================================
  // CAMPAIGNS
  // ============================================================
  async getCampaigns(tenantId) {
    return this.request(`/tenants/${tenantId}/campaigns`);
  }

  async createCampaign(tenantId, data) {
    return this.request(`/tenants/${tenantId}/campaigns`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================================
  // PLOTS (LOTES)
  // ============================================================
  async getPlots(establishmentId) {
    return this.request(`/establishments/${establishmentId}/plots`);
  }

  async createPlot(establishmentId, data) {
    return this.request(`/establishments/${establishmentId}/plots`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================================
  // WORK ORDERS
  // ============================================================
  async getWorkOrders(campaignId) {
    return this.request(`/campaigns/${campaignId}/work-orders`);
  }

  async createWorkOrder(campaignId, data) {
    return this.request(`/campaigns/${campaignId}/work-orders`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateWorkOrder(workOrderId, status) {
    return this.request(`/work-orders/${workOrderId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }

  // ============================================================
  // WORK EXECUTION
  // ============================================================
  async recordExecution(workOrderId, data) {
    return this.request(`/work-orders/${workOrderId}/executions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================================
  // INVENTORY
  // ============================================================
  async getInventory(establishmentId) {
    return this.request(`/establishments/${establishmentId}/inventory`);
  }

  async recordInventoryMovement(data) {
    return this.request('/inventory/movements', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================================
  // PRESCRIPTIONS
  // ============================================================
  async getPrescriptions(plotId) {
    return this.request(`/plots/${plotId}/prescriptions`);
  }

  async createPrescription(plotId, data) {
    return this.request(`/plots/${plotId}/prescriptions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================================
  // AUDIT
  // ============================================================
  async getAuditLog(limit = 50, offset = 0) {
    return this.request(`/audit-log?limit=${limit}&offset=${offset}`);
  }

  // ============================================================
  // HEALTH
  // ============================================================
  async healthCheck() {
    try {
      return await this.request('/health');
    } catch (error) {
      return { status: 'OFFLINE', error: error.message };
    }
  }

  async getEquipmentPlanSource() {
    return this.request('/equipment-plan-source');
  }

  async getAgriculturalSummary(tenantId) {
    return this.request(`/tenants/${tenantId}/agricultural-summary`);
  }

  async getMachines(tenantId) {
    return this.request(`/tenants/${tenantId}/machines`);
  }

  async createMachine(tenantId, data) {
    return this.request(`/tenants/${tenantId}/machines`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getMaintenance(tenantId) {
    return this.request(`/tenants/${tenantId}/maintenance`);
  }

  async createMaintenance(tenantId, data) {
    return this.request(`/tenants/${tenantId}/maintenance`, { method: 'POST', body: JSON.stringify(data) });
  }

  async updateMaintenance(id, data) {
    return this.request(`/maintenance/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async getHarvest(tenantId) {
    return this.request(`/tenants/${tenantId}/harvest`);
  }

  async createHarvestEstimate(tenantId, data) {
    return this.request(`/tenants/${tenantId}/harvest-estimates`, { method: 'POST', body: JSON.stringify(data) });
  }

  async createWeighTicket(tenantId, data) {
    return this.request(`/tenants/${tenantId}/weigh-tickets`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getOperatingCosts(tenantId) {
    return this.request(`/tenants/${tenantId}/operating-costs`);
  }

  async createOperatingCost(tenantId, data) {
    return this.request(`/tenants/${tenantId}/operating-costs`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getFinanceSummary(tenantId, params = '') {
    return this.request(`/tenants/${tenantId}/finance-summary${params}`);
  }

  async getSales(tenantId) {
    return this.request(`/tenants/${tenantId}/sales`);
  }

  async createSale(tenantId, data) {
    return this.request(`/tenants/${tenantId}/sales`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getLpgs(tenantId) {
    return this.request(`/tenants/${tenantId}/lpgs`);
  }

  async getLpgConfig() {
    return this.request('/lpg/config');
  }

  async createLpg(tenantId, data) {
    return this.request(`/tenants/${tenantId}/lpgs`, { method: 'POST', body: JSON.stringify(data) });
  }

  async authorizeLpg(tenantId, lpgId) {
    return this.request(`/tenants/${tenantId}/lpgs/${lpgId}/authorize`, { method: 'POST' });
  }

  async getArcaStatus() {
    return this.request('/arca/status');
  }

  async updateArcaConfig(data) {
    return this.request('/arca/config', { method: 'PUT', body: JSON.stringify(data) });
  }

  async checkArcaSisa(tenantId, data) {
    return this.request(`/tenants/${tenantId}/arca/sisa/check`, { method: 'POST', body: JSON.stringify(data) });
  }

  async createArcaCpe(tenantId, data) {
    return this.request(`/tenants/${tenantId}/arca/cpe`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getCashAccounts(tenantId) {
    return this.request(`/tenants/${tenantId}/cash-accounts`);
  }

  async createCashAccount(tenantId, data) {
    return this.request(`/tenants/${tenantId}/cash-accounts`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getCashMovements(tenantId) {
    return this.request(`/tenants/${tenantId}/cash-movements`);
  }

  async createCashMovement(tenantId, data) {
    return this.request(`/tenants/${tenantId}/cash-movements`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getCashFlow(tenantId, params = '') {
    return this.request(`/tenants/${tenantId}/cash-flow${params}`);
  }

  async getHrSummary(tenantId) {
    return this.request(`/tenants/${tenantId}/hr-summary`);
  }

  async getEmployees(tenantId) {
    return this.request(`/tenants/${tenantId}/employees`);
  }

  async createEmployee(tenantId, data) {
    return this.request(`/tenants/${tenantId}/employees`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getAttendance(tenantId) {
    return this.request(`/tenants/${tenantId}/attendance`);
  }

  async createAttendance(tenantId, data) {
    return this.request(`/tenants/${tenantId}/attendance`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getPayrollPeriods(tenantId) {
    return this.request(`/tenants/${tenantId}/payroll-periods`);
  }

  async createPayrollPeriod(tenantId, data) {
    return this.request(`/tenants/${tenantId}/payroll-periods`, { method: 'POST', body: JSON.stringify(data) });
  }

  async createPayrollItem(periodId, data) {
    return this.request(`/payroll-periods/${periodId}/items`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getCredits(tenantId) {
    return this.request(`/tenants/${tenantId}/credits`);
  }

  async getCreditSummary(tenantId) {
    return this.request(`/tenants/${tenantId}/credit-summary`);
  }

  async createCredit(tenantId, data) {
    return this.request(`/tenants/${tenantId}/credits`, { method: 'POST', body: JSON.stringify(data) });
  }

  async createCreditPayment(creditId, data) {
    return this.request(`/credits/${creditId}/payments`, { method: 'POST', body: JSON.stringify(data) });
  }

  async getCreditInstallments(creditId) {
    return this.request(`/credits/${creditId}/installments`);
  }

  async getCreditInstallmentsByStatus(tenantId, status) {
    return this.request(`/tenants/${tenantId}/credit-installments?status=${status}`);
  }

  async getChecks(tenantId) {
    return this.request(`/tenants/${tenantId}/checks`);
  }

  async createCheck(tenantId, data) {
    return this.request(`/tenants/${tenantId}/checks`, { method: 'POST', body: JSON.stringify(data) });
  }

  async updateCheck(checkId, data) {
    return this.request(`/checks/${checkId}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  // ============================================================
  // LICENCIAS
  // ============================================================
  async getLicenseStatus() {
    return this.request('/license/status');
  }

  async activateLicense(key) {
    return this.request('/license/activate', { method: 'POST', body: JSON.stringify({ key }) });
  }

  async checkModuleAccess(moduleName) {
    return this.request(`/license/module/${moduleName}`);
  }

  async getAllowedModules() {
    return this.request('/license/modules');
  }

  async getLicenseTypes() {
    return this.request('/license/types');
  }

  async revokeLicense() {
    return this.request('/license/revoke', { method: 'POST' });
  }

  async getLicenseHistory() {
    return this.request('/license/history');
  }

  async syncLicense() {
    return this.request('/license/sync');
  }
}

// ============================================================
// SISTEMA DE CACHÉ OFFLINE PARA LICENCIAS
// ============================================================

class LicenseOfflineCache {
  constructor() {
    this.cacheKey = 'pampa-license-cache';
    this.syncTimeKey = 'pampa-license-sync-time';
    this.SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutos
  }

  // Obtener licencia del caché local
  getLocal() {
    try {
      const cache = localStorage.getItem(this.cacheKey);
      return cache ? JSON.parse(cache) : null;
    } catch (err) {
      console.error('Error leyendo caché local:', err);
      return null;
    }
  }

  // Guardar licencia en caché local
  setLocal(data) {
    try {
      localStorage.setItem(this.cacheKey, JSON.stringify(data));
      localStorage.setItem(this.syncTimeKey, new Date().toISOString());
      return true;
    } catch (err) {
      console.error('Error guardando caché local:', err);
      return false;
    }
  }

  // Obtener última sincronización
  getLastSyncTime() {
    const time = localStorage.getItem(this.syncTimeKey);
    return time ? new Date(time) : null;
  }

  // Verificar si necesita sincronizar
  needsSync() {
    const lastSync = this.getLastSyncTime();
    if (!lastSync) return true;
    return (new Date() - lastSync) > this.SYNC_INTERVAL;
  }

  // Sincronizar con servidor si está disponible
  async syncIfOnline(api) {
    if (!navigator.onLine) {
      console.log('📵 Offline - usando caché local de licencia');
      return false;
    }

    if (!this.needsSync()) {
      return false;
    }

    try {
      const syncData = await api.syncLicense();
      if (syncData) {
        const cached = this.getLocal();
        const cachedTrial = cached?.license?.type === 'trial' && new Date(cached.license.expiresAt || 0).getTime() > Date.now();
        if (cachedTrial && !syncData.activeLicense) {
          return false;
        }
        this.setLocal(syncData);
        console.log('✅ Licencia sincronizada con servidor');
        return true;
      }
    } catch (err) {
      console.warn('⚠️ Sincronización fallida, usando caché local:', err);
    }
    return false;
  }

  // Obtener estado de licencia (caché + servidor)
  async getStatus(api) {
    try {
      if (navigator.onLine) {
        const status = await api.getLicenseStatus();
        this.setLocal(status);
        return status;
      }
    } catch (err) {
      console.warn('No se pudo obtener licencia del servidor');
    }

    const cached = this.getLocal();
    if (cached) {
      cached.offline = true;
      cached.cachedAt = this.getLastSyncTime()?.toLocaleString('es-AR');
      return cached;
    }

    return { valid: false, offline: true, message: 'Sin licencia (modo offline)' };
  }

  // Activar licencia (online)
  async activate(key, api) {
    if (!navigator.onLine) {
      throw new Error('Se requiere conexión para activar licencia');
    }

    const result = await api.activateLicense(key);
    if (result.success) {
      this.setLocal(result.license);
    }
    return result;
  }

  // Limpiar caché
  clear() {
    localStorage.removeItem(this.cacheKey);
    localStorage.removeItem(this.syncTimeKey);
  }
}

// Instancia global de caché de licencias
const licenseCache = new LicenseOfflineCache();

// Crear instancia global
const api = new PampaAPI();

// Sincronizar licencias al cargar
licenseCache.syncIfOnline(api).catch(console.error);

// Sincronizar cuando recupera conexión
window.addEventListener('online', () => {
  console.log('🔌 Conexión restaurada - sincronizando licencias...');
  licenseCache.syncIfOnline(api).catch(console.error);
});
