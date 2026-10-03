// Carpeta donde el servidor guarda los datos fiscales (una colección = un .json).
// En escritorio (Electron) apunta a la carpeta del usuario (PAMPA_DATA_DIR, la define
// electron/main.js): la carpeta de instalación queda dentro del asar (solo lectura) y se
// reemplaza al actualizar. Sin esa variable (servidor propio, desarrollo) usa ./data.
const path = require('path');

function dataDir() {
  return process.env.PAMPA_DATA_DIR || path.join(__dirname, 'data');
}

// Raíz para la configuración ARCA (.arca-config.json, caché WSAA y rutas relativas de certificados).
function stateRoot() {
  return process.env.PAMPA_DATA_DIR ? path.dirname(process.env.PAMPA_DATA_DIR) : __dirname;
}

module.exports = { dataDir, stateRoot };
