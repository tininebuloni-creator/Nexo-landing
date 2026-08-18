const fs = require('fs');
const path = require('path');

function ensureFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8');
}

function readRows(filePath) {
  ensureFile(filePath);
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeRows(filePath, rows) {
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
}

function nextId(rows) {
  const ids = rows.map((x) => Number(x.id) || 0);
  return (Math.max(0, ...ids) + 1).toString();
}

module.exports = function jsonModel(fileName, defaults = {}) {
  const filePath = path.join(__dirname, '..', 'data', fileName);

  function list(query = {}) {
    let rows = readRows(filePath);
    const pairs = Object.entries(query || {}).filter(([, value]) => `${value}`.trim() !== '');

    if (!pairs.length) return rows;

    rows = rows.filter((row) => {
      return pairs.every(([key, value]) => {
        const rowValue = row[key];
        if (rowValue == null) return false;
        return `${rowValue}`.toLowerCase().includes(`${value}`.toLowerCase());
      });
    });

    return rows;
  }

  function find(id) {
    const rows = readRows(filePath);
    return rows.find((row) => `${row.id}` === `${id}`) || null;
  }

  function create(payload) {
    const rows = readRows(filePath);
    const row = {
      id: nextId(rows),
      ...defaults,
      ...payload,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    rows.push(row);
    writeRows(filePath, rows);
    return row;
  }

  function update(id, payload) {
    const rows = readRows(filePath);
    const index = rows.findIndex((row) => `${row.id}` === `${id}`);
    if (index < 0) {
      const err = new Error('No encontrado');
      err.status = 404;
      throw err;
    }

    rows[index] = {
      ...rows[index],
      ...payload,
      id: rows[index].id,
      updated_at: new Date().toISOString(),
    };
    writeRows(filePath, rows);
    return rows[index];
  }

  function remove(id) {
    const rows = readRows(filePath);
    const index = rows.findIndex((row) => `${row.id}` === `${id}`);
    if (index < 0) {
      const err = new Error('No encontrado');
      err.status = 404;
      throw err;
    }
    rows.splice(index, 1);
    writeRows(filePath, rows);
  }

  return { list, find, create, update, remove };
};
