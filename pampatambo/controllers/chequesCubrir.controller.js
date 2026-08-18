const crud = require('./_crudController');
const model = require('../models/chequesCubrir.model');

module.exports = crud(model, {
  allowedFields: ['numero', 'banco', 'destino', 'importe', 'vencimiento', 'estado', 'observaciones'],
});
