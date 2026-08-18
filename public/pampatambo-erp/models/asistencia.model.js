const jsonModel = require('./_jsonModel');

module.exports = jsonModel('asistencias.json', {
  fecha: '',
  legajo: '',
  empleado: '',
  turno: '',
  estado: 'PRESENTE',
  horas: 0,
  observaciones: '',
});
