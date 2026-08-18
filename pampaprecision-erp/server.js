const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const db = require('./database');
const fs = require('fs');
const path = require('path');
const { ArcaClient } = require('./arca-client');
const XLSX = require('xlsx');
const licenses = require('./licenses');

const app = express();
const PORT = process.env.PORT || 3000;
const arca = new ArcaClient();
const lpgRatesPath = path.join(__dirname, 'public', 'simulador_lpg_provincias_completo.xlsx');
const equipmentPlanPath = path.join(__dirname, 'ap_plan_equipamiento.json');

function loadLpgProvinceRates() {
  if (!fs.existsSync(lpgRatesPath)) return {};
  const workbook = XLSX.readFile(lpgRatesPath, { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Configuracion, { header: ['province', 'rate'], range: 1, defval: null });
  return Object.fromEntries(rows.filter(row => row.province && Number.isFinite(Number(row.rate))).map(row => [String(row.province).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), Number(row.rate)]));
}

function loadLpgCropConfig() {
  if (!fs.existsSync(lpgRatesPath)) return {};
  const workbook = XLSX.readFile(lpgRatesPath, { cellDates: false });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Simulador_LPG, { header: ['crop', 'grossKg', 'humidityReceived', 'humidityTolerance'], range: 8, defval: null });
  return Object.fromEntries(rows.filter(row => row.crop && Number.isFinite(Number(row.humidityTolerance))).map(row => [String(row.crop).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), {
    humidityTolerance: Number(row.humidityTolerance),
    dryingRate: 0.015,
    acopioRate: 0.02,
    freightPerTon: 6500
  }]));
}

const lpgProvinceRates = loadLpgProvinceRates();
const lpgCropConfig = loadLpgCropConfig();
Object.assign(lpgCropConfig, {
  soy: lpgCropConfig.soja,
  corn: lpgCropConfig.maiz,
  maize: lpgCropConfig.maiz,
  wheat: lpgCropConfig.trigo,
  sunflower: lpgCropConfig.girasol
});
function lpgProvinceRate(province) {
  const key = String(province || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return lpgProvinceRates[key] || 0;
}

const sisaMatrix = {
  producer: { '1': { vatRetentionRate: 0.05, reimbursementRate: 1 }, '2': { vatRetentionRate: 0.07, reimbursementRate: 0 }, '3': { vatRetentionRate: 0.08, reimbursementRate: 0 }, inactive: { vatRetentionRate: 1, reimbursementRate: 0 }, excluded: { vatRetentionRate: 1, reimbursementRate: 0 } },
  intermediary: { '1': { vatRetentionRate: 0.05, reimbursementRate: 0 }, '2': { vatRetentionRate: 0.05, reimbursementRate: 0 }, '3': { vatRetentionRate: 0.08, reimbursementRate: 0 }, inactive: { vatRetentionRate: 1, reimbursementRate: 0 }, excluded: { vatRetentionRate: 1, reimbursementRate: 0 } }
};
const incomeTaxMatrix = {
  producer: { '1': 0, '2': 0.02, '3': 0.15, inactive: 0.15, excluded: 0.15 },
  intermediary: { '1': 0.02, '2': 0.02, '3': 0.15, inactive: 0.15, excluded: 0.15 }
};
const iibbMatrix = { producer: { exemptRate: 0 }, intermediary: { marginRate: 0.041 } };
function sisaRule(role, status) {
  const normalized = String(status || '1').trim().toLowerCase();
  return sisaMatrix[role]?.[normalized] || sisaMatrix[role]?.['1'];
}
function incomeTaxRate(role, status) {
  const normalized = String(status || '1').trim().toLowerCase();
  return incomeTaxMatrix[role]?.[normalized] ?? incomeTaxMatrix[role]?.['1'];
}

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/equipment-plan-source', (req, res) => {
  try {
    if (!fs.existsSync(equipmentPlanPath)) {
      res.status(404).json({ error: 'No se encontro ap_plan_equipamiento.json' });
      return;
    }
    const content = fs.readFileSync(equipmentPlanPath, 'utf8');
    res.json(JSON.parse(content));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analiza libros Excel históricos antes de guardarlos en el almacenamiento local del cliente.
app.post('/api/import/historical', express.raw({ type: 'application/octet-stream', limit: '25mb' }), (req, res) => {
  const fileName = String(req.get('X-File-Name') || 'historico').replace(/[^A-Za-z0-9._ -]/g, '_');
  const extension = path.extname(fileName).toLowerCase();
  if (!['.xlsx', '.xls'].includes(extension)) {
    return res.status(400).json({ error: 'Formato no admitido. Usá un libro Excel .xlsx o .xls.' });
  }
  if (!req.body?.length) return res.status(400).json({ error: 'El archivo está vacío' });

  try {
    let rows;
    let columns;
    const workbook = XLSX.read(req.body, { type: 'buffer', raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    columns = rows.length ? Object.keys(rows[0]) : [];
    res.json({ fileName, rowCount: rows.length, columns, rows });
  } catch (error) {
    res.status(422).json({ error: `No se pudo leer el archivo: ${error.message}` });
  }
});

// Descarga KML desde un mapa público de Google My Maps.
// El identificador se valida para impedir que esta ruta actúe como proxy genérico.
app.get('/api/import/google-my-maps/:mapId', async (req, res) => {
  const { mapId } = req.params;
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(mapId)) {
    return res.status(400).json({ error: 'El identificador de Google My Maps no es válido' });
  }

  try {
    const googleResponse = await fetch(`https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mapId)}&forcekml=1`);
    if (!googleResponse.ok) {
      return res.status(googleResponse.status).json({ error: 'No se pudo acceder al mapa. Verifica que sea público.' });
    }

    const kml = await googleResponse.text();
    if (!kml.includes('<kml')) {
      return res.status(422).json({ error: 'Google My Maps no devolvió un archivo KML válido' });
    }
    res.type('application/vnd.google-earth.kml+xml').send(kml);
  } catch (error) {
    res.status(502).json({ error: `No se pudo descargar el mapa: ${error.message}` });
  }
});

// ============================================================
// SISTEMA DE LICENCIAS
// ============================================================

// Obtener estado actual de la licencia
app.get('/api/license/status', (req, res) => {
  const activeLicense = licenses.getActiveLicense();
  if (!activeLicense) {
    return res.json({ valid: false, message: 'Sin licencia activa' });
  }
  res.json({ valid: true, ...activeLicense });
});

// Activar una nueva licencia
app.post('/api/license/activate', (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ error: 'Clave de licencia requerida' });
  }
  const result = licenses.activateLicense(key);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result);
});

// Validar si un módulo está disponible
app.get('/api/license/module/:moduleName', (req, res) => {
  const { moduleName } = req.params;
  const allowed = licenses.isModuleAllowed(moduleName);
  res.json({ module: moduleName, allowed });
});

// Obtener lista de módulos permitidos
app.get('/api/license/modules', (req, res) => {
  const modules = licenses.getAllowedModules();
  res.json({ modules });
});

// Obtener información de tipos de licencia disponibles
app.get('/api/license/types', (req, res) => {
  res.json({ types: licenses.LICENSE_TYPES });
});

// Revocar licencia actual (admin only)
app.post('/api/license/revoke', (req, res) => {
  const result = licenses.revokeLicense();
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result);
});

// Obtener historial de licencias
app.get('/api/license/history', (req, res) => {
  const history = licenses.getLicensesHistory();
  res.json({ history });
});

// Sincronización offline-first de licencias
app.get('/api/license/sync', (req, res) => {
  const payload = licenses.getSyncPayload();
  licenses.updateLastSync();
  res.json(payload);
});

// Endpoint de sincronización para datos offline-first
app.post('/api/sync', (req, res) => {
  const { id, action, data, timestamp } = req.body;
  if (!id || !action || !data) {
    return res.status(400).json({ error: 'id, action y data requeridos' });
  }
  try {
    const syncLog = path.join(__dirname, 'sync-events.jsonl');
    const logEntry = {
      id, action, data,
      timestamp: timestamp || new Date().toISOString(),
      receivedAt: new Date().toISOString()
    };
    fs.appendFileSync(syncLog, JSON.stringify(logEntry) + '\n', 'utf8');
    console.log(`📨 Sync recibido: ${action} [${id}]`);
    res.json({
      success: true, id, action,
      receivedAt: new Date().toISOString(),
      message: 'Datos sincronizados correctamente'
    });
  } catch (error) {
    console.error('Error en sincronización:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// TENANTS & COMPANIES
// ============================================================
app.get('/api/tenants', async (req, res) => {
  try {
    const result = await db.query('SELECT id, name, created_at FROM core.tenant');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tenants', async (req, res) => {
  const { name } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO core.tenant (id, name) VALUES (gen_random_uuid(), $1) RETURNING *',
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ESTABLISHMENTS
// ============================================================
app.get('/api/tenants/:tenantId/establishments', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const result = await db.query(
      'SELECT id, code, name, country_code FROM core.establishment WHERE tenant_id = $1 ORDER BY name',
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tenants/:tenantId/establishments', async (req, res) => {
  const { tenantId } = req.params;
  const { code, name, countryCode } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO core.establishment (id, tenant_id, code, name, country_code) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING *',
      [tenantId, code, name, countryCode]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// CAMPAIGNS
// ============================================================
app.get('/api/tenants/:tenantId/campaigns', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const result = await db.query(
      'SELECT id, code, name, crop_year_start, crop_year_end, is_open FROM core.campaign WHERE tenant_id = $1 ORDER BY crop_year_start DESC',
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tenants/:tenantId/campaigns', async (req, res) => {
  const { tenantId } = req.params;
  const { code, name, cropYearStart, cropYearEnd, currencyId } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO core.campaign (id, tenant_id, code, name, crop_year_start, crop_year_end, currency_id, is_open)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true) RETURNING *`,
      [tenantId, code, name, cropYearStart, cropYearEnd, currencyId]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PLOTS (LOTES)
// ============================================================
app.get('/api/establishments/:estabId/plots', async (req, res) => {
  const { estabId } = req.params;
  try {
    const result = await db.query(
      `SELECT p.id, p.code, p.name, p.surface_ha, ST_AsGeoJSON(p.centroid_geom) as centroid
       FROM core.plot p
       WHERE p.establishment_id = $1 ORDER BY p.code`,
      [estabId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/establishments/:estabId/plots', async (req, res) => {
  const { estabId } = req.params;
  const { code, name, surfaceHa, centroidLat, centroidLon } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO core.plot (id, establishment_id, code, name, surface_ha, centroid_geom)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, ST_Point($5, $6)) RETURNING id, code, name, surface_ha`,
      [estabId, code, name, surfaceHa, centroidLon, centroidLat]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// WORK ORDERS (ORDENES DE TRABAJO)
// ============================================================
app.get('/api/campaigns/:campaignId/work-orders', async (req, res) => {
  const { campaignId } = req.params;
  try {
    const result = await db.query(
      `SELECT wo.id, wo.operation_type, wo.plot_season_id, p.code AS plot_code,
              p.name AS plot_name, wo.requested_date, wo.planned_area_ha, wo.status
       FROM ops.work_order wo
       JOIN core.plot_season ps ON ps.id = wo.plot_season_id
       JOIN core.plot p ON p.id = ps.plot_id
       WHERE ps.campaign_id = $1 ORDER BY wo.requested_date DESC`,
      [campaignId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/campaigns/:campaignId/work-orders', async (req, res) => {
  const { campaignId } = req.params;
  const { plotSeasonId, operationType, requestedDate, plannedAreaHa, status } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO ops.work_order (id, tenant_id, plot_season_id, operation_type, requested_date, planned_area_ha, status)
       SELECT gen_random_uuid(), c.tenant_id, $2, $3, $4, $5, $6
       FROM core.campaign c WHERE c.id = $1 RETURNING *`,
      [campaignId, plotSeasonId, operationType, requestedDate, plannedAreaHa, status || 'open']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/work-orders/:workOrderId', async (req, res) => {
  const { workOrderId } = req.params;
  const { status } = req.body;
  try {
    const result = await db.query(
      'UPDATE ops.work_order SET status = $1 WHERE id = $2 RETURNING *',
      [status, workOrderId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// WORK EXECUTION
// ============================================================
app.post('/api/work-orders/:workOrderId/executions', async (req, res) => {
  const { workOrderId } = req.params;
  const { executedArea, machineHours, laborHours, operatorName, machineId, wind, temperature, humidity, inversion } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO ops.work_execution (id, tenant_id, work_order_id, executed_at, area_ha, machine_hours, labor_hours, operator_name, machine_id)
       SELECT gen_random_uuid(), wo.tenant_id, wo.id, now(), $2, $3, $4, $5, $6
       FROM ops.work_order wo WHERE wo.id = $1 RETURNING *`,
      [workOrderId, executedArea, machineHours || 0, laborHours || 0, operatorName, machineId || null]
    );
    
    // Grabar condiciones de aplicación
    if (wind !== null || temperature !== null || humidity !== null) {
      await db.query(
        `INSERT INTO ops.application_condition (id, tenant_id, work_execution_id, wind_speed_kmh, temperature_c, relative_humidity, thermal_inversion_flag)
         SELECT gen_random_uuid(), we.tenant_id, $1, $2, $3, $4, $5
         FROM ops.work_execution we WHERE we.id = $1`,
        [result.rows[0].id, wind, temperature, humidity, inversion === 'Si']
      );
    }
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// MODULO AGRICOLA: MAQUINARIA, MANTENIMIENTO, COSECHA Y COSTOS
// ============================================================
app.get('/api/tenants/:tenantId/machines', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT m.*, COALESCE(h.reading_value, 0) AS current_hourmeter,
              COUNT(mw.id) FILTER (WHERE mw.status IN ('open', 'planned')) AS pending_maintenance
       FROM mach.machine m
       LEFT JOIN LATERAL (SELECT reading_value FROM mach.hourmeter_reading WHERE machine_id = m.id ORDER BY reading_time DESC LIMIT 1) h ON true
       LEFT JOIN mach.maintenance_work_order mw ON mw.machine_id = m.id
       WHERE m.tenant_id = $1 GROUP BY m.id, h.reading_value ORDER BY m.active DESC, m.code`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/machines', async (req, res) => {
  const { code, category, brand, model, serialNo, plate, hourlyCostUsd } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO mach.machine (tenant_id, code, category, brand, model, serial_no, plate, hourly_cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 35)) RETURNING *`,
      [req.params.tenantId, code, category, brand, model, serialNo, plate, hourlyCostUsd]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/machines/:machineId/hourmeter-readings', async (req, res) => {
  const { tenantId, readingValue, readingTime, source } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO mach.hourmeter_reading (tenant_id, machine_id, reading_value, reading_time, source)
       VALUES ($1, $2, $3, COALESCE($4, now()), COALESCE($5, 'manual')) RETURNING *`,
      [tenantId, req.params.machineId, readingValue, readingTime, source]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/maintenance', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT mw.*, m.code AS machine_code, m.brand, m.model
       FROM mach.maintenance_work_order mw JOIN mach.machine m ON m.id = mw.machine_id
       WHERE mw.tenant_id = $1 ORDER BY mw.status, mw.due_at NULLS LAST, mw.opened_at DESC`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/maintenance', async (req, res) => {
  const { machineId, description, dueAt, priority, estimatedCostUsd } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO mach.maintenance_work_order (tenant_id, machine_id, description, due_at, priority, estimated_cost_usd)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'medium'), COALESCE($6, 0)) RETURNING *`,
      [req.params.tenantId, machineId, description, dueAt, priority, estimatedCostUsd]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/maintenance/:maintenanceId', async (req, res) => {
  const { status, actualCostUsd, closedAt } = req.body;
  try {
    const result = await db.query(
      `UPDATE mach.maintenance_work_order
       SET status = COALESCE($2, status), actual_cost_usd = COALESCE($3, actual_cost_usd),
           closed_at = CASE WHEN $2 = 'closed' THEN COALESCE($4, now()) ELSE closed_at END
       WHERE id = $1 RETURNING *`,
      [req.params.maintenanceId, status, actualCostUsd, closedAt]
    );
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/harvest', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ps.id AS plot_season_id, p.code AS plot_code, p.name AS plot_name, c.code AS campaign_code,
              COALESCE(SUM(wt.net_kg) / 1000.0, 0) AS harvested_tn,
              COALESCE(AVG(he.estimated_yield_tn_ha), 0) AS estimated_yield_tn_ha,
              COUNT(wt.id) AS weigh_tickets
       FROM core.plot_season ps JOIN core.plot p ON p.id = ps.plot_id JOIN core.campaign c ON c.id = ps.campaign_id
       LEFT JOIN com.harvest_estimate he ON he.plot_season_id = ps.id
       LEFT JOIN com.weigh_ticket wt ON wt.plot_season_id = ps.id
       WHERE ps.tenant_id = $1 GROUP BY ps.id, p.code, p.name, c.code ORDER BY c.code DESC, p.code`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/harvest-estimates', async (req, res) => {
  const { plotSeasonId, estimatedYieldTnHa, source } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO com.harvest_estimate (tenant_id, plot_season_id, estimated_yield_tn_ha, source)
       VALUES ($1, $2, $3, COALESCE($4, 'manual')) RETURNING *`,
      [req.params.tenantId, plotSeasonId, estimatedYieldTnHa, source]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/weigh-tickets', async (req, res) => {
  const { plotSeasonId, ticketNumber, grossKg, tareKg, weighedAt } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO com.weigh_ticket (tenant_id, plot_season_id, ticket_number, gross_kg, tare_kg, weighed_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, now())) RETURNING *`,
      [req.params.tenantId, plotSeasonId, ticketNumber, grossKg, tareKg, weighedAt]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/operating-costs', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT oc.*, p.code AS plot_code, m.code AS machine_code
       FROM fin.operating_cost oc
       LEFT JOIN core.plot_season ps ON ps.id = oc.plot_season_id
       LEFT JOIN core.plot p ON p.id = ps.plot_id
       LEFT JOIN mach.machine m ON m.id = oc.machine_id
       WHERE oc.tenant_id = $1 ORDER BY oc.cost_date DESC, oc.created_at DESC`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/operating-costs', async (req, res) => {
  const { plotSeasonId, workOrderId, machineId, costDate, category, description, amountUsd } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO fin.operating_cost (tenant_id, plot_season_id, work_order_id, machine_id, cost_date, category, description, amount_usd)
       VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7, $8) RETURNING *`,
      [req.params.tenantId, plotSeasonId || null, workOrderId || null, machineId || null, costDate, category, description, amountUsd]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/agricultural-summary', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM mach.machine WHERE tenant_id = $1 AND active) AS active_machines,
         (SELECT COUNT(*) FROM mach.maintenance_work_order WHERE tenant_id = $1 AND status IN ('open', 'planned')) AS pending_maintenance,
         (SELECT COALESCE(SUM(amount_usd), 0) FROM fin.operating_cost WHERE tenant_id = $1) AS total_operating_cost_usd,
         (SELECT COALESCE(SUM(net_kg), 0) / 1000.0 FROM com.weigh_ticket WHERE tenant_id = $1) AS harvested_tn,
         (SELECT COUNT(*) FROM ops.work_order WHERE tenant_id = $1 AND operation_type IN ('siembra', 'cosecha')) AS agricultural_work_orders`,
      [req.params.tenantId]
    );
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// FINANZAS: VENTAS Y FLUJO DE FONDOS
// ============================================================
app.get('/api/tenants/:tenantId/finance-summary', async (req, res) => {
  const { from, to } = req.query;
  try {
    const result = await db.query(
      `WITH period AS (
         SELECT COALESCE($2::date, date_trunc('year', CURRENT_DATE)::date) AS from_date,
                COALESCE($3::date, CURRENT_DATE) AS to_date
       ), sales AS (
         SELECT COALESCE(SUM(total_amount), 0) AS issued_sales,
                COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'pending'), 0) AS receivable
         FROM fin.sale s, period p WHERE s.tenant_id = $1 AND s.sale_date BETWEEN p.from_date AND p.to_date
       ), cash AS (
         SELECT COALESCE(SUM(amount_usd) FILTER (WHERE movement_type = 'in'), 0) AS cash_in,
                COALESCE(SUM(amount_usd) FILTER (WHERE movement_type = 'out'), 0) AS cash_out
         FROM fin.cash_movement cm, period p WHERE cm.tenant_id = $1 AND cm.movement_date BETWEEN p.from_date AND p.to_date AND cm.status = 'confirmed'
       ), balance AS (
         SELECT COALESCE(SUM(ca.opening_balance), 0) + COALESCE(SUM(cm.amount_usd) FILTER (WHERE cm.movement_type = 'in'), 0) - COALESCE(SUM(cm.amount_usd) FILTER (WHERE cm.movement_type = 'out'), 0) AS current_balance
         FROM fin.cash_account ca LEFT JOIN fin.cash_movement cm ON cm.cash_account_id = ca.id AND cm.status = 'confirmed'
         WHERE ca.tenant_id = $1 AND ca.active
       )
       SELECT sales.issued_sales, sales.receivable, cash.cash_in, cash.cash_out,
              cash.cash_in - cash.cash_out AS net_cash_flow, balance.current_balance
       FROM sales, cash, balance`,
      [req.params.tenantId, from || null, to || null]
    );
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/sales', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, COALESCE(json_agg(json_build_object('id', sl.id, 'description', sl.description, 'quantity', sl.quantity, 'unitPrice', sl.unit_price, 'taxRate', sl.tax_rate, 'lineTotal', sl.line_total)) FILTER (WHERE sl.id IS NOT NULL), '[]') AS lines
       FROM fin.sale s LEFT JOIN fin.sale_line sl ON sl.sale_id = s.id
       WHERE s.tenant_id = $1 GROUP BY s.id ORDER BY s.sale_date DESC, s.created_at DESC`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/sales', async (req, res) => {
  const { saleNumber, saleDate, customerName, customerTaxId, currencyId, dueDate, lines = [], grainSale = false, lpgDraft = {} } = req.body;
  if (!saleNumber || !customerName || !lines.length) return res.status(400).json({ error: 'saleNumber, customerName y lines son obligatorios' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const currency = currencyId || (await client.query(`SELECT id FROM ref.currency WHERE code = $1 LIMIT 1`, [grainSale ? 'ARS' : 'USD'])).rows[0]?.id;
    if (!currency) throw new Error(`No hay moneda ${grainSale ? 'ARS' : 'USD'} configurada`);
    const normalizedLines = lines.map(line => {
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      const taxRate = Number(line.taxRate || 0);
      const net = quantity * unitPrice;
      return { description: line.description, quantity, unitPrice, taxRate, lineTotal: net + net * taxRate / 100 };
    });
    const subtotal = normalizedLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const total = normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0);
    const tax = total - subtotal;
    const saleResult = await client.query(
      `INSERT INTO fin.sale (tenant_id, sale_number, sale_date, customer_name, customer_tax_id, currency_id, subtotal, tax_amount, total_amount, due_date)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.params.tenantId, saleNumber, saleDate, customerName, customerTaxId, currency, subtotal, tax, total, dueDate]
    );
    for (const line of normalizedLines) {
      await client.query(
        `INSERT INTO fin.sale_line (tenant_id, sale_id, description, quantity, unit_price, tax_rate, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.params.tenantId, saleResult.rows[0].id, line.description, line.quantity, line.unitPrice, line.taxRate, line.lineTotal]
      );
    }
    const detectedGrainSale = grainSale || lines.some(line => /cereal|soja|ma[ií]z|trigo|girasol|cebada|sorgo|arroz|avena|legumbre/i.test(line.description || ''));
    let lpgDraftResult = null;
    if (detectedGrainSale) {
      const originProvince = lpgDraft.originProvince || lpgDraft.originLocality;
      const grainWeight = Number(lpgDraft.netWeightKg || (normalizedLines[0].quantity * 1000));
      const grainPrice = Number(lpgDraft.unitPrice || normalizedLines[0].unitPrice || 0);
      const cropKey = String(lpgDraft.grainCode || lpgDraft.grainName || lines[0].description || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const crop = lpgCropConfig[cropKey] || {};
      const humidityLoss = Number(lpgDraft.humidityReceived ?? 0) > Number(lpgDraft.humidityTolerance ?? crop.humidityTolerance ?? 0)
        ? (Number(lpgDraft.humidityReceived ?? 0) - Number(lpgDraft.humidityTolerance ?? crop.humidityTolerance ?? 0)) / (1 - Number(lpgDraft.humidityTolerance ?? crop.humidityTolerance ?? 0))
        : 0;
      const lpgNetWeight = grainWeight * (1 - humidityLoss) * (1 - Number(lpgDraft.dryingRate ?? crop.dryingRate ?? 0.015));
      const lpgGross = lpgNetWeight / 1000 * grainPrice;
      const lpgVatRate = Number(lpgDraft.vatRate || 10.5);
      const commissionAmount = lpgGross * Number(lpgDraft.acopioRate ?? crop.acopioRate ?? 0.02);
      const freightAmount = grainWeight / 1000 * Number(lpgDraft.freightPerTon ?? crop.freightPerTon ?? 6500);
      const stampRate = lpgProvinceRate(originProvince);
      const stampAmount = lpgGross * stampRate;
      const lpgTaxableSubtotal = Math.max(0, lpgGross - commissionAmount - freightAmount - stampAmount);
      const lpgVat = lpgTaxableSubtotal * lpgVatRate / 100;
      const autoProducerSisaRule = sisaRule('producer', lpgDraft.producerSisaStatus);
      const lpgVatWithholding = lpgVat * autoProducerSisaRule.vatRetentionRate;
      const lpgIncomeWithholding = lpgTaxableSubtotal * incomeTaxRate('producer', lpgDraft.producerSisaStatus);
      const lpgNetAmount = Math.max(0, lpgTaxableSubtotal + lpgVat - lpgVatWithholding - lpgIncomeWithholding);
      const lpgDeductions = commissionAmount + freightAmount + stampAmount;
      const lpgNumber = lpgDraft.lpgNumber || `LPG-${saleNumber}`;
      lpgDraftResult = await client.query(
        `INSERT INTO fin.lpg (tenant_id, lpg_number, issue_date, operation_date, operation_type, issuer_tax_id, issuer_name,
          producer_tax_id, producer_name, producer_sisa_status, establishment_name, establishment_province, establishment_locality,
          producer_cbu, currency_id, unit_price, gross_amount, taxable_subtotal, vat_rate, vat_amount, net_amount, status, notes)
         VALUES ($1,$2,COALESCE($3,CURRENT_DATE),COALESCE($3,CURRENT_DATE),'sale',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'draft',$20)
         RETURNING id, lpg_number, status`,
        [req.params.tenantId, lpgNumber, saleDate, lpgDraft.issuerTaxId || customerTaxId || 'PENDIENTE', lpgDraft.issuerName || customerName, lpgDraft.producerTaxId || 'PENDIENTE', lpgDraft.producerName || 'Pendiente de completar', lpgDraft.producerSisaStatus, lpgDraft.establishmentName, lpgDraft.originProvince, lpgDraft.originLocality, lpgDraft.producerCbu, currency, grainPrice, lpgGross, lpgGross, lpgVatRate, lpgVat, lpgGross + lpgVat, `Generada automáticamente desde la venta ${saleNumber}. Completar datos y autorizar en ARCA.`]
      );
      await client.query(
        `UPDATE fin.lpg SET deductible_expenses = $1, taxable_subtotal = $2, net_amount = $3 WHERE id = $4`,
        [lpgDeductions, lpgTaxableSubtotal, lpgNetAmount, lpgDraftResult.rows[0].id]
      );
      await client.query(
        `UPDATE fin.lpg SET vat_withholding = $1, income_tax_withholding = $2 WHERE id = $3`,
        [lpgVatWithholding, lpgIncomeWithholding, lpgDraftResult.rows[0].id]
      );
      for (const deduction of [
        ['storage_commission', `Comision de acopio (2%)`, commissionAmount],
        ['freight', `Flete (${Number(lpgDraft.freightPerTon ?? 6500).toLocaleString('es-AR')} por tonelada bruta)`, freightAmount]
      ]) {
        await client.query(
          `INSERT INTO fin.lpg_deduction (tenant_id, lpg_id, deduction_type, description, amount) VALUES ($1,$2,$3,$4,$5)`,
          [req.params.tenantId, lpgDraftResult.rows[0].id, deduction[0], deduction[1], deduction[2]]
        );
      }
      if (stampAmount > 0) {
        await client.query(
          `INSERT INTO fin.lpg_deduction (tenant_id, lpg_id, deduction_type, description, amount) VALUES ($1,$2,'stamp_duty',$3,$4)`,
          [req.params.tenantId, lpgDraftResult.rows[0].id, `Sellado ${originProvince} (${(stampRate * 100).toFixed(2)}%)`, stampAmount]
        );
      }
      await client.query(
        `INSERT INTO fin.lpg_line (tenant_id, lpg_id, grain_code, grain_name, campaign, origin_province, origin_locality,
          destination, cpe_number, deposit_certificate, net_weight_kg)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [req.params.tenantId, lpgDraftResult.rows[0].id, lpgDraft.grainCode || 'OTHER', lpgDraft.grainName || lines[0].description, lpgDraft.campaign || 'Pendiente', originProvince, lpgDraft.originLocality, lpgDraft.destination, lpgDraft.cpeNumber, lpgDraft.depositCertificate, lpgNetWeight]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ ...saleResult.rows[0], lpg: lpgDraftResult?.rows[0] || null });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

app.get('/api/tenants/:tenantId/lpgs', async (req, res) => {
  try {
    const result = await db.query(
            `SELECT l.*, c.code AS currency_code, ll.grain_code, ll.grain_name, ll.campaign, ll.net_weight_kg,
              ll.origin_province, ll.origin_locality, ll.destination, ll.cpe_number, ll.deposit_certificate,
              COALESCE(SUM(ld.amount), 0) AS deductions_total
       FROM fin.lpg l
       JOIN ref.currency c ON c.id = l.currency_id
       LEFT JOIN fin.lpg_line ll ON ll.lpg_id = l.id
       LEFT JOIN fin.lpg_deduction ld ON ld.lpg_id = l.id
       WHERE l.tenant_id = $1
       GROUP BY l.id, c.code, ll.id
       ORDER BY l.issue_date DESC, l.created_at DESC`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/lpg/config', (req, res) => {
  const provinces = Object.entries(lpgProvinceRates).map(([province, rate]) => ({ province: province.replace(/\b\w/g, letter => letter.toUpperCase()), rate }));
  res.json({ vatRate: 10.5, provinces, crops: lpgCropConfig, sisaMatrix, incomeTaxMatrix, iibbMatrix });
});

app.post('/api/tenants/:tenantId/lpgs', async (req, res) => {
  const {
    lpgNumber, coe, issueDate, operationDate, operationType = 'sale', adjustmentType,
    issuerTaxId, issuerName, issuerVatStatus, issuerSisaStatus, producerTaxId, producerName,
    producerVatStatus, producerSisaStatus, establishmentName, establishmentProvince,
    establishmentLocality, brokerTaxId, brokerName, producerCbu, currencyId, unitPrice,
    line, deductions = [], vatRate = 10.5, vatWithholding = 0, incomeTaxWithholding = 0,
    grossIncomeWithholding = 0, taxCredit = 0, notes, vatWithholdingRate = 0.015, incomeTaxWithholdingRate = 0.005, producerIibbExempt = true, iibbMarginRate = 0.041
  } = req.body;
  if (!lpgNumber || !issuerTaxId || !issuerName || !producerTaxId || !producerName || !line?.grainName || !line?.campaign || !(line?.netWeightKg || line?.grossWeightKg)) {
    return res.status(400).json({ error: 'Faltan datos obligatorios de la LPG o del grano' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const currency = currencyId || (await client.query("SELECT id FROM ref.currency WHERE code = 'USD' LIMIT 1")).rows[0]?.id;
    if (!currency) throw new Error('No hay moneda USD configurada');
    const grossWeight = Number(line.grossWeightKg || line.netWeightKg);
    const cropKey = String(line.grainCode || line.grainName || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const crop = lpgCropConfig[cropKey] || lpgCropConfig[String(line.grainName || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()] || {};
    const humidityReceived = Number(line.humidityReceived || 0);
    const humidityTolerance = Number(line.humidityTolerance ?? crop.humidityTolerance ?? 0);
    const humidityLoss = humidityReceived > humidityTolerance ? (humidityReceived - humidityTolerance) / (1 - humidityTolerance) : 0;
    const dryingRate = Number(line.dryingRate ?? crop.dryingRate ?? 0.015);
    const weight = Number(line.netWeightKg) || grossWeight * (1 - humidityLoss) * (1 - dryingRate);
    const price = Number(unitPrice || 0);
    const grossAmount = weight / 1000 * price;
    const qualityAdjustment = Number(line.qualityAdjustment || 0);
    const stampProvince = establishmentProvince || line.originProvince;
    const stampRate = lpgProvinceRate(stampProvince);
    const stampAmount = grossAmount * stampRate;
    const brokerCommissionAmount = grossAmount * Number(line.brokerCommissionRate ?? 0);
    const dryingStorageAmount = Number(line.dryingStorageAmount || 0);
    const baseDeductions = deductions.length && deductions.some(deduction => Number(deduction.amount || 0) > 0) ? deductions : [
      { type: 'storage_commission', description: `Comision de acopio (${(Number(line.acopioRate ?? crop.acopioRate ?? 0.02) * 100).toFixed(2)}%)`, amount: grossAmount * Number(line.acopioRate ?? crop.acopioRate ?? 0.02) },
      { type: 'broker_commission', description: `Comision corredor (${(Number(line.brokerCommissionRate ?? 0) * 100).toFixed(2)}%)`, amount: brokerCommissionAmount },
      { type: 'drying_storage', description: 'Secado y almacenaje', amount: dryingStorageAmount },
      { type: 'freight', description: `Flete (${Number(line.freightPerTon ?? crop.freightPerTon ?? 6500).toLocaleString('es-AR')} por tonelada bruta)`, amount: grossWeight / 1000 * Number(line.freightPerTon ?? crop.freightPerTon ?? 6500) }
    ];
    const calculatedDeductions = stampAmount > 0
      ? [...baseDeductions, { type: 'stamp_duty', description: `Sellado ${stampProvince} (${(stampRate * 100).toFixed(2)}%)`, amount: stampAmount }]
      : baseDeductions;
    const deductibleExpenses = calculatedDeductions.reduce((total, deduction) => total + Number(deduction.amount || 0), 0);
    const taxableSubtotal = Math.max(0, grossAmount + qualityAdjustment - deductibleExpenses);
    const vatAmount = taxableSubtotal * Number(vatRate || 0) / 100;
    const producerSisaRule = sisaRule('producer', producerSisaStatus);
    const intermediarySisaRule = sisaRule('intermediary', issuerSisaStatus);
    const producerVatWithholdingAmount = Number(vatWithholding || vatAmount * producerSisaRule.vatRetentionRate);
    const intermediaryVatWithholdingAmount = vatAmount * intermediarySisaRule.vatRetentionRate;
    const vatWithholdingAmount = producerVatWithholdingAmount;
    const producerIncomeTaxRate = incomeTaxRate('producer', producerSisaStatus);
    const intermediaryIncomeTaxRate = incomeTaxRate('intermediary', issuerSisaStatus);
    const incomeTaxWithholdingAmount = Number(incomeTaxWithholding || taxableSubtotal * producerIncomeTaxRate);
    const intermediaryMarginBase = brokerCommissionAmount > 0 ? brokerCommissionAmount : grossAmount * Number(line.intermediaryMarginRate || 0);
    const iibbWithholdingAmount = Number(grossIncomeWithholding || (producerIibbExempt ? 0 : intermediaryMarginBase * Number(iibbMarginRate || iibbMatrix.intermediary.marginRate)));
    const producerReimbursementAmount = producerVatWithholdingAmount * producerSisaRule.reimbursementRate;
    const netAmount = Math.max(0, taxableSubtotal + vatAmount - vatWithholdingAmount - incomeTaxWithholdingAmount - iibbWithholdingAmount + Number(taxCredit || 0));
    const lpg = await client.query(
      `INSERT INTO fin.lpg (tenant_id, lpg_number, coe, issue_date, operation_date, operation_type, adjustment_type,
        issuer_tax_id, issuer_name, issuer_vat_status, issuer_sisa_status, producer_tax_id, producer_name,
        producer_vat_status, producer_sisa_status, establishment_name, establishment_province, establishment_locality,
        broker_tax_id, broker_name, producer_cbu, currency_id, unit_price, gross_amount, deductible_expenses,
        taxable_subtotal, vat_rate, vat_amount, vat_withholding, income_tax_withholding, gross_income_withholding,
        tax_credit, net_amount, status, notes)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),COALESCE($5,COALESCE($4,CURRENT_DATE)),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,'draft',$34)
       RETURNING *`,
      [req.params.tenantId, lpgNumber, coe, issueDate, operationDate, operationType, adjustmentType, issuerTaxId, issuerName, issuerVatStatus, issuerSisaStatus, producerTaxId, producerName, producerVatStatus, producerSisaStatus, establishmentName, establishmentProvince, establishmentLocality, brokerTaxId, brokerName, producerCbu, currency, price, grossAmount, deductibleExpenses, taxableSubtotal, Number(vatRate || 0), vatAmount, vatWithholdingAmount, incomeTaxWithholdingAmount, iibbWithholdingAmount, Number(taxCredit || 0), netAmount, `${notes || ''}\nSISA productor: IVA ${(producerSisaRule.vatRetentionRate * 100).toFixed(2)}%; reintegro IVA estimado $ ${producerReimbursementAmount.toFixed(2)}; Ganancias ${(producerIncomeTaxRate * 100).toFixed(2)}%. IIBB: ${producerIibbExempt ? 'productor exento 0%' : `base margen $ ${intermediaryMarginBase.toFixed(2)} a ${(Number(iibbMarginRate || iibbMatrix.intermediary.marginRate) * 100).toFixed(2)}%`}. Intermediario: IVA ${(intermediarySisaRule.vatRetentionRate * 100).toFixed(2)}%; Ganancias ${(intermediaryIncomeTaxRate * 100).toFixed(2)}%.`]
    );
    const lpgId = lpg.rows[0].id;
    await client.query(
      `INSERT INTO fin.lpg_line (tenant_id, lpg_id, grain_code, grain_name, campaign, origin_province, origin_locality,
        destination, cpe_number, deposit_certificate, net_weight_kg, reference_grade, moisture, sieve, volatile, quality_adjustment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [req.params.tenantId, lpgId, line.grainCode || 'OTHER', line.grainName, line.campaign, line.originProvince, line.originLocality, line.destination, line.cpeNumber, line.depositCertificate, weight, line.referenceGrade, line.moisture, line.sieve, line.volatile, qualityAdjustment]
    );
    for (const deduction of calculatedDeductions) {
      await client.query(
        `INSERT INTO fin.lpg_deduction (tenant_id, lpg_id, deduction_type, description, amount) VALUES ($1,$2,$3,$4,$5)`,
        [req.params.tenantId, lpgId, deduction.type || 'other', deduction.description || deduction.type || 'Deduccion', Number(deduction.amount || 0)]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(lpg.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ error: error.message }); } finally { client.release(); }
});

app.get('/api/arca/status', (req, res) => {
  const exists = filePath => Boolean(filePath && fs.existsSync(filePath));
  res.json({
    configured: arca.isConfigured(),
    environment: arca.environment,
    wsaa: arca.isConfigured() ? 'ready' : 'missing_credentials',
    certificate: exists(arca.certificatePath) ? 'found' : 'missing',
    privateKey: exists(arca.privateKeyPath) ? 'found' : 'missing',
    services: {
      lpg: Boolean(arca.lpgUrl),
      sisa: Boolean(arca.sisaUrl),
      cpe: Boolean(arca.cpeUrl),
      configured: [arca.lpgUrl, arca.sisaUrl, arca.cpeUrl].filter(Boolean).length
    }
  });
});

app.put('/api/arca/config', async (req, res) => {
  const allowed = ['ARCA_ENVIRONMENT', 'ARCA_CUIT', 'ARCA_CERTIFICATE_PATH', 'ARCA_PRIVATE_KEY_PATH', 'ARCA_LPG_URL', 'ARCA_LPG_SOAP_ACTION', 'ARCA_LPG_OPERATION', 'ARCA_SISA_WSN', 'ARCA_SISA_URL', 'ARCA_SISA_SOAP_ACTION', 'ARCA_SISA_OPERATION', 'ARCA_CPE_WSN', 'ARCA_CPE_URL', 'ARCA_CPE_SOAP_ACTION', 'ARCA_CPE_OPERATION'];
  const updates = Object.fromEntries(allowed.filter(key => req.body[key] !== undefined).map(key => [key, String(req.body[key] || '').trim()]));
  if (updates.ARCA_ENVIRONMENT && !['testing', 'production'].includes(updates.ARCA_ENVIRONMENT)) return res.status(400).json({ error: 'El ambiente debe ser testing o production' });
  try {
    const envPath = path.join(__dirname, '.env');
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    for (const [key, value] of Object.entries(updates)) {
      const line = `${key}=${value.replace(/\\/g, '\\\\')}`;
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
      process.env[key] = value;
    }
    fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
    Object.assign(arca, new ArcaClient(process.env));
    res.json({ saved: true, status: { environment: arca.environment, configured: arca.isConfigured() } });
  } catch (error) { res.status(500).json({ error: `No se pudo guardar la configuración ARCA: ${error.message}` }); }
});

app.post('/api/tenants/:tenantId/arca/sisa/check', async (req, res) => {
  const { subjectTaxId, subjectName } = req.body;
  if (!subjectTaxId) return res.status(400).json({ error: 'El CUIT a consultar es obligatorio' });
  try {
    const arcaResult = await arca.checkSisa(subjectTaxId);
    const result = await db.query(
      `INSERT INTO fin.arca_sisa_check (tenant_id, subject_tax_id, subject_name, sisa_status, registration_status, result_payload, status)
       VALUES ($1,$2,$3,$4,$5,$6,'authorized') RETURNING *`,
      [req.params.tenantId, subjectTaxId, subjectName, arcaResult.sisaStatus, arcaResult.sisaStatus, JSON.stringify({ response: arcaResult.response })]
    );
    res.json(result.rows[0]);
  } catch (error) {
    const result = await db.query(
      `INSERT INTO fin.arca_sisa_check (tenant_id, subject_tax_id, subject_name, status, error_message)
       VALUES ($1,$2,$3,'error',$4) RETURNING *`,
      [req.params.tenantId, subjectTaxId, subjectName, error.message]
    );
    res.status(502).json({ error: error.message, check: result.rows[0] });
  }
});

app.post('/api/tenants/:tenantId/arca/cpe', async (req, res) => {
  const { lpgId, issuerTaxId, producerTaxId, originProvince, originLocality, destination, grainCode, grainName, campaign, grossWeightKg, vehiclePlate, trailerPlate, driverTaxId, driverName } = req.body;
  if (!issuerTaxId || !producerTaxId || !originProvince || !destination || !grainCode || !grainName || !grossWeightKg) return res.status(400).json({ error: 'Faltan datos obligatorios para la Carta de Porte' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const draft = await client.query(
      `INSERT INTO fin.arca_cpe (tenant_id, lpg_id, issuer_tax_id, producer_tax_id, origin_province, origin_locality, destination, grain_code, grain_name, campaign, gross_weight_kg, vehicle_plate, trailer_plate, driver_tax_id, driver_name, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [req.params.tenantId, lpgId || null, issuerTaxId, producerTaxId, originProvince, originLocality, destination, grainCode, grainName, campaign, grossWeightKg, vehiclePlate, trailerPlate, driverTaxId, driverName, JSON.stringify(req.body)]
    );
    const arcaResult = await arca.requestCpe(draft.rows[0]);
    const result = await client.query(
      `UPDATE fin.arca_cpe SET cpe_number = $1, authorization_code = $2, status = 'authorized', response_payload = $3, authorized_at = now() WHERE id = $4 RETURNING *`,
      [arcaResult.cpeNumber, arcaResult.authorizationCode, JSON.stringify({ response: arcaResult.response }), draft.rows[0].id]
    );
    if (lpgId && arcaResult.cpeNumber) await client.query('UPDATE fin.lpg_line SET cpe_number = $1 WHERE lpg_id = $2', [arcaResult.cpeNumber, lpgId]);
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(502).json({ error: `ARCA no autorizó la Carta de Porte: ${error.message}` });
  } finally { client.release(); }
});

app.post('/api/tenants/:tenantId/lpgs/:lpgId/authorize', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT l.*, ll.grain_name, ll.campaign, ll.net_weight_kg, ll.cpe_number, ll.deposit_certificate
       FROM fin.lpg l LEFT JOIN fin.lpg_line ll ON ll.lpg_id = l.id
       WHERE l.id = $1 AND l.tenant_id = $2`,
      [req.params.lpgId, req.params.tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'LPG no encontrada' });
    const authorization = await arca.authorizeLpg(result.rows[0]);
    const updated = await db.query(
      `UPDATE fin.lpg SET coe = COALESCE($1, coe), status = 'authorized' WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [authorization.coe, req.params.lpgId, req.params.tenantId]
    );
    res.json({ lpg: updated.rows[0], arca: { authorizationCode: authorization.authorizationCode } });
  } catch (error) {
    await db.query(`UPDATE fin.lpg SET status = 'rejected', notes = CONCAT(COALESCE(notes, ''), $1) WHERE id = $2 AND tenant_id = $3`, [`\nARCA: ${error.message}`, req.params.lpgId, req.params.tenantId]).catch(() => {});
    res.status(502).json({ error: `ARCA no autorizó la LPG: ${error.message}` });
  }
});

app.get('/api/tenants/:tenantId/cash-accounts', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ca.*, COALESCE(ca.opening_balance, 0) + COALESCE(SUM(CASE WHEN cm.movement_type = 'in' THEN cm.amount_usd ELSE -cm.amount_usd END), 0) AS current_balance
       FROM fin.cash_account ca LEFT JOIN fin.cash_movement cm ON cm.cash_account_id = ca.id AND cm.status = 'confirmed'
       WHERE ca.tenant_id = $1 AND ca.active GROUP BY ca.id ORDER BY ca.active DESC, ca.name`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/cash-accounts', async (req, res) => {
  const { name, accountType, currencyId, openingBalance, cbu } = req.body;
  try {
    const normalizedAccountType = { 'Caja de ahorro · Pesos': 'savings_ars', 'Caja de ahorro · Dólares': 'savings_usd', 'Cuenta corriente · Pesos': 'checking_ars', 'Cuenta corriente · Dólares': 'checking_usd' }[accountType] || accountType;
    const currencyCode = currencyId || (normalizedAccountType === 'savings_ars' || normalizedAccountType === 'checking_ars' ? 'ARS' : 'USD');
    const currency = currencyId?.length > 20 ? currencyId : (await db.query('SELECT id FROM ref.currency WHERE code = $1 LIMIT 1', [currencyCode])).rows[0]?.id;
    const result = await db.query(
      `INSERT INTO fin.cash_account (tenant_id, name, account_type, currency_id, opening_balance, cbu)
       VALUES ($1, $2, COALESCE($3, 'bank'), $4, COALESCE($5, 0), NULLIF($6, '')) RETURNING *`,
      [req.params.tenantId, name, normalizedAccountType, currency, openingBalance, cbu]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/cash-movements', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cm.*, ca.name AS account_name FROM fin.cash_movement cm JOIN fin.cash_account ca ON ca.id = cm.cash_account_id
       WHERE cm.tenant_id = $1 ORDER BY cm.movement_date DESC, cm.created_at DESC`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/cash-movements', async (req, res) => {
  const { cashAccountId, movementDate, movementType, sourceType, sourceId, description, amountUsd } = req.body;
  if (!cashAccountId || !movementType || !description || !Number(amountUsd)) return res.status(400).json({ error: 'Cuenta, tipo, descripcion e importe son obligatorios' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query('SELECT id FROM fin.cash_account WHERE id = $1 AND tenant_id = $2 AND active', [cashAccountId, req.params.tenantId]);
    if (!account.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La cuenta de fondos seleccionada no existe, está inactiva o pertenece a otra empresa.' });
    }
    const result = await client.query(
      `INSERT INTO fin.cash_movement (tenant_id, cash_account_id, movement_date, movement_type, source_type, source_id, description, amount_usd)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, COALESCE($5, 'manual'), $6, $7, $8) RETURNING *`,
      [req.params.tenantId, cashAccountId, movementDate, movementType, sourceType, sourceId || null, description, amountUsd]
    );
    if (sourceType === 'sale' && sourceId && movementType === 'in') {
      await client.query("UPDATE fin.sale SET payment_status = 'paid' WHERE id = $1 AND tenant_id = $2", [sourceId, req.params.tenantId]);
    }
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

app.get('/api/tenants/:tenantId/cash-flow', async (req, res) => {
  const { from, to } = req.query;
  try {
    const result = await db.query(
      `SELECT movement_date, COALESCE(SUM(amount_usd) FILTER (WHERE movement_type = 'in'), 0) AS cash_in,
              COALESCE(SUM(amount_usd) FILTER (WHERE movement_type = 'out'), 0) AS cash_out,
              COALESCE(SUM(amount_usd) FILTER (WHERE movement_type = 'in'), 0) - COALESCE(SUM(amount_usd) FILTER (WHERE movement_type = 'out'), 0) AS net
       FROM fin.cash_movement WHERE tenant_id = $1 AND status = 'confirmed'
         AND movement_date >= COALESCE($2::date, date_trunc('year', CURRENT_DATE)::date)
         AND movement_date <= COALESCE($3::date, CURRENT_DATE)
       GROUP BY movement_date ORDER BY movement_date DESC`,
      [req.params.tenantId, from || null, to || null]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// CHEQUES
// ============================================================
app.get('/api/tenants/:tenantId/checks', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cb.*, ca.name AS account_name FROM fin.check_book cb
       LEFT JOIN fin.cash_account ca ON ca.id = cb.cash_account_id
       WHERE cb.tenant_id = $1 ORDER BY cb.due_date, cb.created_at DESC`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/checks', async (req, res) => {
  const { cashAccountId, checkNumber, checkType, bankName, holderName, issueDate, dueDate, amountUsd, notes } = req.body;
  if (!checkNumber || !checkType || !bankName || !holderName || !dueDate || !Number(amountUsd)) return res.status(400).json({ error: 'Numero, tipo, banco, titular, vencimiento e importe son obligatorios' });
  try {
    const result = await db.query(
      `INSERT INTO fin.check_book (tenant_id, cash_account_id, check_number, check_type, bank_name, holder_name, issue_date, due_date, amount_usd, notes)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, CURRENT_DATE), $8, $9, $10) RETURNING *`,
      [req.params.tenantId, cashAccountId || null, checkNumber, checkType, bankName, holderName, issueDate, dueDate, amountUsd, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/checks/:checkId', async (req, res) => {
  const { tenantId, status, cashAccountId } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const check = await client.query('SELECT * FROM fin.check_book WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [req.params.checkId, tenantId]);
    if (!check.rows[0]) throw new Error('Cheque no encontrado');
    const updated = await client.query(
      `UPDATE fin.check_book SET status = $2, cash_account_id = COALESCE($3, cash_account_id) WHERE id = $1 RETURNING *`,
      [req.params.checkId, status, cashAccountId || null]
    );
    if (check.rows[0].check_type === 'received' && ['deposited', 'cashed'].includes(status) && check.rows[0].status !== status) {
      const accountId = cashAccountId || check.rows[0].cash_account_id;
      if (!accountId) throw new Error('El cheque necesita una cuenta de fondos');
      await client.query(
        `INSERT INTO fin.cash_movement (tenant_id, cash_account_id, movement_date, movement_type, source_type, source_id, description, amount_usd)
         VALUES ($1, $2, CURRENT_DATE, 'in', 'check', $3, $4, $5)`,
        [tenantId, accountId, req.params.checkId, `Cobro cheque ${check.rows[0].check_number}`, check.rows[0].amount_usd]
      );
    }
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ error: error.message }); } finally { client.release(); }
});

// ============================================================
// CREDITOS Y CUENTAS POR COBRAR
// ============================================================
app.get('/api/tenants/:tenantId/credits', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, s.sale_number, COALESCE(SUM(cp.amount_usd), 0) AS paid_amount_usd
       FROM fin.credit c LEFT JOIN fin.sale s ON s.id = c.sale_id
       LEFT JOIN fin.credit_payment cp ON cp.credit_id = c.id
      WHERE c.tenant_id = $1 GROUP BY c.id, s.sale_number ORDER BY c.due_date, c.id DESC`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/credit-summary', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'open') AS open_credits,
              COALESCE(SUM(outstanding_amount_usd) FILTER (WHERE status = 'open'), 0) AS outstanding_amount_usd,
              COUNT(*) FILTER (WHERE status = 'open' AND due_date < CURRENT_DATE) AS overdue_credits,
              COALESCE(SUM(outstanding_amount_usd) FILTER (WHERE status = 'open' AND due_date < CURRENT_DATE), 0) AS overdue_amount_usd
       FROM fin.credit WHERE tenant_id = $1`,
      [req.params.tenantId]
    );
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/credits', async (req, res) => {
  const { creditNumber, saleId, customerName, issueDate, dueDate, principalAmountUsd, interestRate, notes, amortizationSystem = 'french', installmentCount = 1, installmentFrequency = 'monthly' } = req.body;
  const principal = Number(principalAmountUsd || 0); const annualRate = Number(interestRate || 0); const count = Math.max(1, Number(installmentCount || 1));
  if (!creditNumber || !customerName || !dueDate || principal <= 0) return res.status(400).json({ error: 'Numero, cliente, vencimiento e importe son obligatorios' });
  if (!['french', 'german', 'american'].includes(amortizationSystem)) return res.status(400).json({ error: 'Sistema de amortizacion invalido' });
  const startDate = new Date(`${issueDate || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const addPeriod = (base, period) => { const date = new Date(base); if (installmentFrequency === 'weekly') date.setUTCDate(date.getUTCDate() + period * 7); else if (installmentFrequency === 'quarterly') date.setUTCMonth(date.getUTCMonth() + period * 3); else date.setUTCMonth(date.getUTCMonth() + period); return date.toISOString().slice(0, 10); };
  const periodicRate = annualRate / 100 / (installmentFrequency === 'weekly' ? 52 : installmentFrequency === 'quarterly' ? 4 : 12);
  let balance = principal; const schedule = []; let installmentTotal = 0;
  for (let number = 1; number <= count; number += 1) {
    const interest = amortizationSystem === 'american' ? balance * periodicRate : balance * periodicRate;
    const fixedPayment = periodicRate === 0 ? principal / count : principal * periodicRate / (1 - Math.pow(1 + periodicRate, -count));
    const principalPart = amortizationSystem === 'american' ? (number === count ? balance : 0) : amortizationSystem === 'german' ? principal / count : Math.min(balance, fixedPayment - interest);
    const amount = amortizationSystem === 'american' ? interest + principalPart : principalPart + interest;
    balance = Math.max(0, balance - principalPart); installmentTotal += amount;
    schedule.push({ number, dueDate: number === count ? dueDate : addPeriod(startDate, number), principalAmount: principalPart, interestAmount: interest, amount, outstandingPrincipal: balance });
  }
  const total = installmentTotal;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO fin.credit (tenant_id, sale_id, customer_name, credit_number, issue_date, due_date, principal_amount_usd, interest_rate, total_amount_usd, outstanding_amount_usd, amortization_system, installment_count, installment_frequency, notes)
       VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE), $6, $7, $8, $9, $9, $10, $11, $12, $13) RETURNING *`,
      [req.params.tenantId, saleId || null, customerName, creditNumber, issueDate, dueDate, principal, annualRate, total, amortizationSystem, count, installmentFrequency, notes]
    );
    for (const installment of schedule) await client.query(
      `INSERT INTO fin.credit_installment (tenant_id, credit_id, installment_number, due_date, principal_amount_usd, interest_amount_usd, installment_amount_usd, outstanding_principal_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.params.tenantId, result.rows[0].id, installment.number, installment.dueDate, installment.principalAmount, installment.interestAmount, installment.amount, installment.outstandingPrincipal]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ error: error.message }); } finally { client.release(); }
});

app.get('/api/credits/:creditId/installments', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM fin.credit_installment WHERE credit_id = $1 ORDER BY installment_number`,
      [req.params.creditId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/credit-installments', async (req, res) => {
  const { status = 'due' } = req.query;
  const filters = {
    paid: "ci.status = 'paid'",
    due: "ci.status = 'pending' AND ci.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'",
    overdue: "ci.status = 'pending' AND ci.due_date < CURRENT_DATE"
  };
  try {
    const result = await db.query(
      `SELECT ci.*, c.credit_number, c.customer_name, c.amortization_system
       FROM fin.credit_installment ci JOIN fin.credit c ON c.id = ci.credit_id
       WHERE ci.tenant_id = $1 AND ${filters[status] || filters.due}
       ORDER BY ci.due_date, c.customer_name, ci.installment_number`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/credits/:creditId/payments', async (req, res) => {
  const { tenantId, cashAccountId, paymentDate, amountUsd, notes } = req.body;
  const amount = Number(amountUsd || 0);
  if (!tenantId || !cashAccountId || amount <= 0) return res.status(400).json({ error: 'Tenant, cuenta e importe son obligatorios' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const credit = await client.query('SELECT * FROM fin.credit WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [req.params.creditId, tenantId]);
    if (!credit.rows[0]) throw new Error('Credito no encontrado');
    if (amount > Number(credit.rows[0].outstanding_amount_usd)) throw new Error('El pago supera el saldo pendiente');
    const payment = await client.query(
      `INSERT INTO fin.credit_payment (tenant_id, credit_id, cash_account_id, payment_date, amount_usd, notes)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6) RETURNING *`,
      [tenantId, req.params.creditId, cashAccountId, paymentDate, amount, notes]
    );
    const outstanding = Number(credit.rows[0].outstanding_amount_usd) - amount;
    let remainingPayment = amount;
    const installments = await client.query(
      `SELECT id, installment_amount_usd, paid_amount_usd FROM fin.credit_installment WHERE credit_id = $1 AND status = 'pending' ORDER BY installment_number FOR UPDATE`,
      [req.params.creditId]
    );
    for (const installment of installments.rows) {
      if (remainingPayment <= 0) break;
      const pendingAmount = Number(installment.installment_amount_usd) - Number(installment.paid_amount_usd);
      const applied = Math.min(remainingPayment, pendingAmount);
      const paidAmount = Number(installment.paid_amount_usd) + applied;
      await client.query(
        `UPDATE fin.credit_installment SET paid_amount_usd = $2, status = CASE WHEN paid_amount_usd + $3 >= installment_amount_usd - 0.01 THEN 'paid' ELSE 'pending' END WHERE id = $1`,
        [installment.id, paidAmount, applied]
      );
      remainingPayment -= applied;
    }
    await client.query("UPDATE fin.credit SET outstanding_amount_usd = $2, status = CASE WHEN $2 <= 0 THEN 'paid' ELSE 'open' END WHERE id = $1", [req.params.creditId, outstanding]);
    await client.query(
      `INSERT INTO fin.cash_movement (tenant_id, cash_account_id, movement_date, movement_type, source_type, source_id, description, amount_usd)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), 'in', 'credit_payment', $4, $5, $6)`,
      [tenantId, cashAccountId, paymentDate, payment.rows[0].id, `Cobro credito ${credit.rows[0].credit_number}`, amount]
    );
    await client.query('COMMIT');
    res.status(201).json({ payment: payment.rows[0], outstandingAmountUsd: outstanding });
  } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ error: error.message }); } finally { client.release(); }
});

// ============================================================
// RRHH: EMPLEADOS, ASISTENCIA Y LIQUIDACIONES
// ============================================================
app.get('/api/tenants/:tenantId/hr-summary', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM hr.employee WHERE tenant_id = $1 AND employment_status = 'active') AS active_employees,
         (SELECT COUNT(*) FROM hr.attendance WHERE tenant_id = $1 AND work_date = CURRENT_DATE AND status = 'present') AS present_today,
         (SELECT COUNT(*) FROM hr.attendance WHERE tenant_id = $1 AND work_date = CURRENT_DATE AND status IN ('absent', 'leave')) AS absences_today,
         (SELECT COALESCE(SUM(net_amount_usd), 0) FROM hr.payroll_item WHERE tenant_id = $1 AND status IN ('approved', 'paid')) AS payroll_cost_usd`,
      [req.params.tenantId]
    );
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/employees', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, c.contract_type, c.start_date AS contract_start, c.end_date AS contract_end
       FROM hr.employee e LEFT JOIN LATERAL (SELECT contract_type, start_date, end_date FROM hr.employment_contract WHERE employee_id = e.id ORDER BY start_date DESC LIMIT 1) c ON true
       WHERE e.tenant_id = $1 ORDER BY e.employment_status, e.last_name, e.first_name`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/employees', async (req, res) => {
  const { employeeCode, firstName, lastName, nationalId, email, phone, jobTitle, department, hireDate, hourlyRateUsd, monthlySalaryUsd, contractType, contractStart, contractEnd } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const employee = await client.query(
      `INSERT INTO hr.employee (tenant_id, employee_code, first_name, last_name, national_id, email, phone, job_title, department, hire_date, hourly_rate_usd, monthly_salary_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'campo'), $10, COALESCE($11, 0), COALESCE($12, 0)) RETURNING *`,
      [req.params.tenantId, employeeCode, firstName, lastName, nationalId, email, phone, jobTitle, department, hireDate, hourlyRateUsd, monthlySalaryUsd]
    );
    await client.query(
      `INSERT INTO hr.employment_contract (tenant_id, employee_id, contract_type, start_date, end_date, salary_usd)
       VALUES ($1, $2, COALESCE($3, 'permanent'), COALESCE($4, CURRENT_DATE), $5, COALESCE($6, 0))`,
      [req.params.tenantId, employee.rows[0].id, contractType, contractStart, contractEnd, monthlySalaryUsd]
    );
    await client.query('COMMIT');
    res.status(201).json(employee.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ error: error.message }); } finally { client.release(); }
});

app.post('/api/tenants/:tenantId/attendance', async (req, res) => {
  const { employeeId, workDate, status, hoursWorked, overtimeHours, note } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO hr.attendance (tenant_id, employee_id, work_date, status, hours_worked, overtime_hours, note)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), COALESCE($4, 'present'), COALESCE($5, 0), COALESCE($6, 0), $7)
       ON CONFLICT (employee_id, work_date) DO UPDATE SET status = EXCLUDED.status, hours_worked = EXCLUDED.hours_worked, overtime_hours = EXCLUDED.overtime_hours, note = EXCLUDED.note
       RETURNING *`,
      [req.params.tenantId, employeeId, workDate, status, hoursWorked, overtimeHours, note]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/attendance', async (req, res) => {
  const { from, to } = req.query;
  try {
    const result = await db.query(
      `SELECT a.*, e.employee_code, e.first_name, e.last_name FROM hr.attendance a JOIN hr.employee e ON e.id = a.employee_id
       WHERE a.tenant_id = $1 AND a.work_date >= COALESCE($2::date, CURRENT_DATE - 30) AND a.work_date <= COALESCE($3::date, CURRENT_DATE)
       ORDER BY a.work_date DESC, e.last_name`,
      [req.params.tenantId, from || null, to || null]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tenants/:tenantId/payroll-periods', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pp.*, COUNT(pi.id) AS employee_count, COALESCE(SUM(pi.net_amount_usd), 0) AS net_total_usd
       FROM hr.payroll_period pp LEFT JOIN hr.payroll_item pi ON pi.payroll_period_id = pp.id
       WHERE pp.tenant_id = $1 GROUP BY pp.id ORDER BY pp.period_start DESC`,
      [req.params.tenantId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tenants/:tenantId/payroll-periods', async (req, res) => {
  const { periodStart, periodEnd, paymentDate } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO hr.payroll_period (tenant_id, period_start, period_end, payment_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.tenantId, periodStart, periodEnd, paymentDate]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/payroll-periods/:periodId/items', async (req, res) => {
  const { tenantId, employeeId, baseAmountUsd, overtimeAmountUsd, bonusAmountUsd, deductionAmountUsd, status } = req.body;
  const base = Number(baseAmountUsd || 0); const overtime = Number(overtimeAmountUsd || 0); const bonus = Number(bonusAmountUsd || 0); const deduction = Number(deductionAmountUsd || 0);
  try {
    const result = await db.query(
      `INSERT INTO hr.payroll_item (tenant_id, payroll_period_id, employee_id, base_amount_usd, overtime_amount_usd, bonus_amount_usd, deduction_amount_usd, net_amount_usd, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $4 + $5 + $6 - $7, COALESCE($8, 'draft')) RETURNING *`,
      [tenantId, req.params.periodId, employeeId, base, overtime, bonus, deduction, status]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/payroll-periods/:periodId/items', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pi.*, e.employee_code, e.first_name, e.last_name FROM hr.payroll_item pi JOIN hr.employee e ON e.id = pi.employee_id
       WHERE pi.payroll_period_id = $1 ORDER BY e.last_name, e.first_name`,
      [req.params.periodId]
    );
    res.json(result.rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================
// INVENTORY
// ============================================================
app.get('/api/establishments/:estabId/inventory', async (req, res) => {
  const { estabId } = req.params;
  try {
    const result = await db.query(
      `SELECT sl.id, sl.warehouse_id, i.name as input_name, sl.quantity, sl.uom_id, sl.reorder_level,
              CASE WHEN sl.quantity <= sl.reorder_level THEN 'LOW' ELSE 'OK' END as status
       FROM inv.stock_lot sl
       JOIN agr.input i ON sl.input_id = i.id
       JOIN inv.warehouse w ON sl.warehouse_id = w.id
       WHERE w.establishment_id = $1 ORDER BY i.name`,
      [estabId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/inventory/movements', async (req, res) => {
  const { warehouseId, inputId, quantity, movementType, reference } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO inv.inventory_movement (id, warehouse_id, input_id, quantity, movement_type, reference, movement_date)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now()) RETURNING *`,
      [warehouseId, inputId, quantity, movementType, reference]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// AUDIT LOG
// ============================================================
app.get('/api/audit-log', async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  try {
    const result = await db.query(
      `SELECT user_id, action, resource_type, resource_id, timestamp, result
       FROM audit.audit_event
       ORDER BY timestamp DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PRECISION - PRESCRIPTIONS
// ============================================================
app.get('/api/plots/:plotId/prescriptions', async (req, res) => {
  const { plotId } = req.params;
  try {
    const result = await db.query(
      `SELECT id, code, operation_type, target_rate, min_rate, max_rate, created_at
       FROM geo.prescription_map
       WHERE plot_id = $1 ORDER BY created_at DESC`,
      [plotId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/plots/:plotId/prescriptions', async (req, res) => {
  const { plotId } = req.params;
  const { code, operationType, targetRate, minRate, maxRate } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO geo.prescription_map (id, plot_id, code, operation_type, target_rate, min_rate, max_rate, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now()) RETURNING *`,
      [plotId, code, operationType, targetRate, minRate, maxRate]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Start Server
// ============================================================
app.listen(PORT, () => {
  console.log(`🌾 Pampa Precision ERP Server running on http://localhost:${PORT}`);
  console.log(`📊 Frontend: http://localhost:${PORT}`);
  console.log(`🔌 API: http://localhost:${PORT}/api`);
});

module.exports = app;
