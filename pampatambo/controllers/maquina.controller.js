const crud = require('./_crudController');
const model = require('../models/maquina.model');

module.exports = crud(model, {
  allowedFields: ['codigo', 'nombre', 'categoria', 'estado', 'stock_repuestos', 'observaciones'],
});
