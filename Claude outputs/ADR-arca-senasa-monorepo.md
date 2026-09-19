# ADR: módulo ARCA/SENASA compartido para Agro, Tambo y Porcinos

**Estado:** Propuesto
**Fecha:** 2026-09-19
**Decide:** Cristina

## Contexto

Cristina pidió pensar, antes de arrancar a construir el ARCA/SENASA de Porcinos, si conviene
sacar la parte fiscal/sanitaria de Agro, Tambo y Porcinos a un monorepo compartido, dejando en
cada app solo las diferencias.

Reviso lo que ya existe en el proyecto (no toqué nada, solo leí):

- **`packages/core-fiscal-arca/`** ya existe: WSAA, WSFE, WSCPE, retenciones (venta hacienda,
  RG830 servicios, SISA/LPG, locación rural), validación de padrón/CUIT, consulta RFOCB. Es
  código genérico, no depende de ninguna app en particular.
- **`packages/core-afip/`** también existe: manager de token AFIP, SENASA, fiscal municipal,
  crypto, auth. El archivo `afipManager.js` de este paquete tiene un comentario propio que dice
  literalmente que está pensado para que "cada app arme su thin wrapper" pasándole su propio
  `appRoot` — o sea, el diseño para compartirlo YA está hecho.
- **Pero Agro no lo usa.** `apps/pampaagro/services/afipManager.js` es una copia vieja e
  independiente (mismo código, pero sin el parámetro `appRoot`, con rutas fijas a `__dirname` de
  Agro) — nunca se migró al paquete compartido. Mismo patrón en `afipSenasaService.js`,
  `afipCryptoService.js`, `afipAuthManager.js`, `fiscalMunicipalService.js`.
- **Tambo tiene otra cosa distinta**, no un duplicado: `controllers/fiscalArca.controller.js` es
  la capa CRUD que guarda los comprobantes en la base de datos propia de Tambo — no pisa al
  paquete compartido porque resuelve un problema diferente (persistencia de datos, no el llamado
  al webservice de AFIP/SENASA).
- **Porcinos no tiene nada de esto todavía** — ni copia propia ni conexión al paquete
  compartido. Es la app más nueva en este frente.

## Decisión propuesta

Separar el módulo en dos capas, porque hoy están mezcladas bajo el mismo nombre "ARCA/SENASA" y
no tienen el mismo grado de similitud entre apps:

1. **Capa webservice (100% compartible):** login/token WSAA, envío WSFE, WSCPE, cálculo de
   retenciones, validación de padrón y CUIT, consulta SENASA. Esto ya vive en
   `packages/core-fiscal-arca` y `packages/core-afip` — no hay que crear nada nuevo, hay que
   **terminar de conectarlo**.
2. **Capa de datos (propia de cada app):** qué campos guarda cada comprobante, cómo se listan,
   qué reglas de negocio local aplican (ej. en Tambo, comprobantes ligados a litros de leche; en
   Porcinos, a lotes de cerdos). Esto se queda en cada app, pero llamando a la capa 1 compartida
   en vez de reimplementar retenciones o el login a AFIP.

Con Porcinos arranco directo con el wrapper fino sobre el paquete compartido (así no genero una
tercera copia para después migrar), y de paso dejo a Agro conectado al paquete compartido
también, retirando su copia vieja. Tambo no necesita tocarse en la capa 1 porque no tiene copia
propia de eso — solo revisar si su capa de datos puede llamar al paquete para las retenciones en
vez de tener su propia matemática (a confirmar si la tiene).

## Opciones consideradas

### Opción A — Terminar la migración ya empezada (recomendada)
Usar `packages/core-fiscal-arca` + `packages/core-afip` tal cual están, escribir el wrapper fino
en Porcinos y Agro, sacar las copias viejas de Agro.

| Dimensión | Evaluación |
|---|---|
| Esfuerzo | Bajo-medio: el paquete ya existe y ya está diseñado para esto |
| Riesgo | Bajo: no se toca la lógica fiscal en sí, solo dónde vive |
| Consistencia futura | Alta: un bug de retenciones se arregla una sola vez para las 3 apps |

**Pros:** aprovecha trabajo ya hecho; menos código para mantener; un solo lugar para actualizar
cuando ARCA cambie una alícuota o un webservice.
**Contras:** hay que migrar Agro con cuidado (verificar que nada dependa de las rutas viejas
`__dirname`-relativas antes de borrar la copia).

### Opción B — Copiar tal cual a Porcinos, dejar Agro como está
Porcinos copia el código de Agro (la versión vieja, no la del paquete).

**Pros:** más rápido hoy.
**Contras:** exactamente el problema que Cristina quiere evitar — tres copias divergiendo, cada
bug de ARCA/SENASA hay que arreglarlo 3 veces (como ya pasó hoy con otros módulos de Tambo).

## Trade-off

La Opción A pide un poco más de cuidado al migrar Agro (para no romper lo que ya funciona en
producción), pero es el camino corto real: el trabajo de diseño compartido ya está hecho y sin
usar. Construir Porcinos directo sobre el paquete evita crear una tercera copia el mismo día que
se decide evitar la duplicación.

## Preguntas para Cristina antes de arrancar

1. ¿Confirmás que arranco Porcinos con el wrapper fino sobre `packages/core-afip` +
   `packages/core-fiscal-arca`, en vez de copiar el código de Agro?
2. ¿Migro también Agro a usar el paquete compartido (retirando su copia vieja), o lo dejamos
   como está por ahora y lo hacemos en otro momento aparte?
3. Tambo: ¿su `fiscalArca.controller.js` tiene matemática de retenciones propia, o solo guarda
   los datos? Si tiene cálculo propio, ¿lo migramos también a llamar al paquete compartido?

## Acción

- [ ] Confirmar con Cristina las 3 preguntas de arriba
- [ ] Armar el wrapper fino de Porcinos (`apps/pampaporcinos/services/afipManager.js` +
      `afipSenasaService.js`, llamando a `packages/core-afip`)
- [ ] Conectar la capa CRUD de Porcinos a ese wrapper
- [ ] (si Cristina confirma) migrar Agro y borrar su copia vieja
- [ ] (si aplica) revisar la capa de datos de Tambo
