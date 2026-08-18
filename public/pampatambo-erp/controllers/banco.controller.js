const crud = require('./_crudController');
const model = require('../models/banco.model');

module.exports = crud(model, {
  allowedFields: [
    'fecha',
    'banco',
    'cuenta',
    'tipo',
    'concepto',
    'monto',
    'referencia',
    'estado',
    'observaciones',
  ],
});
