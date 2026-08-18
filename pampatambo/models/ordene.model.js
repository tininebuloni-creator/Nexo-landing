const jsonModel = require('./_jsonModel');

module.exports = jsonModel('ordenes.json', {
  fecha: '',
  turno: 'MANANA',
  animal_id: '',
  vaca: '',
  litros: 0,
  observaciones: '',
});
