const crud = require('./_crudController');
const model = require('../models/asistencia.model');

module.exports = crud(model, {
  allowedFields: [
    'fecha',
    'legajo',
    'empleado',
    'turno',
    'estado',
    'horas',
    'observaciones',
  ],
});
