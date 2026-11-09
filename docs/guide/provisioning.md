# Provisionamiento y Autenticación de Integradores SaaS

El endpoint `POST /v1/api-clients` permite registrar una nueva cuenta de integración SaaS en el gateway. Este proceso emite una **Master API Key** única que identifica al integrador y autentica todas sus llamadas posteriores.

---

## Creación de una Cuenta de Integrador

Para dar de alta un nuevo SaaS, realice una petición al endpoint de provisión administrativa:

```http
POST /v1/api-clients HTTP/1.1
Host: api.gateway.com
Content-Type: application/json

{
  "name": "FacturaCloud ERP Platform",
  "contactEmail": "dev@facturacloud.io",
  "webhookUrl": "https://api.facturacloud.io/webhooks/sri",
  "rateLimitPerMinute": 120
}
```

### Respuesta de Provisión (HTTP 201 Created)

::: warning ADVERTENCIA CRÍTICA: API KEY DE ÚNICA EXHIBICIÓN
La propiedad `apiKey` en texto plano solo se devuelve una única vez en la respuesta del provisionamiento. Debe guardarla inmediatamente en un almacén seguro de secretos (como AWS Secrets Manager, HashiCorp Vault o variables de entorno protegidas).
:::

```json
{
  "success": true,
  "apiClient": {
    "id": "a98dfb02-1345-4bb6-981c-6d1234567890",
    "name": "FacturaCloud ERP Platform",
    "contactEmail": "dev@facturacloud.io",
    "webhookUrl": "https://api.facturacloud.io/webhooks/sri",
    "rateLimitPerMinute": 120,
    "isActive": true,
    "createdAt": "2026-11-09T18:30:00.000Z"
  },
  "apiKey": "sri_live_7a9f8b2c4d1e3a5f6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e"
}
```

---

## Modelo de Seguridad de la API Key

1. **Estructura del Token**:
   - Prefijo canónico: `sri_live_`
   - Entropía: 48 caracteres hexadecimales aleatorios criptográficamente seguros generados vía `crypto.randomBytes(24).toString('hex')`.
2. **Almacenamiento Criptográfico Hashed**:
   - `sri-invoice-gateway` **NUNCA** almacena la API Key en texto plano en la base de datos PostgreSQL.
   - Solo se persiste su hash digest computado mediante **SHA-256**:
     ```typescript
     const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
     ```
3. **Validación en Tiempo de Petición**:
   - `ApiKeyGuard` intercepta cada llamada entrante, toma el valor de `Authorization: Bearer <token>`, calcula su digest SHA-256 en memoria y realiza la búsqueda en base de datos:
     ```sql
     SELECT id, name, is_active, rate_limit_per_minute 
     FROM api_clients 
     WHERE api_key_hash = :hash AND is_active = true;
     ```

---

## Autenticación en Peticiones HTTP

Para invocar cualquier endpoint protegido de la API (`/v1/tenants`, `/v1/tenants/:tenantId/invoices`, etc.), agregue la clave en el encabezado `Authorization`:

```bash
curl -X GET https://api.gateway.com/v1/tenants \
  -H "Authorization: Bearer sri_live_7a9f8b2c4d1e3a5f6b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e" \
  -H "Accept: application/json"
```

### Códigos de Error Comunes de Autenticación

| Código HTTP | Error Code | Causa |
| :--- | :--- | :--- |
| `401 Unauthorized` | `MISSING_API_KEY` | El encabezado `Authorization: Bearer ...` no fue provisto en la petición. |
| `401 Unauthorized` | `INVALID_API_KEY` | El token enviado no existe en la base de datos o el hash SHA-256 no coincide. |
| `401 Unauthorized` | `INACTIVE_API_CLIENT` | La cuenta del integrador SaaS se encuentra suspendida o deshabilitada (`isActive = false`). |
