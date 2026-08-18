const crud = require('./_crudController');
const model = require('../models/costoOperativo.model');

module.exports = crud(model, {
  allowedFields: [
    'fecha',
    'sector',
    'actividad',
    'concepto',
    'monto',
    'unidad',
    'cantidad',
    'estado',
    'observaciones',
  ],
});
