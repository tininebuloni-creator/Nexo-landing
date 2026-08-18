const crud = require('./_crudController');
const model = require('../models/sanidad.model');

module.exports = crud(model, {
  allowedFields: ['fecha', 'animal_id', 'vaca', 'tipo', 'producto', 'dias_retiro', 'responsable', 'observaciones'],
});
