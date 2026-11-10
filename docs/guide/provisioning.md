# Registro del SaaS, Cuota Única y Autenticación

El endpoint **`POST /v1/api-clients`** es el punto de entrada donde se **registra tu plataforma SaaS** dentro de `sri-invoice-gateway`. Puedes registrarlo directamente usando el formulario interactivo de abajo, desde Swagger (`/docs`) o con `curl`.

::: danger REGISTRO ÚNICO POR RUC Y API KEY IRRECUPERABLE
1. **Un solo registro por RUC de SaaS (`409 Conflict`)**: El RUC de tu plataforma es único en la base de datos. Si intentas registrar el mismo RUC por segunda vez, el gateway rechazará la petición con `409 Conflict` (`API_CLIENT_RUC_EXISTS`).
2. **Copia tu `apiKey` inmediatamente**: La propiedad `apiKey` (`sri_live_...`) en texto plano se muestra **una única vez** en la respuesta de creación y **no volverá a mostrarse nunca más**. Guárdala en ese instante en tus variables de entorno (`.env`) o gestor de secretos.
:::

---

## Formulario de Registro Interactivo {#formulario-de-registro}

<ClientOnly>
  <SaasRegistrationForm />
</ClientOnly>

---

## ¿Cómo registrar tu SaaS vía API / cURL?

Puedes hacerlo desde **Swagger UI** (`https://tu-api.up.railway.app/docs` ➔ `POST /v1/api-clients`) o desde tu consola:

```bash
curl -X POST https://tu-api.up.railway.app/v1/api-clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "FacturaCloud SaaS",
    "ruc": "1790011674001",
    "webhookUrl": "https://api.facturacloud.io/webhooks/sri"
  }'
```

### Campos de Registro (`CreateApiClientDto`)

| Campo | Requerido | Tipo | Descripción |
| :--- | :--- | :--- | :--- |
| **`name`** | **Sí** | `string` | Nombre identificador de tu plataforma SaaS o ERP (ej. `"FacturaCloud SaaS"`). |
| **`ruc`** | **Sí** | `string` | RUC de 13 dígitos numéricos del proveedor del software/SaaS terminado en `001` (regex: `/^\d{10}001$/`). El gateway inyecta este RUC automáticamente en `<infoAdicional><campoAdicional nombre="RUC Proveedor">...</campoAdicional></infoAdicional>` de todas las facturas emitidas bajo tu plataforma (Resolución SRI **NAC-DGERCGC26-00000027**). |
| **`webhookUrl`** | No | `string` (URL) | URL HTTPS de tu SaaS donde el gateway enviará las notificaciones automáticas de autorización del SRI. *(Ver sección Webhook abajo).* |

---

## ¿Qué es el Webhook (`webhookUrl`) y para qué sirve?

La comunicación con los Web Services SOAP del SRI de Ecuador es lenta y asíncrona (puede tardar entre 2 y 15 segundos o requerir reintentos si el SRI está congestionado).

El **Webhook** es una URL de tu propio servidor (por ejemplo `https://tu-saas.com/api/webhooks/sri`) que le entregas al gateway para que te avise automáticamente apenas termine el proceso:

1. Tu SaaS envía la factura (`POST /v1/tenants/:id/invoices`) y recibe respuesta inmediata en `<200ms` con estado `QUEUED`.
2. El gateway firma el XML (XAdES-BES) y lo tramita en segundo plano contra el SRI usando colas BullMQ.
3. En cuanto el SRI responde (`AUTORIZADO`, `DEVUELTA`, `NO_AUTORIZADO` o `FAILED`), el gateway hace un `POST` automático a tu `webhookUrl` con el XML autorizado, número de autorización y firma criptográfica HMAC-SHA256 (`X-SRI-Gateway-Signature`).

**¿Para qué sirve en la práctica?**
* Evita que tu SaaS tenga que consultar el estado de cada factura cada segundo (*polling* innecesario).
* Te permite actualizar el estado de la factura en la base de datos de tu SaaS en tiempo real y enviar el PDF/XML al correo del cliente final apenas el SRI autoriza.
* *(Es opcional al registrar el SaaS porque también puedes enviar un `webhookUrl` específico en cada factura o consultar vía `GET`).* Consulta la [guía de Webhooks](/guide/webhooks) para validar la firma HMAC.

---

## Cuota Única Incluida (Rate Limiting)

No existen múltiples planes ni configuraciones complejas. Toda plataforma SaaS registrada recibe un esquema único con negocios ilimitados y control de tasa para proteger las colas del SRI:

| Recurso | Configuración | Comportamiento si se excede |
| :--- | :--- | :--- |
| **Negocios Emisores (`Tenants`)** | Sin límite rígido | Registra y administra todos los contribuyentes emisores que necesite tu plataforma. |
| **Tasa de Peticiones HTTP** | **20 req/s** por plataforma SaaS (Redis) | Si superas las 20 peticiones por segundo, responde `429 Too Many Requests` con `Retry-After: 1`. |
| **Funcionalidades Incluidas** | Firma XAdES-BES, Clave Módulo 11, Colas BullMQ, RUC Proveedor automático y Webhooks HMAC | 100% incluidas sin restricciones. |

---

## Respuesta de Registro (HTTP 201 Created)

```json
{
  "id": "a98dfb02-1345-4bb6-981c-6d1234567890",
  "name": "FacturaCloud SaaS",
  "ruc": "1790011674001",
  "apiKey": "sri_live_7a9f8b2c4d1e3a5f6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e",
  "apiKeyHash": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "webhookUrl": "https://api.facturacloud.io/webhooks/sri",
  "plan": "DEFAULT",
  "rateLimitRps": 20,
  "status": "ACTIVE",
  "createdAt": "2026-11-10T16:30:00.000Z",
  "updatedAt": "2026-11-10T16:30:00.000Z"
}
```

> **Recuerda**: Copia el valor de **`apiKey`** (`sri_live_...`) antes de cerrar la pestaña o terminal. El servidor **no guarda** ese valor en texto plano y ningún endpoint te lo volverá a entregar después.

---

## Modelo de Seguridad de la API Key

1. **Estructura del Token**:
   - Prefijo canónico: `sri_live_`
   - Entropía: 48 caracteres hexadecimales aleatorios criptográficamente seguros generados vía `crypto.randomBytes(24).toString('hex')`.
2. **Almacenamiento Criptográfico Hashed**:
   - `sri-invoice-gateway` **NUNCA** almacena la API Key en texto plano en PostgreSQL.
   - Solo se persiste su digest **SHA-256** (`api_key_hash`):
     ```typescript
     const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
     ```
3. **Validación en Tiempo de Petición**:
   - `ApiKeyGuard` intercepta cada llamada entrante, calcula el hash SHA-256 del token enviado en `Authorization: Bearer <token>` y busca en PostgreSQL:
     ```sql
     SELECT id, name, status, plan, rate_limit_rps
     FROM api_clients
     WHERE api_key_hash = :hash;
     ```

---

## Autenticación en Peticiones HTTP

Para invocar cualquier endpoint protegido (`/v1/tenants`, `/v1/tenants/:tenantId/certificates`, `/v1/tenants/:tenantId/invoices`), envía la clave en el encabezado `Authorization`:

```bash
curl -X GET https://tu-api.up.railway.app/v1/tenants \
  -H "Authorization: Bearer sri_live_7a9f8b2c4d1e3a5f6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e" \
  -H "Accept: application/json"
```

### Códigos de Error Comunes de Autenticación

| Código HTTP | Error Code | Causa |
| :--- | :--- | :--- |
| `401 Unauthorized` | `MISSING_API_KEY` | El encabezado `Authorization: Bearer ...` no fue provisto en la petición. |
| `401 Unauthorized` | `INVALID_API_KEY` | El token enviado no existe en la base de datos o el hash SHA-256 no coincide. |
| `401 Unauthorized` | `API_CLIENT_INACTIVE` | La plataforma SaaS asociada a esta API Key no tiene `status = 'ACTIVE'`. |
