const crud = require('./_crudController');
const model = require('../models/ordene.model');

module.exports = crud(model, {
  allowedFields: ['fecha', 'turno', 'animal_id', 'vaca', 'litros', 'observaciones'],
});
