const crud = require('./_crudController');
const model = require('../models/lote.model');

module.exports = crud(model, {
  allowedFields: ['campo_id', 'nombre', 'uso', 'superficie_ha', 'latitud', 'longitud', 'poligono_geojson', 'estado'],
});
