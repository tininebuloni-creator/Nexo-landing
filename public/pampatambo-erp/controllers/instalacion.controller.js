const crud = require('./_crudController');
const model = require('../models/instalacion.model');

module.exports = crud(model, {
  allowedFields: [
    'codigo',
    'nombre',
    'tipo',
    'fecha_alta',
    'valor_compra',
    'vida_util_anios',
    'valor_residual',
    'costo_mantenimiento_anual',
    'frecuencia_mantenimiento_dias',
    'proximo_mantenimiento',
    'estado',
    'observaciones',
  ],
});
