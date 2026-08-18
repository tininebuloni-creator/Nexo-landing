const crud = require('./_crudController');
const model = require('../models/campo.model');

module.exports = crud(model, {
  allowedFields: ['nombre', 'establecimiento', 'superficie_ha', 'latitud', 'longitud', 'observaciones'],
});
