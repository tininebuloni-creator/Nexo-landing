const crud = require('./_crudController');
const model = require('../models/entregaUsina.model');

module.exports = crud(model, {
  allowedFields: [
    'fecha',
    'camion',
    'chofer',
    'usina',
    'litros',
    'precio',
    'temperatura_c',
    'grasa_pct',
    'proteina_pct',
    'estado',
    'observaciones',
  ],
});
