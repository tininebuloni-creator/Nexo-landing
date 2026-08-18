# PampaGanaderia ERP

Sistema local de gestión ganadera para productores.

Las licencias, planes, trial y roles pertenecen al sistema unificado **Nexo Agro**. PampaGanaderia ERP utiliza ese mismo motor de licencias y el formato de claves `NEXO-XXXX-XXXX-XXXX`; no se debe crear un generador paralelo.

El trial dura **10 días**. El botón **Enviar Link Trial por WhatsApp** arma un enlace con `?trial=auto`. En Electron se puede definir el servidor público mediante `NEXO_AGRO_TRIAL_URL` en `.env`, por ejemplo:

```env
NEXO_AGRO_TRIAL_URL=https://trial.nexoagro.com.ar
```

No se debe enviar por WhatsApp un enlace `localhost` o `127.0.0.1`; para compartirlo, la URL debe apuntar a un servidor accesible desde internet o desde la red del destinatario.




## Funciones incluidas

- Dashboard administrativo y ganadero.
- Hacienda, inventario, alimentación y movimientos.
- Costos y rentabilidad ganadera.
- Pesaje y balanza.
- Lectura RFID.
- Boleto de marca: alta local, control de vigencia y validación antes del DUT.
- Auditoría de merma en ruta.
- Notificación al chofer.
- Reportes financieros y ganaderos.
- Importación y exportación de datos.
- Alertas, roles, conectividad y sincronización.
- Almacenamiento local de pesajes y notificaciones.

Los datos locales se guardan en `datos-productor.json`.

## Emisión DUT y AFIP/SENASA

La pantalla y la integración técnica están preparadas, pero la emisión oficial requiere configurar:

- CUIT del productor.
- Certificado AFIP.
- Clave privada.
- Servicio y credenciales de SENASA.
- Ambiente de homologación o producción.

Sin esas credenciales, el sistema continúa funcionando para la gestión local, pero no realiza una emisión oficial.

## Guía rápida: Pre-DUT y DUT

### 1. Crear una Orden de Carga Provisional

Cuando el establecimiento no tiene señal, ingresar a:

```text
Barra lateral > Fiscal ganadero > Mis viajes / Pre-DUT y comprobantes
```

Completar el formulario con:

- RENSPA de origen y destino.
- Boleto de marca.
- Categoría y cantidad de animales.
- Chofer y camión.
- Fecha de carga y vencimiento previsto.
- Municipio y tasa municipal, si corresponde.
- Estado del pago municipal.

Presionar **Guardar Pre-DUT e imprimir**. El sistema:

1. Guarda la orden en el almacenamiento local.
2. Genera un identificador interno.
3. Genera un QR local con los datos de la carga.
4. Prepara una Orden de Carga Provisional para impresión térmica o impresión común.

El Pre-DUT es un documento interno. No reemplaza al DUT oficial de SENASA y no habilita por sí solo la circulación de hacienda.

### 2. Ver el QR provisional

Las órdenes quedan en la tabla **Mis viajes / Pre-DUT y comprobantes**. Para una orden pendiente se puede:

- Imprimir la Orden de Carga Provisional.
- Consultar su estado.
- Ver el estado del pago municipal.
- Marcar el pago como acreditado cuando corresponda.

El QR provisional se genera localmente y no necesita internet.

### 3. Sincronizar cuando vuelve la señal

Al recuperar conexión, presionar **Sincronizar pendientes**. El backend envía los trámites en lote al adaptador oficial de SENASA:

```text
POST /api/logistica/emitir-dut-lote
```

Los trámites con pago municipal pendiente no se envían. Los errores quedan registrados en la cola para poder reintentarlos.

### 4. Tasas municipales

Cada municipio puede usar una modalidad diferente. El sistema soporta:

- Pago pendiente.
- Pago acreditado.
- VEP.
- Transferencia.
- Cuenta corriente.
- Sin tasa o no aplica.

La validación se realiza antes de emitir el DUT. Las reglas pueden configurarse mediante `FISCAL_TASAS_MUNICIPALES` en `.env`:

```env
FISCAL_TASAS_MUNICIPALES={"default":{"modalidad":"PENDIENTE","importePorCabeza":0,"requierePagoAntesDeEmitir":true}}
```

La aplicación bloquea la emisión si existe una tasa que requiere acreditación y el pago sigue pendiente.

### 5. DUT oficial

Cuando SENASA confirma la emisión, la orden cambia a **Emitido**. En ese estado se habilita:

- **Ver DUT oficial**.
- **Imprimir DUT**.
- Visualización del QR oficial devuelto por SENASA.
- Descarga del comprobante si el servicio devuelve un PDF.
- Preparación del cierre del tránsito.

El QR oficial debe ser el entregado por SENASA. El sistema no fabrica un QR oficial ni transforma el QR provisional en un documento válido.

### 6. Alertas de vencimiento y cierre

El módulo Fiscal muestra alertas cuando:

- Un DUT emitido todavía está abierto.
- Faltan menos de 24 horas para su vencimiento.
- El DUT ya venció.
- El pago municipal sigue pendiente.

También se puede solicitar permiso para notificaciones del dispositivo. Las notificaciones visibles dentro de la aplicación no dependen de ese permiso.

## Integración técnica

El flujo de producción queda separado en estas capas:

```text
Frontend
	-> guarda Pre-DUT y QR local
	-> administra cola offline

Backend
	-> valida boleto, fechas y tasa municipal
	-> obtiene token ARCA mediante WSAA
	-> envía el lote a SENASA/SIGSA
	-> guarda la respuesta oficial, PDF y QR

SENASA
	-> valida stock y documentación
	-> emite el DUT oficial
	-> devuelve número, comprobante y QR
```

Para completar la emisión real todavía se necesita el WSDL oficial y el contrato de operaciones de SENASA/SIGSA para emisión y cierre. Hasta entonces, el modo local, el Pre-DUT, la cola y la validación municipal funcionan como preparación operativa.

## Configuración segura

Las claves privadas no se cargan en el navegador ni se guardan en `localStorage`. Deben permanecer en el servidor o en el instalador seguro de ARCA.

La configuración se prepara con:

```text
.env.example -> .env
certs/homologacion.crt
certs/homologacion.key
```

Primero se recomienda probar en homologación. El paso a producción requiere certificados, CUIT, servicio habilitado y endpoints oficiales de ARCA/SENASA.

## Futura versión `.exe`

La aplicación ya tiene el esqueleto Electron preparado y conserva el sistema de licencias Nexo Agro. Se pueden ejecutar o compilar tres ediciones:

```text
npm run electron:basica
npm run electron:profesional
npm run electron:premium
```

Para generar instaladores de Windows:

```text
npm run dist:basica
npm run dist:profesional
npm run dist:premium
```

Cada edición usa el mismo ERP, la misma pantalla de licencia y los mismos roles. Solo cambia el plan inicial (`Básica`, `Profesional` o `Premium`); las cantidades y módulos se mantienen en la configuración central existente y se definirán posteriormente.

La versión distribuida podrá instalarse como:

```text
PampaGanaderia ERP.exe
```

El `.exe` incluirá la interfaz y el servidor local.  Se ejecutará con doble clic y conservará los datos en una carpeta local del equipo.

Electron inicia el servidor local, abre el ERP en una ventana segura y expone solo las funciones necesarias mediante `preload`. La validación comercial definitiva de la licencia deberá trasladarse al proceso principal antes de distribuirla públicamente.

## Datos y respaldo

Antes de cambiar de equipo, copiar el archivo `datos-productor.json` como respaldo. En la versión `.exe`, este archivo se ubicará en una carpeta de datos del usuario para evitar perder información al actualizar la aplicación.
