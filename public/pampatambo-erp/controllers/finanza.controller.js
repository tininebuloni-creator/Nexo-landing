const crud = require('./_crudController');
const model = require('../models/finanza.model');

module.exports = crud(model, {
  allowedFields: [
    'fecha',
    'tipo',
    'categoria',
    'concepto',
    'monto',
    'medio_pago',
    'estado',
    'referencia',
    'observaciones',
  ],
});
