# Registro del SaaS y Autenticación (API Key)

Antes de registrar negocios o emitir facturas, debes dar de alta tu plataforma SaaS una única vez. Al hacerlo, obtendrás tu **`apiKey`**, que funcionará como tu **Bearer Token** en todas las peticiones a la API.

::: danger REGISTRO ÚNICO POR RUC Y CLAVE IRRECUPERABLE
1. **Un registro por RUC**: Cada RUC de proveedor solo puede registrarse una vez (`409 Conflict` si intentas repetirlo).
2. **Copia tu `apiKey` al instante**: La clave (`sri_live_...`) solo se muestra una única vez al crear la cuenta. Guárdala en un lugar seguro porque no se puede volver a consultar después.
:::

---

## Formulario de Registro Interactivo {#formulario-de-registro}

<ClientOnly>
  <SaasRegistrationForm />
</ClientOnly>

---

## Cómo usar tu API Key (Bearer Token)

Una vez que tengas tu `apiKey` (`sri_live_...`), úsala como **Bearer Token** en todos los demás endpoints (registrar negocios, subir certificados `.p12`, emitir o consultar facturas):

* **Si estás probando en Swagger (`/docs`)**:
  1. Haz clic en el botón **Authorize** (arriba a la derecha).
  2. Pega tu `apiKey` (`sri_live_...`) en el campo **Value** *(no hace falta escribir la palabra "Bearer", Swagger la añade solo)*.
  3. Haz clic en **Authorize** y ya podrás probar cualquier endpoint.

* **Si llamas desde tu backend, Postman o `curl`**:
  Agrega este encabezado en cada petición HTTP:
  ```http
  Authorization: Bearer sri_live_tu_clave_aqui
  ```

Ejemplo para listar tus negocios registrados:
```bash
curl https://tu-api.up.railway.app/v1/tenants \
  -H "Authorization: Bearer sri_live_tu_clave_aqui"
```

---

## Registro manual vía API (`POST /v1/api-clients`)

Si prefieres registrar tu plataforma desde consola o Postman en lugar de usar el formulario:

```bash
curl -X POST https://tu-api.up.railway.app/v1/api-clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "FacturaCloud SaaS",
    "ruc": "1790011674001",
    "webhookUrl": "https://api.facturacloud.io/webhooks/sri"
  }'
```

### Datos que recibe

| Campo | Requerido | Descripción |
| :--- | :--- | :--- |
| **`name`** | **Sí** | Nombre de tu plataforma o empresa integradora. |
| **`ruc`** | **Sí** | Tu RUC de 13 dígitos terminado en `001`. Se agregará automáticamente en el XML de todas tus facturas como `RUC Proveedor` para cumplir con la Resolución SRI **NAC-DGERCGC26-00000027**. |
| **`webhookUrl`** | No | URL pública HTTPS donde quieres recibir el resultado automático cuando el SRI apruebe o rechace una factura. |

---

## ¿Qué es el Webhook (`webhookUrl`) y cómo configurarlo?

Como el SRI suele tardar varios segundos en responder, nuestro microservicio no te hace esperar: recibe la factura al instante y, cuando el SRI termina, **te avisa enviando un `POST` a tu servidor**.

* **¿Para qué sirve?** Te permite actualizar el estado de la factura en tu sistema apenas sea autorizada sin tener que estar consultando cada segundo.
* **Requisitos para que funcione**:
  1. Debe ser una ruta `POST` en una URL **HTTPS pública** (no uses `localhost` en producción).
  2. La URL no debe hacer redirecciones (`301`/`302`).
  3. Tu servidor debe responder `200 OK` en menos de 10 segundos.

👉 Revisa la **[Guía paso a paso para configurar tu Webhook](/guide/webhooks#como-configurar-tu-webhook)**.

---

## Cuota del Servicio

Todas las cuentas operan bajo un esquema único simple y listo para producción:
* **Negocios (`Tenants`)**: Puedes registrar todos los negocios emisores que necesites bajo tu cuenta SaaS.
* **Límite de velocidad**: `20` peticiones por segundo por plataforma para mantener estables las colas hacia el SRI.
* **Incluye**: Firma XAdES-BES, generación de clave de acceso Módulo 11, reintentos automáticos ante el SRI, inyección de `RUC Proveedor` y notificaciones por Webhook.

---

## Errores comunes de autenticación

| Código HTTP | Error | Qué significa |
| :--- | :--- | :--- |
| `401 Unauthorized` | `MISSING_API_KEY` | No enviaste el encabezado `Authorization: Bearer <apiKey>`. |
| `401 Unauthorized` | `INVALID_API_KEY` | La `apiKey` está mal escrita o no existe. |
| `401 Unauthorized` | `API_CLIENT_INACTIVE` | La cuenta del SaaS está desactivada. |
| `409 Conflict` | `API_CLIENT_RUC_EXISTS` | Ese RUC ya fue registrado anteriormente. |
