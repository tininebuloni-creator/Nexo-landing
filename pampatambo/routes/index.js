const express = require('express');
const animalController = require('../controllers/animal.controller');
const alimentoController = require('../controllers/alimento.controller');
const ordeneController = require('../controllers/ordene.controller');
const reproduccionController = require('../controllers/reproduccion.controller');
const sanidadController = require('../controllers/sanidad.controller');
const maquinaController = require('../controllers/maquina.controller');
const insumoSanidadController = require('../controllers/insumoSanidad.controller');
const campoController = require('../controllers/campo.controller');
const loteController = require('../controllers/lote.controller');
const instalacionController = require('../controllers/instalacion.controller');
const entregaUsinaController = require('../controllers/entregaUsina.controller');
const costoController = require('../controllers/costo.controller');
const costoOperativoController = require('../controllers/costoOperativo.controller');
const finanzaController = require('../controllers/finanza.controller');
const cajaController = require('../controllers/caja.controller');
const bancoController = require('../controllers/banco.controller');
const creditoController = require('../controllers/credito.controller');
const chequesCobrarController = require('../controllers/chequesCobrar.controller');
const chequesCubrirController = require('../controllers/chequesCubrir.controller');
const empleadoController = require('../controllers/empleado.controller');
const asistenciaController = require('../controllers/asistencia.controller');
const licenseController = require('../controllers/license.controller');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, module: 'tambo' });
});

router.get('/license/capabilities', licenseController.capabilities);
router.post('/license/sign', licenseController.sign);
router.post('/license/verify', licenseController.verify);
router.post('/license/trial-link', licenseController.issueTrialLink);
router.post('/license/trial-redeem', licenseController.redeemTrialLink);

router.get('/animales', animalController.index);
router.get('/animales/:id', animalController.show);
router.post('/animales', animalController.create);
router.put('/animales/:id', animalController.update);
router.delete('/animales/:id', animalController.remove);

router.get('/alimentos', alimentoController.index);
router.get('/alimentos/:id', alimentoController.show);
router.post('/alimentos', alimentoController.create);
router.put('/alimentos/:id', alimentoController.update);
router.delete('/alimentos/:id', alimentoController.remove);

router.get('/ordenes', ordeneController.index);
router.get('/ordenes/:id', ordeneController.show);
router.post('/ordenes', ordeneController.create);
router.put('/ordenes/:id', ordeneController.update);
router.delete('/ordenes/:id', ordeneController.remove);

router.get('/reproduccion', reproduccionController.index);
router.get('/reproduccion/:id', reproduccionController.show);
router.post('/reproduccion', reproduccionController.create);
router.put('/reproduccion/:id', reproduccionController.update);
router.delete('/reproduccion/:id', reproduccionController.remove);

router.get('/sanidad', sanidadController.index);
router.get('/sanidad/:id', sanidadController.show);
router.post('/sanidad', sanidadController.create);
router.put('/sanidad/:id', sanidadController.update);
router.delete('/sanidad/:id', sanidadController.remove);

router.get('/maquinas', maquinaController.index);
router.get('/maquinas/:id', maquinaController.show);
router.post('/maquinas', maquinaController.create);
router.put('/maquinas/:id', maquinaController.update);
router.delete('/maquinas/:id', maquinaController.remove);

router.get('/insumosSanidad', insumoSanidadController.index);
router.get('/insumosSanidad/:id', insumoSanidadController.show);
router.post('/insumosSanidad', insumoSanidadController.create);
router.put('/insumosSanidad/:id', insumoSanidadController.update);
router.delete('/insumosSanidad/:id', insumoSanidadController.remove);

router.get('/campos', campoController.index);
router.get('/campos/:id', campoController.show);
router.post('/campos', campoController.create);
router.put('/campos/:id', campoController.update);
router.delete('/campos/:id', campoController.remove);

router.get('/lotes', loteController.index);
router.get('/lotes/:id', loteController.show);
router.post('/lotes', loteController.create);
router.put('/lotes/:id', loteController.update);
router.delete('/lotes/:id', loteController.remove);

router.get('/instalaciones', instalacionController.index);
router.get('/instalaciones/:id', instalacionController.show);
router.post('/instalaciones', instalacionController.create);
router.put('/instalaciones/:id', instalacionController.update);
router.delete('/instalaciones/:id', instalacionController.remove);

router.get('/entregas-usina', entregaUsinaController.index);
router.get('/entregas-usina/:id', entregaUsinaController.show);
router.post('/entregas-usina', entregaUsinaController.create);
router.put('/entregas-usina/:id', entregaUsinaController.update);
router.delete('/entregas-usina/:id', entregaUsinaController.remove);

router.get('/costos', costoController.index);
router.get('/costos/:id', costoController.show);
router.post('/costos', costoController.create);
router.put('/costos/:id', costoController.update);
router.delete('/costos/:id', costoController.remove);

router.get('/costos-operativos', costoOperativoController.index);
router.get('/costos-operativos/:id', costoOperativoController.show);
router.post('/costos-operativos', costoOperativoController.create);
router.put('/costos-operativos/:id', costoOperativoController.update);
router.delete('/costos-operativos/:id', costoOperativoController.remove);

router.get('/finanzas', finanzaController.index);
router.get('/finanzas/:id', finanzaController.show);
router.post('/finanzas', finanzaController.create);
router.put('/finanzas/:id', finanzaController.update);
router.delete('/finanzas/:id', finanzaController.remove);

router.get('/caja', cajaController.index);
router.get('/caja/:id', cajaController.show);
router.post('/caja', cajaController.create);
router.put('/caja/:id', cajaController.update);
router.delete('/caja/:id', cajaController.remove);

router.get('/bancos', bancoController.index);
router.get('/bancos/:id', bancoController.show);
router.post('/bancos', bancoController.create);
router.put('/bancos/:id', bancoController.update);
router.delete('/bancos/:id', bancoController.remove);

router.get('/creditos', creditoController.index);
router.get('/creditos/:id', creditoController.show);
router.post('/creditos', creditoController.create);
router.put('/creditos/:id', creditoController.update);
router.delete('/creditos/:id', creditoController.remove);

router.get('/cheques-cobrar', chequesCobrarController.index);
router.get('/cheques-cobrar/:id', chequesCobrarController.show);
router.post('/cheques-cobrar', chequesCobrarController.create);
router.put('/cheques-cobrar/:id', chequesCobrarController.update);
router.delete('/cheques-cobrar/:id', chequesCobrarController.remove);

router.get('/cheques-cubrir', chequesCubrirController.index);
router.get('/cheques-cubrir/:id', chequesCubrirController.show);
router.post('/cheques-cubrir', chequesCubrirController.create);
router.put('/cheques-cubrir/:id', chequesCubrirController.update);
router.delete('/cheques-cubrir/:id', chequesCubrirController.remove);

router.get('/empleados', empleadoController.index);
router.get('/empleados/:id', empleadoController.show);
router.post('/empleados', empleadoController.create);
router.put('/empleados/:id', empleadoController.update);
router.delete('/empleados/:id', empleadoController.remove);

router.get('/asistencias', asistenciaController.index);
router.get('/asistencias/:id', asistenciaController.show);
router.post('/asistencias', asistenciaController.create);
router.put('/asistencias/:id', asistenciaController.update);
router.delete('/asistencias/:id', asistenciaController.remove);

module.exports = router;
