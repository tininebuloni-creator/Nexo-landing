const crud = require('./_crudController');
module.exports = crud(require('../models/alimento.model'), {
  allowedFields: ['nombre','tipo','ms_pct','pb_pct','em_mcal','stock','unidad']
});
