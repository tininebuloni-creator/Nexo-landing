const jsonModel = require('./_jsonModel');

module.exports = jsonModel('costos.json', {
  fecha: '',
  categoria: '',
  concepto: '',
  monto: 0,
  proveedor: '',
  comprobante: '',
  estado: 'PENDIENTE',
  observaciones: '',
});
