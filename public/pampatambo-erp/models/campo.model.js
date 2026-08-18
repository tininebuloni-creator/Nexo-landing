const jsonModel = require('./_jsonModel');

module.exports = jsonModel('campos.json', {
  nombre: '',
  establecimiento: '',
  superficie_ha: 0,
  latitud: 0,
  longitud: 0,
  observaciones: '',
});
