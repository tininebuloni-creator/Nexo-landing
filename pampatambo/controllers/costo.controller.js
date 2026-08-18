const crud = require('./_crudController');
const model = require('../models/costo.model');

module.exports = crud(model, {
  allowedFields: [
    'fecha',
    'categoria',
    'concepto',
    'monto',
    'proveedor',
    'comprobante',
    'estado',
    'observaciones',
  ],
});
