# Gestión de Negocios Emisores (Tenants)

Un **Tenant** representa cada empresa o persona con RUC que emite facturas electrónicas desde tu plataforma SaaS. Cada negocio maneja su propio RUC, su propio certificado digital `.p12` y sus propias facturas, completamente aislado de los demás.

> Recuerda enviar siempre tu `apiKey` como **Bearer Token** en el encabezado `Authorization: Bearer <tu_api_key>` (o configurarlo en el botón **Authorize** de Swagger).

---

## Registrar un Negocio (`POST /v1/tenants`)

Envía la razón social y el RUC de 13 dígitos del contribuyente:

```bash
curl -X POST https://tu-api.up.railway.app/v1/tenants \
  -H "Authorization: Bearer sri_live_tu_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "businessName": "Corporación Andina de Alimentos S.A.",
    "ruc": "1790011674001"
  }'
```

### Respuesta (HTTP 201 Created)

```json
{
  "id": "e2a3c4b5-6789-0123-abcd-ef0123456789",
  "businessName": "Corporación Andina de Alimentos S.A.",
  "ruc": "1790011674001",
  "apiClientId": "a98dfb02-1345-4bb6-981c-6d1234567890",
  "status": "ACTIVE",
  "createdAt": "2026-11-10T18:40:00.000Z",
  "updatedAt": "2026-11-10T18:40:00.000Z"
}
```

Guarda el campo **`id`** (`tenantId`): lo necesitarás en la URL para subir su certificado `.p12` y para emitir sus facturas.

### Reglas del RUC
* Debe tener exactamente **13 dígitos numéricos** y terminar en `001` (ejemplo: `1790011674001`).
* No puedes registrar dos veces el mismo RUC dentro de la misma plataforma SaaS (`409 Conflict` / `TENANT_RUC_EXISTS`).

---

## Listar tus Negocios (`GET /v1/tenants`)

Devuelve la lista paginada de los negocios registrados bajo tu plataforma SaaS:

```bash
curl "https://tu-api.up.railway.app/v1/tenants?page=1&limit=10" \
  -H "Authorization: Bearer sri_live_tu_api_key"
```

### Respuesta (HTTP 200 OK)

```json
{
  "data": [
    {
      "id": "e2a3c4b5-6789-0123-abcd-ef0123456789",
      "businessName": "Corporación Andina de Alimentos S.A.",
      "ruc": "1790011674001",
      "status": "ACTIVE",
      "hasActiveCertificate": true,
      "createdAt": "2026-11-10T18:40:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 10
  }
}
```

> El campo `hasActiveCertificate` te indica al instante si el negocio ya tiene un certificado `.p12` válido cargado para poder facturar.
