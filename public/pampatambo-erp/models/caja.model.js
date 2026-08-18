const jsonModel = require('./_jsonModel');

module.exports = jsonModel('caja.json', {
  fecha: '',
  tipo: 'EGRESO',
  concepto: '',
  monto: 0,
  medio: '',
  estado: 'PENDIENTE',
  comprobante: '',
  observaciones: '',
});
