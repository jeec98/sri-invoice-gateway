# Cómo Funciona (Arquitectura General)

`sri-invoice-gateway` actúa como puente entre tu plataforma (SaaS, ERP, POS o tienda online) y los servicios SOAP del SRI de Ecuador.

En lugar de que cada negocio tenga que lidiar con certificados `.p12`, firma XML XAdES-BES y caídas del SRI, tu plataforma envía un simple JSON y nuestro servicio se encarga del resto en segundo plano.

---

## Estructura en 2 Niveles

```
+-------------------------------------------------------------------+
| 1. Tu Plataforma / SaaS                                           |
| - Se registra una sola vez y obtiene su API Key (Bearer Token).   |
| - Administra múltiples negocios emisores desde un mismo lugar.    |
| - Recibe los resultados del SRI automáticamente por Webhook.      |
+-------------------------------------------------------------------+
                                  │
                                  ▼
+-------------------------------------------------------------------+
| 2. Negocios Emisores (Tenants)                                    |
| - Cada cliente/negocio con su propio RUC (13 dígitos).            |
| - Cada uno sube su propia firma electrónica (.p12 / .pfx).        |
| - Sus facturas y datos están aislados de los demás negocios.      |
+-------------------------------------------------------------------+
```

---

## Recomendación de Seguridad para tu SaaS

Si tu producto tiene una web o app móvil (`frontend`) y un servidor propio (`backend`):

1. **Guarda tu `apiKey` únicamente en tu backend** (en el `.env` de tu servidor).
2. Tu frontend debe hablar con **tu backend**, y tu backend es quien llama a `sri-invoice-gateway` usando `Authorization: Bearer sri_live_...`.
3. Nunca pongas la `apiKey` directamente en el navegador o app del cliente final.

---

## ¿Qué ocurre cuando envías una factura?

1. **Validación inmediata (< 200 ms)**: Comprobamos que el negocio tenga un certificado `.p12` activo, que no hayas repetido el `referenceId` y calculamos la **Clave de Acceso de 49 dígitos**.
2. **Respuesta rápida (`202 Accepted`)**: Tu sistema recibe la Clave de Acceso al instante sin quedar congelado esperando al SRI.
3. **Firma y envío en segundo plano**: Construimos el XML v1.1.0, agregamos tu `RUC Proveedor` automáticamente, firmamos con XAdES-BES y enviamos al SRI.
4. **Reintentos inteligentes y notificación**: Si el SRI responde `EN PROCESO`, reintentamos automáticamente y al obtener `AUTORIZADO` (o algún error) enviamos el XML final a tu **Webhook**.
