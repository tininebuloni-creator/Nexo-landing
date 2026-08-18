# PampaAgro ERP

[![Release](https://img.shields.io/github/v/release/tininebuloni-creator/PAMPAAGRO-ERP?label=ultima%20version)](https://github.com/tininebuloni-creator/PAMPAAGRO-ERP/releases/latest)
[![Download](https://img.shields.io/github/downloads/tininebuloni-creator/PAMPAAGRO-ERP/total?label=descargas)](https://github.com/tininebuloni-creator/PAMPAAGRO-ERP/releases/latest)

Sistema de gestion agropecuaria de escritorio basado en Electron.

## Descargar

| Instalador | Portable |
|---|---|
| [Setup x64](https://github.com/tininebuloni-creator/PAMPAAGRO-ERP/releases/latest/download/Nexo-Agro-ERP-Setup-1.0.0-x64.exe) | [Portable x64](https://github.com/tininebuloni-creator/PAMPAAGRO-ERP/releases/latest/download/Nexo-Agro-ERP-Portable-1.0.0-x64.exe) |

## Roles del sistema

La aplicacion trabaja con cuatro roles principales. Cada rol habilita solo los modulos autorizados para ese perfil.

### Propietario
Perfil de acceso total.

Incluye:
- Dashboard
- Campos
- Lotes
- Campanas
- Siembra
- Aplicaciones
- Cosecha
- Hacienda
- Alimentacion
- Trazabilidad
- Equipos
- Mantenimiento
- Cargas de combustible
- Costos operativos
- Inventario
- Empleados
- Caja
- Bancos
- Cuentas Bancarias
- Cheques
- Creditos
- Flujo de Fondos
- Costos
- Rentabilidad
- Empresa
- Reportes entre roles
- Gestion de Documentos

Uso recomendado:
- Dueños
- Directivos
- Usuarios que necesitan ver y operar todo el sistema

### Administracion
Perfil orientado a gestion economica y administrativa.

Incluye:
- Dashboard
- Inventario
- Empleados
- Caja
- Bancos
- Cuentas Bancarias
- Cheques
- Creditos
- Flujo de Fondos
- Costos
- Empresa
- Reportes

Uso recomendado:
- Administracion
- Contabilidad
- Tesoreria
- Gestion financiera

### Ingeniero/Veterinario
Perfil orientado a produccion y operacion de campo.

Incluye:
- Dashboard
- Campos
- Lotes
- Campanas
- Siembra
- Aplicaciones
- Cosecha
- Hacienda
- Alimentacion
- Maquinarias
- Mantenimiento
- Inventario
- Empleados
- Reportes

Uso recomendado:
- Ingenieros agronomos
- Encargados de produccion
- Operacion de campo

## Como configurar el rol por instalacion

El rol inicial se define en el proceso principal de Electron. La prioridad de lectura es:

1. `settings.json` dentro de la carpeta de datos de usuario de Electron.
2. Variable de entorno `NEXO_APP_ROLE`.
3. Valor por defecto `administracion`.

En Windows, la ruta suele quedar bajo `%APPDATA%\PampaAgro ERP\settings.json` o una carpeta equivalente dentro de la ruta de datos de usuario que devuelve Electron.

### Ejemplos de configuracion

Propietario:

```json
{
  "appRole": "propietario"
}
```

Administracion:

```json
{
  "appRole": "administracion"
}
```

Ingeniero:

```json
{
  "appRole": "ingeniero"
}
```

Operador:

```json
{
  "appRole": "operador"
}
```

### Valores validos

- `propietario`
- `administracion`
- `ingeniero`
- `operador`


### Opcion 1: configurar por `settings.json`

Electron guarda la configuracion en la carpeta de usuario de la aplicacion. Dentro de ese archivo se puede definir:

Como referencia, tambien tenes un ejemplo listo para copiar en [settings.example.json](settings.example.json).

```json
{
  "appRole": "propietario"
}
```

Ejemplos:

```json
{
  "appRole": "administracion"
}
```

```json
{
  "appRole": "ingeniero"
}
```

### Opcion 2: configurar por variable de entorno

Si queres fijar el rol al iniciar la app sin tocar el archivo de configuracion:

```bash
NEXO_APP_ROLE=propietario
```

O bien:

```bash
NEXO_APP_ROLE=administracion
```

O bien:

```bash
NEXO_APP_ROLE=ingeniero
```

## Cambiar el rol desde codigo

La app expone un puente Electron para leer y guardar el rol de instalacion:

- `electronAPI.getAppRole()`
- `electronAPI.setAppRole(rol)`

Ejemplo:

```js
await window.electronAPI.setAppRole('ingeniero');
```

## Matriz resumida de roles

| Rol | Tipo de acceso | Modulos principales |
| --- | --- | --- |
| Propietario | Total | Todo el sistema |
| Administracion | Financiero y administrativo | Caja, bancos, creditos, costos, empresa, reportes |
| Ingeniero | Operativo de campo | Campos, lotes, siembra, aplicaciones, cosecha, maquinaria, mantenimiento |

## Desarrollo local

```bash
npm install
npm run dev
```

## Generar instalador

```bash
npm run dist
```

## Generar packs por version

El build genera automaticamente tres packs de entrega:

- `release-dist-YYYYMMDD-HHMMSS/pack-cliente/basica/`
- `release-dist-YYYYMMDD-HHMMSS/pack-cliente/profesional/`
- `release-dist-YYYYMMDD-HHMMSS/pack-cliente/premium/`

Cada pack incluye:

- Un ejecutable principal de escritorio
- `index.html`
- `settings.json` con el plan y el rol por defecto de esa version
- `README.md` de entrega para el cliente

El codigo de activacion se entrega al cliente al momento de la compra.

Uso recomendado:

- Basica: operacion esencial y de inicio
- Profesional: operacion ampliada con modulos de produccion y gestion, incluyendo caja, bancos, creditos y costos
- Premium: acceso completo con el alcance maximo de modulos

Modulos destacados por version:

- Basica: Dashboard, Caja, Bancos, Creditos, Costos, Reportes
- Profesional: Dashboard, Campos, Lotes, Siembra, Hacienda, Caja, Bancos, Creditos, Costos, Reportes
- Premium: acceso completo (incluye Maquinarias, Inventario, Finanzas, Documentos y Reportes)

## Documentacion relacionada

- [BUILD-EXE.md](BUILD-EXE.md)
- [pack-cliente/MATRIZ_MODULOS_ROLES_Y_LICENCIAS.txt](pack-cliente/MATRIZ_MODULOS_ROLES_Y_LICENCIAS.txt)
