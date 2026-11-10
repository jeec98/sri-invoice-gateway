# Guía Rápida de Integración (Quickstart)

Bienvenido a la guía de inicio rápido para desarrolladores de **SRI Invoice Gateway**. En menos de 5 minutos podrás provisionar tu cliente de API, registrar tu primera empresa emisora (tenant), configurar su firma digital y emitir tu primera factura electrónica.

---

## Flujo de Integración en 3 Pasos

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Desarrollador SaaS
    participant API as SRI Invoice Gateway
    participant SRI as Web Services SRI
    participant Webhook as SaaS Webhook

    Dev->>API: 1. POST /v1/api-clients (Obtener API Key)
    API-->>Dev: HTTP 201 { apiKey: "sri_live_..." }

    Dev->>API: 2. POST /v1/tenants (Crear Tenant con RUC)
    API-->>Dev: HTTP 201 { id: "tenant-uuid", ruc: "1790011674001" }

    Dev->>API: 3. POST /v1/tenants/:id/certificates (.p12 + password)
    API-->>Dev: HTTP 201 { subject: "...", expiresAt: "..." }

    Dev->>API: 4. POST /v1/tenants/:id/invoices (Emisión Asíncrona)
    API-->>Dev: HTTP 202 Accepted { claveAcceso, status: "QUEUED" }

    Note over API,SRI: Procesa XML, firma XAdES-BES y consulta SOAP
    API->>Webhook: 5. Notificación Webhook (sri.invoice.completed)
    Webhook-->>API: HTTP 200 OK
```

---

## Paso 1: Registrar tu Plataforma SaaS (Una sola vez)

Aquí es donde registras tu plataforma SaaS dentro del gateway (puedes hacerlo directamente desde el [formulario interactivo](/guide/provisioning#formulario-de-registro), en **Swagger (`/docs`)** o con `curl`). Esta llamada genera una credencial maestra (`sri_live_*`) que enviarás en el encabezado `Authorization: Bearer <api_key>` en todas las llamadas posteriores:

```bash
curl -X POST https://api.gateway.com/v1/api-clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mi Plataforma SaaS ERP",
    "ruc": "1790011674001",
    "webhookUrl": "https://erp.misaas.com/webhooks/sri"
  }'
```

* **`ruc` (Cumplimiento SRI `NAC-DGERCGC26-00000027`)**: RUC de 13 dígitos (terminado en `001`) de tu empresa/plataforma proveedora del software. El gateway lo inyectará automáticamente en `<infoAdicional><campoAdicional nombre="RUC Proveedor">` en todas tus facturas.
* **`webhookUrl` (Qué es y para qué sirve)**: Es la URL HTTPS de tu propio servidor donde el gateway te notificará automáticamente (vía `POST` firmado con HMAC-SHA256) cuando el SRI autorice o rechace una factura en segundo plano, evitando que tengas que consultar el estado repetidamente (*polling*). *(Es opcional al registrar el SaaS).*
* **Esquema Único**: Sin planes complejos. Permite registrar múltiples negocios emisores (`Tenants`) bajo tu SaaS con una tasa protegida de `20` req/s en Redis para estabilizar las colas del SRI.

::: danger REGISTRO ÚNICO POR RUC Y GUARDA TU API KEY DE INMEDIATO
* **Solo se puede registrar una vez por RUC**: El `ruc` del SaaS es único (`@unique`); un segundo intento con el mismo RUC devolverá `409 Conflict` (`API_CLIENT_RUC_EXISTS`).
* **Copia tu `apiKey` ahora mismo**: La clave en texto plano solo se muestra una única vez en esta respuesta y **no volverá a mostrarse nunca más** (en PostgreSQL solo se guarda su hash SHA-256).
:::

> Puedes registrarte visualmente o revisar los detalles completos en la [Guía de Registro del SaaS](/guide/provisioning).

---

## Paso 2: Registrar Tenant y Firma Electrónica

### 2.1 Crear la Empresa Emisora

```bash
curl -X POST https://api.gateway.com/v1/tenants \
  -H "Authorization: Bearer sri_live_TU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Empresa Demo S.A.",
    "ruc": "1790011674001",
    "legalName": "EMPRESA DEMOSTRATIVA S.A.",
    "email": "facturacion@demo.com",
    "address": "Av. Amazonas y Colón, Quito"
  }'
```

### 2.2 Cargar Certificado Digital `.p12`

El archivo de firma `.p12` o `.pfx` debe estar emitido por una Autoridad de Certificación acreditada por ARCOTEL (Banco Central del Ecuador, Security Data, Uanataca, ANF, Consejo de la Judicatura):

```bash
curl -X POST https://api.gateway.com/v1/tenants/TENANT_ID/certificates \
  -H "Authorization: Bearer sri_live_TU_API_KEY" \
  -F "file=@/ruta/a/tu/firma.p12" \
  -F "password=TuPasswordDeFirma"
```

El gateway valida en memoria que el RUC del certificado coincida con el RUC del tenant y almacena la clave privada encriptada con **AES-256-GCM**.

---

## Paso 3: Emitir Factura Electrónica

Envía el comprobante en formato JSON. El gateway validará la información, generará la clave de acceso de 49 dígitos (Módulo 11) y encolará la emisión:

```bash
curl -X POST https://api.gateway.com/v1/tenants/TENANT_ID/invoices \
  -H "Authorization: Bearer sri_live_TU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "ambiente": 1,
    "tipoEmision": 1,
    "secuencial": "000000001",
    "fechaEmision": "09/11/2026",
    "infoFactura": {
      "tipoIdentificacionComprador": "05",
      "razonSocialComprador": "CONSUMIDOR FINAL",
      "identificacionComprador": "9999999999999",
      "totalSinImpuestos": 100.00,
      "totalDescuento": 0.00,
      "totalConImpuestos": [
        {
          "codigo": "2",
          "codigoPorcentaje": "4",
          "baseImponible": 100.00,
          "valor": 15.00
        }
      ],
      "importeTotal": 115.00
    },
    "detalles": [
      {
        "codigoPrincipal": "SERV-01",
        "descripcion": "Consultoría Técnica de Software",
        "cantidad": 1,
        "precioUnitario": 100.00,
        "descuento": 0.00,
        "precioTotalSinImpuesto": 100.00,
        "impuestos": [
          {
            "codigo": "2",
            "codigoPorcentaje": "4",
            "tarifa": 15.0,
            "baseImponible": 100.00,
            "valor": 15.00
          }
        ]
      }
    ],
    "pagos": [
      {
        "formaPago": "01",
        "total": 115.00
      }
    ]
  }'
```

### Respuesta Inmediata (`< 200 ms`)

```json
{
  "claveAcceso": "0911202601179001167400110010010000000011234567812",
  "status": "QUEUED",
  "jobId": "job-d41d8cd98f00b204e9800998ecf8427e",
  "estimatedProcessingTimeMs": 2500
}
```

---

## Próximos Pasos

- Consulta la [Arquitectura 2-Tier B2B2B](/guide/architecture) para comprender el flujo interno y BullMQ.
- Revisa la especificación completa de la [Clave de Acceso y Módulo 11](/guide/modulo11).
- Implementa la recepción de notificaciones en [Webhooks & HMAC-SHA256](/guide/webhooks).
- Explora la [Referencia Completa de Endpoints REST](/api/endpoints).
