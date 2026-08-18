const jsonModel = require('./_jsonModel');

module.exports = jsonModel('animales.json', {
  caravana: '',
  nombre: '',
  categoria: 'VACA_LACTANCIA',
  raza_id: '',
  sexo: 'H',
  fecha_nacimiento: '',
  fecha_ingreso: '',
  madre_id: '',
  padre_id: '',
  estado: 'ACTIVO',
  estado_reprod: 'VACIA',
  estado_lactancia: 'DESCANSO',
  fecha_reingreso_servicio: '',
  observaciones: '',
});
