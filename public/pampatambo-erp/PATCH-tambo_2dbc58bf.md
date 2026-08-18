# PATCH — Módulo TAMBO (versión esencial)

Este patch agrega el módulo **Tambo** a `nexo-agro-erp.html` siguiendo el mismo patrón que usan Inventario, Hacienda y Alimentación.

**Alcance esencial**: dos entidades base
- `tamboVacas` — padrón de vacas del tambo
- `tamboOrdenes` — registro diario de ordeñe (litros por vaca por turno)

> Todos los cambios son **inserciones** (nada se borra). Los números de línea son referencia; buscá el marcador de contexto entre `«...»` para pegar al lado.

---

## 1) Sidebar — nueva sección "Tambo"

**Archivo:** `nexo-agro-erp.html` — insertar **después de la línea 1104** (justo después del cierre de la sección "Ganadería").

Contexto:
```html
      <div class="nav-section">
        <div class="nav-section-title">Ganadería</div>
        <div class="nav-item" data-module="hacienda"><span class="nav-icon">🐄</span> Hacienda</div>
        <div class="nav-item" data-module="alimentacion"><span class="nav-icon">🌾</span> Alimentación</div>
      </div>
«INSERTAR ACÁ»
```

Pegar:
```html
      <div class="nav-section">
        <div class="nav-section-title">Tambo</div>
        <div class="nav-item" data-module="tamboVacas"><span class="nav-icon">🐮</span> Vacas del Tambo</div>
        <div class="nav-item" data-module="tamboOrdenes"><span class="nav-icon">🥛</span> Ordeñes</div>
      </div>
```

---

## 2) HTML de los módulos

**Archivo:** `nexo-agro-erp.html` — insertar **después de la línea 1701** (después del `</div>` que cierra `<div class="module" id="mod-inventario">`).

Contexto:
```html
          </table>
        </div>
      </div>
      <!-- MODULE: ALIMENTACION -->
«INSERTAR ACÁ, antes del comentario ALIMENTACION»
```

Pegar:
```html
      <!-- MODULE: TAMBO VACAS -->
      <div class="module" id="mod-tamboVacas">
        <div class="kpi-grid">
          <div class="kpi blue">
            <div class="kpi-label">🐮 Vacas Totales</div>
            <div class="kpi-value" id="tamboKpiTotal">0</div>
            <div class="kpi-sub">Padrón del tambo</div>
          </div>
          <div class="kpi green">
            <div class="kpi-label">🥛 En Lactancia</div>
            <div class="kpi-value" id="tamboKpiLactancia">0</div>
            <div class="kpi-sub">Vacas produciendo</div>
          </div>
          <div class="kpi orange">
            <div class="kpi-label">🌱 Secas</div>
            <div class="kpi-value" id="tamboKpiSecas">0</div>
            <div class="kpi-sub">Período seco</div>
          </div>
          <div class="kpi red">
            <div class="kpi-label">📉 Bajas</div>
            <div class="kpi-value" id="tamboKpiBajas">0</div>
            <div class="kpi-sub">Descartadas / vendidas</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🐮 Padrón de Vacas</div>
            <div style="display:flex;gap:8px;">
              <button class="topbar-btn" onclick="openImportModal('tamboVacas')">📁 Importar</button>
              <button class="topbar-btn primary" onclick="openModal('tamboVacas')">+ Nueva Vaca</button>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Caravana</th>
                <th>Nombre</th>
                <th>Raza</th>
                <th>Fecha Nac.</th>
                <th>Estado</th>
                <th>Nº Lactancia</th>
                <th>Último Parto</th>
              </tr>
            </thead>
            <tbody id="tamboVacasBody"></tbody>
          </table>
        </div>
      </div>

      <!-- MODULE: TAMBO ORDEÑES -->
      <div class="module" id="mod-tamboOrdenes">
        <div class="kpi-grid">
          <div class="kpi blue">
            <div class="kpi-label">🥛 Litros Hoy</div>
            <div class="kpi-value" id="tamboKpiLitrosHoy">0</div>
            <div class="kpi-sub">Suma del día</div>
          </div>
          <div class="kpi green">
            <div class="kpi-label">📊 Promedio/Vaca</div>
            <div class="kpi-value" id="tamboKpiPromedio">0</div>
            <div class="kpi-sub">Litros/vaca en lactancia</div>
          </div>
          <div class="kpi orange">
            <div class="kpi-label">📅 Últimos 7 días</div>
            <div class="kpi-value" id="tamboKpi7dias">0</div>
            <div class="kpi-sub">Litros acumulados</div>
          </div>
          <div class="kpi red">
            <div class="kpi-label">📆 Últimos 30 días</div>
            <div class="kpi-value" id="tamboKpi30dias">0</div>
            <div class="kpi-sub">Litros acumulados</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🥛 Registro de Ordeñes</div>
            <div style="display:flex;gap:8px;">
              <button class="topbar-btn" onclick="openImportModal('tamboOrdenes')">📁 Importar</button>
              <button class="topbar-btn primary" onclick="openModal('tamboOrdenes')">+ Nueva Ordeñe</button>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Turno</th>
                <th>Vaca</th>
                <th>Litros</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody id="tamboOrdenesBody"></tbody>
          </table>
        </div>
      </div>
```

---

## 3) State — dos arrays nuevos

**Archivo:** `nexo-agro-erp.html` — insertar **dentro de `const state = {`** (línea 2481). Sugerencia: pegar justo después de la línea 2498 (`alimentacion: [],`) para mantener las áreas ganaderas juntas.

Contexto:
```js
  alimentacion: [],
«INSERTAR ACÁ»
  mantenimiento: [],
```

Pegar:
```js
  tamboVacas: [],
  tamboOrdenes: [],
```

---

## 4) Array `modules` — registrar los dos módulos

**Archivo:** `nexo-agro-erp.html` — línea **2863**. Reemplazar la línea completa.

Antes:
```js
const modules = ['dashboard','campos','lotes','campañas','aplicaciones','siembra','cosecha','inventario','hacienda','alimentacion','maquinarias','cargacombustible','costosOperativos','mantenimiento','empleados','caja','bancos','cuentasBancarias','cheques','creditos','flujo','costos','rentabilidad','empresa','reportes','documentos'];
```

Después:
```js
const modules = ['dashboard','campos','lotes','campañas','aplicaciones','siembra','cosecha','inventario','hacienda','alimentacion','tamboVacas','tamboOrdenes','maquinarias','cargacombustible','costosOperativos','mantenimiento','empleados','caja','bancos','cuentasBancarias','cheques','creditos','flujo','costos','rentabilidad','empresa','reportes','documentos'];
```

---

## 5) `formConfigs` — schemas de los formularios

**Archivo:** `nexo-agro-erp.html` — insertar **dentro de `const formConfigs = {`** (línea 4066). Sugerencia: pegar antes del cierre `}` global de `formConfigs` (buscá el `};` que cierra el objeto grande).

Pegar (adaptar si querés más/menos campos):
```js
  tamboVacas: {
    title: 'Nueva Vaca del Tambo',
    fields: [
      { name: 'caravana', label: 'Caravana', type: 'text', required: true, autoNumber: { prefix: 'V', pad: 4 } },
      { name: 'nombre', label: 'Nombre', type: 'text' },
      { name: 'raza', label: 'Raza', type: 'select', options: ['Holando Argentino', 'Jersey', 'Pardo Suizo', 'Cruza'], required: true },
      { name: 'fechaNacimiento', label: 'Fecha Nacimiento', type: 'date' },
      { name: 'estado', label: 'Estado', type: 'select', options: ['Lactancia', 'Seca', 'Vaquillona', 'Baja'], required: true },
      { name: 'numLactancia', label: 'Nº de Lactancia', type: 'number' },
      { name: 'ultimoParto', label: 'Último Parto', type: 'date' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboOrdenes: {
    title: 'Nueva Ordeñe',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      { name: 'turno', label: 'Turno', type: 'select', options: ['Mañana', 'Tarde', 'Noche'], required: true },
      { name: 'vaca', label: 'Vaca', type: 'select', required: true, dynamicOptions: 'tamboVacas', displayField: 'caravana' },
      { name: 'litros', label: 'Litros', type: 'number', required: true, step: 'any' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
```

> **Nota**: si `dynamicOptions` con `displayField` no está soportado en el motor actual, el formulario mostrará el índice. Verificalo con Hacienda/Siembra que ya usan `dynamicOptions`.

---

## 6) Funciones render + KPIs

**Archivo:** `nexo-agro-erp.html` — pegar al final del bloque de funciones render (por ejemplo después de `renderInventario()` que termina cerca de la línea 6699), o antes del `</script>` final. Da lo mismo mientras estén definidas cuando `renderTables()` las llame.

> **Importante**: si el ERP tiene un `renderTables()` central que llama uno por uno a los render de cada módulo, agregá también las dos llamadas ahí. Si en cambio cada módulo se re-renderiza on-demand al cambiar de vista, no hace falta.

Pegar:
```js
// ============================================================
// MÓDULO TAMBO — Vacas y Ordeñes
// ============================================================
function renderTamboVacas() {
  const body = document.getElementById('tamboVacasBody');
  if (!body) return;

  body.innerHTML = state.tamboVacas.map((v, i) => {
    const tagEstado = ({
      'Lactancia': '<span class="tag green">Lactancia</span>',
      'Seca':      '<span class="tag orange">Seca</span>',
      'Vaquillona':'<span class="tag blue">Vaquillona</span>',
      'Baja':      '<span class="tag red">Baja</span>'
    })[v.estado] || v.estado || '';
    return `
      <tr onclick="openModal('tamboVacas', ${i})" style="cursor:pointer;">
        <td><strong>${v.caravana || ''}</strong></td>
        <td>${v.nombre || ''}</td>
        <td>${v.raza || ''}</td>
        <td>${v.fechaNacimiento || ''}</td>
        <td>${tagEstado}</td>
        <td>${v.numLactancia || ''}</td>
        <td>${v.ultimoParto || ''}</td>
      </tr>
    `;
  }).join('');

  actualizarKPIsTamboVacas();
}

function actualizarKPIsTamboVacas() {
  const total     = state.tamboVacas.length;
  const lactancia = state.tamboVacas.filter(v => v.estado === 'Lactancia').length;
  const secas     = state.tamboVacas.filter(v => v.estado === 'Seca').length;
  const bajas     = state.tamboVacas.filter(v => v.estado === 'Baja').length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('tamboKpiTotal', total);
  set('tamboKpiLactancia', lactancia);
  set('tamboKpiSecas', secas);
  set('tamboKpiBajas', bajas);
}

function renderTamboOrdenes() {
  const body = document.getElementById('tamboOrdenesBody');
  if (!body) return;

  // Ordenar por fecha desc
  const ordenadas = [...state.tamboOrdenes].sort((a, b) =>
    (b.fecha || '').localeCompare(a.fecha || '')
  );

  body.innerHTML = ordenadas.map((o, i) => {
    // buscar índice real en state para el openModal
    const realIdx = state.tamboOrdenes.indexOf(o);
    const vaca = state.tamboVacas.find(v => v.caravana === o.vaca) || {};
    const nombreVaca = vaca.nombre ? `${o.vaca} — ${vaca.nombre}` : (o.vaca || '');
    return `
      <tr onclick="openModal('tamboOrdenes', ${realIdx})" style="cursor:pointer;">
        <td>${o.fecha || ''}</td>
        <td><span class="tag blue">${o.turno || ''}</span></td>
        <td>${nombreVaca}</td>
        <td><strong>${(Number(o.litros) || 0).toLocaleString()}</strong> L</td>
        <td>${o.observaciones || ''}</td>
      </tr>
    `;
  }).join('');

  actualizarKPIsTamboOrdenes();
}

function actualizarKPIsTamboOrdenes() {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace7  = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const litrosHoy    = state.tamboOrdenes.filter(o => o.fecha === hoy).reduce((s, o) => s + (Number(o.litros) || 0), 0);
  const litros7dias  = state.tamboOrdenes.filter(o => o.fecha >= hace7).reduce((s, o) => s + (Number(o.litros) || 0), 0);
  const litros30dias = state.tamboOrdenes.filter(o => o.fecha >= hace30).reduce((s, o) => s + (Number(o.litros) || 0), 0);
  const enLactancia  = state.tamboVacas.filter(v => v.estado === 'Lactancia').length;
  const promedio     = enLactancia ? (litrosHoy / enLactancia).toFixed(1) : 0;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('tamboKpiLitrosHoy', litrosHoy.toLocaleString());
  set('tamboKpiPromedio', promedio);
  set('tamboKpi7dias', litros7dias.toLocaleString());
  set('tamboKpi30dias', litros30dias.toLocaleString());
}
```

---

## 7) (Opcional) Enganchar en `renderTables()`

Si el ERP tiene una función central `renderTables()` que llama a todos los render (buscala con `grep -n "function renderTables"`), agregá adentro:

```js
renderTamboVacas();
renderTamboOrdenes();
```

Si no la tiene, no importa: cada módulo se renderiza cuando el sidebar cambia de vista.

---

## Cómo probar

1. Aplicá los 6 cambios y guardá el archivo.
2. Abrí el ERP (o el `.exe` de Electron).
3. En el sidebar debería aparecer la sección **Tambo** con "Vacas del Tambo" y "Ordeñes".
4. Cargá una vaca y una ordeñe; verificá que se persistan al recargar (localStorage) y que aparezcan los KPIs.

## Qué queda para una segunda pasada

- Reproducción (servicios / preñeces / partos) → nuevo módulo `tamboReproduccion`
- Sanidad (vacunas / tratamientos) → módulo `tamboSanidad`
- Entrega a usina / liquidaciones → módulo `tamboUsina`
- Vincular la vaca con el módulo Hacienda existente (unificar caravanas)
