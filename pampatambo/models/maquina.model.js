const jsonModel = require('./_jsonModel');

module.exports = jsonModel('maquinas.json', {
  codigo: '',
  nombre: '',
  categoria: '',
  estado: 'OPERATIVA',
  stock_repuestos: 0,
  observaciones: '',
});
