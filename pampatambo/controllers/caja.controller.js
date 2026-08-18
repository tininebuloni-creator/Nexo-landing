const crud = require('./_crudController');
const model = require('../models/caja.model');

module.exports = crud(model, {
  allowedFields: [
    'fecha',
    'tipo',
    'concepto',
    'monto',
    'medio',
    'estado',
    'comprobante',
    'observaciones',
  ],
});
