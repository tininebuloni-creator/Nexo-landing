const jsonModel = require('./_jsonModel');

module.exports = jsonModel('chequesCubrir.json', {
  numero: '',
  banco: '',
  destino: '',
  importe: 0,
  vencimiento: '',
  estado: 'PENDIENTE',
  observaciones: '',
});
