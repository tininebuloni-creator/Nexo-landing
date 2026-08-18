const jsonModel = require('./_jsonModel');

module.exports = jsonModel('sanidad.json', {
  fecha: '',
  animal_id: '',
  vaca: '',
  tipo: 'VACUNA',
  producto: '',
  dias_retiro: 0,
  responsable: '',
  observaciones: '',
});
