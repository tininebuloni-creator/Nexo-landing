const jsonModel = require('./_jsonModel');

module.exports = jsonModel('instalaciones.json', {
  codigo: '',
  nombre: '',
  tipo: '',
  fecha_alta: '',
  valor_compra: 0,
  vida_util_anios: 10,
  valor_residual: 0,
  costo_mantenimiento_anual: 0,
  frecuencia_mantenimiento_dias: 180,
  proximo_mantenimiento: '',
  estado: 'ACTIVO',
  observaciones: '',
});
