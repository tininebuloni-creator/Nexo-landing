const jsonModel = require('./_jsonModel');

module.exports = jsonModel('finanzas.json', {
  fecha: '',
  tipo: 'EGRESO',
  categoria: '',
  concepto: '',
  monto: 0,
  medio_pago: '',
  estado: 'PENDIENTE',
  referencia: '',
  observaciones: '',
});
