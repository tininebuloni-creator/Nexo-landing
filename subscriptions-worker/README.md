# Nexo Subscriptions

Servicio separado de suscripciones para PampaAgro. El instalador consulta una autorización firmada en `GET /v1/client/authorization`; al registrarse un pago se extiende la suscripción, sin enviar una licencia nueva al cliente.

## Medios de pago

- `POST /v1/admin/payments`: cobro manual para transferencia de cualquier banco, efectivo, cheque, canje o factura.
- `POST /v1/webhooks/mercado-pago`: acredita automáticamente pagos aprobados de Mercado Pago. El pago debe usar `external_reference` con el formato `subscription:<id>`.
- Otros proveedores pueden agregarse como adaptadores de webhook sin cambiar PampaAgro.

## Configuración inicial

1. Crear D1: `npx wrangler d1 create nexo-subscriptions` y completar `database_id` en `wrangler.toml`.
2. Ejecutar esquema: `npx wrangler d1 execute nexo-subscriptions --remote --file=schema.sql`.
3. Definir secretos, nunca en archivos ni en Git:
   - `ADMIN_API_TOKEN`: protege las rutas administrativas.
   - `LICENSE_PRIVATE_KEY`: clave privada Ed25519 que corresponde a la pública incluida en PampaAgro.
   - `MERCADO_PAGO_ACCESS_TOKEN`: habilita verificación de pagos de Mercado Pago.
   - `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANGUAGE` y `ADMIN_WHATSAPP_TO`: habilitan alertas reales por WhatsApp Business.
4. Deploy: `npx wrangler deploy`.
5. En cada instalación PampaAgro configurar `subscriptionApiUrl` con la URL del Worker.

Las alertas se revisan diariamente a las 13:00 UTC, 15, 7, 3 y 1 día antes del vencimiento. No se simulan pagos ni mensajes: sin secretos configurados, los webhooks automáticos se rechazan y los recordatorios no se marcan como enviados.