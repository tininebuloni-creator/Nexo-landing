const crud = require('./_crudController');
const model = require('../models/chequesCobrar.model');

module.exports = crud(model, {
  allowedFields: ['numero', 'banco', 'origen', 'importe', 'vencimiento', 'estado', 'observaciones'],
});
