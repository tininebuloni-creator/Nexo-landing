# PATCH — Módulo TAMBO (2ª pasada)

Extiende el módulo Tambo con **3 áreas nuevas**:
- `tamboReproduccion` — servicios (IA/natural), diagnósticos y partos
- `tamboSanidad` — vacunaciones y tratamientos
- `tamboUsina` — remitos a la usina y liquidaciones

Requiere haber aplicado antes **PATCH-tambo.md** (base con `tamboVacas` y `tamboOrdenes`).

> Igual que el anterior: todos los cambios son **inserciones**. Buscá los marcadores `«INSERTAR ACÁ»`.

---

## 1) Sidebar — agregar 3 items a la sección "Tambo"

**Archivo:** `nexo-agro-erp.html` — dentro del bloque `<div class="nav-section">` de Tambo que agregaste en el patch 1.

Contexto:
```html
      <div class="nav-section">
        <div class="nav-section-title">Tambo</div>
        <div class="nav-item" data-module="tamboVacas"><span class="nav-icon">🐮</span> Vacas del Tambo</div>
        <div class="nav-item" data-module="tamboOrdenes"><span class="nav-icon">🥛</span> Ordeñes</div>
«INSERTAR ACÁ»
      </div>
```

Pegar:
```html
        <div class="nav-item" data-module="tamboReproduccion"><span class="nav-icon">🐄</span> Reproducción</div>
        <div class="nav-item" data-module="tamboSanidad"><span class="nav-icon">💉</span> Sanidad</div>
        <div class="nav-item" data-module="tamboUsina"><span class="nav-icon">🏭</span> Usina / Remitos</div>
```

---

## 2) HTML de los 3 módulos

**Archivo:** `nexo-agro-erp.html` — insertar **después del `</div>` que cierra `<div class="module" id="mod-tamboOrdenes">`** (los agregados en el patch 1).

Pegar:
```html
      <!-- MODULE: TAMBO REPRODUCCION -->
      <div class="module" id="mod-tamboReproduccion">
        <div class="kpi-grid">
          <div class="kpi blue">
            <div class="kpi-label">💉 Servicios</div>
            <div class="kpi-value" id="tamboRepKpiServicios">0</div>
            <div class="kpi-sub">Total registrados</div>
          </div>
          <div class="kpi green">
            <div class="kpi-label">🤰 Preñadas</div>
            <div class="kpi-value" id="tamboRepKpiPrenadas">0</div>
            <div class="kpi-sub">Diagnóstico positivo</div>
          </div>
          <div class="kpi orange">
            <div class="kpi-label">❌ Vacías</div>
            <div class="kpi-value" id="tamboRepKpiVacias">0</div>
            <div class="kpi-sub">Diagnóstico negativo</div>
          </div>
          <div class="kpi red">
            <div class="kpi-label">🍼 Partos</div>
            <div class="kpi-value" id="tamboRepKpiPartos">0</div>
            <div class="kpi-sub">Total registrados</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">💉 Servicios (IA / Natural / TE)</div>
            <button class="topbar-btn primary" onclick="openModal('tamboServicios')">+ Nuevo Servicio</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Vaca</th>
                <th>Tipo</th>
                <th>Toro/Pajuela</th>
                <th>Inseminador</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody id="tamboServiciosBody"></tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🤰 Diagnósticos de Preñez</div>
            <button class="topbar-btn primary" onclick="openModal('tamboPrenieces')">+ Nuevo Diagnóstico</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Vaca</th>
                <th>Método</th>
                <th>Resultado</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody id="tamboPreniecesBody"></tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🍼 Partos</div>
            <button class="topbar-btn primary" onclick="openModal('tamboPartos')">+ Nuevo Parto</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Vaca</th>
                <th>Tipo</th>
                <th>Sexo Cría</th>
                <th>Caravana Cría</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody id="tamboPartosBody"></tbody>
          </table>
        </div>
      </div>

      <!-- MODULE: TAMBO SANIDAD -->
      <div class="module" id="mod-tamboSanidad">
        <div class="kpi-grid">
          <div class="kpi blue">
            <div class="kpi-label">💉 Vacunaciones</div>
            <div class="kpi-value" id="tamboSanKpiVacunas">0</div>
            <div class="kpi-sub">Total registradas</div>
          </div>
          <div class="kpi green">
            <div class="kpi-label">🩺 Tratamientos</div>
            <div class="kpi-value" id="tamboSanKpiTrat">0</div>
            <div class="kpi-sub">Total registrados</div>
          </div>
          <div class="kpi orange">
            <div class="kpi-label">⏰ Retiros Vigentes</div>
            <div class="kpi-value" id="tamboSanKpiRetiros">0</div>
            <div class="kpi-sub">Con retiro de leche activo</div>
          </div>
          <div class="kpi red">
            <div class="kpi-label">📅 Vencidas 30d</div>
            <div class="kpi-value" id="tamboSanKpiVenc">0</div>
            <div class="kpi-sub">Próxima dosis vencida</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">💉 Vacunaciones</div>
            <button class="topbar-btn primary" onclick="openModal('tamboVacunaciones')">+ Nueva Vacunación</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Vaca</th>
                <th>Producto</th>
                <th>Dosis</th>
                <th>Próxima</th>
                <th>Responsable</th>
              </tr>
            </thead>
            <tbody id="tamboVacunacionesBody"></tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🩺 Tratamientos</div>
            <button class="topbar-btn primary" onclick="openModal('tamboTratamientos')">+ Nuevo Tratamiento</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Vaca</th>
                <th>Producto</th>
                <th>Motivo</th>
                <th>Retiro Leche (días)</th>
                <th>Responsable</th>
              </tr>
            </thead>
            <tbody id="tamboTratamientosBody"></tbody>
          </table>
        </div>
      </div>

      <!-- MODULE: TAMBO USINA -->
      <div class="module" id="mod-tamboUsina">
        <div class="kpi-grid">
          <div class="kpi blue">
            <div class="kpi-label">🏭 Remitos</div>
            <div class="kpi-value" id="tamboUsKpiRemitos">0</div>
            <div class="kpi-sub">Total emitidos</div>
          </div>
          <div class="kpi green">
            <div class="kpi-label">🥛 Litros Entregados</div>
            <div class="kpi-value" id="tamboUsKpiLitros">0</div>
            <div class="kpi-sub">Acumulado histórico</div>
          </div>
          <div class="kpi orange">
            <div class="kpi-label">📅 Mes en curso</div>
            <div class="kpi-value" id="tamboUsKpiMes">0</div>
            <div class="kpi-sub">Litros del mes</div>
          </div>
          <div class="kpi red">
            <div class="kpi-label">💵 Liquidaciones</div>
            <div class="kpi-value" id="tamboUsKpiLiq">0</div>
            <div class="kpi-sub">Total registradas</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🏭 Remitos a Usina</div>
            <button class="topbar-btn primary" onclick="openModal('tamboRemitos')">+ Nuevo Remito</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Nº Remito</th>
                <th>Usina</th>
                <th>Litros</th>
                <th>Temperatura</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody id="tamboRemitosBody"></tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">💵 Liquidaciones</div>
            <button class="topbar-btn primary" onclick="openModal('tamboLiquidaciones')">+ Nueva Liquidación</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Período</th>
                <th>Usina</th>
                <th>Litros</th>
                <th>Precio/L</th>
                <th>Bonif.</th>
                <th>Desc.</th>
                <th>Total</th>
                <th>Fecha Pago</th>
              </tr>
            </thead>
            <tbody id="tamboLiquidacionesBody"></tbody>
          </table>
        </div>
      </div>
```

---

## 3) State — 7 arrays nuevos

**Archivo:** `nexo-agro-erp.html` — dentro de `const state = {`, junto a los que agregaste en el patch 1.

Contexto:
```js
  tamboVacas: [],
  tamboOrdenes: [],
«INSERTAR ACÁ»
```

Pegar:
```js
  tamboServicios: [],
  tamboPrenieces: [],
  tamboPartos: [],
  tamboVacunaciones: [],
  tamboTratamientos: [],
  tamboRemitos: [],
  tamboLiquidaciones: [],
```

---

## 4) Array `modules` — registrar 3 módulos-vista + 7 entidades

**Archivo:** `nexo-agro-erp.html` — línea `2863`. Reemplazar por la línea completa:

```js
const modules = ['dashboard','campos','lotes','campañas','aplicaciones','siembra','cosecha','inventario','hacienda','alimentacion','tamboVacas','tamboOrdenes','tamboReproduccion','tamboServicios','tamboPrenieces','tamboPartos','tamboSanidad','tamboVacunaciones','tamboTratamientos','tamboUsina','tamboRemitos','tamboLiquidaciones','maquinarias','cargacombustible','costosOperativos','mantenimiento','empleados','caja','bancos','cuentasBancarias','cheques','creditos','flujo','costos','rentabilidad','empresa','reportes','documentos'];
```

> Los 3 nombres "de vista" (`tamboReproduccion`, `tamboSanidad`, `tamboUsina`) son solo contenedores HTML — no tienen data propia. Los 7 restantes son los que persisten datos.

---

## 5) `formConfigs` — 7 schemas nuevos

**Archivo:** `nexo-agro-erp.html` — pegar dentro de `const formConfigs = {`, junto a los del patch 1.

```js
  tamboServicios: {
    title: 'Nuevo Servicio',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      { name: 'vaca', label: 'Vaca', type: 'select', required: true, dynamicOptions: 'tamboVacas', displayField: 'caravana' },
      { name: 'tipo', label: 'Tipo', type: 'select', options: ['IA', 'Natural', 'TE'], required: true },
      { name: 'toro', label: 'Toro / Pajuela', type: 'text' },
      { name: 'inseminador', label: 'Inseminador', type: 'text' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboPrenieces: {
    title: 'Nuevo Diagnóstico de Preñez',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      { name: 'vaca', label: 'Vaca', type: 'select', required: true, dynamicOptions: 'tamboVacas', displayField: 'caravana' },
      { name: 'metodo', label: 'Método', type: 'select', options: ['Tacto', 'Ecografía', 'Sangre'], required: true },
      { name: 'resultado', label: 'Resultado', type: 'select', options: ['Preñada', 'Vacía', 'Dudosa'], required: true },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboPartos: {
    title: 'Nuevo Parto',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      { name: 'vaca', label: 'Vaca', type: 'select', required: true, dynamicOptions: 'tamboVacas', displayField: 'caravana' },
      { name: 'tipo', label: 'Tipo', type: 'select', options: ['Normal', 'Distócico'] },
      { name: 'sexoCria', label: 'Sexo Cría', type: 'select', options: ['H', 'M'] },
      { name: 'caravanaCria', label: 'Caravana Cría', type: 'text' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboVacunaciones: {
    title: 'Nueva Vacunación',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      { name: 'vaca', label: 'Vaca', type: 'select', required: true, dynamicOptions: 'tamboVacas', displayField: 'caravana' },
      { name: 'producto', label: 'Producto / Vacuna', type: 'text', required: true },
      { name: 'dosis', label: 'Dosis', type: 'text' },
      { name: 'proxima', label: 'Próxima Dosis', type: 'date' },
      { name: 'responsable', label: 'Responsable', type: 'text' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboTratamientos: {
    title: 'Nuevo Tratamiento',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      { name: 'vaca', label: 'Vaca', type: 'select', required: true, dynamicOptions: 'tamboVacas', displayField: 'caravana' },
      { name: 'producto', label: 'Producto', type: 'text', required: true },
      { name: 'dosis', label: 'Dosis', type: 'text' },
      { name: 'motivo', label: 'Motivo', type: 'text' },
      { name: 'retiroLeche', label: 'Retiro Leche (días)', type: 'number' },
      { name: 'responsable', label: 'Responsable', type: 'text' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboRemitos: {
    title: 'Nuevo Remito',
    fields: [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      { name: 'numero', label: 'Nº Remito', type: 'text', autoNumber: { prefix: 'R', pad: 5 } },
      { name: 'usina', label: 'Usina', type: 'text', required: true },
      { name: 'litros', label: 'Litros', type: 'number', required: true, step: 'any' },
      { name: 'temperatura', label: 'Temperatura (°C)', type: 'number', step: 'any' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
  tamboLiquidaciones: {
    title: 'Nueva Liquidación',
    fields: [
      { name: 'periodo', label: 'Período (YYYY-MM)', type: 'text', required: true, placeholder: '2026-08' },
      { name: 'usina', label: 'Usina', type: 'text', required: true },
      { name: 'litros', label: 'Litros Totales', type: 'number', required: true, step: 'any' },
      { name: 'precioLitro', label: 'Precio por Litro', type: 'number', required: true, step: 'any' },
      { name: 'bonificacion', label: 'Bonificaciones ($)', type: 'number', step: 'any' },
      { name: 'descuentos', label: 'Descuentos ($)', type: 'number', step: 'any' },
      { name: 'total', label: 'Total ($)', type: 'number', step: 'any' },
      { name: 'fechaPago', label: 'Fecha Pago', type: 'date' },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea' }
    ]
  },
```

---

## 6) Funciones render + KPIs

Pegar al final del bloque de funciones render (después de `renderTamboOrdenes()` del patch 1):

```js
// ============================================================
// MÓDULO TAMBO — Reproducción
// ============================================================
function _vacaLabel(caravana) {
  const v = state.tamboVacas.find(v => v.caravana === caravana);
  return v && v.nombre ? `${caravana} — ${v.nombre}` : (caravana || '');
}

function renderTamboServicios() {
  const body = document.getElementById('tamboServiciosBody');
  if (!body) return;
  const filas = [...state.tamboServicios].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  body.innerHTML = filas.map((s) => {
    const idx = state.tamboServicios.indexOf(s);
    return `
      <tr onclick="openModal('tamboServicios', ${idx})" style="cursor:pointer;">
        <td>${s.fecha || ''}</td>
        <td>${_vacaLabel(s.vaca)}</td>
        <td><span class="tag blue">${s.tipo || ''}</span></td>
        <td>${s.toro || ''}</td>
        <td>${s.inseminador || ''}</td>
        <td>${s.observaciones || ''}</td>
      </tr>`;
  }).join('');
}

function renderTamboPrenieces() {
  const body = document.getElementById('tamboPreniecesBody');
  if (!body) return;
  const filas = [...state.tamboPrenieces].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  body.innerHTML = filas.map((p) => {
    const idx = state.tamboPrenieces.indexOf(p);
    const tag = ({
      'Preñada': '<span class="tag green">Preñada</span>',
      'Vacía':   '<span class="tag red">Vacía</span>',
      'Dudosa':  '<span class="tag orange">Dudosa</span>'
    })[p.resultado] || p.resultado || '';
    return `
      <tr onclick="openModal('tamboPrenieces', ${idx})" style="cursor:pointer;">
        <td>${p.fecha || ''}</td>
        <td>${_vacaLabel(p.vaca)}</td>
        <td>${p.metodo || ''}</td>
        <td>${tag}</td>
        <td>${p.observaciones || ''}</td>
      </tr>`;
  }).join('');
}

function renderTamboPartos() {
  const body = document.getElementById('tamboPartosBody');
  if (!body) return;
  const filas = [...state.tamboPartos].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  body.innerHTML = filas.map((p) => {
    const idx = state.tamboPartos.indexOf(p);
    return `
      <tr onclick="openModal('tamboPartos', ${idx})" style="cursor:pointer;">
        <td>${p.fecha || ''}</td>
        <td>${_vacaLabel(p.vaca)}</td>
        <td>${p.tipo || ''}</td>
        <td>${p.sexoCria || ''}</td>
        <td>${p.caravanaCria || ''}</td>
        <td>${p.observaciones || ''}</td>
      </tr>`;
  }).join('');
  actualizarKPIsTamboReproduccion();
}

function actualizarKPIsTamboReproduccion() {
  const servicios = state.tamboServicios.length;
  const prenadas  = state.tamboPrenieces.filter(p => p.resultado === 'Preñada').length;
  const vacias    = state.tamboPrenieces.filter(p => p.resultado === 'Vacía').length;
  const partos    = state.tamboPartos.length;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('tamboRepKpiServicios', servicios);
  set('tamboRepKpiPrenadas', prenadas);
  set('tamboRepKpiVacias', vacias);
  set('tamboRepKpiPartos', partos);
}

// ============================================================
// MÓDULO TAMBO — Sanidad
// ============================================================
function renderTamboVacunaciones() {
  const body = document.getElementById('tamboVacunacionesBody');
  if (!body) return;
  const filas = [...state.tamboVacunaciones].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  body.innerHTML = filas.map((v) => {
    const idx = state.tamboVacunaciones.indexOf(v);
    return `
      <tr onclick="openModal('tamboVacunaciones', ${idx})" style="cursor:pointer;">
        <td>${v.fecha || ''}</td>
        <td>${_vacaLabel(v.vaca)}</td>
        <td>${v.producto || ''}</td>
        <td>${v.dosis || ''}</td>
        <td>${v.proxima || ''}</td>
        <td>${v.responsable || ''}</td>
      </tr>`;
  }).join('');
  actualizarKPIsTamboSanidad();
}

function renderTamboTratamientos() {
  const body = document.getElementById('tamboTratamientosBody');
  if (!body) return;
  const filas = [...state.tamboTratamientos].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  body.innerHTML = filas.map((t) => {
    const idx = state.tamboTratamientos.indexOf(t);
    return `
      <tr onclick="openModal('tamboTratamientos', ${idx})" style="cursor:pointer;">
        <td>${t.fecha || ''}</td>
        <td>${_vacaLabel(t.vaca)}</td>
        <td>${t.producto || ''}</td>
        <td>${t.motivo || ''}</td>
        <td>${t.retiroLeche || 0}</td>
        <td>${t.responsable || ''}</td>
      </tr>`;
  }).join('');
  actualizarKPIsTamboSanidad();
}

function actualizarKPIsTamboSanidad() {
  const hoy = new Date();
  const hoyStr = hoy.toISOString().slice(0, 10);
  const hace30 = new Date(hoy.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  const vacunas = state.tamboVacunaciones.length;
  const trat    = state.tamboTratamientos.length;

  // Tratamientos con retiro vigente (fecha + retiroLeche > hoy)
  const retirosVigentes = state.tamboTratamientos.filter(t => {
    if (!t.fecha || !t.retiroLeche) return false;
    const finRetiro = new Date(t.fecha);
    finRetiro.setDate(finRetiro.getDate() + Number(t.retiroLeche));
    return finRetiro >= hoy;
  }).length;

  // Vacunaciones con próxima dosis vencida hace <=30 días o vencida
  const vencidas = state.tamboVacunaciones.filter(v => v.proxima && v.proxima <= hoyStr && v.proxima >= hace30).length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('tamboSanKpiVacunas', vacunas);
  set('tamboSanKpiTrat', trat);
  set('tamboSanKpiRetiros', retirosVigentes);
  set('tamboSanKpiVenc', vencidas);
}

// ============================================================
// MÓDULO TAMBO — Usina (Remitos + Liquidaciones)
// ============================================================
function renderTamboRemitos() {
  const body = document.getElementById('tamboRemitosBody');
  if (!body) return;
  const filas = [...state.tamboRemitos].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  body.innerHTML = filas.map((r) => {
    const idx = state.tamboRemitos.indexOf(r);
    return `
      <tr onclick="openModal('tamboRemitos', ${idx})" style="cursor:pointer;">
        <td>${r.fecha || ''}</td>
        <td><strong>${r.numero || ''}</strong></td>
        <td>${r.usina || ''}</td>
        <td>${(Number(r.litros) || 0).toLocaleString()} L</td>
        <td>${r.temperatura || ''} °C</td>
        <td>${r.observaciones || ''}</td>
      </tr>`;
  }).join('');
  actualizarKPIsTamboUsina();
}

function renderTamboLiquidaciones() {
  const body = document.getElementById('tamboLiquidacionesBody');
  if (!body) return;
  const filas = [...state.tamboLiquidaciones].sort((a, b) => (b.periodo || '').localeCompare(a.periodo || ''));
  body.innerHTML = filas.map((l) => {
    const idx = state.tamboLiquidaciones.indexOf(l);
    return `
      <tr onclick="openModal('tamboLiquidaciones', ${idx})" style="cursor:pointer;">
        <td><strong>${l.periodo || ''}</strong></td>
        <td>${l.usina || ''}</td>
        <td>${(Number(l.litros) || 0).toLocaleString()}</td>
        <td>$${(Number(l.precioLitro) || 0).toLocaleString()}</td>
        <td>$${(Number(l.bonificacion) || 0).toLocaleString()}</td>
        <td>$${(Number(l.descuentos) || 0).toLocaleString()}</td>
        <td><strong>$${(Number(l.total) || 0).toLocaleString()}</strong></td>
        <td>${l.fechaPago || ''}</td>
      </tr>`;
  }).join('');
  actualizarKPIsTamboUsina();
}

function actualizarKPIsTamboUsina() {
  const remitos = state.tamboRemitos.length;
  const litros  = state.tamboRemitos.reduce((s, r) => s + (Number(r.litros) || 0), 0);
  const mesActual = new Date().toISOString().slice(0, 7); // YYYY-MM
  const litrosMes = state.tamboRemitos
    .filter(r => (r.fecha || '').startsWith(mesActual))
    .reduce((s, r) => s + (Number(r.litros) || 0), 0);
  const liq = state.tamboLiquidaciones.length;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('tamboUsKpiRemitos', remitos);
  set('tamboUsKpiLitros', litros.toLocaleString());
  set('tamboUsKpiMes', litrosMes.toLocaleString());
  set('tamboUsKpiLiq', liq);
}

// Cálculo automático del total en liquidaciones (opcional):
// Si el motor de formularios permite hooks, podés recalcular `total = litros*precioLitro + bonificacion - descuentos`
// dentro de saveModal, o dejar que el usuario lo ingrese manual.
```

---

## 7) Enganche opcional en `renderTables()`

Si existe `function renderTables()`, agregar:

```js
renderTamboServicios();
renderTamboPrenieces();
renderTamboPartos();
renderTamboVacunaciones();
renderTamboTratamientos();
renderTamboRemitos();
renderTamboLiquidaciones();
```

---

## Notas importantes

- **`tamboReproduccion`, `tamboSanidad`, `tamboUsina`** son solo **contenedores visuales**; el sidebar los usa como `data-module` para mostrar/ocultar el `<div id="mod-xxx">`. No tienen `state` propio ni `formConfigs`.
- Los **datos reales** viven en las 7 entidades (`tamboServicios`, `tamboPrenieces`, `tamboPartos`, `tamboVacunaciones`, `tamboTratamientos`, `tamboRemitos`, `tamboLiquidaciones`).
- El botón `+ Nuevo` de cada tabla abre el modal genérico (`openModal('tamboXxx')`) que ya usa el ERP para todo lo demás — la persistencia en localStorage/IndexedDB es automática.
- El campo `vaca` en todos los formularios usa `dynamicOptions: 'tamboVacas'` con `displayField: 'caravana'`. Si en tu ERP `dynamicOptions` no soporta `displayField`, verificalo comparando con Siembra (usa `dynamicOptions: 'lotes'`) y ajustá si es necesario.
- **Cálculo automático de la liquidación**: dejé el campo `total` editable. Si querés que se calcule solo, buscá el hook de `saveModal` y agregá:
  ```js
  if (currentModal.module === 'tamboLiquidaciones') {
    data.total = (Number(data.litros)||0) * (Number(data.precioLitro)||0)
               + (Number(data.bonificacion)||0) - (Number(data.descuentos)||0);
  }
  ```

## Qué queda para una 3ª pasada (si te interesa)

- **Alimentación específica del tambo** (raciones para lactancia vs seca) — reusar la `alimentacion` existente o crear `tamboRaciones`
- **Pasturas y potreros** con rotación
- **Personal** (tamberos, turnos de ordeñe) — puede colgarse del módulo `empleados` que ya existe
- **Dashboard del tambo** con gráfico de litros/día (usando alguna lib chart que ya use el ERP)
- **Integración con Hacienda**: unificar caravanas entre `hacienda.animalesTrazabilidad` y `tamboVacas` para evitar duplicar animales
