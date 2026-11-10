// PampaAgro · ARCA en la prueba web: mismas rutas y respuestas que el servidor de escritorio (electron/server.js), pero
// SIMULADAS y sin validez fiscal (ver pampa-arca-web.js). Se usa solo cuando no hay app de escritorio (window.electronAPI).
(function () {
  'use strict';
  const A = window.PampaArcaWeb;
  if (!A) return;
  const APP = 'agro';
  const BASE = 'pampa-arca-web://agro';
  const { util } = A;
  const d = util.soloDigitos;
  const cuitEmpresa = () => { try { return d(state.empresa && state.empresa.cuit); } catch { return ''; } };
  const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
  const entero = (v) => (String(v ?? '').trim() !== '' && Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : undefined);
  const ok = (datos) => ({ success: true, simulado: true, ...datos });
  // Tablas SISA de retención (mismas que @pampa/core-fiscal-arca/retenciones-sisa-lpg, productor directo).
  const RET_IVA = { 1: 0.05, 2: 0.07, 3: 0.08, INACTIVO: 0.08 };
  const RET_IVA_OPERADOR = { 1: 0.1, 2: 0.1, 3: 0.16, INACTIVO: 0.16 };
  const RET_GAN = { 1: 0, 2: 0.02, 3: 0.15 };

  async function resolverLugar(lugar) {
    // Provincia y localidad: código o nombre (como en el escritorio), con los catálogos estáticos de ARCA.
    if (!lugar) return lugar;
    const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    const buscar = (lista, v) => {
      if (/^\d+$/.test(String(v ?? '').trim())) return Number(v);
      const exactos = (lista || []).filter((i) => norm(i.descripcion) === norm(v));
      return exactos.length === 1 ? Number(exactos[0].codigo) : undefined;
    };
    try {
      const codProvincia = buscar(await A.catalogo('provincias'), lugar.codProvincia);
      const codLocalidad = codProvincia === undefined ? undefined : buscar(await A.catalogo('localidades', codProvincia), lugar.codLocalidad);
      return { ...lugar, codProvincia: codProvincia ?? lugar.codProvincia, codLocalidad: codLocalidad ?? lugar.codLocalidad };
    } catch { return lugar; }
  }

  A.registrar(APP, [
    {
      metodo: 'GET', patron: /^\/api\/fiscal\/arca\/estado$/, sinConfig: true,
      manejar: async ({ app }) => {
        const e = await A.estado(app);
        return { simulado: true, entorno: e.ambiente, certificadoConfigurado: e.configurada && !e.demostracion, claveConfigurada: e.configurada && !e.demostracion, cuitConfigurado: Boolean(e.cuit), activo: e.configurada, minutosRestantes: e.configurada ? 720 : 0, cuitProductor: e.cuit, servicioDisponible: e.configurada, aviso: util.AVISO };
      }
    },
    {
      metodo: 'GET', patron: /^\/api\/fiscal\/catalogos\/(\w+)$/, sinConfig: true,
      manejar: async ({ match, params }) => {
        if (match[1] !== 'wscpe') throw util.error(`En la web solo están los catálogos de Carta de Porte (WSCPE); los de ${match[1].toUpperCase()} se bajan desde el escritorio.`, 404);
        const info = await util.catalogoInfo();
        const datos = params.tabla ? await A.catalogo(params.tabla, params.provincia) : { granos: await A.catalogo('granos'), provincias: await A.catalogo('provincias') };
        return ok({ servicio: 'wscpe', ambiente: info.ambiente, actualizado: info.actualizado, errores: {}, datos });
      }
    },
    {
      metodo: 'POST', patron: /^\/api\/fiscal\/catalogos\/sincronizar$/, sinConfig: true,
      manejar: async () => {
        const info = await util.catalogoInfo();
        return ok({ catalogos: { wscpe: { origen: 'copia-web', actualizado: info.actualizado, tablas: ['granos', 'provincias', 'localidades'], errores: {} } }, message: 'En la web se usa la copia de los catálogos de ARCA publicada con la app.' });
      }
    },
    {
      metodo: 'POST', patron: /^\/api\/fiscal\/cpe\/autorizar$/,
      manejar: async ({ cuerpo: b, cfg, app }) => {
        const clave = String(b.idempotencyKey || '').trim();
        if (clave) {
          const previo = util.documentos.listar(app, 'cpe').find((x) => x.idempotencyKey === clave);
          if (previo) return ok({ ...previo, repetido: true, message: `La CPE ya estaba autorizada (CTG ${previo.ctg}, simulado).` });
        }
        const origen = await resolverLugar(b.origen);
        const destino = await resolverLugar(b.destino);
        const tr = b.transporte || {};
        const kilos = num(b.kilosTotales);
        const faltan = [
          !b.campo && 'campo', !(kilos > 0) && 'kilos', !String(b.patente || '').trim() && 'patente del camión', !b.grano && 'grano',
          !(entero(origen && origen.codProvincia) !== undefined && entero(origen && origen.codLocalidad)) && 'provincia y localidad de ARCA del origen',
          d(tr.cuitTransportista).length !== 11 && 'CUIT del transportista', d(tr.cuitChofer).length !== 11 && 'CUIT del chofer', !(num(tr.kmRecorrer) > 0) && 'kilómetros a recorrer',
          d((destino && destino.cuit) || b.cuitDestinatario || b.cuitCliente).length !== 11 && 'CUIT del destino',
          !(entero(destino && destino.codProvincia) !== undefined && entero(destino && destino.codLocalidad)) && 'provincia y localidad de ARCA del destino',
          d(b.cuitDestinatario || b.cuitCliente).length !== 11 && 'CUIT del destinatario'
        ].filter(Boolean);
        if (faltan.length) throw util.error(`Para pedir el CTG falta: ${faltan.join(', ')}.`, 400, { codigo: 'CPE_DATOS_INCOMPLETOS', faltan });
        const sucursal = entero(b.sucursal) || 1;
        const registro = {
          ctg: util.ctg(), codigoBarra: util.azar(20), loteId: b.campo.codigo || b.campo.nombre || '', campoCodigo: b.campo.codigo || '',
          kilosOrigen: kilos, kilos, kilosDestino: null, patente: b.patente || '', tipoCPE: 74, sucursal, nroOrden: util.siguiente(app, `cpe-${sucursal}`),
          compradorCuit: b.cuitCliente || '', estado: 'APROBADO', estadoFiscal: 'APROBADO', estadoInterno: 'En tránsito', cierreLogistico: 'Abierto',
          observaciones: [util.AVISO], simulado: true, cuitSolicitante: cfg.cuit, creadoEn: new Date().toISOString(), idempotencyKey: clave || undefined
        };
        util.documentos.agregar(app, 'cpe', registro);
        return ok({ ...registro, message: `CPE ${registro.ctg} autorizada (SIMULADA, sin validez fiscal).` });
      }
    },
    {
      metodo: 'GET', patron: /^\/api\/fiscal\/cartas-porte-cpe$/,
      sinConfig: true,
      manejar: async ({ app }) => ({ cartasPorteCPE: util.documentos.listar(app, 'cpe'), simulado: true })
    },
    {
      metodo: 'POST', patron: /^\/api\/fiscal\/cpe\/confirmar-arribo$/,
      manejar: async ({ cuerpo: b, app }) => {
        const previa = util.documentos.listar(app, 'cpe').find((x) => x.ctg === b.ctg);
        if (!previa) throw util.error(`No se encontró la CPE ${b.ctg}.`, 404);
        const kilosDestino = num(b.kilosDestino);
        const kilosMerma = Math.max(0, num(previa.kilosOrigen) - kilosDestino);
        util.documentos.actualizar(app, 'cpe', (x) => x.ctg === b.ctg, {
          kilosDestino, kilosMerma, cierreLogistico: 'Cerrado', estadoInterno: 'Arribado',
          ...(b.precioPizarra ? { perdidaEconomicaMerma: Math.round(kilosMerma * num(b.precioPizarra)) } : {})
        });
        return ok({ kilosMerma, message: 'Arribo confirmado (SIMULADO, sin validez fiscal).' });
      }
    },
    {
      metodo: 'POST', patron: /^\/api\/fiscal\/lpg\/emitir$/,
      manejar: async ({ cuerpo: b, cfg, app }) => {
        const kilos = num(b.kilos);
        const precioRefTn = b.precioRefTn !== undefined && b.precioRefTn !== '' ? num(b.precioRefTn) : (kilos > 0 && num(b.importeNeto) > 0 ? Math.round(num(b.importeNeto) / kilos * 1000 * 1000) / 1000 : undefined);
        if (!b.cuitComprador || !(kilos > 0 || (b.certificados || []).length) || precioRefTn === undefined) {
          throw util.error('Faltan datos para la LPG: CUIT comprador, kilos (o certificados) y precio por tonelada (o importe neto).', 400, { codigo: 'LPG_DATOS_INCOMPLETOS' });
        }
        // Misma regla que ARCA (manual WSLPG): la LPG la liquida el comprador o el corredor.
        const liquidador = d(cfg.cuit);
        const liquidaCorredor = Boolean(b.liquidaCorredor);
        const liquida = liquidaCorredor ? d(b.corredor && b.corredor.cuit) === liquidador : d(b.cuitComprador) === liquidador;
        if (!liquida) {
          throw util.error(`La LPG la emite ante ARCA el comprador (o el corredor que liquida). La CUIT configurada (${liquidador}) no es ${liquidaCorredor ? 'la del corredor' : `la del comprador (${d(b.cuitComprador)})`}: pedile la LPG al comprador y consultala por COE.`, 422, { codigo: 'LPG_LA_LIQUIDA_EL_COMPRADOR' });
        }
        const estadoSisa = b.estadoSisa ? String(b.estadoSisa).trim().toUpperCase() : '';
        if (!estadoSisa) throw util.error('Indicá el Estado SISA del vendedor (1, 2, 3 o INACTIVO) según su constancia en ARCA.', 422, { codigo: 'LPG_FALTA_ESTADO_SISA' });
        const subTotal = util.redondear(kilos * precioRefTn / 1000);
        const alicIva = b.alicIvaOperacion === null ? 0 : (b.alicIvaOperacion === undefined || b.alicIvaOperacion === '' ? 10.5 : num(b.alicIvaOperacion)); // 0 es una alícuota válida (exento): no se pisa con 10,5
        const importeIva = util.redondear(subTotal * alicIva / 100);
        // CBU del vendedor inconsistente (RG 4310, arts. 70 y 76): se retiene el 100 % del IVA de la operación.
        const cbuInconsistente = b.cbuInconsistente === true || b.cbuInconsistente === 'si';
        const retIva = cbuInconsistente ? importeIva : util.redondear(subTotal * ((b.esOperador ? RET_IVA_OPERADOR : RET_IVA)[estadoSisa] ?? 0));
        const motivoIva = cbuInconsistente ? 'CBU del vendedor inconsistente: se retiene el 100 % del IVA (RG 4310, arts. 70 y 76).' : `Estado ${estadoSisa} · ${b.esOperador ? 'operador' : 'productor'} vendedor (RG 4310, art. 43).`;
        const retGan = b.esOperador ? 0 : util.redondear(subTotal * (RET_GAN[estadoSisa] ?? (b.inscriptoGanancias ? 0.28 : 0.3)));
        const totalRetencion = util.redondear(retIva + retGan);
        const pto = entero(b.puntoVenta) || 1;
        const nroOrden = util.siguiente(app, `lpg-${pto}`);
        const coe = util.coe();
        const registro = {
          coe, cae: coe, numeroComprobante: `${pto}-${nroOrden}`, ptoEmision: pto, nroOrden, fechaLiquidacion: util.hoy(), puntoVenta: pto,
          cuitComprador: b.cuitComprador, cuitVendedor: b.cuitVendedor || cfg.cuit, codigoGranoSISA: b.codigoGranoSISA || b.grano || '',
          esOperador: Boolean(b.esOperador), ctgsVinculados: b.ctgsVinculados || [], estadoSisa, cbuInconsistente,
          liquidacion: {
            importeNeto: subTotal, iva: { ivaOperacion: importeIva, retencionIva: retIva, motivo: motivoIva }, totalRetenciones: totalRetencion,
            ganancias: { retencionGanancias: retGan }, netoACobrar: util.redondear(subTotal + importeIva - totalRetencion), totalPesoNeto: kilos, precioRefTn
          },
          observaciones: [util.AVISO], simulado: true, creadoEn: new Date().toISOString()
        };
        util.documentos.agregar(app, 'lpg', registro);
        return ok({ ...registro, message: `LPG ${registro.numeroComprobante} autorizada (SIMULADA, COE ${coe}, sin validez fiscal).` });
      }
    },
    {
      metodo: 'GET', patron: /^\/api\/fiscal\/lpg\/coe\/(\d+)$/,
      manejar: async ({ match, app }) => {
        const lpg = util.documentos.listar(app, 'lpg').find((x) => String(x.coe) === match[1]);
        if (!lpg) throw util.error('En la web solo se pueden traer las LPG simuladas en este equipo; las LPG reales se consultan por COE desde la app de escritorio.', 404);
        return ok({
          coe: lpg.coe, ptoEmision: lpg.ptoEmision, nroOrden: lpg.nroOrden, estadoArca: 'AC (simulada)', fechaLiquidacion: lpg.fechaLiquidacion,
          subTotal: lpg.liquidacion.importeNeto, importeIva: lpg.liquidacion.iva.ivaOperacion, totalRetencion: lpg.liquidacion.totalRetenciones,
          totalNetoAPagar: lpg.liquidacion.netoACobrar, totalPesoNeto: lpg.liquidacion.totalPesoNeto,
          datos: { cuitComprador: lpg.cuitComprador, cuitVendedor: lpg.cuitVendedor, codGrano: lpg.codigoGranoSISA }
        });
      }
    }
  ]);

  // Sin app de escritorio: las llamadas al "servidor fiscal" (BASE + ruta) se responden con el simulador.
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async function (recurso, opciones = {}) {
    const url = typeof recurso === 'string' ? recurso : recurso && recurso.url;
    if (!url || !url.startsWith(BASE)) return fetchOriginal(recurso, opciones);
    const ruta = url.slice(BASE.length);
    const metodo = String(opciones.method || 'GET').toUpperCase();
    let cuerpo = {};
    try { cuerpo = opciones.body ? JSON.parse(opciones.body) : {}; } catch { cuerpo = {}; }
    const responder = (status, datos) => new Response(JSON.stringify(datos), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      return responder(200, await A.pedir(APP, metodo, ruta, cuerpo, { cuitSugerido: cuitEmpresa() }));
    } catch (error) {
      return responder(error.status || 500, { success: false, simulado: true, codigo: error.codigo, faltan: error.faltan, message: error.message, error: error.message });
    }
  };
  window.PampaArcaWebAgro = { BASE, esWeb: () => !(window.electronAPI && window.electronAPI.getServerUrl), configurar: () => A.configurar(APP, { cuitSugerido: cuitEmpresa() }) };
})();
