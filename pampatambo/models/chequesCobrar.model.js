const jsonModel = require('./_jsonModel');

module.exports = jsonModel('chequesCobrar.json', {
  numero: '',
  banco: '',
  origen: '',
  importe: 0,
  vencimiento: '',
  estado: 'PENDIENTE',
  observaciones: '',
});
