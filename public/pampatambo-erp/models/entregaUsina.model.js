const jsonModel = require('./_jsonModel');

module.exports = jsonModel('entregasUsina.json', {
  fecha: '',
  camion: '',
  chofer: '',
  usina: '',
  litros: 0,
  precio: 0,
  temperatura_c: 0,
  grasa_pct: 0,
  proteina_pct: 0,
  estado: 'ENTREGADO',
  observaciones: '',
});
