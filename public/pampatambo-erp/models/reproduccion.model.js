const jsonModel = require('./_jsonModel');

module.exports = jsonModel('reproduccion.json', {
  fecha: '',
  animal_id: '',
  vaca: '',
  tipo_servicio: 'IA',
  resultado: 'PENDIENTE',
  metodo_estimacion_parto: 'CALCULADO',
  fecha_estimada_parto: '',
  dias_para_parto: '',
  observaciones: '',
});
