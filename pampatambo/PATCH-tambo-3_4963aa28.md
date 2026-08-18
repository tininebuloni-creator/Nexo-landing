# PATCH — Módulo TAMBO (3ª pasada)

Cierra el módulo con **4 áreas nuevas**:
- `tamboAlimentacion` — raciones específicas del tambo (lactancia / seca / vaquillonas)
- `tamboPasturas` — potreros + rotación
- `tamboPersonal` — tamberos, turnos de ordeñe, tareas
- `tamboDashboard` — vista con gráfico de litros/día y KPIs generales del tambo

Requiere haber aplicado antes **PATCH-tambo.md** y **PATCH-tambo-2.md**.

> Chart.js ya está cargado por el ERP (línea 21 del HTML), así que el dashboard lo reusa.

---

## 1) Sidebar — 4 items nuevos en la sección "Tambo"

**Archivo:** `nexo-agro-erp.html` — dentro del `<div class="nav-section">` de Tambo.

Contexto:
```html
      <div class="nav-section">
        <div class="nav-section-title">Tambo</div>
        <div class="nav-item" data-module="tamboVacas"><span class="nav-icon">🐮</span> Vacas del Tambo</div>
        <div class="nav-item" data-module="tamboOrdenes"><span class="nav-icon">🥛</span> Ordeñes</div>
        <div class="nav-item" data-module="tamboReproduccion"><span class="nav-icon">🐄</span> Reproducción</div>
        <div class="nav-item" data-module="tamboSanidad"><span class="nav-icon">💉</span> Sanidad</div>
        <div class="nav-item" data-module="tamboUsina"><span class="nav-icon">🏭</span> Usina / Remitos</div>
«INSERTAR ACÁ»
      </div>
```

Pegar:
```html
        <div class="nav-item" data-module="tamboAlimentacion"><span class="nav-icon">🌽</span> Alimentación Tambo</div>
        <div class="nav-item" data-module="tamboPasturas"><span class="nav-icon">🌿</span> Pasturas</div>
        <div class="nav-item" data-module="tamboPersonal"><span class="nav-icon">👨‍🌾</span> Personal Tambo</div>
        <div class="nav-item" data-module="tamboDashboard"><span class="nav-icon">📈</span> Dashboard Tambo</div>
```

> **Tip UX**: si querés que "Dashboard Tambo" aparezca **arriba** de todo dentro de la sección Tambo, movelo como primer item del bloque.

---

## 2) HTML de los 4 módulos

Insertar **después del `</div>` que cierra `<div class="module" id="mod-tamboUsina">`** (agregado en el patch 2).

```html
      <!-- MODULE: TAMBO ALIMENTACION -->
      <div class="module" id="mod-tamboAlimentacion">
        <div class="kpi-grid">
          <div class="kpi blue">
            <div class="kpi-label">🍽️ Raciones</div>
            <div class="kpi-value" id="tamboAliKpiRaciones">0</div>
            <div class="kpi-sub">Total definidas</div>
          </div>
          <div class="kpi green">
            <div class="kpi-label">📦 Consumo Hoy</div>
            <div class="kpi-value" id="tamboAliKpiConsumoHoy">0</div>
            <div class="kpi-sub">kg entregados</div>
          </div>
          <div class="kpi orange">
            <div class="kpi-label">📅 Consumo 7d</div>
            <div class="kpi-value" id="tamboAliKpi7d">0</div>
            <div class="kpi-sub">kg entregados</div>
          </div>
          <div class="kpi red">
            <div class="kpi-label">📆 Consumo 30d</div>
            <div class="kpi-value" id="tamboAliKpi30d">0</div>
            <div class="kpi-sub">kg entregados</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🍽️ Raciones del Tambo</div>
            <button class="topbar-btn primary" onclick="openModal('tamboRaciones')">+ Nueva Ración</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Destinatario</th>
                <th>Ingredientes</th>
                <th>kg/animal/día</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody id="tamboRacionesBody"></tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">📦 Consumo Diario</div>
            <button class="topbar-btn primary" onclick="openModal('tamboConsumos')">+ Registrar Consumo</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Ración</th>
                <th>Cantidad (kg)</th>
                <th>Categoría</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody id="tamboConsumosBody"></tbody>
          </table>
        </div>
      </div>

      <!-- MODULE: TAMBO PASTURAS -->
      <div class="module" id="mod-tamboPasturas">
        <div class="kpi-grid">
          <div class="kpi blue">
            <div class="kpi-label">🌿 Potreros</div>
            <div class="kpi-value" id="tamboPasKpiPotreros">0</div>
            <div class="kpi-sub">Total</div>
          </div>
          <div class="kpi green">
            <div class="kpi-label">📏 Hectáreas</div>
            <div class="kpi-value" id="tamboPasKpiHa">0</div>
            <div class="kpi-sub">Superficie total</div>
          </div>
          <div class="kpi orange">
            <div class="kpi-label">🔄 Rotaciones</div>
            <div class="kpi-value" id="tamboPasKpiRot">0</div>
            <div class="kpi-sub">Registradas</div>
          </div>
          <div class="kpi red">
            <div class="kpi-label">🐮 Ocupados Hoy</div>
            <div class="kpi-value" id="tamboPasKpiOcup">0</div>
            <div class="kpi-sub">Potreros con animales</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🌿 Potreros del Tambo</div>
            <button class="topbar-btn primary" onclick="openModal('tamboPotreros')">+ Nuevo Potrero</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Hectáreas</th>
                <th>Tipo Pastura</th>
                <th>Fecha Siembra</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody id="tamboPotrerosBody"></tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🔄 Rotaciones</div>
            <button class="topbar-btn primary" onclick="openModal('tamboRotaciones')">+ Nueva Rotación</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Potrero</th>
                <th>Ingreso</th>
                <th>Salida</th>
                <th>Categoría</th>
                <th>Nº Animales</th>
                <th>Disp. (kgMS/ha)</th>
              </tr>
            </thead>
            <tbody id="tamboRotacionesBody"></tbody>
          </table>
        </div>
      </div>

      <!-- MODULE: TAMBO PERSONAL -->
      <div class="module" id="mod-tamboPersonal">
        <div class="kpi-grid">
          <div class="kpi blue">
            <div class="kpi-label">👨‍🌾 Tamberos</div>
            <div class="kpi-value" id="tamboPerKpiTamberos">0</div>
            <div class="kpi-sub">Personal activo</div>
          </div>
          <div class="kpi green">
            <div class="kpi-label">⏰ Turnos Hoy</div>
            <div class="kpi-value" id="tamboPerKpiTurnosHoy">0</div>
            <div class="kpi-sub">Asignados</div>
          </div>
          <div class="kpi orange">
            <div class="kpi-label">📋 Tareas Pendientes</div>
            <div class="kpi-value" id="tamboPerKpiPendientes">0</div>
            <div class="kpi-sub">Sin completar</div>
          </div>
          <div class="kpi red">
            <div class="kpi-label">✅ Tareas Hechas</div>
            <div class="kpi-value" id="tamboPerKpiHechas">0</div>
            <div class="kpi-sub">Últimos 7 días</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">👨‍🌾 Personal del Tambo</div>
            <button class="topbar-btn primary" onclick="openModal('tamboPersonalRegistro')">+ Nuevo Personal</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>DNI</th>
                <th>Rol</th>
                <th>Teléfono</th>
                <th>Fecha Ingreso</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody id="tamboPersonalRegistroBody"></tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">⏰ Turnos de Ordeñe</div>
            <button class="topbar-btn primary" onclick="openModal('tamboTurnos')">+ Asignar Turno</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Turno</th>
                <th>Personal</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody id="tamboTurnosBody"></tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">📋 Tareas</div>
            <button class="topbar-btn primary" onclick="openModal('tamboTareas')">+ Nueva Tarea</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Personal</th>
                <th>Descripción</th>
                <th>Estado</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody id="tamboTareasBody"></tbody>
          </table>
        </div>
      </div>

      <!-- MODULE: TAMBO DASHBOARD -->
      <div class="module" id="mod-tamboDashboard">
        <div class="kpi-grid">
          <div class="kpi blue">
            <div class="kpi-label">🥛 Litros Hoy</div>
            <div class="kpi-value" id="dashTamboLitrosHoy">0</div>
            <div class="kpi-sub">Suma del día</div>
          </div>
          <div class="kpi green">
            <div class="kpi-label">📊 Prom. 7d</div>
            <div class="kpi-value" id="dashTamboProm7d">0</div>
            <div class="kpi-sub">Litros/día promedio</div>
          </div>
          <div class="kpi orange">
            <div class="kpi-label">🐮 En Lactancia</div>
            <div class="kpi-value" id="dashTamboLact">0</div>
            <div class="kpi-sub">Vacas activas</div>
          </div>
          <div class="kpi red">
            <div class="kpi-label">💵 Ing. Mes</div>
            <div class="kpi-value" id="dashTamboIngMes">$0</div>
            <div class="kpi-sub">Última liquidación</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">📈 Producción diaria (últimos 30 días)</div>
          </div>
          <div class="chart-container" style="height:320px;"><canvas id="chartTamboLitros"></canvas></div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🥧 Composición del rodeo</div>
          </div>
          <div class="chart-container" style="height:280px;"><canvas id="chartTamboRodeo"></canvas></div>
        </div>
      </div>
```

---

## 3) State — 9 arrays nuevos

Dentro de `const state = {`, junto a los del patch 1 y 2:

```js
  tamboRaciones: [],
  tamboConsumos: [],
  tamboPotreros: [],
  tamboRotaciones: [],
  tamboPersonalRegistro: [],
  tamboTurnos: [],
  tamboTareas: [],
```

> `tamboAlimentacion`, `tamboPasturas`, `tamboPersonal`, `tamboDashboard` **no** llevan array — son vistas contenedoras.

---

## 4) Array `modules` — reemplazar línea 2863 completa

```js
const modules = ['dashboard','campos','lotes','campañas','aplicaciones','siembra','cosecha','inventario','hacienda','alimentacion','tamboVacas','tamboOrdenes','tamboReproduccion','tamboServicios','tamboPrenieces','tamboPartos','tamboSanidad','tamboVacunaciones','tamboTratamientos','tamboUsina','tamboRemitos','tamboLiquidaciones','tamboAlimentacion','tamboRaciones','tamboConsumos','tamboPasturas','tamboPotreros','tamboRotaciones','tamboPersonal','tamboPersonalRegistro','tamboTurnos','tamboTareas','tamboDashboard','maquinarias','cargacombustible','costosOperativos','mantenimiento','empleados','caja','bancos','cuentasBancarias','cheques','creditos','flujo','costos','rentabilidad','empresa','reportes','documentos'];
```

---

## 5) `formConfigs` — 7 schemas nuevos

Dentro de `const formConfigs = {`, junto a los anteriores:

```js
  tamboRaciones: {
    title: 'Nueva Ración',
    fields: [
      { name: 'nombre', label: 'Nombre', type: 'text', required: true },
      { name: 'destinatario', label: 'Destinatario', type: 'select', options: ['Vacas Lactancia', 'Vacas Secas', 'Vaquillonas', 'Terneros'], required: true },
      { name: 'ingredientes', label: 'Ingredientes', type: 'textarea', placeholder: 'Ej: Silo 15kg + Balanceado 5kg + Alfalfa 3kg' },
      { name: 'kgPorAnimal', label: 'kg/animal/día', type: 'number', step: 'any', required: true },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboConsumos: {
    title: 'Nuevo Consumo',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      { name: 'racion', label: 'Ración', type: 'select', required: true, dynamicOptions: 'tamboRaciones', displayField: 'nombre' },
      { name: 'cantidad', label: 'Cantidad (kg)', type: 'number', step: 'any', required: true },
      { name: 'categoria', label: 'Categoría', type: 'select', options: ['Vacas Lactancia', 'Vacas Secas', 'Vaquillonas', 'Terneros'] },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboPotreros: {
    title: 'Nuevo Potrero',
    fields: [
      { name: 'nombre', label: 'Nombre', type: 'text', required: true, autoNumber: { prefix: 'P', pad: 2 } },
      { name: 'hectareas', label: 'Hectáreas', type: 'number', step: 'any', required: true },
      { name: 'tipoPastura', label: 'Tipo de Pastura', type: 'select', options: ['Alfalfa', 'Mixta', 'Natural', 'Sorgo', 'Avena', 'Maíz Consociado'] },
      { name: 'fechaSiembra', label: 'Fecha Siembra', type: 'date' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboRotaciones: {
    title: 'Nueva Rotación',
    fields: [
      { name: 'potrero', label: 'Potrero', type: 'select', required: true, dynamicOptions: 'tamboPotreros', displayField: 'nombre' },
      { name: 'fechaIngreso', label: 'Fecha Ingreso', type: 'date', required: true },
      { name: 'fechaSalida', label: 'Fecha Salida', type: 'date' },
      { name: 'categoria', label: 'Categoría', type: 'select', options: ['Vacas Lactancia', 'Vacas Secas', 'Vaquillonas', 'Terneros'] },
      { name: 'cantidadAnimales', label: 'Nº Animales', type: 'number' },
      { name: 'disponibilidad', label: 'Disponibilidad (kgMS/ha)', type: 'number' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboPersonalRegistro: {
    title: 'Nuevo Personal',
    fields: [
      { name: 'nombre', label: 'Nombre y Apellido', type: 'text', required: true },
      { name: 'dni', label: 'DNI', type: 'text' },
      { name: 'rol', label: 'Rol', type: 'select', options: ['Tambero', 'Peón', 'Encargado', 'Veterinario', 'Ingeniero'], required: true },
      { name: 'telefono', label: 'Teléfono', type: 'text' },
      { name: 'fechaIngreso', label: 'Fecha de Ingreso', type: 'date' },
      { name: 'activo', label: 'Estado', type: 'select', options: ['Activo', 'Inactivo'], required: true },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboTurnos: {
    title: 'Nuevo Turno',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      { name: 'turno', label: 'Turno', type: 'select', options: ['Mañana', 'Tarde', 'Noche'], required: true },
      { name: 'personal', label: 'Personal', type: 'select', required: true, dynamicOptions: 'tamboPersonalRegistro', displayField: 'nombre' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboTareas: {
    title: 'Nueva Tarea',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      { name: 'personal', label: 'Personal', type: 'select', dynamicOptions: 'tamboPersonalRegistro', displayField: 'nombre' },
      { name: 'descripcion', label: 'Descripción', type: 'text', required: true },
      { name: 'estado', label: 'Estado', type: 'select', options: ['Pendiente', 'En Proceso', 'Hecha', 'Cancelada'], required: true },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
```

---

## 6) Funciones render + KPIs + gráficos

Pegar al final del bloque de funciones render:

```js
// ============================================================
// MÓDULO TAMBO — Alimentación
// ============================================================
function renderTamboRaciones() {
  const body = document.getElementById('tamboRacionesBody');
  if (!body) return;
  body.innerHTML = state.tamboRaciones.map((r, i) => `
    <tr onclick="openModal('tamboRaciones', ${i})" style="cursor:pointer;">
      <td><strong>${r.nombre || ''}</strong></td>
      <td><span class="tag blue">${r.destinatario || ''}</span></td>
      <td>${r.ingredientes || ''}</td>
      <td>${r.kgPorAnimal || 0}</td>
      <td>${r.observaciones || ''}</td>
    </tr>`).join('');
  actualizarKPIsTamboAlimentacion();
}

function renderTamboConsumos() {
  const body = document.getElementById('tamboConsumosBody');
  if (!body) return;
  const filas = [...state.tamboConsumos].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  body.innerHTML = filas.map((c) => {
    const idx = state.tamboConsumos.indexOf(c);
    return `
      <tr onclick="openModal('tamboConsumos', ${idx})" style="cursor:pointer;">
        <td>${c.fecha || ''}</td>
        <td>${c.racion || ''}</td>
        <td><strong>${(Number(c.cantidad) || 0).toLocaleString()}</strong> kg</td>
        <td>${c.categoria || ''}</td>
        <td>${c.observaciones || ''}</td>
      </tr>`;
  }).join('');
  actualizarKPIsTamboAlimentacion();
}

function actualizarKPIsTamboAlimentacion() {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace7  = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const raciones = state.tamboRaciones.length;
  const consumoHoy = state.tamboConsumos.filter(c => c.fecha === hoy).reduce((s, c) => s + (Number(c.cantidad) || 0), 0);
  const consumo7d  = state.tamboConsumos.filter(c => c.fecha >= hace7).reduce((s, c) => s + (Number(c.cantidad) || 0), 0);
  const consumo30d = state.tamboConsumos.filter(c => c.fecha >= hace30).reduce((s, c) => s + (Number(c.cantidad) || 0), 0);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('tamboAliKpiRaciones', raciones);
  set('tamboAliKpiConsumoHoy', consumoHoy.toLocaleString());
  set('tamboAliKpi7d', consumo7d.toLocaleString());
  set('tamboAliKpi30d', consumo30d.toLocaleString());
}

// ============================================================
// MÓDULO TAMBO — Pasturas
// ============================================================
function renderTamboPotreros() {
  const body = document.getElementById('tamboPotrerosBody');
  if (!body) return;
  body.innerHTML = state.tamboPotreros.map((p, i) => `
    <tr onclick="openModal('tamboPotreros', ${i})" style="cursor:pointer;">
      <td><strong>${p.nombre || ''}</strong></td>
      <td>${p.hectareas || 0}</td>
      <td>${p.tipoPastura || ''}</td>
      <td>${p.fechaSiembra || ''}</td>
      <td>${p.observaciones || ''}</td>
    </tr>`).join('');
  actualizarKPIsTamboPasturas();
}

function renderTamboRotaciones() {
  const body = document.getElementById('tamboRotacionesBody');
  if (!body) return;
  const filas = [...state.tamboRotaciones].sort((a, b) => (b.fechaIngreso || '').localeCompare(a.fechaIngreso || ''));
  body.innerHTML = filas.map((r) => {
    const idx = state.tamboRotaciones.indexOf(r);
    return `
      <tr onclick="openModal('tamboRotaciones', ${idx})" style="cursor:pointer;">
        <td>${r.potrero || ''}</td>
        <td>${r.fechaIngreso || ''}</td>
        <td>${r.fechaSalida || '<span class="tag green">Activo</span>'}</td>
        <td>${r.categoria || ''}</td>
        <td>${r.cantidadAnimales || 0}</td>
        <td>${r.disponibilidad || 0}</td>
      </tr>`;
  }).join('');
  actualizarKPIsTamboPasturas();
}

function actualizarKPIsTamboPasturas() {
  const potreros = state.tamboPotreros.length;
  const ha = state.tamboPotreros.reduce((s, p) => s + (Number(p.hectareas) || 0), 0);
  const rotaciones = state.tamboRotaciones.length;
  // Ocupados hoy = rotaciones con fechaIngreso <= hoy y (sin fechaSalida o fechaSalida > hoy)
  const hoy = new Date().toISOString().slice(0, 10);
  const ocupadosSet = new Set(
    state.tamboRotaciones
      .filter(r => (r.fechaIngreso || '') <= hoy && (!r.fechaSalida || r.fechaSalida >= hoy))
      .map(r => r.potrero)
  );

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('tamboPasKpiPotreros', potreros);
  set('tamboPasKpiHa', ha.toLocaleString());
  set('tamboPasKpiRot', rotaciones);
  set('tamboPasKpiOcup', ocupadosSet.size);
}

// ============================================================
// MÓDULO TAMBO — Personal
// ============================================================
function renderTamboPersonalRegistro() {
  const body = document.getElementById('tamboPersonalRegistroBody');
  if (!body) return;
  body.innerHTML = state.tamboPersonalRegistro.map((p, i) => {
    const tag = p.activo === 'Activo'
      ? '<span class="tag green">Activo</span>'
      : '<span class="tag red">Inactivo</span>';
    return `
      <tr onclick="openModal('tamboPersonalRegistro', ${i})" style="cursor:pointer;">
        <td><strong>${p.nombre || ''}</strong></td>
        <td>${p.dni || ''}</td>
        <td><span class="tag blue">${p.rol || ''}</span></td>
        <td>${p.telefono || ''}</td>
        <td>${p.fechaIngreso || ''}</td>
        <td>${tag}</td>
      </tr>`;
  }).join('');
  actualizarKPIsTamboPersonal();
}

function renderTamboTurnos() {
  const body = document.getElementById('tamboTurnosBody');
  if (!body) return;
  const filas = [...state.tamboTurnos].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  body.innerHTML = filas.map((t) => {
    const idx = state.tamboTurnos.indexOf(t);
    return `
      <tr onclick="openModal('tamboTurnos', ${idx})" style="cursor:pointer;">
        <td>${t.fecha || ''}</td>
        <td><span class="tag blue">${t.turno || ''}</span></td>
        <td>${t.personal || ''}</td>
        <td>${t.observaciones || ''}</td>
      </tr>`;
  }).join('');
  actualizarKPIsTamboPersonal();
}

function renderTamboTareas() {
  const body = document.getElementById('tamboTareasBody');
  if (!body) return;
  const filas = [...state.tamboTareas].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  body.innerHTML = filas.map((t) => {
    const idx = state.tamboTareas.indexOf(t);
    const tag = ({
      'Pendiente':  '<span class="tag orange">Pendiente</span>',
      'En Proceso': '<span class="tag blue">En Proceso</span>',
      'Hecha':      '<span class="tag green">Hecha</span>',
      'Cancelada':  '<span class="tag red">Cancelada</span>'
    })[t.estado] || t.estado || '';
    return `
      <tr onclick="openModal('tamboTareas', ${idx})" style="cursor:pointer;">
        <td>${t.fecha || ''}</td>
        <td>${t.personal || ''}</td>
        <td>${t.descripcion || ''}</td>
        <td>${tag}</td>
        <td>${t.observaciones || ''}</td>
      </tr>`;
  }).join('');
  actualizarKPIsTamboPersonal();
}

function actualizarKPIsTamboPersonal() {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const tamberos    = state.tamboPersonalRegistro.filter(p => p.activo === 'Activo').length;
  const turnosHoy   = state.tamboTurnos.filter(t => t.fecha === hoy).length;
  const pendientes  = state.tamboTareas.filter(t => t.estado === 'Pendiente').length;
  const hechas7     = state.tamboTareas.filter(t => t.estado === 'Hecha' && t.fecha >= hace7).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('tamboPerKpiTamberos', tamberos);
  set('tamboPerKpiTurnosHoy', turnosHoy);
  set('tamboPerKpiPendientes', pendientes);
  set('tamboPerKpiHechas', hechas7);
}

// ============================================================
// MÓDULO TAMBO — Dashboard (con Chart.js)
// ============================================================
let chartTamboLitros = null;
let chartTamboRodeo  = null;

function renderTamboDashboard() {
  // KPIs superiores
  const hoy = new Date().toISOString().slice(0, 10);
  const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const litrosHoy = state.tamboOrdenes.filter(o => o.fecha === hoy).reduce((s, o) => s + (Number(o.litros) || 0), 0);
  const litros7d  = state.tamboOrdenes.filter(o => o.fecha >= hace7).reduce((s, o) => s + (Number(o.litros) || 0), 0);
  const prom7d    = (litros7d / 7).toFixed(1);
  const lactancia = state.tamboVacas.filter(v => v.estado === 'Lactancia').length;

  // Ingreso del mes = última liquidación del mes actual
  const mesActual = hoy.slice(0, 7);
  const liqMes = state.tamboLiquidaciones.filter(l => (l.periodo || '') === mesActual)
    .reduce((s, l) => s + (Number(l.total) || 0), 0);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('dashTamboLitrosHoy', litrosHoy.toLocaleString());
  set('dashTamboProm7d', prom7d);
  set('dashTamboLact', lactancia);
  set('dashTamboIngMes', '$' + liqMes.toLocaleString());

  // === Gráfico 1: Producción diaria últimos 30 días (línea) ===
  const canvas1 = document.getElementById('chartTamboLitros');
  if (canvas1 && typeof Chart !== 'undefined') {
    // Armar labels de los últimos 30 días
    const labels = [];
    const datos = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const fecha = d.toISOString().slice(0, 10);
      labels.push(fecha.slice(5)); // MM-DD
      const total = state.tamboOrdenes.filter(o => o.fecha === fecha).reduce((s, o) => s + (Number(o.litros) || 0), 0);
      datos.push(total);
    }

    if (chartTamboLitros) chartTamboLitros.destroy();
    chartTamboLitros = new Chart(canvas1, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Litros/día',
          data: datos,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.15)',
          tension: 0.3,
          fill: true,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#f1f5f9' } } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: '#2d3548' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: '#2d3548' }, beginAtZero: true }
        }
      }
    });
  }

  // === Gráfico 2: Composición del rodeo (doughnut) ===
  const canvas2 = document.getElementById('chartTamboRodeo');
  if (canvas2 && typeof Chart !== 'undefined') {
    const lact = state.tamboVacas.filter(v => v.estado === 'Lactancia').length;
    const seca = state.tamboVacas.filter(v => v.estado === 'Seca').length;
    const vaq  = state.tamboVacas.filter(v => v.estado === 'Vaquillona').length;
    const baja = state.tamboVacas.filter(v => v.estado === 'Baja').length;

    if (chartTamboRodeo) chartTamboRodeo.destroy();
    chartTamboRodeo = new Chart(canvas2, {
      type: 'doughnut',
      data: {
        labels: ['Lactancia', 'Secas', 'Vaquillonas', 'Bajas'],
        datasets: [{
          data: [lact, seca, vaq, baja],
          backgroundColor: ['#10b981', '#f59e0b', '#3b82f6', '#ef4444'],
          borderColor: '#1a1f2e',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#f1f5f9' } } }
      }
    });
  }
}
```

---

## 7) Enganche para redibujar al entrar al dashboard

El ERP usa un listener en `.sidebar-nav` (línea ~3382) que cambia de módulo. Para que el gráfico se **redibuje al entrar** al dashboard del tambo, hay dos opciones:

**Opción A** — Buscá el listener y agregá al final del handler de clic:
```js
if (module === 'tamboDashboard') renderTamboDashboard();
```

**Opción B** (más simple, sin buscar el listener) — Envolvé el `data-module="tamboDashboard"` con un `onclick`:
```html
<div class="nav-item" data-module="tamboDashboard" onclick="setTimeout(renderTamboDashboard,50)">
  <span class="nav-icon">📈</span> Dashboard Tambo
</div>
```

---

## 8) Enganche en `renderTables()` (si existe)

Agregar:
```js
renderTamboRaciones();
renderTamboConsumos();
renderTamboPotreros();
renderTamboRotaciones();
renderTamboPersonalRegistro();
renderTamboTurnos();
renderTamboTareas();
renderTamboDashboard();
```

---

## Verificación después de aplicar

1. **Sidebar**: la sección "Tambo" ahora tiene **9 ítems**.
2. **Vacas / Ordeñes / Reproducción / Sanidad / Usina** (patch 1 y 2) siguen andando.
3. **Alimentación Tambo** → cargá una ración y un consumo; verificá KPIs de 7d/30d.
4. **Pasturas** → cargá un potrero y una rotación; el KPI "Ocupados Hoy" debería reflejar rotaciones sin fecha de salida.
5. **Personal** → asigná un turno y creá una tarea "Pendiente"; verificá que aparezca en el KPI correspondiente.
6. **Dashboard Tambo** → debería mostrar dos gráficos (línea 30d + dona del rodeo). Si están vacíos, cargá primero datos en Ordeñes y Vacas.

## Recap total del módulo (patches 1+2+3)

| Área | Vista | Entidades con datos |
|---|---|---|
| Rodeo | `tamboVacas` | `tamboVacas` |
| Producción | `tamboOrdenes` | `tamboOrdenes` |
| Reproducción | `tamboReproduccion` | `tamboServicios`, `tamboPrenieces`, `tamboPartos` |
| Sanidad | `tamboSanidad` | `tamboVacunaciones`, `tamboTratamientos` |
| Usina | `tamboUsina` | `tamboRemitos`, `tamboLiquidaciones` |
| Alimentación | `tamboAlimentacion` | `tamboRaciones`, `tamboConsumos` |
| Pasturas | `tamboPasturas` | `tamboPotreros`, `tamboRotaciones` |
| Personal | `tamboPersonal` | `tamboPersonalRegistro`, `tamboTurnos`, `tamboTareas` |
| Dashboard | `tamboDashboard` | (agregados de los anteriores) |

**Total**: 14 entidades persistentes + 9 vistas + 2 gráficos Chart.js.

## Ideas para 4ª pasada (si querés seguir)

- **Reportes exportables**: PDF/Excel de producción mensual, retiros de leche vigentes, liquidaciones.
- **Alerta de servicios sin diagnóstico** (más de 45 días desde el servicio sin registro de preñez).
- **Alerta de próxima fecha de secado** (según fecha de servicio + gestación 283 días - 60).
- **Integración con `hacienda.animalesTrazabilidad`**: sincronizar caravanas entre módulos para no duplicar animales.
- **Cotización del día**: enganchar con el módulo `bancos`/`caja` para valorizar leche entregada según precio de mercado.
