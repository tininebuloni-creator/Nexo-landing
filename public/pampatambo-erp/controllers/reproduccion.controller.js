const crud = require('./_crudController');
const model = require('../models/reproduccion.model');

module.exports = crud(model, {
  allowedFields: ['fecha', 'animal_id', 'vaca', 'tipo_servicio', 'resultado', 'metodo_estimacion_parto', 'fecha_estimada_parto', 'dias_para_parto', 'observaciones'],
});
