const crud = require('./_crudController');
const model = require('../models/animal.model');
module.exports = crud(model, {
  allowedFields: [
    'caravana','nombre','categoria','raza_id','sexo','fecha_nacimiento',
    'fecha_ingreso','madre_id','padre_id','estado','estado_reprod','estado_lactancia','fecha_reingreso_servicio','observaciones'
  ]
});
