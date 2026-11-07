# SRI Invoice Gateway (`sri-invoice-gateway`)

Microservicio Multi-Tenant listo para producción desarrollado en **Node.js / TypeScript / NestJS** para delegar la generación de **Clave de Acceso (Módulo 11)**, construcción de **XML v1.1.0**, **Firma Electrónica XAdES-BES** nativa y tramitación 100% asíncrona (Recepción + Autorización SOAP 1.1) ante el **Servicio de Rentas Internas (SRI) de Ecuador**.

---

## Arquitectura y Stack Tecnológico

- **Framework**: NestJS 11 con TypeScript estricto y validación por DTOs (`class-validator` / `class-transformer`).
- **Procesamiento Asíncrono**: **BullMQ** respaldado por **Redis** (respuesta en `POST /v1/invoices` `< 200ms` con `HTTP 202 Accepted`).
- **Criptografía PKI y Firma XAdES-BES**:
  - `node-forge` para apertura y validación de contenedores PKCS#12 (`.p12` / `.pfx`).
  - `node:crypto` con **AES-256-GCM** (`ciphertext`, `iv`, `authTag`) para cifrar las contraseñas de los certificados.
  - `@xmldom/xmldom` y `xpath` para Canonicalización **C14N** (`http://www.w3.org/TR/2001/REC-xml-c14n-20010315`), digests **SHA-1** (`#comprobante`, `#SignedProperties`, `#Certificate`) y firma **RSA-SHA1**.
- **Cliente SOAP 1.1 Directo**: Peticiones HTTP POST con Envelopes XML SOAP 1.1 ligeros vía `axios` (sin librerías WSDL pesadas) hacia los ambientes de Pruebas (`celcer.sri.gob.ec`) y Producción (`cel.sri.gob.ec`).
- **Base de Datos**: **PostgreSQL 16** con **Prisma ORM** (`Tenant`, `InvoiceJob`).

---

## Estructura de Módulos

```text
sri-invoice-gateway/
├── prisma/
│   ├── schema.prisma                         # Modelos Tenant e InvoiceJob
│   └── seed.ts                               # Seed de Tenant demo y API Key
├── src/
│   ├── main.ts                               # Bootstrap NestJS + Swagger (/docs) + Global ValidationPipe
│   ├── app.module.ts                         # Orquestación de Config, BullMQ, Prisma y Módulos
│   ├── prisma/                               # PrismaModule & PrismaService
│   └── modules/
│       ├── crypto/
│       │   ├── aes-gcm.service.ts            # Cifrado simétrico AES-256-GCM (ciphertext, iv, authTag)
│       │   ├── p12-parser.service.ts         # Extracción de KeyBag/CertBag y validación de vigencia
│       │   └── xades-bes-signer.service.ts   # Motor de firma electrónica XAdES-BES C14N del SRI
│       ├── tenants/
│       │   ├── guards/api-key.guard.ts       # Autenticación Bearer <API_KEY> validada con SHA-256
│       │   ├── tenants.controller.ts         # POST /v1/tenants y POST /v1/tenants/certificates
│       │   └── tenants.service.ts            # Almacenamiento seguro de .p12 y credenciales
│       ├── invoices/
│       │   ├── services/access-key.service.ts # Clave de Acceso (49 dígitos) y Algoritmo Módulo 11
│       │   ├── services/xml-builder.service.ts# Generador XML <factura id="comprobante" version="1.1.0">
│       │   ├── dto/create-invoice.dto.ts     # DTOs estrictos (IVA 15%, 0%, Exento, No Objeto, Pagos)
│       │   ├── invoices.controller.ts        # POST /v1/invoices (HTTP 202) y GET /v1/invoices/:claveAcceso
│       │   └── invoices.service.ts           # Encolamiento rápido en BullMQ
│       ├── sri-soap/
│       │   └── sri-soap-client.service.ts    # Envelopes SOAP 1.1 (validarComprobante / autorizacionComprobante)
│       ├── queue/
│       │   └── invoice-queue.consumer.ts     # Worker BullMQ con backoff exponencial y despacho Webhook
│       └── webhook/
│           └── webhook.service.ts            # Notificador HTTP POST con firma HMAC-SHA256
├── Dockerfile
└── docker-compose.yml
```

---

## Guía Paso a Paso: Levantar el Entorno

### Opción A: Levantar todo con Docker Compose (Recomendado)

```bash
cd sri-invoice-gateway

# 1. Copiar variables de entorno
cp .env.example .env

# 2. Construir y levantar PostgreSQL, Redis y el API
docker compose up -d --build

# 3. Ejecutar el seed para crear un Tenant de prueba y obtener su API Key
docker compose exec api npx tsx prisma/seed.ts
```

### Opción B: Desarrollo Local (Node.js + Docker para DB/Redis)

```bash
cd sri-invoice-gateway

# 1. Levantar únicamente PostgreSQL y Redis en Docker
docker compose up -d postgres redis

# 2. Instalar dependencias
npm install

# 3. Copiar archivo .env
cp .env.example .env

# 4. Generar cliente Prisma y ejecutar migraciones en PostgreSQL
npx prisma generate
npx prisma migrate dev --name init

# 5. Ejecutar seed inicial (crea Tenant con RUC 1790011674001 y muestra la API_KEY)
npm run prisma:seed

# 6. Iniciar el microservicio en modo desarrollo
npm run start:dev
```

- **API Base URL**: `http://localhost:3000/v1`
- **Documentación Interactiva Swagger**: `http://localhost:3000/docs`

---

## Pruebas del Flujo Completo con cURL / Postman

### Paso 1: Crear un Nuevo Tenant (Opcional si no usaste el Seed)

```bash
curl -X POST http://localhost:3000/v1/tenants \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mi SaaS Facturación Ecuador S.A.",
    "ruc": "1790011674001"
  }'
```

**Respuesta (`201 Created`)**:
```json
{
  "success": true,
  "tenantId": "b6d9f414-8a1c-4d2b-98c1-2f18a91e8901",
  "name": "Mi SaaS Facturación Ecuador S.A.",
  "ruc": "1790011674001",
  "apiKey": "sri_live_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a",
  "warning": "Guarde esta API Key en un lugar seguro. No volverá a mostrarse en texto plano."
}
```

---

### Paso 2: Cargar el Certificado Electrónico (`.p12` / `.pfx`)

El microservicio valida que la clave abra el archivo `.p12` y que el certificado esté vigente antes de cifrar la contraseña con **AES-256-GCM** y almacenarlo:

```bash
curl -X POST http://localhost:3000/v1/tenants/certificates \
  -H "Authorization: Bearer sri_live_demo_tenant_api_key_2026" \
  -F "ruc=1790011674001" \
  -F "password=TuClaveDelCertificadoP12" \
  -F "file=@/ruta/a/tu/firma_electronica.p12"
```

**Respuesta (`201 Created`)**:
```json
{
  "success": true,
  "tenantId": "b6d9f414-8a1c-4d2b-98c1-2f18a91e8901",
  "ruc": "1790011674001",
  "certificate": {
    "subject": "CN=EMPRESA DEMO SAAS ECUADOR S.A.,C=EC",
    "issuer": "CN=AUTORIDAD DE CERTIFICACION SUBCA-1 SECURITY DATA,O=SECURITY DATA S.A. 1,C=EC",
    "validFrom": "2026-01-01T00:00:00.000Z",
    "validTo": "2028-01-01T00:00:00.000Z",
    "encryptionAlgorithm": "AES-256-GCM"
  }
}
```

---

### Paso 3: Emitir y Encolar una Factura (`POST /v1/invoices`)

Genera inmediatamente la **Clave de Acceso de 49 dígitos (Módulo 11)**, encola el trabajo en **BullMQ** y responde en `< 200ms` con **HTTP 202 Accepted**:

```bash
curl -X POST http://localhost:3000/v1/invoices \
  -H "Authorization: Bearer sri_live_demo_tenant_api_key_2026" \
  -H "Content-Type: application/json" \
  -d '{
    "referenceId": "FAC-SAAS-2026-000123",
    "ambiente": "1",
    "webhookUrl": "https://webhook.site/tu-uuid-de-prueba",
    "razonSocial": "EMPRESA DEMO SAAS ECUADOR S.A.",
    "nombreComercial": "DEMO SAAS",
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
    "totalSinImpuestos": 100.00,
    "totalDescuento": 0.00,
    "propina": 0.00,
    "importeTotal": 115.00,
    "moneda": "DOLAR",
    "pagos": [
      {
        "formaPago": "20",
        "total": 115.00,
        "plazo": "30",
        "unidadTiempo": "dias"
      }
    ],
    "detalles": [
      {
        "codigoPrincipal": "LIC-CLOUD-01",
        "descripcion": "Suscripción Anual Plataforma ERP Cloud",
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
      }
    ],
    "infoAdicional": [
      { "nombre": "Email", "valor": "facturacion@pacifico.com.ec" },
      { "nombre": "Telefono", "valor": "042555666" }
    ]
  }'
```

**Respuesta Inmediata (`202 Accepted`)**:
```json
{
  "success": true,
  "jobId": "72a1c9d0-15b2-4e3f-9a10-4c8d7e6f5a4b",
  "claveAcceso": "0711202601179001167400110010010000001231234567815",
  "status": "QUEUED"
}
```

---

### Paso 4: Recepción del Webhook Asíncrono en el SaaS

Una vez que el Worker de BullMQ firma el XML con **XAdES-BES**, lo envía a `RecepcionComprobantesOffline` (`validarComprobante`), espera de 2 a 3 segundos y consulta `AutorizacionComprobantesOffline` (`autorizacionComprobante`), dispara un `HTTP POST` hacia el `webhookUrl` con firma HMAC en el header `X-SRI-Gateway-Signature`:

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
  "authorizedXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<autorizacion>...</autorizacion>",
  "sriMessages": [],
  "timestamp": "2026-11-07T17:55:11.000Z"
}
```

También puedes consultar el estado en cualquier momento vía `GET`:

```bash
curl -X GET http://localhost:3000/v1/invoices/0711202601179001167400110010010000001231234567815 \
  -H "Authorization: Bearer sri_live_demo_tenant_api_key_2026"
```

---

## Ejecución de Pruebas Unitarias (Vitest)

La suite de pruebas verifica:
- Cifrado y descifrado **AES-256-GCM** y detección de alteraciones (`authTag`).
- Apertura de `.p12`, rechazo de contraseñas erróneas y certificados caducados.
- Cálculo exacto de **Clave de Acceso (49 dígitos)** y **Módulo 11** (residuos 0, 1 y `11 - residuo`).
- Generación canónica de XML SRI `v1.1.0` (IVA 15%, 0%, `infoAdicional`).
- Firma digital **XAdES-BES** (`<ds:Signature>`, `<etsi:SignedProperties>`, C14N y RSA-SHA1).
- Construcción y parseo de respuestas SOAP 1.1 (`RECIBIDA`, `DEVUELTA`, `AUTORIZADO`).

```bash
npm test
```

