# SRI Invoice Gateway (`sri-invoice-gateway`)

Microservicio Multi-Tenant en **Node.js / TypeScript / NestJS 11** que desacopla y automatiza la facturación electrónica de **Ecuador (SRI Esquema Offline)**: generación de **Clave de Acceso de 49 dígitos (Módulo 11)**, construcción de **XML canónico v1.1.0**, **Firma Electrónica XAdES-BES** nativa en memoria y autorización asíncrona vía **BullMQ + SOAP 1.1** con notificación por **Webhook firmado (HMAC-SHA256)**.

---

## Tabla de Contenidos

1. [Arquitectura y Flujo de Integración con tu SaaS](#1-arquitectura-y-flujo-de-integración-con-tu-saas)
2. [Cómo Configurar tu SaaS para Conectarse al Microservicio](#2-cómo-configurar-tu-saas-para-conectarse-al-microservicio)
3. [Contrato de API: Qué Debe Enviar tu SaaS](#3-contrato-de-api-qué-debe-enviar-tu-saas)
   - [3.1 Registrar Empresa / Tenant (`POST /v1/tenants`)](#31-registrar-empresa--tenant-post-v1tenants)
   - [3.2 Subir Certificado `.p12` / `.pfx` (`POST /v1/tenants/certificates`)](#32-subir-certificado-p12--pfx-post-v1tenantscertificates)
   - [3.3 Emitir Factura (`POST /v1/invoices`) — Diccionario Completo](#33-emitir-factura-post-v1invoices--diccionario-completo-del-payload)
   - [3.4 Tablas Oficiales del SRI (Tipos de ID, IVA, Formas de Pago)](#34-tablas-oficiales-del-sri-para-armar-el-payload)
4. [Respuestas del Microservicio y Cómo Renderizar en tu SaaS](#4-respuestas-del-microservicio-y-cómo-renderizar-en-tu-saas)
   - [4.1 Respuesta Síncrona Inmediata (`202 Accepted` en `< 200ms`)](#41-respuesta-síncrona-inmediata-202-accepted-en--200ms)
   - [4.2 Webhook Asíncrono (`POST <webhookUrl>`) — Todos los Escenarios](#42-webhook-asíncrono-post-webhookurl--todos-los-escenarios)
   - [4.3 Consulta de Estado por Clave de Acceso (`GET /v1/invoices/:claveAcceso`)](#43-consulta-de-estado-por-clave-de-acceso-get-v1invoicesclaveacceso)
   - [4.4 Guía para Renderizar el RIDE (PDF), Código de Barras y Estados en UI](#44-guía-para-renderizar-el-ride-pdf-código-de-barras-y-estados-en-ui)
   - [4.5 Catálogo de Errores HTTP y Códigos de Negocio](#45-catálogo-de-errores-http-y-códigos-de-negocio)
5. [Despliegue Local del Microservicio (Docker Compose)](#5-despliegue-local-del-microservicio-docker-compose)

---

## 1. Arquitectura y Flujo de Integración con tu SaaS

```mermaid
sequenceDiagram
    autonumber
    participant SaaS as Tu SaaS (Backend / UI)
    participant API as SRI Invoice Gateway (API)
    participant Queue as BullMQ + Redis (Worker)
    participant SRI as SRI SOAP 1.1 (celcer / cel)

    Note over SaaS,API: Configuración Inicial (1 sola vez por Empresa/RUC)
    SaaS->>API: POST /v1/tenants (name, ruc)
    API-->>SaaS: 201 Created { tenantId, apiKey: "sri_live_..." }
    SaaS->>API: POST /v1/tenants/certificates (Bearer apiKey + archivo .p12 + password)
    API-->>SaaS: 201 Created { certificate: { subject, validFrom, validTo } }

    Note over SaaS,SRI: Emisión de Cada Factura (Asíncrona < 200ms)
    SaaS->>API: POST /v1/invoices (Bearer apiKey + JSON de Factura)
    API-->>SaaS: 202 Accepted { jobId, claveAcceso (49 dígitos), status: "QUEUED" }
    API->>Queue: Encola trabajo en BullMQ

    Queue->>Queue: Descifra .p12 (AES-256-GCM), genera XML v1.1.0 y firma XAdES-BES
    Queue->>SRI: SOAP validarComprobante (RecepcionComprobantesOffline)
    SRI-->>Queue: Estado: RECIBIDA
    Queue->>Queue: Espera 2.5s (y hasta 3 reintentos con backoff si está EN PROCESO)
    Queue->>SRI: SOAP autorizacionComprobante (AutorizacionComprobantesOffline)
    SRI-->>Queue: Estado: AUTORIZADO + numeroAutorizacion + fechaAutorizacion + XML

    Queue->>SaaS: POST <webhookUrl> (Header X-SRI-Gateway-Signature + JSON con authorizedXml)
    SaaS-->>Queue: 200 OK
```

---

## 2. Cómo Configurar tu SaaS para Conectarse al Microservicio

### 2.1 Variables de Entorno que debe tener el Backend de tu SaaS

En el backend de tu SaaS agrega estas dos variables globales:

```env
# URL base donde corre este microservicio
SRI_GATEWAY_BASE_URL="http://localhost:3000/v1"

# Mismo secreto configurado en WEBHOOK_SIGNING_SECRET del microservicio
# Sirve para verificar que los webhooks realmente provienen del Gateway
SRI_WEBHOOK_SECRET="whsec_7e4b9c2d1a8f6e3b5c0d9a2f4e8b1c6d3a7f9e2b4c6d8a1f"
```

### 2.2 Campos que debes guardar en la tabla de `Empresas` / `Organizaciones` de tu SaaS

Si tu SaaS maneja una o varias empresas emisoras (multi-tenant), agrega estos campos en tu tabla de configuración tributaria por empresa:

| Campo en tu SaaS | Tipo | Descripción |
| :--- | :--- | :--- |
| `sriTenantId` | `string (UUID)` | Devuelto por `POST /v1/tenants` al dar de alta la empresa. |
| `sriApiKey` | `string` | Token `sri_live_...` devuelto por `POST /v1/tenants`. Tu SaaS lo enviará en el header `Authorization: Bearer <sriApiKey>`. |
| `sriAmbiente` | `'1' \| '2'` | `'1'` = Pruebas (Certificación SRI), `'2'` = Producción. |
| `sriCertSubject` | `string \| null` | Titular extraído del `.p12` (devuelto por `POST /v1/tenants/certificates`) para mostrarlo en la UI de tu SaaS. |
| `sriCertValidTo` | `DateTime \| null` | Fecha de caducidad de la firma electrónica (para mostrar alertas de vencimiento en tu SaaS). |

### 2.3 Campos que debes guardar en la tabla `Facturas` (`Invoices`) de tu SaaS

| Campo en tu SaaS | Tipo | Cuándo se llena | Para qué sirve al renderizar |
| :--- | :--- | :--- | :--- |
| `sriJobId` | `string (UUID)` | Al recibir `202 Accepted` | Trazabilidad del trabajo en cola. |
| `claveAcceso` | `string (49 dígitos)` | Al recibir `202 Accepted` | **Código de barras (Code128)** y número de autorización. ¡Ya lo tienes desde el primer segundo! |
| `sriStatus` | `string` | `202` (`QUEUED`) -> Webhook (`AUTORIZADO` / `DEVUELTA` / `NO_AUTORIZADO`) | Mostrar el badge de estado en tu listado de facturas. |
| `numeroAutorizacion` | `string \| null` | Al recibir el Webhook | Mostrar en la cabecera del RIDE (PDF). |
| `fechaAutorizacion` | `string / DateTime \| null` | Al recibir el Webhook | Mostrar fecha y hora oficial de autorización en el RIDE (PDF). |
| `authorizedXml` | `text \| null` | Al recibir el Webhook | Descargar el `.xml` autorizado o adjuntarlo por email junto con el PDF. |
| `sriMessages` | `jsonb \| null` | Al recibir el Webhook | Mostrar en un modal/alerta el motivo exacto si el SRI devuelve o rechaza la factura. |

---

## 3. Contrato de API: Qué Debe Enviar tu SaaS

Todas las rutas tienen el prefijo `/v1`. Excepto `POST /v1/tenants`, **todos los endpoints requieren el header**:

```http
Authorization: Bearer sri_live_tu_api_key_del_tenant
```

---

### 3.1 Registrar Empresa / Tenant (`POST /v1/tenants`)

Se llama **una sola vez** cuando registras una nueva empresa emisora (RUC) en tu SaaS.

- **Endpoint**: `POST /v1/tenants`
- **Headers**: `Content-Type: application/json`
- **Body**:

```json
{
  "name": "Importadora Tecnológica del Ecuador S.A.",
  "ruc": "1790011674001"
}
```

- **Respuesta (`201 Created`)**:

```json
{
  "success": true,
  "tenantId": "b6d9f414-8a1c-4d2b-98c1-2f18a91e8901",
  "name": "Importadora Tecnológica del Ecuador S.A.",
  "ruc": "1790011674001",
  "apiKey": "sri_live_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a",
  "warning": "Guarde esta API Key en un lugar seguro. No volverá a mostrarse en texto plano."
}
```

---

### 3.2 Subir Certificado `.p12` / `.pfx` (`POST /v1/tenants/certificates`)

Cuando el usuario sube su firma electrónica desde la pantalla de configuración de tu SaaS, tu backend reenvía el archivo por `multipart/form-data`. El microservicio verifica que la contraseña abra el `.p12`, comprueba que no esté caducado y cifra la contraseña con **AES-256-GCM**.

- **Endpoint**: `POST /v1/tenants/certificates`
- **Headers**:
  - `Authorization: Bearer <sriApiKey>`
  - `Content-Type: multipart/form-data`
- **Campos Form-Data**:
  - `ruc` (`string`, obligatorio): RUC de 13 dígitos del tenant autenticado.
  - `password` (`string`, obligatorio): Contraseña de la firma electrónica `.p12`.
  - `file` (`binary`, obligatorio, máx. 5 MB): Archivo con extensión `.p12` o `.pfx`.

- **Respuesta (`201 Created`)**:

```json
{
  "success": true,
  "tenantId": "b6d9f414-8a1c-4d2b-98c1-2f18a91e8901",
  "ruc": "1790011674001",
  "certificate": {
    "subject": "CN=IMPORTADORA TECNOLOGICA DEL ECUADOR S.A.,C=EC",
    "issuer": "CN=AUTORIDAD DE CERTIFICACION SUBCA-1 SECURITY DATA,O=SECURITY DATA S.A. 1,C=EC",
    "validFrom": "2026-01-15T00:00:00.000Z",
    "validTo": "2028-01-15T00:00:00.000Z",
    "encryptionAlgorithm": "AES-256-GCM"
  }
}
```

> **Tip UI para tu SaaS**: Guarda `certificate.subject` y `certificate.validTo` para renderizar en tu pantalla de ajustes una tarjeta tipo *"Firma Electrónica Activa — Vence el 15/01/2028"*.

---

### 3.3 Emitir Factura (`POST /v1/invoices`) — Diccionario Completo del Payload

Cada vez que tu SaaS crea una factura, envía este JSON a `POST /v1/invoices`:

- **Endpoint**: `POST /v1/invoices`
- **Headers**:
  - `Authorization: Bearer <sriApiKey>`
  - `Content-Type: application/json`

#### Ejemplo Completo del Payload JSON:

```json
{
  "referenceId": "FAC-SAAS-2026-000123",
  "ambiente": "1",
  "webhookUrl": "https://api.tu-saas.com/webhooks/sri",
  "razonSocial": "IMPORTADORA TECNOLOGICA DEL ECUADOR S.A.",
  "nombreComercial": "IMPOTEC ECUADOR",
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
  "direccionComprador": "AV. 9 DE OCTUBRE 400, GUAYAQUIL",
  "totalSinImpuestos": 150.00,
  "totalDescuento": 0.00,
  "propina": 0.00,
  "importeTotal": 165.00,
  "moneda": "DOLAR",
  "pagos": [
    {
      "formaPago": "20",
      "total": 165.00,
      "plazo": "30",
      "unidadTiempo": "dias"
    }
  ],
  "detalles": [
    {
      "codigoPrincipal": "LIC-PRO-01",
      "codigoAuxiliar": "SW-001",
      "descripcion": "Licencia Anual Software Contable Cloud (Gravado 15%)",
      "cantidad": 1,
      "precioUnitario": 100.00,
      "descuento": 0.00,
      "precioTotalSinImpuesto": 100.00,
      "impuestos": [
        {
          "codigo": "2",
          "codigoPorcentaje": "4",
          "tarifa": 15,
          "baseImponible": 100.00,
          "valor": 15.00
        }
      ]
    },
    {
      "codigoPrincipal": "CAP-01",
      "descripcion": "Servicio Capacitación Exento / Tarifa 0%",
      "cantidad": 1,
      "precioUnitario": 50.00,
      "descuento": 0.00,
      "precioTotalSinImpuesto": 50.00,
      "impuestos": [
        {
          "codigo": "2",
          "codigoPorcentaje": "0",
          "tarifa": 0,
          "baseImponible": 50.00,
          "valor": 0.00
        }
      ]
    }
  ],
  "infoAdicional": [
    { "nombre": "Email", "valor": "facturacion@pacifico.com.ec" },
    { "nombre": "Telefono", "valor": "042555666" },
    { "nombre": "OrdenCompra", "valor": "OC-2026-889" }
  ]
}
```

#### Detalle de Todos los Campos del Payload:

| Campo | Tipo | Req. | Reglas y Descripción |
| :--- | :--- | :---: | :--- |
| `referenceId` | `string` | Sí | ID único de la factura en tu SaaS (ej. UUID o `"FAC-00123"`). **Actúa como llave de idempotencia**: si envías el mismo `referenceId` dos veces para el mismo Tenant, devuelve `409 Conflict` para evitar duplicados. |
| `ambiente` | `'1' \| '2'` | Sí | `"1"` = Pruebas (`celcer.sri.gob.ec`), `"2"` = Producción (`cel.sri.gob.ec`). |
| `webhookUrl` | `string (URL)` | Sí | URL `http://` o `https://` de tu SaaS donde este microservicio enviará el `POST` con el resultado final. |
| `razonSocial` | `string` | Sí | Razón social del emisor tal como consta en el RUC. |
| `nombreComercial` | `string` | No | Nombre comercial del emisor (opcional). |
| `ruc` | `string` | Sí | Exactamente **13 dígitos numéricos**. Debe coincidir con el RUC del Tenant autenticado (`403 RUC_MISMATCH` si difiere). |
| `estab` | `string` | Sí | Código de establecimiento de 3 dígitos (ej. `"001"`). Si envías `"1"`, se normaliza a `"001"`. |
| `ptoEmi` | `string` | Sí | Punto de emisión de 3 dígitos (ej. `"001"`). |
| `secuencial` | `string` | Sí | Número secuencial de hasta 9 dígitos (ej. `"000000123"`). Si envías `"123"`, se rellena con ceros a la izquierda a 9 dígitos. |
| `dirMatriz` | `string` | Sí | Dirección de la matriz del emisor. |
| `fechaEmision` | `string` | Sí | Acepta formato `"dd/mm/aaaa"` (ej. `"07/11/2026"`) o ISO `"aaaa-mm-dd"` (`"2026-11-07"`). |
| `dirEstablecimiento` | `string` | Sí | Dirección del establecimiento emisor. |
| `obligadoContabilidad`| `'SI' \| 'NO'` | No | Por defecto `"SI"`. |
| `tipoIdentificacionComprador` | `string` | Sí | Ver tabla 3.4 (`"04"` RUC, `"05"` Cédula, `"06"` Pasaporte, `"07"` Consumidor Final, `"08"` Exterior). |
| `razonSocialComprador`| `string` | Sí | Nombre completo o razón social del cliente comprador (o `"CONSUMIDOR FINAL"` si es `"07"`). |
| `identificacionComprador` | `string` | Sí | RUC, cédula, pasaporte o `"9999999999999"` para Consumidor Final. |
| `direccionComprador` | `string` | No | Dirección del cliente comprador (opcional). |
| `totalSinImpuestos` | `number` | Sí | Suma de `precioTotalSinImpuesto` de todos los detalles ($\ge 0$). |
| `totalDescuento` | `number` | Sí | Suma de todos los descuentos aplicados ($\ge 0$). |
| `propina` | `number` | No | Propina (por defecto `0.00`). |
| `importeTotal` | `number` | Sí | Total final a pagar (`totalSinImpuestos + totalImpuestos + propina`). |
| `moneda` | `string` | No | Por defecto `"DOLAR"`. |
| `pagos` | `Array` | Sí | Al menos una forma de pago: `{ formaPago, total, plazo?, unidadTiempo? }`. |
| `detalles` | `Array` | Sí | Ítems de la factura: `{ codigoPrincipal, codigoAuxiliar?, descripcion, cantidad, precioUnitario, descuento, precioTotalSinImpuesto, impuestos: [...] }`. **Nota**: El microservicio agrupa y calcula automáticamente el bloque `<totalConImpuestos>` del XML sumando los impuestos de cada línea. |
| `infoAdicional` | `Array` | No | Lista opcional de `{ nombre, valor }` (ej. Email, Teléfono, Observaciones). |

---

### 3.4 Tablas Oficiales del SRI para Armar el Payload

#### A. Tipos de Identificación del Comprador (`tipoIdentificacionComprador`)
| Código | Tipo de Identificación | Nota para tu SaaS |
| :---: | :--- | :--- |
| `"04"` | RUC | 13 dígitos |
| `"05"` | Cédula | 10 dígitos |
| `"06"` | Pasaporte | Alfanumérico |
| `"07"` | Venta a Consumidor Final | Usar `identificacionComprador: "9999999999999"` y `razonSocialComprador: "CONSUMIDOR FINAL"` (máx. \$50 según normativa SRI). |
| `"08"` | Identificación del Exterior | Personas o empresas extranjeras |

#### B. Códigos de Impuesto IVA (`detalles[].impuestos[]`)
Para IVA siempre se envía `"codigo": "2"` con los siguientes valores de `codigoPorcentaje` y `tarifa`:

| Tarifa IVA | `codigo` | `codigoPorcentaje` | `tarifa` | Cómo calcular `valor` |
| :--- | :---: | :---: | :---: | :--- |
| **IVA 15%** (Vigente) | `"2"` | `"4"` | `15` | `Number((baseImponible * 0.15).toFixed(2))` |
| **IVA 5%** (Canasta/Construcción) | `"2"` | `"5"` | `5` | `Number((baseImponible * 0.05).toFixed(2))` |
| **IVA 0%** | `"2"` | `"0"` | `0` | `0.00` |
| **No Objeto de Impuesto** | `"2"` | `"6"` | `0` | `0.00` |
| **Exento de IVA** | `"2"` | `"7"` | `0` | `0.00` |

#### C. Códigos de Forma de Pago (`pagos[].formaPago`)
| Código | Descripción Oficial SRI |
| :---: | :--- |
| `"01"` | Sin utilización del sistema financiero (Efectivo) |
| `"16"` | Tarjeta de débito |
| `"19"` | Tarjeta de crédito |
| `"20"` | Otros con utilización del sistema financiero (Transferencia bancaria, cheque, depósito) |

---

## 4. Respuestas del Microservicio y Cómo Renderizar en tu SaaS

### 4.1 Respuesta Síncrona Inmediata (`202 Accepted` en `< 200ms`)

Tan pronto como tu SaaS hace `POST /v1/invoices`, el microservicio calcula en el acto la **Clave de Acceso de 49 dígitos (Módulo 11)** y te devuelve:

```json
{
  "success": true,
  "jobId": "72a1c9d0-15b2-4e3f-9a10-4c8d7e6f5a4b",
  "claveAcceso": "0711202601179001167400110010010000001231234567815",
  "status": "QUEUED"
}
```

**¿Qué debe hacer tu SaaS con esta respuesta inmediata?**
1. Guardar `jobId`, `claveAcceso` y `status: "QUEUED"` en tu base de datos.
2. Mostrar inmediatamente la factura en la interfaz de usuario con el número `001-001-000000123`, su `claveAcceso` de 49 dígitos y un estado visual **"En proceso en el SRI..."** (sin dejar congelada la pantalla del cajero/usuario esperando al SRI).

---

### 4.2 Webhook Asíncrono (`POST <webhookUrl>`) — Todos los Escenarios

Pocos segundos después, cuando el Worker termina de hablar con los webservices SOAP del SRI, realiza un `HTTP POST` hacia el `webhookUrl` que enviaste en la factura.

#### Headers enviados por el Microservicio a tu Webhook:
```http
Content-Type: application/json
X-SRI-Gateway-Event: sri.invoice.completed
X-SRI-Gateway-Signature: sha256=8f3c9b1a2d4e6f8a0b2c4d6e8f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a
```

#### Cómo Verificar la Firma de Seguridad en el Backend de tu SaaS (Node.js / TypeScript):

```ts
import * as crypto from 'node:crypto';

export function verifySriWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

#### Escenario 1: Factura Autorizada Exitosamente (`status: "AUTORIZADO"`)

```json
{
  "event": "sri.invoice.completed",
  "jobId": "72a1c9d0-15b2-4e3f-9a10-4c8d7e6f5a4b",
  "referenceId": "FAC-SAAS-2026-000123",
  "claveAcceso": "0711202601179001167400110010010000001231234567815",
  "ambiente": "1",
  "status": "AUTORIZADO",
  "numeroAutorizacion": "0711202601179001167400110010010000001231234567815",
  "fechaAutorizacion": "2026-11-07T12:55:10-05:00",
  "authorizedXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<autorizacion>\n  <estado>AUTORIZADO</estado>\n  <numeroAutorizacion>0711202601179001167400110010010000001231234567815</numeroAutorizacion>\n  <fechaAutorizacion>2026-11-07T12:55:10-05:00</fechaAutorizacion>\n  <ambiente>PRUEBAS</ambiente>\n  <comprobante><![CDATA[<?xml version=\"1.0\" encoding=\"UTF-8\"?><factura id=\"comprobante\" version=\"1.1.0\">...<ds:Signature>...</ds:Signature></factura>]]></comprobante>\n  <mensajes/>\n</autorizacion>",
  "sriMessages": [],
  "timestamp": "2026-11-07T17:55:11.000Z"
}
```

#### Escenario 2: Factura Devuelta o No Autorizada por el SRI (`status: "DEVUELTA"` o `"NO_AUTORIZADO"`)

Si el SRI rechaza el comprobante (por ejemplo, RUC en clausura, secuencial ya registrado, error de cálculo de impuestos o fecha fuera de rango), el arreglo `sriMessages` incluye el código y explicación exacta del SRI para que tu SaaS lo muestre al usuario:

```json
{
  "event": "sri.invoice.completed",
  "jobId": "72a1c9d0-15b2-4e3f-9a10-4c8d7e6f5a4b",
  "referenceId": "FAC-SAAS-2026-000123",
  "claveAcceso": "0711202601179001167400110010010000001231234567815",
  "ambiente": "1",
  "status": "DEVUELTA",
  "numeroAutorizacion": null,
  "fechaAutorizacion": null,
  "authorizedXml": null,
  "sriMessages": [
    {
      "identificador": "43",
      "mensaje": "CLAVE ACCESO REGISTRADA",
      "informacionAdicional": "La clave de acceso ya se encuentra registrada en la base de datos del SRI.",
      "tipo": "ERROR"
    }
  ],
  "timestamp": "2026-11-07T17:55:11.000Z"
}
```

---

### 4.3 Consulta de Estado por Clave de Acceso (`GET /v1/invoices/:claveAcceso`)

Si tu SaaS tiene un botón de **"Actualizar estado"** o prefiere consultar por polling en lugar de esperar el webhook:

- **Endpoint**: `GET /v1/invoices/0711202601179001167400110010010000001231234567815`
- **Headers**: `Authorization: Bearer <sriApiKey>`
- **Respuesta (`200 OK`)**:

```json
{
  "success": true,
  "jobId": "72a1c9d0-15b2-4e3f-9a10-4c8d7e6f5a4b",
  "referenceId": "FAC-SAAS-2026-000123",
  "claveAcceso": "0711202601179001167400110010010000001231234567815",
  "ambiente": "1",
  "status": "AUTORIZADO",
  "numeroAutorizacion": "0711202601179001167400110010010000001231234567815",
  "fechaAutorizacion": "2026-11-07T17:55:10.000Z",
  "sriMessages": [],
  "authorizedXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<autorizacion>...</autorizacion>",
  "webhookDelivered": true,
  "createdAt": "2026-11-07T17:55:05.000Z",
  "updatedAt": "2026-11-07T17:55:11.000Z"
}
```

---

### 4.4 Guía para Renderizar el RIDE (PDF), Código de Barras y Estados en UI

Con los datos que envías y la respuesta que te entrega el microservicio, tu SaaS tiene **absolutamente todo** lo que exige la Ficha Técnica del SRI para construir el PDF (**RIDE — Representación Impresa de Comprobante Electrónico**) y la vista web:

#### A. Mapeo de Campos para el RIDE (PDF)

| Sección del RIDE (PDF) | Qué valor pintar | Origen del Dato |
| :--- | :--- | :--- |
| **Nro. de Factura** | `${estab}-${ptoEmi}-${secuencial}` (ej. `001-001-000000123`) | Datos de la factura en tu SaaS |
| **Número de Autorización** | `response.numeroAutorizacion` (49 dígitos) | Webhook / `GET /v1/invoices/:claveAcceso` |
| **Fecha y Hora de Autorización** | `response.fechaAutorizacion` (formateado `DD/MM/YYYY HH:mm:ss`) | Webhook / `GET /v1/invoices/:claveAcceso` |
| **Ambiente** | Si `ambiente === "1"` pintar **`PRUEBAS`**; si es `"2"` pintar **`PRODUCCIÓN`** | Webhook / `GET /v1/invoices/:claveAcceso` |
| **Emisión** | Pintar siempre **`NORMAL`** | Esquema Offline del SRI (`tipoEmision = 1`) |
| **Clave de Acceso (Texto)** | `response.claveAcceso` (49 dígitos numéricos) | Disponible desde el `202 Accepted` inicial |
| **Código de Barras** | Generar código de barras formato **`CODE128`** usando los 49 dígitos de `response.claveAcceso` | Librerías recomendadas en tu SaaS: `bwip-js` o `jsbarcode` |
| **Archivo XML Adjunto** | Guardar o adjuntar `response.authorizedXml` como `${claveAcceso}.xml` | Webhook / `GET /v1/invoices/:claveAcceso` |

#### B. Cómo Renderizar los Estados (`status`) en la UI de tu SaaS

| `status` recibido | Color / Badge sugerido en UI | Acción recomendada en el SaaS |
| :--- | :--- | :--- |
| `QUEUED` / `PROCESSING` | 🔵 Azul (`Procesando en SRI...`) | Mostrar spinner o permitir descarga preliminar con `claveAcceso`. |
| `RECIBIDA` / `EN_PROCESO` | 🟡 Amarillo (`En validación SRI`) | El SRI recibió el XML pero está tardando en autorizar. Mostrar botón *"Consultar Estado"* (`GET /v1/invoices/:claveAcceso`). |
| `AUTORIZADO` | 🟢 Verde (`Autorizada`) | Habilitar descarga de **RIDE (PDF)** y **XML Autorizado** (`authorizedXml`) y disparar envío de correo al comprador. |
| `DEVUELTA` / `NO_AUTORIZADO` | 🔴 Rojo (`Rechazada por SRI`) | Mostrar al usuario la lista `sriMessages[]` (`identificador`, `mensaje`, `informacionAdicional`) para que corrija los datos y vuelva a emitir. |
| `FAILED` | 🔴 Rojo (`Error de Firma / Conexión`) | Revisar `sriMessages[0].mensaje` (ej. caída temporal del SRI o problema con el certificado). |

---

### 4.5 Catálogo de Errores HTTP y Códigos de Negocio

Cuando ocurre un error de validación o de negocio al llamar al API, el microservicio devuelve un JSON con código prefijado en `message`:

```json
{
  "message": "RUC_MISMATCH: El RUC del comprobante (0999999999001) no coincide con el RUC del tenant autenticado (1790011674001).",
  "error": "Forbidden",
  "statusCode": 403
}
```

| HTTP Status | Prefijo en `message` | Causa y Solución para el SaaS |
| :---: | :--- | :--- |
| `400` | `CERTIFICATE_NOT_CONFIGURED` | El Tenant intenta emitir una factura sin haber subido antes su archivo `.p12`. Redirigir a configuración de firma. |
| `400` | `INVALID_CERTIFICATE_PASSWORD` | La contraseña enviada no abre el archivo `.p12`/`.pfx`. Pedir al usuario que verifique su clave. |
| `400` | `CERTIFICATE_EXPIRED` | El certificado `.p12` ya caducó. Solicitar al usuario un certificado renovado. |
| `400` | `INVALID_CLAVE_ACCESO` | El parámetro `:claveAcceso` en `GET /v1/invoices/:claveAcceso` no tiene 49 dígitos numéricos. |
| `401` | `MISSING_API_KEY` / `INVALID_API_KEY` | Falta el header `Authorization: Bearer <apiKey>` o la API Key no pertenece a un Tenant activo. |
| `403` | `RUC_MISMATCH` | El `ruc` enviado en el body no coincide con el RUC registrado para ese `apiKey`. |
| `404` | `INVOICE_NOT_FOUND` | No existe una factura con esa `claveAcceso` para el Tenant autenticado. |
| `409` | `TENANT_RUC_EXISTS` | Ya existe un Tenant registrado con ese RUC en `POST /v1/tenants`. |
| `409` | `DUPLICATE_REFERENCE_ID` | Ya se envió previamente una factura con ese mismo `referenceId` para este Tenant. |

---

## 5. Despliegue Local del Microservicio (Docker Compose)

No necesitas crear ninguna base de datos en la nube para desarrollar o probar contra el SRI; el archivo `docker-compose.yml` incluye **PostgreSQL 16** y **Redis 7** preconfigurados:

```bash
# 1. Copiar variables de entorno
cp .env.example .env

# 2. Levantar PostgreSQL (puerto 5435) y Redis (puerto 6379)
docker compose up -d postgres redis

# 3. Instalar dependencias, migrar esquema Prisma y crear Tenant de prueba
pnpm install
pnpm run prisma:generate
pnpm run prisma:migrate
pnpm run prisma:seed

# 4. Iniciar el microservicio en modo desarrollo
pnpm run start:dev
```

- **API Base URL**: `http://localhost:3000/v1`
- **Documentación Interactiva OpenAPI / Swagger**: `http://localhost:3000/docs`
- **Ejecutar Suite de Pruebas Unitarias (Vitest)**: `pnpm test`
