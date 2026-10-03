// Retenciones sobre la venta de leche cruda bovina a la usina (LUME). Mismo cálculo en el servidor
// (services/fiscalRules.service.js) y en el navegador (modo local): un solo archivo para ambos.
//  - IVA, RG (AFIP) 1428/2003 (texto según RG 4216): según la condición registral del tambo frente a
//    ARCA, no según el SISA. Responsable inscripto en regla 1 %; no categorizado o monotributista
//    excedido 12,70 %; con transgresiones o irregularidades 21 %.
//    La norma no fija importe mínimo: se retiene sobre cada pago.
//  - Ganancias, RG 830/2000, régimen 78 (enajenación de bienes muebles y bienes de cambio): no hay
//    régimen sectorial para tambos. Inscripto 2 % sobre lo que excede el mínimo no sujeto de $224.000,
//    acumulando los pagos del mismo agente (usina) en el mes calendario; no inscripto 10 % sobre el
//    total, sin mínimo. No se retiene si el resultado es menor a $240.
// Las alícuotas, mínimos y vigencias salen de las reglas VALIDADAS (editables y actualizables por el
// feed de normativa); los valores de abajo son solo los de arranque.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PampaLumeRetenciones = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONDICIONES_IVA = {
    RESPONSABLE_INSCRIPTO: 'Responsable inscripto en regla (1 %)',
    NO_CATEGORIZADO: 'No categorizado / monotributista excedido (12,70 %)',
    IRREGULAR: 'Con transgresiones o irregularidades (21 %)',
    MONOTRIBUTO: 'Monotributista en regla (sin retención)',
  };
  const CONDICIONES_GANANCIAS = {
    INSCRIPTO: 'Inscripto en Ganancias (2 % sobre el excedente de $224.000 mensuales)',
    NO_INSCRIPTO: 'No inscripto en Ganancias (10 % sobre el total)',
    MONOTRIBUTO: 'Monotributista en regla (sin retención; si excede el régimen, elegí Inscripto)',
  };

  const RG1428 = 'RG (AFIP) 1428/2003, texto según RG 4216: retención de IVA sobre la compra de leche cruda bovina según la condición registral del vendedor. La norma no fija importe mínimo: se retiene sobre cada pago, desde el primer peso.';
  const RG1428_URL = 'https://biblioteca.afip.gob.ar/search/query/norma.aspx?p=t:RAG|n:1428|o:3|a:2003|f:30/01/2003';
  const RG830 = 'RG (AFIP) 830/2000, Anexo II, régimen 78 (enajenación de bienes muebles y bienes de cambio): mínimo no sujeto mensual acumulable por agente de retención; retención mínima $240.';
  const VIGENCIA = '2026-01-01';

  const REGLAS_DEFECTO = [
    { regimen: 'IVA_LECHE_ALICUOTA', condicion: 'GENERAL', alicuota_pct: 21, minimo_no_imponible: 0, monto_minimo_retencion: 0, fuente_normativa: 'Ley de IVA: la venta de leche cruda del tambo a la industria está gravada al 21 % (la alícuota reducida solo aplica en la venta al consumidor final).', fuente_url: '' },
    { regimen: 'IVA_LECHE_RETENCION', condicion: 'RESPONSABLE_INSCRIPTO', alicuota_pct: 1, minimo_no_imponible: 0, monto_minimo_retencion: 0, fuente_normativa: RG1428, fuente_url: RG1428_URL },
    { regimen: 'IVA_LECHE_RETENCION', condicion: 'NO_CATEGORIZADO', alicuota_pct: 12.7, minimo_no_imponible: 0, monto_minimo_retencion: 0, fuente_normativa: RG1428, fuente_url: RG1428_URL },
    { regimen: 'IVA_LECHE_RETENCION', condicion: 'IRREGULAR', alicuota_pct: 21, minimo_no_imponible: 0, monto_minimo_retencion: 0, fuente_normativa: RG1428, fuente_url: RG1428_URL },
    { regimen: 'IVA_LECHE_RETENCION', condicion: 'MONOTRIBUTO', alicuota_pct: 0, minimo_no_imponible: 0, monto_minimo_retencion: 0, fuente_normativa: `${RG1428} El monotributista en regla no sufre retención (el excedido tributa como no categorizado).`, fuente_url: RG1428_URL },
    { regimen: 'GANANCIAS_LECHE_RG830', condicion: 'INSCRIPTO', alicuota_pct: 2, minimo_no_imponible: 224000, monto_minimo_retencion: 240, codigo_regimen: '78', fuente_normativa: RG830, fuente_url: '' },
    { regimen: 'GANANCIAS_LECHE_RG830', condicion: 'MONOTRIBUTO', alicuota_pct: 0, minimo_no_imponible: 0, monto_minimo_retencion: 240, codigo_regimen: '78', fuente_normativa: `${RG830} Monotributista en regla: no sufre retención; si excede los parámetros del régimen se le retiene como inscripto.`, fuente_url: '' },
    { regimen: 'GANANCIAS_LECHE_RG830', condicion: 'NO_INSCRIPTO', alicuota_pct: 10, minimo_no_imponible: 0, monto_minimo_retencion: 240, codigo_regimen: '78', fuente_normativa: `${RG830} No inscriptos: sobre el total, sin mínimo no sujeto.`, fuente_url: '' },
  ].map((regla) => ({ jurisdiccion: 'NACIONAL', vigencia_desde: VIGENCIA, vigencia_hasta: '', estado: 'VALIDADA', origen: 'RG1428_RG830', ...regla }));

  const pesos = (valor) => `$${Number(valor || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const redondear = (valor) => Math.round(Number(valor || 0) * 100) / 100;
  const fechaDe = (valor) => String(valor || new Date().toISOString()).slice(0, 10);

  // Condiciones cargadas con la versión anterior (por "Estado SISA", que no aplica a la leche).
  function condicionesDe(liquidacion) {
    const sisa = String(liquidacion.estado_sisa || '').toUpperCase();
    const legadoIva = { 1: 'RESPONSABLE_INSCRIPTO', 2: 'NO_CATEGORIZADO', 3: 'NO_CATEGORIZADO', INACTIVO: 'IRREGULAR', MONOTRIBUTO: 'MONOTRIBUTO' }[sisa] || '';
    const iva = CONDICIONES_IVA[liquidacion.condicion_iva_tambo] ? liquidacion.condicion_iva_tambo : legadoIva;
    const ganancias = CONDICIONES_GANANCIAS[liquidacion.condicion_ganancias_tambo]
      ? liquidacion.condicion_ganancias_tambo
      : iva === 'RESPONSABLE_INSCRIPTO' ? 'INSCRIPTO' : iva === 'MONOTRIBUTO' ? 'MONOTRIBUTO' : iva ? 'NO_INSCRIPTO' : '';
    return { iva, ganancias };
  }

  function vigente(regla, fecha) {
    return regla.estado === 'VALIDADA'
      && (!regla.vigencia_desde || regla.vigencia_desde <= fecha)
      && (!regla.vigencia_hasta || regla.vigencia_hasta >= fecha);
  }

  // La vigente con la vigencia más reciente (las actualizaciones normativas agregan versiones nuevas).
  function buscarRegla(reglas, { regimen, condicion, jurisdiccion = 'NACIONAL', fecha }) {
    return (reglas || [])
      .filter((r) => r.regimen === regimen && r.condicion === condicion && (r.jurisdiccion || 'NACIONAL') === jurisdiccion && vigente(r, fecha))
      .sort((a, b) => String(b.vigencia_desde || '').localeCompare(String(a.vigencia_desde || '')))[0] || null;
  }

  function resumenRegla(regla) {
    return regla ? {
      id: regla.id, regimen: regla.regimen, condicion: regla.condicion, jurisdiccion: regla.jurisdiccion || 'NACIONAL',
      alicuota_pct: Number(regla.alicuota_pct || 0), minimo_no_imponible: Number(regla.minimo_no_imponible || 0),
      monto_minimo_retencion: Number(regla.monto_minimo_retencion || 0), codigo_regimen: regla.codigo_regimen || '',
      fuente_normativa: regla.fuente_normativa || '', vigencia_desde: regla.vigencia_desde || '', vigencia_hasta: regla.vigencia_hasta || '',
    } : null;
  }

  function simple(regla, base) {
    if (!regla) return 0;
    return redondear(Math.max(0, Number(base || 0) - Number(regla.minimo_no_imponible || 0)) * Number(regla.alicuota_pct || 0) / 100);
  }

  // Pagos anteriores de la misma usina en el mismo mes (para el mínimo no sujeto acumulable de la RG 830).
  function acumuladoDelMes(liquidacion, liquidaciones) {
    const mes = fechaDe(liquidacion.fecha).slice(0, 7);
    const clave = (l) => `${fechaDe(l.fecha)}|${String(l.id).padStart(12, '0')}`;
    const propia = clave(liquidacion);
    const previas = (liquidaciones || []).filter((l) => String(l.id) !== String(liquidacion.id)
      && fechaDe(l.fecha).slice(0, 7) === mes
      && String(l.usina || '').trim().toLowerCase() === String(liquidacion.usina || '').trim().toLowerCase()
      && clave(l) < propia);
    return {
      liquidaciones: previas.length,
      neto: redondear(previas.reduce((s, l) => s + Number(l.neto || 0), 0)),
      retencionGanancias: redondear(previas.reduce((s, l) => s + Number(l.resumen_fiscal?.retenciones?.ganancias_sisa || 0), 0)),
    };
  }

  function calcular({ liquidacion, reglas, liquidaciones = [], provinciaCompradora, porcentajeTambero = 0, tipoInscripcionTambero = 'SIN_DECLARAR' }) {
    const fecha = fechaDe(liquidacion.fecha);
    const base = Number(liquidacion.neto || 0);
    const condiciones = condicionesDe(liquidacion);
    if (!condiciones.iva) {
      const error = new Error('Cargá la condición del tambo frente al IVA (RG 1428) en la liquidación antes de calcular.');
      error.status = 422;
      throw error;
    }
    const reglaDebito = buscarRegla(reglas, { regimen: 'IVA_LECHE_ALICUOTA', condicion: 'GENERAL', fecha });
    const reglaIva = buscarRegla(reglas, { regimen: 'IVA_LECHE_RETENCION', condicion: condiciones.iva, fecha });
    const reglaGanancias = buscarRegla(reglas, { regimen: 'GANANCIAS_LECHE_RG830', condicion: condiciones.ganancias, fecha });
    const faltan = [
      !reglaDebito && 'IVA_LECHE_ALICUOTA / GENERAL',
      !reglaIva && `IVA_LECHE_RETENCION / ${condiciones.iva}`,
      !reglaGanancias && `GANANCIAS_LECHE_RG830 / ${condiciones.ganancias}`,
    ].filter(Boolean);
    if (faltan.length) {
      const error = new Error(`Falta una regla VALIDADA y vigente al ${fecha} para: ${faltan.join(', ')}.`);
      error.status = 422;
      throw error;
    }

    const ivaDebito = simple(reglaDebito, base);
    const ivaCalculada = simple(reglaIva, base);
    const minimoIva = Number(reglaIva.monto_minimo_retencion || 0);
    const iva = ivaCalculada > minimoIva ? ivaCalculada : 0;

    const acumulado = acumuladoDelMes(liquidacion, liquidaciones);
    const alicuotaGanancias = Number(reglaGanancias.alicuota_pct || 0) / 100;
    const minimoNoSujeto = Number(reglaGanancias.minimo_no_imponible || 0);
    const baseGanancias = minimoNoSujeto > 0 ? Math.max(0, acumulado.neto + base - minimoNoSujeto) : base;
    const gananciasCalculada = redondear(Math.max(0, baseGanancias * alicuotaGanancias - (minimoNoSujeto > 0 ? acumulado.retencionGanancias : 0)));
    const minimoGanancias = Number(reglaGanancias.monto_minimo_retencion || 0);
    const ganancias = gananciasCalculada >= minimoGanancias ? gananciasCalculada : 0;

    const tipoInscripcion = String(tipoInscripcionTambero || 'SIN_DECLARAR').trim().toUpperCase();
    const reglaIibb = provinciaCompradora ? buscarRegla(reglas, { regimen: 'IIBB_LECHE_RETENCION', condicion: 'GENERAL', jurisdiccion: String(provinciaCompradora).toUpperCase(), fecha }) : null;
    const iibb = simple(reglaIibb, base);
    const porcentaje = Number(porcentajeTambero || 0);
    const brutoTambero = redondear(base * porcentaje / 100);
    const sussOmitido = tipoInscripcion === 'MONOTRIBUTO';
    const reglaSuss = porcentaje > 0 && !sussOmitido ? buscarRegla(reglas, { regimen: 'SUSS_TAMBERO_ASOCIADO', condicion: 'GENERAL', fecha }) : null;
    const suss = simple(reglaSuss, brutoTambero);

    return {
      calculado_en: new Date().toISOString(),
      base_neto: base,
      condicion_iva_tambo: condiciones.iva,
      condicion_ganancias_tambo: condiciones.ganancias,
      iva_debito: ivaDebito,
      total_con_iva: redondear(base + ivaDebito),
      // Claves históricas (iva_sisa / ganancias_sisa) mantenidas por compatibilidad con lo ya guardado.
      retenciones: { iva_sisa: iva, ganancias_sisa: ganancias, iibb, suss_tambero: suss },
      detalle_retenciones: {
        iva: { regimen: 'RG 1428/2003', condicion: condiciones.iva, alicuota_pct: Number(reglaIva.alicuota_pct || 0), calculado: ivaCalculada, minimo: minimoIva, retenido: iva, motivo: iva ? '' : ivaCalculada > 0 ? `No se retiene: ${pesos(ivaCalculada)} es igual o inferior al mínimo de ${pesos(minimoIva)}.` : 'Sin retención para esta condición.' },
        ganancias: { regimen: `RG 830/2000 régimen ${reglaGanancias.codigo_regimen || '78'}`, condicion: condiciones.ganancias, alicuota_pct: Number(reglaGanancias.alicuota_pct || 0), minimo_no_sujeto: minimoNoSujeto, acumulado_mes: acumulado, base: redondear(baseGanancias), calculado: gananciasCalculada, minimo: minimoGanancias, retenido: ganancias, motivo: ganancias ? '' : gananciasCalculada > 0 ? `No se retiene: ${pesos(gananciasCalculada)} es menor al mínimo de ${pesos(minimoGanancias)}.` : minimoNoSujeto > 0 ? `Lo pagado en el mes por esta usina no supera el mínimo no sujeto de ${pesos(minimoNoSujeto)}.` : 'Sin retención.' },
      },
      mederia: { porcentaje_tambero: porcentaje, bruto_tambero: brutoTambero, tipo_inscripcion_tambero: tipoInscripcion, suss_omitido_por_monotributo: sussOmitido, neto_tambero: Math.max(0, redondear(brutoTambero - suss)) },
      neto_estimado_tambo: redondear(base + ivaDebito - iva - ganancias - iibb - brutoTambero),
      reglas_aplicadas: [reglaDebito, reglaIva, reglaGanancias, reglaIibb, reglaSuss].filter(Boolean).map(resumenRegla),
    };
  }

  // Pasa las reglas de la versión anterior (por Estado SISA) a las de RG 1428 / RG 830 sin borrar nada:
  // las viejas quedan REEMPLAZADAS (no se usan para calcular) y se agregan las que falten.
  function migrarReglas(reglas, crearId) {
    const lista = Array.isArray(reglas) ? reglas.map((r) => ({ ...r })) : [];
    let cambios = 0;
    lista.forEach((regla) => {
      if (['IVA_LECHE_RETENCION', 'GANANCIAS_LECHE_RETENCION'].includes(regla.regimen) && /^SISA_/.test(String(regla.condicion || '')) && regla.estado !== 'REEMPLAZADA') {
        regla.estado = 'REEMPLAZADA';
        regla.observaciones = `${regla.observaciones ? `${regla.observaciones} ` : ''}Reemplazada: la retención sobre la leche depende de la condición registral (RG 1428) y Ganancias va por RG 830, no por el Estado SISA.`;
        cambios += 1;
      }
    });
    // El mínimo de $400 venía de la RG 2854 (que excluye a la leche): la RG 1428 no tiene mínimo.
    lista.forEach((regla) => {
      if (regla.regimen === 'IVA_LECHE_RETENCION' && regla.estado !== 'REEMPLAZADA' && Number(regla.monto_minimo_retencion) === 400) {
        regla.monto_minimo_retencion = 0;
        regla.fuente_normativa = String(regla.fuente_normativa).replace(' Sin retención si el importe es igual o inferior a $400 (RG 2854/2010).', ' La norma no fija importe mínimo: se retiene sobre cada pago, desde el primer peso.');
        cambios += 1;
      }
    });
    REGLAS_DEFECTO.forEach((defecto) => {
      const existe = lista.some((r) => r.regimen === defecto.regimen && r.condicion === defecto.condicion && (r.jurisdiccion || 'NACIONAL') === defecto.jurisdiccion && r.estado !== 'REEMPLAZADA');
      if (existe) return;
      lista.push({ ...defecto, id: crearId(lista) });
      cambios += 1;
    });
    return { reglas: lista, cambios };
  }

  return { CONDICIONES_IVA, CONDICIONES_GANANCIAS, REGLAS_DEFECTO, condicionesDe, buscarRegla, acumuladoDelMes, calcular, migrarReglas };
}));
