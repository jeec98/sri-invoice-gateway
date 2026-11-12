# Referencia de Endpoints REST (v1)

Documentación de todos los endpoints disponibles en `sri-invoice-gateway` para registrar tu plataforma SaaS, dar de alta negocios emisores, subir certificados `.p12` y emitir facturas electrónicas ante el SRI de Ecuador.

---

## Convenciones Globales

### Base URL
| Entorno | Base URL |
| :--- | :--- |
| **Desarrollo / Local** | `http://localhost:3000` |
| **Producción** | `https://sri-invoice-gateway-production.up.railway.app` (o el dominio de tu servidor) |

Todos los endpoints están prefijados con `/v1`.

### Autenticación (`apiKey` como Bearer Token)
Excepto el registro inicial (`POST /v1/api-clients`), todos los endpoints requieren enviar tu **`apiKey`** (`sri_live_...`) como **Bearer Token** en el encabezado `Authorization`:

```http
Authorization: Bearer sri_live_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

* **En Swagger (`/docs`)**: Haz clic en el botón **Authorize**, pega tu `apiKey` (`sri_live_...`) y guarda.
* **Aislamiento automático**: Cada plataforma SaaS solo puede ver y emitir facturas para los negocios (`Tenants`) registrados bajo su propia `apiKey`.

### Encabezados de Límite de Tasa
Cada respuesta incluye tu cuota disponible en la ventana actual (`20` peticiones por segundo):
- `X-RateLimit-Limit`: Límite máximo por segundo (`20`).
- `X-RateLimit-Remaining`: Peticiones disponibles en este segundo.

---

## 1. POST /v1/api-clients

**Registro de Plataforma SaaS (Único por RUC)**

Registra tu plataforma SaaS dentro del microservicio (puedes hacerlo directamente desde el [formulario web](/guide/provisioning#formulario-de-registro), en **Swagger `/docs`** o con `curl`). Te devuelve una **`apiKey`** (`sri_live_...`) que deberás usar como **Bearer Token** en todos los demás endpoints.

> [!CAUTION]
> 1. **Solo se puede registrar una única vez por RUC**: El `ruc` de tu plataforma es único. Si intentas registrar nuevamente el mismo RUC, la API responderá con `409 Conflict` (`API_CLIENT_RUC_EXISTS`).
> 2. **Copia tu `apiKey` inmediatamente**: El valor en texto plano se devuelve **únicamente en esta respuesta y nunca volverá a mostrarse**. Guárdalo de inmediato en tus variables de entorno.

### Encabezados de Petición
| Encabezado | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `Content-Type` | `string` | **Sí** | Debe ser `application/json` |

### Cuerpo de la Petición (JSON)
| Campo | Tipo | Requerido | Restricciones / Descripción |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Sí** | Nombre comercial o identificador de la plataforma SaaS (ej. `"FacturaCloud SaaS"`). |
| `ruc` | `string` | **Sí** | RUC de 13 dígitos numéricos del proveedor de software terminado en `001` (`/^\d{10}001$/`). Se inyecta automáticamente en `<campoAdicional nombre="RUC Proveedor">` de cada factura (Resolución SRI **NAC-DGERCGC26-00000027**). |
| `webhookUrl` | `string` | No | **Qué es y para qué sirve**: URL HTTPS de tu propio servidor donde el gateway enviará automáticamente (vía `POST` firmado con HMAC-SHA256) el resultado del SRI (`AUTORIZADO`, `DEVUELTA`, `NO_AUTORIZADO` o `FAILED`) cuando termine la cola asíncrona, evitando hacer *polling* constante. |

### Esquema Único del Servicio

Todas las plataformas registradas operan bajo un esquema único optimizado:
* **Negocios (`Tenants`)**: Múltiples negocios emisores permitidos por plataforma SaaS.
* **Tasa HTTP**: `20` peticiones por segundo en Redis (`RateLimitGuard`) para evitar saturación de colas.

### Ejemplos de Implementación

::: code-group

```bash [cURL]
curl -X POST https://api.tu-dominio.com/v1/api-clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "FacturaCloud SaaS",
    "ruc": "1790011674001",
    "webhookUrl": "https://api.facturacloud.io/webhooks/sri"
  }'
```

```typescript [TypeScript (Node.js)]
import axios from 'axios';

interface CreateApiClientDto {
  name: string;
  ruc: string;
  webhookUrl?: string;
}

interface ApiClientResponse {
  id: string;
  name: string;
  ruc: string;
  apiKey: string;
  apiKeyHash: string;
  webhookUrl: string | null;
  plan: string;
  rateLimitRps: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

async function provisionSaaSCredentials(): Promise<ApiClientResponse> {
  const payload: CreateApiClientDto = {
    name: 'FacturaCloud SaaS',
    ruc: '1790011674001',
    webhookUrl: 'https://api.facturacloud.io/webhooks/sri',
  };

  const response = await axios.post<ApiClientResponse>(
    'https://api.tu-dominio.com/v1/api-clients',
    payload,
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  console.log('Master API Key generada (guardar de inmediato):', response.data.apiKey);
  return response.data;
}
```

```python [Python 3]
import requests

def provision_saas_credentials() -> dict:
    url = "https://api.tu-dominio.com/v1/api-clients"
    payload = {
        "name": "FacturaCloud SaaS",
        "ruc": "1790011674001",
        "webhookUrl": "https://api.facturacloud.io/webhooks/sri"
    }
    headers = {"Content-Type": "application/json"}

    response = requests.post(url, json=payload, headers=headers)
    response.raise_for_status()
    data = response.json()

    print(f"Master API Key generada: {data['apiKey']}")
    return data
```

:::

### Respuestas HTTP

#### `201 Created`
```json
{
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "FacturaCloud SaaS",
  "ruc": "1790011674001",
  "apiKey": "sri_live_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "apiKeyHash": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "webhookUrl": "https://api.facturacloud.io/webhooks/sri",
  "plan": "DEFAULT",
  "rateLimitRps": 20,
  "status": "ACTIVE",
  "createdAt": "2026-11-09T16:00:00.000Z",
  "updatedAt": "2026-11-09T16:00:00.000Z"
}
```

#### Códigos de Error
| Código HTTP | Mensaje / Código de Error | Descripción |
| :--- | :--- | :--- |
| `400 Bad Request` | `name should not be empty` | El nombre del integrador es obligatorio o los tipos son incorrectos. |
| `400 Bad Request` | `webhookUrl must be an URL address` | La URL de webhook no tiene formato de URL absoluto válido. |
| `409 Conflict` | `API_CLIENT_RUC_EXISTS` | Ya existe una plataforma SaaS registrada con ese mismo RUC. |

---

## 2. POST /v1/tenants

**Registro de Empresa Emisora (Tenant)**

Registra una nueva Empresa Emisora contribuyente bajo la plataforma SaaS autenticada. Cada tenant representa un contribuyente tributario ecuatoriano identificado por su RUC único de 13 dígitos terminado en `001`.

> [!NOTE]
> Un mismo contribuyente (RUC) no puede ser registrado dos veces bajo la misma plataforma SaaS (`TENANT_RUC_EXISTS`).

### Encabezados de Petición
| Encabezado | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `Authorization` | `string` | **Sí** | `Bearer sri_live_<48_hex>` |
| `Content-Type` | `string` | **Sí** | `application/json` |

### Cuerpo de la Petición (JSON)
| Campo | Tipo | Requerido | Restricciones / Descripción |
| :--- | :--- | :--- | :--- |
| `businessName` | `string` | **Sí** | Razón social oficial o nombre comercial registrado ante el SRI. |
| `ruc` | `string` | **Sí** | RUC de 13 dígitos numéricos terminado en `001` (regex: `/^\d{10}001$/`). |

### Ejemplos de Implementación

::: code-group

```bash [cURL]
curl -X POST https://api.tu-dominio.com/v1/tenants \
  -H "Authorization: Bearer sri_live_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" \
  -H "Content-Type: application/json" \
  -d '{
    "businessName": "Importadora Tecnológica del Ecuador S.A.",
    "ruc": "1790011674001"
  }'
```

```typescript [TypeScript (Node.js)]
import axios from 'axios';

interface CreateTenantDto {
  businessName: string;
  ruc: string;
}

interface TenantResponse {
  id: string;
  businessName: string;
  ruc: string;
  apiClientId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

async function registerTenant(apiKey: string): Promise<TenantResponse> {
  const payload: CreateTenantDto = {
    businessName: 'Importadora Tecnológica del Ecuador S.A.',
    ruc: '1790011674001',
  };

  const response = await axios.post<TenantResponse>(
    'https://api.tu-dominio.com/v1/tenants',
    payload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}
```

```python [Python 3]
import requests

def register_tenant(api_key: str) -> dict:
    url = "https://api.tu-dominio.com/v1/tenants"
    payload = {
        "businessName": "Importadora Tecnológica del Ecuador S.A.",
        "ruc": "1790011674001"
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    response = requests.post(url, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()
```

:::

### Respuestas HTTP

#### `201 Created`
```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "businessName": "Importadora Tecnológica del Ecuador S.A.",
  "ruc": "1790011674001",
  "apiClientId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "status": "ACTIVE",
  "createdAt": "2026-11-09T16:05:00.000Z",
  "updatedAt": "2026-11-09T16:05:00.000Z"
}
```

#### Códigos de Error
| Código HTTP | Mensaje / Código de Error | Descripción |
| :--- | :--- | :--- |
| `400 Bad Request` | `El RUC debe tener 13 dígitos numéricos y terminar en 001.` | Formato tributario de RUC ecuatoriano no válido. |
| `401 Unauthorized` | `INVALID_API_KEY: Credencial Bearer inválida o ausente.` | API Key inexistente o revocada. |
| `409 Conflict` | `TENANT_RUC_EXISTS: Ya existe una empresa emisora registrada con este RUC...` | El RUC ya fue dado de alta bajo este `ApiClient`. |

---

## 3. GET /v1/tenants

**Listar Empresas Emisoras (Tenants)**

Retorna una lista paginada de las empresas emisoras dadas de alta estrictamente por la plataforma SaaS autenticada. Garantiza aislamiento multi-tenant absoluto (`WHERE api_client_id = :apiClientId`).

### Encabezados de Petición
| Encabezado | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `Authorization` | `string` | **Sí** | `Bearer sri_live_<48_hex>` |

### Parámetros de Consulta (Query Parameters)
| Parámetro | Tipo | Requerido | Default | Descripción |
| :--- | :--- | :--- | :--- | :--- |
| `page` | `number` | No | `1` | Número de página (mínimo: 1). |
| `limit` | `number` | No | `10` | Cantidad de registros por página (mínimo: 1, máximo: 100). |

### Ejemplos de Implementación

::: code-group

```bash [cURL]
curl -X GET "https://api.tu-dominio.com/v1/tenants?page=1&limit=10" \
  -H "Authorization: Bearer sri_live_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

```typescript [TypeScript (Node.js)]
import axios from 'axios';

interface TenantItem {
  id: string;
  businessName: string;
  ruc: string;
  apiClientId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface ListTenantsResponse {
  success: boolean;
  items: TenantItem[];
  total: number;
  page: number;
  limit: number;
}

async function listTenants(apiKey: string, page = 1, limit = 10): Promise<ListTenantsResponse> {
  const response = await axios.get<ListTenantsResponse>(
    'https://api.tu-dominio.com/v1/tenants',
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      params: { page, limit },
    }
  );

  return response.data;
}
```

```python [Python 3]
import requests

def list_tenants(api_key: str, page: int = 1, limit: int = 10) -> dict:
    url = "https://api.tu-dominio.com/v1/tenants"
    headers = {"Authorization": f"Bearer {api_key}"}
    params = {"page": page, "limit": limit}

    response = requests.get(url, headers=headers, params=params)
    response.raise_for_status()
    return response.json()
```

:::

### Respuestas HTTP

#### `200 OK`
```json
{
  "success": true,
  "items": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "businessName": "Importadora Tecnológica del Ecuador S.A.",
      "ruc": "1790011674001",
      "apiClientId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "status": "ACTIVE",
      "createdAt": "2026-11-09T16:05:00.000Z",
      "updatedAt": "2026-11-09T16:05:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

#### Códigos de Error
| Código HTTP | Mensaje / Código de Error | Descripción |
| :--- | :--- | :--- |
| `401 Unauthorized` | `INVALID_API_KEY` | Credencial Bearer inválida, expirada o ausente. |

---

## 4. POST /v1/tenants/:tenantId/certificates

**Carga y Validación Criptográfica de Certificado Digital (.p12 / .pfx)**

Sube el archivo de firma electrónica del contribuyente en formato PKCS#12 (`.p12` o `.pfx`). El gateway ejecuta una batería de 6 validaciones criptográficas antes de almacenar:
1. **Contraseña**: Apertura exitosa de la caja PKCS#12 con la clave provista.
2. **Integridad Par Clave-Certificado**: Verificación del par de claves pública/privada RSA.
3. **Vigencia Temporal**: Validación estricta de fechas `validFrom <= hoy <= validTo`.
4. **Entidad de Certificación Acreditada por ARCOTEL**: Validación de emisores oficiales (Banco Central del Ecuador, Security Data, Uanataca, ANF AC, Consejo de la Judicatura, etc.).
5. **Identidad RUC**: Validación de coincidencia del RUC en extensiones X.509 (`OID 1.3.6.1.4.1.37947...`) contra el RUC del tenant.
6. **Revocación**: Verificación de listas CRL / OCSP.

Tras validar, el gateway cifra la contraseña y el binario con **AES-256-GCM** (vector de inicialización IV de 96 bits aleatorio y tag de autenticación). El binario se almacena en disco con permisos de sistema `0600`.

### Parámetros de Ruta (Path Parameters)
| Parámetro | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `tenantId` | `string (UUID)` | **Sí** | Identificador UUID del tenant autenticado. |

### Encabezados de Petición
| Encabezado | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `Authorization` | `string` | **Sí** | `Bearer sri_live_<48_hex>` |
| `Content-Type` | `string` | **Sí** | `multipart/form-data` |

### Campos del Formulario Multipart
| Campo | Tipo | Requerido | Restricciones / Descripción |
| :--- | :--- | :--- | :--- |
| `file` | `binary` | **Sí** | Archivo binario `.p12` o `.pfx`. Límite máximo de tamaño: `5 MB`. |
| `ruc` | `string` | **Sí** | RUC de 13 dígitos numéricos. Debe coincidir exactamente con el RUC del tenant. |
| `password` | `string` | **Sí** | Contraseña de protección de la firma electrónica. |

### Ejemplos de Implementación

::: code-group

```bash [cURL]
curl -X POST https://api.tu-dominio.com/v1/tenants/3fa85f64-5717-4562-b3fc-2c963f66afa6/certificates \
  -H "Authorization: Bearer sri_live_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" \
  -F "file=@/ruta/a/mi_firma.p12;type=application/x-pkcs12" \
  -F "ruc=1790011674001" \
  -F "password=MiClaveSeguraP12_2026"
```

```typescript [TypeScript (Node.js)]
import axios from 'axios';
import * as fs from 'fs';
import FormData from 'form-data';

interface CertificateUploadResponse {
  success: boolean;
  tenantId: string;
  ruc: string;
  certificate: {
    id: string;
    certSubject: string;
    certIssuer: string;
    validFrom: string;
    validTo: string;
    isActive: boolean;
    rucVerified: boolean;
    encryptionAlgorithm: string;
  };
}

async function uploadCertificate(
  apiKey: string,
  tenantId: string,
  filePath: string,
  ruc: string,
  password: string
): Promise<CertificateUploadResponse> {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('ruc', ruc);
  form.append('password', password);

  const response = await axios.post<CertificateUploadResponse>(
    `https://api.tu-dominio.com/v1/tenants/${tenantId}/certificates`,
    form,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
    }
  );

  return response.data;
}
```

```python [Python 3]
import requests

def upload_certificate(api_key: str, tenant_id: str, file_path: str, ruc: str, password: str) -> dict:
    url = f"https://api.tu-dominio.com/v1/tenants/{tenant_id}/certificates"
    headers = {"Authorization": f"Bearer {api_key}"}

    with open(file_path, "rb") as cert_file:
        files = {
            "file": (file_path, cert_file, "application/x-pkcs12")
        }
        data = {
            "ruc": ruc,
            "password": password
        }

        response = requests.post(url, headers=headers, files=files, data=data)
        response.raise_for_status()
        return response.json()
```

:::

### Respuestas HTTP

#### `201 Created`
```json
{
  "success": true,
  "tenantId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "ruc": "1790011674001",
  "certificate": {
    "id": "e2a095f3-5247-4977-b9c2-b349d4f0d367",
    "certSubject": "CN=JUAN PEREZ,SERIALNUMBER=1790011674001,C=EC",
    "certIssuer": "CN=AUTORIDAD DE CERTIFICACION SECURITY DATA,OU=SUB CA 1,O=SECURITY DATA S.A.,C=EC",
    "validFrom": "2025-01-01T00:00:00.000Z",
    "validTo": "2027-01-01T23:59:59.000Z",
    "isActive": true,
    "rucVerified": true,
    "encryptionAlgorithm": "AES-256-GCM"
  }
}
```

#### Códigos de Error
| Código HTTP | Mensaje / Código de Error | Descripción |
| :--- | :--- | :--- |
| `400 Bad Request` | `MISSING_FILE: Debe enviar el archivo .p12/.pfx en el campo multipart "file".` | No se adjuntó archivo en la petición multipart. |
| `400 Bad Request` | `INVALID_CERTIFICATE_PASSWORD: Clave incorrecta para descifrar el contenedor PKCS#12.` | Contraseña errónea proporcionada para el archivo. |
| `400 Bad Request` | `UNRECOGNIZED_CA: La Entidad de Certificación emisora no se encuentra acreditada ante ARCOTEL.` | Certificado autofirmado o emitido por entidad no autorizada. |
| `401 Unauthorized` | `INVALID_API_KEY` | Credencial Bearer inválida o ausente. |
| `403 Forbidden` | `TENANT_ACCESS_DENIED: Acceso denegado a la empresa emisora solicitada.` | El tenant no pertenece a la plataforma SaaS autenticada. |
| `403 Forbidden` | `RUC_MISMATCH: El RUC enviado no coincide con el RUC del tenant autenticado.` | El RUC del certificado o formulario discrepa del tenant. |
| `404 Not Found` | `TENANT_NOT_FOUND` | El UUID de tenant no existe en el sistema. |

---

## 5. POST /v1/tenants/:tenantId/invoices

**Ingesta Asíncrona de Facturas de Alta Velocidad (<200ms -> 202 Accepted)**

Encola un comprobante electrónico tipo Factura (`codDoc: 01`) para su procesamiento asíncrono. El endpoint realiza validaciones síncronas de bajo cómputo (`< 200 ms`), genera inmediatamente la **Clave de Acceso oficial de 49 dígitos (Módulo 11)**, persiste el trabajo con estado `QUEUED` y lo despacha a la cola BullMQ (`sri-invoice-queue`).

El ciclo de firma digital XAdES-BES, transmisión SOAP 1.1 al SRI y polling de autorización se ejecuta en segundo plano. Al finalizar, el gateway envía un webhook firmado con HMAC-SHA256 al `webhookUrl`.

### Parámetros de Ruta (Path Parameters)
| Parámetro | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `tenantId` | `string (UUID)` | **Sí** | Identificador UUID del tenant emisor. |

### Encabezados de Petición
| Encabezado | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `Authorization` | `string` | **Sí** | `Bearer sri_live_<48_hex>` |
| `Content-Type` | `string` | **Sí** | `application/json` |

### Estructura del Cuerpo de la Petición (JSON)
| Campo | Tipo | Requerido | Descripción / Reglas |
| :--- | :--- | :--- | :--- |
| `referenceId` | `string` | **Sí** | Identificador único de idempotencia en el sistema origen (ej. `"INV-2026-000123"`). |
| `ambiente` | `string` | **Sí** | `"1"` = Pruebas (`celcer.sri.gob.ec`), `"2"` = Producción (`cel.sri.gob.ec`). |
| `webhookUrl` | `string` | No | Sobrescritura de la URL de webhook para esta factura específica. |
| `razonSocial` | `string` | **Sí** | Razón social del contribuyente emisor. |
| `nombreComercial` | `string` | No | Nombre comercial del emisor. |
| `ruc` | `string` | **Sí** | RUC del emisor (13 dígitos). **Debe coincidir con el RUC del tenant**. |
| `estab` | `string` | **Sí** | Código de establecimiento SRI de 3 dígitos (ej. `"001"`). |
| `ptoEmi` | `string` | **Sí** | Punto de emisión SRI de 3 dígitos (ej. `"001"`). |
| `secuencial` | `string` | **Sí** | Secuencial numérico de hasta 9 dígitos (ej. `"000000123"`). |
| `dirMatriz` | `string` | **Sí** | Dirección de la casa matriz. |
| `fechaEmision` | `string` | **Sí** | Fecha de emisión en formato `dd/mm/aaaa` (ej. `"07/11/2026"`). |
| `dirEstablecimiento`| `string` | **Sí** | Dirección del establecimiento emisor. |
| `obligadoContabilidad` | `string` | No | `"SI"` o `"NO"`. |
| `tipoIdentificacionComprador` | `string` | **Sí** | `"04"` = RUC, `"05"` = Cédula, `"06"` = Pasaporte, `"07"` = Consumidor Final, `"08"` = Identificación del Exterior. |
| `razonSocialComprador` | `string` | **Sí** | Nombre o razón social del adquiriente. |
| `identificacionComprador` | `string` | **Sí** | Número de identificación del adquiriente (`"9999999999999"` para consumidor final). |
| `direccionComprador` | `string` | No | Dirección del adquiriente. |
| `totalSinImpuestos` | `number` | **Sí** | Subtotal sin impuestos (suma de `precioTotalSinImpuesto` de items). |
| `totalDescuento` | `number` | **Sí** | Descuento total aplicado. |
| `propina` | `number` | No | Valor de propina (default `0.0`). |
| `importeTotal` | `number` | **Sí** | Monto total a pagar de la factura. |
| `moneda` | `string` | No | Moneda (default `"DOLAR"`). |
| `pagos` | `array` | **Sí** | Array de formas de pago (mínimo 1 elemento). |
| `pagos[].formaPago` | `string` | **Sí** | Código SRI (`"01"`: Sin sistema financiero, `"20"`: Otros con utilización del sistema financiero). |
| `pagos[].total` | `number` | **Sí** | Monto asignado a la forma de pago. |
| `detalles` | `array` | **Sí** | Lista de productos o servicios facturados (mínimo 1 elemento). |
| `detalles[].codigoPrincipal` | `string` | **Sí** | SKU o código del producto. |
| `detalles[].descripcion` | `string` | **Sí** | Descripción del producto o servicio. |
| `detalles[].cantidad` | `number` | **Sí** | Cantidad facturada (> 0). |
| `detalles[].precioUnitario` | `number` | **Sí** | Precio unitario sin impuestos. |
| `detalles[].descuento` | `number` | **Sí** | Descuento por item. |
| `detalles[].precioTotalSinImpuesto` | `number` | **Sí** | Total neto del item (`cantidad * precioUnitario - descuento`). |
| `detalles[].impuestos` | `array` | **Sí** | Desglose de impuestos por item (mínimo 1). |
| `detalles[].impuestos[].codigo` | `string` | **Sí** | `"2"` para IVA. |
| `detalles[].impuestos[].codigoPorcentaje` | `string` | **Sí** | `"0"` = 0%, `"4"` = 15%, `"5"` = 5%, `"6"` = No objeto, `"7"` = Exento. |
| `detalles[].impuestos[].tarifa` | `number` | **Sí** | Porcentaje (ej. `15`). |
| `detalles[].impuestos[].baseImponible` | `number` | **Sí** | Base imponible sujeta al impuesto. |
| `detalles[].impuestos[].valor` | `number` | **Sí** | Valor liquidado del impuesto (`baseImponible * tarifa / 100`). |
| `infoAdicional` | `array` | No | Campos personalizados opcionales (`nombre`, `valor`). |

### Ejemplos de Implementación

::: code-group

```bash [cURL]
curl -X POST https://api.tu-dominio.com/v1/tenants/3fa85f64-5717-4562-b3fc-2c963f66afa6/invoices \
  -H "Authorization: Bearer sri_live_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" \
  -H "Content-Type: application/json" \
  -d '{
    "referenceId": "INV-2026-000123",
    "ambiente": "1",
    "webhookUrl": "https://api.facturacloud.io/webhooks/sri",
    "razonSocial": "IMPORTADORA TECNOLOGICA DEL ECUADOR S.A.",
    "ruc": "1790011674001",
    "estab": "001",
    "ptoEmi": "001",
    "secuencial": "000000123",
    "dirMatriz": "AV. AMAZONAS N34-123 Y NACIONES UNIDAS, QUITO",
    "fechaEmision": "07/11/2026",
    "dirEstablecimiento": "AV. AMAZONAS N34-123 Y NACIONES UNIDAS, QUITO",
    "obligadoContabilidad": "SI",
    "tipoIdentificacionComprador": "04",
    "razonSocialComprador": "COMERCIALIZADORA DEL PACIFICO S.A.",
    "identificacionComprador": "0991234567001",
    "direccionComprador": "AV. 9 DE OCTUBRE, GUAYAQUIL",
    "totalSinImpuestos": 100.0,
    "totalDescuento": 0.0,
    "propina": 0.0,
    "importeTotal": 115.0,
    "moneda": "DOLAR",
    "pagos": [
      {
        "formaPago": "20",
        "total": 115.0,
        "plazo": "30",
        "unidadTiempo": "dias"
      }
    ],
    "detalles": [
      {
        "codigoPrincipal": "PROD-001",
        "descripcion": "Licencia Anual Software Contable Cloud",
        "cantidad": 1,
        "precioUnitario": 100.0,
        "descuento": 0.0,
        "precioTotalSinImpuesto": 100.0,
        "impuestos": [
          {
            "codigo": "2",
            "codigoPorcentaje": "4",
            "tarifa": 15,
            "baseImponible": 100.0,
            "valor": 15.0
          }
        ]
      }
    ],
    "infoAdicional": [
      {
        "nombre": "Email",
        "valor": "facturacion@comercialpacifico.com"
      }
    ]
  }'
```

```typescript [TypeScript (Node.js)]
import axios from 'axios';

interface CreateInvoiceResponse {
  success: boolean;
  jobId: string;
  referenceId: string;
  claveAcceso: string;
  status: 'QUEUED';
}

async function emitInvoice(apiKey: string, tenantId: string, invoicePayload: any): Promise<CreateInvoiceResponse> {
  const response = await axios.post<CreateInvoiceResponse>(
    `https://api.tu-dominio.com/v1/tenants/${tenantId}/invoices`,
    invoicePayload,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  console.log('Factura encolada exitosamente (<200ms):', response.data.claveAcceso);
  return response.data;
}
```

```python [Python 3]
import requests

def emit_invoice(api_key: str, tenant_id: str, invoice_payload: dict) -> dict:
    url = f"https://api.tu-dominio.com/v1/tenants/{tenant_id}/invoices"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    response = requests.post(url, json=invoice_payload, headers=headers)
    response.raise_for_status()
    data = response.json()

    print(f"Factura encolada con Clave de Acceso: {data['claveAcceso']}")
    return data
```

:::

### Respuestas HTTP

#### `202 Accepted`
```json
{
  "success": true,
  "jobId": "a1d82138-0db4-4e2b-bb4f-8f81bb380fa2",
  "referenceId": "INV-2026-000123",
  "claveAcceso": "0711202601179001167400110010010000001237602192712",
  "status": "QUEUED"
}
```

#### Códigos de Error
| Código HTTP | Mensaje / Código de Error | Descripción |
| :--- | :--- | :--- |
| `400 Bad Request` | `MISSING_ACTIVE_CERTIFICATE` | El tenant no posee un certificado digital activo o su fecha ha expirado. |
| `401 Unauthorized` | `INVALID_API_KEY` | Credencial Bearer inválida o ausente. |
| `403 Forbidden` | `RUC_MISMATCH` | El RUC especificado en el cuerpo de la factura discrepa del RUC del tenant. |
| `403 Forbidden` | `TENANT_ACCESS_DENIED` | La empresa emisora no pertenece a la plataforma SaaS autenticada. |
| `409 Conflict` | `DUPLICATE_REFERENCE_ID` | Ya existe una factura encolada con el mismo `referenceId` para este tenant. |
| `422 Unprocessable` | `Validation failed` | Inconsistencias en el esquema JSON (suma de impuestos errónea, formato de fecha inválido). |

---

## 6. GET /v1/tenants/:tenantId/invoices/:claveAcceso

**Consulta de Estado y XML Autorizado por Clave de Acceso**

Permite a la plataforma SaaS consultar el estado actual de tramitación tributaria de una factura, sus mensajes de observaciones o rechazo del SRI, y recuperar los documentos XML firmados (`signedXml`) y autorizados (`authorizedXml`).

La búsqueda se ejecuta bajo estricto aislamiento multi-tenant (`WHERE clave_acceso = :claveAcceso AND tenant_id = :tenantId`).

### Parámetros de Ruta (Path Parameters)
| Parámetro | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `tenantId` | `string (UUID)` | **Sí** | Identificador UUID del tenant emisor. |
| `claveAcceso` | `string` | **Sí** | Clave de acceso de 49 dígitos numéricos generada para el comprobante. |

### Encabezados de Petición
| Encabezado | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `Authorization` | `string` | **Sí** | `Bearer sri_live_<48_hex>` |

### Ejemplos de Implementación

::: code-group

```bash [cURL]
curl -X GET "https://api.tu-dominio.com/v1/tenants/3fa85f64-5717-4562-b3fc-2c963f66afa6/invoices/0711202601179001167400110010010000001237602192712" \
  -H "Authorization: Bearer sri_live_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

```typescript [TypeScript (Node.js)]
import axios from 'axios';

interface InvoiceStatusResponse {
  success: boolean;
  jobId: string;
  referenceId: string;
  claveAcceso: string;
  ambiente: '1' | '2';
  status: 'QUEUED' | 'RECIBIDA' | 'EN_PROCESO' | 'AUTORIZADO' | 'DEVUELTA' | 'NO_AUTORIZADO' | 'FAILED';
  numeroAutorizacion: string | null;
  fechaAutorizacion: string | null;
  sriMessages: any | null;
  signedXml: string | null;
  authorizedXml: string | null;
  webhookDelivered: boolean;
  webhookResponseStatus: number | null;
  createdAt: string;
  updatedAt: string;
}

async function getInvoiceStatus(
  apiKey: string,
  tenantId: string,
  claveAcceso: string
): Promise<InvoiceStatusResponse> {
  const response = await axios.get<InvoiceStatusResponse>(
    `https://api.tu-dominio.com/v1/tenants/${tenantId}/invoices/${claveAcceso}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  return response.data;
}
```

```python [Python 3]
import requests

def get_invoice_status(api_key: str, tenant_id: str, clave_acceso: str) -> dict:
    url = f"https://api.tu-dominio.com/v1/tenants/{tenant_id}/invoices/{clave_acceso}"
    headers = {"Authorization": f"Bearer {api_key}"}

    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()
```

:::

### Respuestas HTTP

#### `200 OK` (Comprobante Autorizado por el SRI)
```json
{
  "success": true,
  "jobId": "a1d82138-0db4-4e2b-bb4f-8f81bb380fa2",
  "referenceId": "INV-2026-000123",
  "claveAcceso": "0711202601179001167400110010010000001237602192712",
  "ambiente": "1",
  "status": "AUTORIZADO",
  "numeroAutorizacion": "0711202601179001167400110010010000001237602192712",
  "fechaAutorizacion": "2026-11-07T14:32:05.000Z",
  "sriMessages": null,
  "signedXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><factura id=\"comprobante\" version=\"1.1.0\"><infoTributaria>...</infoTributaria><infoFactura>...</infoFactura><detalles>...</detalles><ds:Signature xmlns:ds=\"http://www.w3.org/2000/09/xmldsig#\">...</ds:Signature></factura>",
  "authorizedXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>0711202601179001167400110010010000001237602192712</numeroAutorizacion><fechaAutorizacion class=\"fechaAutorizacion\">07/11/2026 14:32:05</fechaAutorizacion><comprobante><![CDATA[<?xml version=\"1.0\" encoding=\"UTF-8\"?><factura>...</factura>]]></comprobante></autorizacion>",
  "webhookDelivered": true,
  "webhookResponseStatus": 200,
  "createdAt": "2026-11-07T14:31:50.000Z",
  "updatedAt": "2026-11-07T14:32:06.000Z"
}
```

#### `200 OK` (Comprobante Rechazado / Devuelto por el SRI)
```json
{
  "success": true,
  "jobId": "b2e93249-1ec5-5f3c-cc5a-9a92cc491ab3",
  "referenceId": "INV-2026-000124",
  "claveAcceso": "0711202601179001167400110010010000001248713203823",
  "ambiente": "1",
  "status": "DEVUELTA",
  "numeroAutorizacion": null,
  "fechaAutorizacion": null,
  "sriMessages": [
    {
      "identificador": "39",
      "mensaje": "FIRMA INVALIDA",
      "informacionAdicional": "El certificado utilizado para la firma se encuentra revocado o ha expirado.",
      "tipo": "ERROR"
    }
  ],
  "signedXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><factura>...</factura>",
  "authorizedXml": null,
  "webhookDelivered": true,
  "webhookResponseStatus": 200,
  "createdAt": "2026-11-07T14:35:10.000Z",
  "updatedAt": "2026-11-07T14:35:14.000Z"
}
```

#### Códigos de Error
| Código HTTP | Mensaje / Código de Error | Descripción |
| :--- | :--- | :--- |
| `400 Bad Request` | `INVALID_CLAVE_ACCESO: La clave de acceso debe contener exactamente 49 dígitos numéricos.` | Longitud o caracteres incorrectos en la clave de acceso. |
| `401 Unauthorized` | `INVALID_API_KEY` | Credencial Bearer inválida o ausente. |
| `403 Forbidden` | `TENANT_ACCESS_DENIED` | La empresa emisora no pertenece a la plataforma SaaS autenticada. |
| `404 Not Found` | `INVOICE_NOT_FOUND: No se encontró la factura con la Clave de Acceso especificada para este tenant.` | No existe comprobante con esa clave bajo este tenant. |

---

## 6. POST /v1/diagnostics/verify-setup

**Diagnóstico de Pre-vuelo Stateless (En Memoria, <500ms)**

Valida preventivamente el RUC (Módulo 10/11), la firma `.p12` (contraseña, integridad RSA, vigencia temporal, CA autorizada ARCOTEL y coincidencia con el RUC emisor), la matriz de establecimientos y la conectividad con los Web Services del SRI. No persiste información en base de datos ni deja archivos en disco.

### Encabezados de Petición
| Encabezado | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `Authorization` | `string` | **Sí** | `Bearer <tu_apiKey>` |
| `Content-Type` | `string` | **Sí** | `application/json` o `multipart/form-data` |

### Cuerpo de la Petición (JSON)
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `ruc` | `string` | **Sí** | RUC de 13 dígitos numéricos a validar. |
| `password` | `string` | **Sí** | Contraseña del archivo `.p12`. |
| `p12Base64` | `string` | Opcional | Contenido del archivo `.p12` en Base64 (si no se envía por `multipart`). |
| `ambiente` | `string` | No | `"1"` (Pruebas) o `"2"` (Producción). Por defecto `"1"`. |
| `establishments` | `array` | No | Lista de sucursales a diagnosticar (`[{ codigo: "001", puntoEmision: "001", activo: true }]`). |

### Respuesta (`200 OK`)
Devuelve `overallStatus: "READY" | "DEGRADED" | "FAILED"` y la bandera `canIssueInvoices: boolean`, junto con el detalle de cada subsistema y los códigos oficiales del SRI.

---

## 7. GET /v1/tenants/:tenantId/diagnostics

**Auditoría Integral Stateful de un Tenant Registrado**

Descifra en memoria el certificado activo de la base de datos del tenant y realiza la auditoría completa de RUC, vigencia, revocación y conectividad con el SRI.

### Encabezados de Petición
| Encabezado | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `Authorization` | `string` | **Sí** | `Bearer <tu_apiKey>` |

### Parámetros de Ruta
| Parámetro | Tipo | Descripción |
| :--- | :--- | :--- |
| `tenantId` | `string` | UUID del tenant registrado. |

### Respuesta (`200 OK`)
Retorna el mismo esquema estructurado que el endpoint de pre-vuelo (`DiagnosticResponseDto`).

---

## 8. GET /v1/tenants/:tenantId/eligibility

**Consulta Ligera de Elegibilidad de Emisión (<100ms)**

Endpoint ultraligero diseñado para interfaces de usuario y comprobaciones previas en formularios de venta o facturación. Devuelve si el negocio puede emitir (`canIssueInvoices: boolean`), estado técnico y motivos bloqueantes.

### Respuesta (`200 OK`)
```json
{
  "tenantId": "c3e98124-742a-4bc1-9e23-1123456789ab",
  "ruc": "1790016919001",
  "canIssueInvoices": true,
  "overallStatus": "READY",
  "checks": {
    "rucValid": true,
    "certificateValid": true,
    "certificateDaysRemaining": 420,
    "activeEstablishments": 2,
    "sriOnline": true
  },
  "blockers": []
}
```

