// config/database.js
// Ajustar según la BD que use el ERP.
// Por defecto, ejemplo con better-sqlite3 (fácil de portar a pg/mysql2).

const path = require('path');

module.exports = {
  // Cambiar por la conexión del ERP principal.
  client: process.env.DB_CLIENT || 'sqlite',
  connection: {
    filename: process.env.DB_FILE || path.join(__dirname, '..', 'db', 'tambo.sqlite'),
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || 'erp',
  },
  // Prefijo opcional para no chocar con tablas existentes del ERP
  tablePrefix: 'tambo_',
};
