const jsonModel = require('./_jsonModel');

module.exports = jsonModel('empleados.json', {
  legajo: '',
  nombre: '',
  apellido: '',
  documento: '',
  cargo: '',
  area: '',
  fecha_ingreso: '',
  sueldo_base: 0,
  estado: 'ACTIVO',
  observaciones: '',
});
