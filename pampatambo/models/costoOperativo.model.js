const jsonModel = require('./_jsonModel');

module.exports = jsonModel('costosOperativos.json', {
  fecha: '',
  sector: '',
  actividad: '',
  concepto: '',
  monto: 0,
  unidad: '',
  cantidad: 0,
  estado: 'PENDIENTE',
  observaciones: '',
});
