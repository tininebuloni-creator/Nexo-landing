const crud = require('./_crudController');
const model = require('../models/empleado.model');

module.exports = crud(model, {
  allowedFields: [
    'legajo',
    'nombre',
    'apellido',
    'documento',
    'cargo',
    'area',
    'fecha_ingreso',
    'sueldo_base',
    'estado',
    'observaciones',
  ],
});
