const jsonModel = require('./_jsonModel');

module.exports = jsonModel('insumosSanidad.json', {
  producto: '',
  categoria: '',
  stock: 0,
  unidad: 'unidad',
  vencimiento: '',
  lote: '',
});
