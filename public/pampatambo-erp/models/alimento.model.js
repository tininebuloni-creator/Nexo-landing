const jsonModel = require('./_jsonModel');

module.exports = jsonModel('alimentos.json', {
  nombre: '',
  tipo: '',
  ms_pct: 0,
  pb_pct: 0,
  em_mcal: 0,
  stock: 0,
  unidad: 'kg',
});
