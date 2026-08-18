const jsonModel = require('./_jsonModel');

module.exports = jsonModel('lotes.json', {
  campo_id: '',
  nombre: '',
  uso: '',
  superficie_ha: 0,
  latitud: 0,
  longitud: 0,
  poligono_geojson: '',
  estado: 'ACTIVO',
});
