const crud = require('./_crudController');
const model = require('../models/insumoSanidad.model');

module.exports = crud(model, {
  allowedFields: ['producto', 'categoria', 'stock', 'unidad', 'vencimiento', 'lote'],
});
