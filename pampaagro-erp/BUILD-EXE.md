# PampaAgro ERP - Build EXE

## Opcion recomendada
- **Electron**: mas rapido para empaquetar tu app web actual como `.exe` sin reescribir todo.

## Alternativa a evaluar
- **Tauri**: EXE mas liviano y menor consumo RAM, pero implica adaptar parte del proyecto.

## Requisitos
1. Node.js LTS instalado.
2. Estar en la carpeta raiz del proyecto.

## Desarrollo local
```bash
npm install
npm run dev
```

## Branding del ejecutable/instalador
- El icono Windows se genera automaticamente desde `logo.png` en `build/icon.ico`.
- Para regenerarlo manualmente:
```bash
npm run make:icon
```

## Generar ejecutables Windows
```bash
npm run dist
```

## Generar build firmado (certificado de codigo)
Configura variables de entorno y luego ejecuta:
```bash
npm run dist:signed
```

Variables requeridas para firma:
- `CSC_LINK`: ruta al archivo de certificado (`.pfx`) o URL segura.
- `CSC_KEY_PASSWORD`: contraseña del certificado.
- `NEXO_AUTO_UPDATE_URL` (opcional): URL de feed para updates en runtime.

Los artefactos se generan en una carpeta versionada por fecha/hora:
- `release-dist-YYYYMMDD-HHMMSS/`

Archivos principales de distribucion:
- `PampaAgro ERP-Setup-VERSION-x64.exe` (instalador)
- `PampaAgro ERP-Portable-VERSION-x64.exe` (portable)

## Build sin instalador (carpeta ejecutable)
```bash
npm run pack
```

La version sin instalador se genera en `release-pack/win-unpacked/`.

## Archivos clave
- `electron/main.js`: proceso principal de Electron.
- `electron/preload.js`: puente seguro renderer <-> main.
- `package.json`: scripts y configuracion de empaquetado.
- `build/LICENSE-EULA.txt`: texto de licencia mostrado por el instalador.
- `scripts/build-dist.js`: build normal y firmado opcional.
- `scripts/make-icon.js`: generacion automatica de icono `.ico`.

## Auto-actualizaciones
- La app usa `electron-updater`.
- En instalacion real (`Setup`), revisa updates automaticamente al iniciar y cada 6 horas.
- Feed por defecto en build: `https://updates.nexoagro.com/releases`.
- Puedes sobreescribir feed en runtime con `NEXO_AUTO_UPDATE_URL`.

## Rol por instalacion
- El rol inicial se lee desde `settings.json` dentro de la carpeta de datos de usuario de Electron.
- Prioridad de configuracion:
	1. `settings.json` -> `appRole`
	2. Variable de entorno `NEXO_APP_ROLE`
	3. Valor por defecto `administracion`
- Valores validos: `propietario`, `administracion`, `ingeniero`.
- Si queres fijarlo manualmente en una instalacion, usa el archivo de settings o llama a `electronAPI.setAppRole(rol)` desde el renderer.

## Integrar sincronizacion real de nube
Hoy el handler `sync-files` es un stub y esta en:
- `electron/main.js`

Ahi debes conectar la logica real para sincronizar archivos en la nube configurada por el usuario (OneDrive, Google Drive, Dropbox, carpeta sincronizada, etc.).
