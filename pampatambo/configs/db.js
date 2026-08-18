// config/db.js
// Wrapper mínimo sobre la BD. Reemplazar por el pool/cliente que use el ERP.
// Ejemplo con better-sqlite3 (síncrono, simple para arrancar).

const Database = (() => {
  try { return require('better-sqlite3'); } catch { return null; }
})();
const cfg = require('./database');

let db;
if (Database) {
  db = new Database(cfg.connection.filename);
  db.pragma('journal_mode = WAL');
} else {
  console.warn('[tambo] better-sqlite3 no instalado. Reemplazar por el cliente del ERP.');
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}
function exec(sql) {
  return db.exec(sql);
}

module.exports = { db, all, get, run, exec, cfg };
