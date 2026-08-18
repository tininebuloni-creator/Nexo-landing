const jsonModel = require('./_jsonModel');

module.exports = jsonModel('bancos.json', {
  fecha: '',
  banco: '',
  cuenta: '',
  tipo: 'EGRESO',
  concepto: '',
  monto: 0,
  referencia: '',
  estado: 'PENDIENTE',
  observaciones: '',
});
