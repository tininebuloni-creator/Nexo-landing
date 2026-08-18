const crud = require('./_crudController');
const model = require('../models/credito.model');

module.exports = crud(model, {
  allowedFields: [
    'fecha',
    'entidad',
    'destino',
    'tipo',
    'monto',
    'tasa_anual',
    'cuotas',
    'vencimiento',
    'estado',
    'observaciones',
  ],
});
