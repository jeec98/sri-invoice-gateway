# Gestión de Empresas Emisoras (Tenants)

En el modelo de `sri-invoice-gateway`, un **Tenant** representa una empresa emisora o contribuyente individual registrado ante el SRI de Ecuador, identificado por su número de Registro Único de Contribuyentes (**RUC** de 13 dígitos).

---

## Creación de un Nuevo Tenant

Para registrar una empresa emisora bajo su cuenta de integrador SaaS, realice una llamada a `POST /v1/tenants`:

```http
POST /v1/tenants HTTP/1.1
Host: api.gateway.com
Authorization: Bearer sri_live_...
Content-Type: application/json

{
  "businessName": "Corporación Andina de Alimentos S.A.",
  "tradeName": "Andina Market",
  "ruc": "1790011674001",
  "legalAddress": "Av. República de El Salvador 890 y Portugal, Quito",
  "specialTaxpayer": "12345",
  "forcedAccounting": true,
  "retentionAgent": "1"
}
```

### Respuesta de Creación (HTTP 201 Created)

```json
{
  "success": true,
  "tenant": {
    "id": "e2a3c4b5-6789-0123-abcd-ef0123456789",
    "apiClientId": "a98dfb02-1345-4bb6-981c-6d1234567890",
    "businessName": "Corporación Andina de Alimentos S.A.",
    "tradeName": "Andina Market",
    "ruc": "1790011674001",
    "legalAddress": "Av. República de El Salvador 890 y Portugal, Quito",
    "specialTaxpayer": "12345",
    "forcedAccounting": true,
    "retentionAgent": "1",
    "status": "ACTIVE",
    "createdAt": "2026-11-09T18:40:00.000Z"
  }
}
```

---

## Restricciones y Unicidad de RUC

1. **Unicidad por Integrador (`@@unique([apiClientId, ruc])`)**:
   - Una misma cuenta SaaS no puede registrar dos veces el mismo RUC. Si se intenta registrar un RUC ya existente bajo el mismo integrador, el gateway responde inmediatamente con `409 Conflict` (`TENANT_RUC_EXISTS`).
2. **Validación de Formato de RUC**:
   - El RUC debe componerse exactamente de **13 dígitos numéricos** (`/^\d{13}$/`).
   - Los primeros 2 dígitos corresponden a una provincia válida ecuatoriana (01 a 24, o 30).
   - Los últimos 3 dígitos deben corresponder al establecimiento matriz (habitualmente `001`).

---

## Listado de Tenants

Para obtener las empresas emisoras vinculadas a su cuenta:

```http
GET /v1/tenants?page=1&limit=20 HTTP/1.1
Host: api.gateway.com
Authorization: Bearer sri_live_...
Accept: application/json
```

### Respuesta Paginada (HTTP 200 OK)

```json
{
  "success": true,
  "data": [
    {
      "id": "e2a3c4b5-6789-0123-abcd-ef0123456789",
      "businessName": "Corporación Andina de Alimentos S.A.",
      "ruc": "1790011674001",
      "status": "ACTIVE",
      "createdAt": "2026-11-09T18:40:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

## Aislamiento Multi-Tenant

El sistema impone un estricto aislamiento de datos en todas las consultas:

- Todas las lecturas y modificaciones en base de datos incluyen de forma obligatoria la cláusula `WHERE api_client_id = :authenticatedApiClientId`.
- Un integrador SaaS **no puede consultar, modificar ni emitir facturas** a nombre de empresas emisoras pertenecientes a otra cuenta SaaS. Cualquier intento desencadena un `403 Forbidden` (`TENANT_ACCESS_DENIED`).
