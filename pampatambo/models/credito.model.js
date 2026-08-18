const jsonModel = require('./_jsonModel');

module.exports = jsonModel('creditos.json', {
  fecha: '',
  entidad: '',
  destino: '',
  tipo: 'TOMADO',
  monto: 0,
  tasa_anual: 0,
  cuotas: 0,
  vencimiento: '',
  estado: 'ACTIVO',
  observaciones: '',
});
