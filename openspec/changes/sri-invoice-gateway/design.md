# Design: sri-invoice-gateway

## Technical Approach
El microservicio `sri-invoice-gateway` se construirá en el subdirectorio `sri-invoice-gateway/` utilizando **NestJS (TypeScript estricto)** bajo una arquitectura modular orientada a dominios técnicos:
- **Persistencia**: PostgreSQL gestionado con **Prisma ORM** (`Tenant`, `InvoiceJob`).
- **Cola Asíncrona**: **BullMQ** sobre **Redis** (`@nestjs/bullmq`) para desacoplar la recepción HTTP (`<200ms`) del procesamiento criptográfico y las llamadas de red SOAP al SRI.
- **Seguridad y PKI**: Cifrado simétrico **AES-256-GCM** nativo (`node:crypto`) para proteger las contraseñas de los archivos `.p12`, y **`node-forge` + `@xmldom/xmldom` + `xpath`** para la firma **XAdES-BES** en memoria sin escribir claves privadas desencriptadas en disco.

---

## Architecture Decisions

### Decision 1: Aislamiento en `./sri-invoice-gateway`
- **Choice**: Directorio autónomo `sri-invoice-gateway/` con su propio `package.json`, `tsconfig.json`, `prisma/schema.prisma`, `Dockerfile` y `docker-compose.yml`.
- **Alternatives considered**: Mezclar dependencias de Prisma/BullMQ dentro del `package.json` de `saas-api`.
- **Rationale**: Garantiza que `sri-invoice-gateway` sea un microservicio 100% independiente, desplegable en su propio contenedor y consumible por cualquier SaaS externo sin acoplarse al monolito contable.

### Decision 2: Almacenamiento de Certificados `.p12`
- **Choice**: Almacenar el binario `.p12` cifrado o en columna `Bytes` (`p12Data`) en PostgreSQL junto con soporte opcional de almacenamiento en volumen local protegido (`certs/`), mientras que la contraseña se cifra con **AES-256-GCM** (`passwordCiphertext`, `passwordIv`, `passwordAuthTag`) usando una llave maestra de 32 bytes (`MASTER_ENCRYPTION_KEY`).
- **Alternatives considered**: Guardar el `.p12` únicamente en el sistema de archivos local del contenedor.
- **Rationale**: En arquitecturas con contenedores efímeros o múltiples réplicas del worker BullMQ, tener el `.p12` disponible desde la base de datos (o volumen compartido) permite que cualquier instancia del worker firme sin problemas de afinidad de disco. Soportaremos almacenamiento en DB (`Bytes`) y respaldo en disco seguro.

### Decision 3: Implementación Nativa de Firma XAdES-BES SRI
- **Choice**: Motor propio en TypeScript (`XadesBesSignerService`) usando `node-forge` para extraer `KeyBag` y `CertBag`, calcular digests SHA-1 y firmar con RSA-SHA1 sobre fragmentos XML canonicalizados (C14N).
- **Alternatives considered**: Invocar un binario externo en Java (`sri-xades-signer.jar`).
- **Rationale**: Evita instalar JVM en el contenedor Docker, reduce la huella de memoria de ~500MB a ~80MB y mantiene todo el stack 100% en Node.js/TypeScript.

### Decision 4: Cliente SOAP 1.1 Directo con Axios
- **Choice**: Construcción de plantillas XML SOAP 1.1 explícitas y envío con `axios` (con timeouts estrictos) y parseo de respuestas con `@xmldom/xmldom` y `xpath`.
- **Alternatives considered**: Librería `soap` (node-soap) con descarga dinámica de WSDL.
- **Rationale**: Los servidores del SRI frecuentemente presentan latencia al servir los archivos `?wsdl`. Enviar el Envelope SOAP 1.1 directo elimina el overhead del handshake WSDL y duplica la velocidad de respuesta.

---

## Data Flow

```text
[SaaS Externo]
      │
      ├── 1. POST /v1/tenants/certificates (Bearer API_KEY, multipart .p12 + password)
      │         └──> Valida vigencia (.p12) con node-forge
      │         └──> Cifra password con AES-256-GCM (ciphertext, iv, authTag)
      │         └──> Guarda en PostgreSQL (Tenant)
      │
      └── 2. POST /v1/invoices (Bearer API_KEY, JSON Factura + webhookUrl)
                ├──> Calcula Clave de Acceso (49 dígitos, Módulo 11)
                ├──> Crea registro InvoiceJob (status: QUEUED) en PostgreSQL
                ├──> Encola Job en Redis (BullMQ: "sri-invoices")
                └──> Responde HTTP 202 Accepted (<200ms)
                          │
                          ▼
               [BullMQ Worker: InvoiceQueueConsumer]
                          │
                          ├── 3. Desencripta password (.p12) con AES-256-GCM
                          ├── 4. Genera XML Factura v1.1.0 (XmlBuilderService)
                          ├── 5. Firma XML con XAdES-BES (XadesBesSignerService)
                          ├── 6. Envía SOAP validarComprobante (SRI Recepción)
                          │        ├── Si DEVUELTA -> Guarda errores y dispara Webhook
                          │        └── Si RECIBIDA -> Espera 2.5s
                          ├── 7. Consulta SOAP autorizacionComprobante (SRI Autorización)
                          │        ├── Si EN PROCESO -> Reintenta con Backoff Exponencial (hasta 3 intentos)
                          │        ├── Si AUTORIZADO -> Extrae XML <autorizacion>, guarda en DB
                          │        └── Si NO AUTORIZADO -> Extrae mensajes de error SRI, guarda en DB
                          └── 8. POST Webhook (WebhookService) -> [SaaS Externo webhookUrl]
```

---

## Prisma Schema Design (`prisma/schema.prisma`)

```prisma
model Tenant {
  id                  String       @id @default(uuid())
  name                String
  ruc                 String       @unique @db.VarChar(13)
  apiKeyHash          String       @unique @map("api_key_hash") @db.VarChar(64)
  p12Binary           Bytes?       @map("p12_binary")
  p12FilePath         String?      @map("p12_file_path")
  passwordCiphertext  String?      @map("password_ciphertext")
  passwordIv          String?      @map("password_iv")
  passwordAuthTag     String?      @map("password_auth_tag")
  certValidFrom       DateTime?    @map("cert_valid_from")
  certValidTo         DateTime?    @map("cert_valid_to")
  certSubject         String?      @map("cert_subject")
  isActive            Boolean      @default(true) @map("is_active")
  createdAt           DateTime     @default(now()) @map("created_at")
  updatedAt           DateTime     @updatedAt @map("updated_at")
  invoiceJobs         InvoiceJob[]

  @@map("tenants")
}

model InvoiceJob {
  id                  String   @id @default(uuid())
  tenantId            String   @map("tenant_id")
  tenant              Tenant   @relation(fields: [tenantId], references: [id])
  referenceId         String   @map("reference_id")
  claveAcceso         String   @unique @map("clave_acceso") @db.VarChar(49)
  ambiente            String   @db.VarChar(1) // "1" Pruebas, "2" Produccion
  status              String   @default("QUEUED") // QUEUED, PROCESSING, RECIBIDA, DEVUELTA, EN_PROCESO, AUTORIZADO, NO_AUTORIZADO, FAILED
  webhookUrl          String   @map("webhook_url")
  payloadJson         Json     @map("payload_json")
  unsignedXml         String?  @map("unsigned_xml") @db.Text
  signedXml           String?  @map("signed_xml") @db.Text
  authorizedXml       String?  @map("authorized_xml") @db.Text
  numeroAutorizacion  String?  @map("numero_autorizacion")
  fechaAutorizacion   DateTime? @map("fecha_autorizacion")
  sriMessages         Json?    @map("sri_messages")
  webhookDelivered    Boolean  @default(false) @map("webhook_delivered")
  attempts            Int      @default(0)
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  @@index([tenantId, referenceId])
  @@map("invoice_jobs")
}
```

---

## File Structure (`sri-invoice-gateway/`)

| File | Action | Description |
|------|--------|-------------|
| `sri-invoice-gateway/package.json` | Create | Dependencias NestJS, BullMQ, Prisma, node-forge, @xmldom/xmldom, xpath, axios |
| `sri-invoice-gateway/tsconfig.json` | Create | Configuración TypeScript estricta |
| `sri-invoice-gateway/docker-compose.yml` | Create | Servicios `api`, `postgres`, `redis` |
| `sri-invoice-gateway/Dockerfile` | Create | Contenedor multi-stage para producción |
| `sri-invoice-gateway/.env.example` | Create | Variables de entorno de ejemplo |
| `sri-invoice-gateway/prisma/schema.prisma` | Create | Esquema de base de datos (`Tenant`, `InvoiceJob`) |
| `sri-invoice-gateway/prisma/seed.ts` | Create | Seed inicial para crear un Tenant de prueba y mostrar su API Key |
| `sri-invoice-gateway/src/main.ts` | Create | Bootstrap NestJS con `ValidationPipe` global y prefijo `/v1` |
| `sri-invoice-gateway/src/app.module.ts` | Create | Módulo raíz integrando Config, Prisma, BullMQ y módulos de negocio |
| `sri-invoice-gateway/src/prisma/prisma.module.ts` | Create | Módulo global Prisma |
| `sri-invoice-gateway/src/prisma/prisma.service.ts` | Create | Servicio de conexión PrismaClient |
| `sri-invoice-gateway/src/modules/crypto/aes-gcm.service.ts` | Create | Cifrado y descifrado AES-256-GCM (`ciphertext`, `iv`, `authTag`) |
| `sri-invoice-gateway/src/modules/crypto/p12-parser.service.ts` | Create | Apertura de `.p12` con `node-forge`, extracción de clave privada, cert X.509 y validación de vigencia |
| `sri-invoice-gateway/src/modules/crypto/xades-bes-signer.service.ts` | Create | Motor de firma electrónica XAdES-BES C14N compatible con SRI |
| `sri-invoice-gateway/src/modules/crypto/crypto.module.ts` | Create | Módulo criptográfico |
| `sri-invoice-gateway/src/modules/tenants/guards/api-key.guard.ts` | Create | Guard de autenticación `Authorization: Bearer <API_KEY>` por hash SHA-256 |
| `sri-invoice-gateway/src/modules/tenants/decorators/current-tenant.decorator.ts` | Create | Decorador para obtener el `Tenant` autenticado |
| `sri-invoice-gateway/src/modules/tenants/dto/upload-certificate.dto.ts` | Create | DTO para `POST /v1/tenants/certificates` y creación de tenants |
| `sri-invoice-gateway/src/modules/tenants/tenants.service.ts` | Create | Lógica de registro de tenants y carga/validación de certificados `.p12` |
| `sri-invoice-gateway/src/modules/tenants/tenants.controller.ts` | Create | Endpoints `/v1/tenants` y `/v1/tenants/certificates` |
| `sri-invoice-gateway/src/modules/tenants/tenants.module.ts` | Create | Módulo de tenants |
| `sri-invoice-gateway/src/modules/invoices/services/access-key.service.ts` | Create | Generador de clave de acceso de 49 dígitos y algoritmo Módulo 11 |
| `sri-invoice-gateway/src/modules/invoices/services/xml-builder.service.ts` | Create | Constructor canónico de XML `<factura id="comprobante" version="1.1.0">` |
| `sri-invoice-gateway/src/modules/invoices/dto/create-invoice.dto.ts` | Create | DTOs validados con `class-validator` para todo el payload de factura SRI |
| `sri-invoice-gateway/src/modules/invoices/invoices.service.ts` | Create | Orquestador síncrono de creación de job y consulta de estado |
| `sri-invoice-gateway/src/modules/invoices/invoices.controller.ts` | Create | Endpoint `POST /v1/invoices` (HTTP 202) y `GET /v1/invoices/:claveAcceso` |
| `sri-invoice-gateway/src/modules/invoices/invoices.module.ts` | Create | Módulo de facturas |
| `sri-invoice-gateway/src/modules/sri-soap/sri-soap-client.service.ts` | Create | Cliente SOAP 1.1 directo para Recepción y Autorización Offline del SRI |
| `sri-invoice-gateway/src/modules/sri-soap/sri-soap.module.ts` | Create | Módulo SOAP SRI |
| `sri-invoice-gateway/src/modules/webhook/webhook.service.ts` | Create | Despachador de Webhooks HTTP POST con firma HMAC opcional y manejo de errores |
| `sri-invoice-gateway/src/modules/webhook/webhook.module.ts` | Create | Módulo Webhook |
| `sri-invoice-gateway/src/modules/queue/invoice-queue.consumer.ts` | Create | Worker BullMQ con flujo completo y reintentos backoff exponencial |
| `sri-invoice-gateway/src/modules/queue/queue.module.ts` | Create | Módulo de colas BullMQ |
| `sri-invoice-gateway/README.md` | Create | Guía completa de instalación, migraciones y pruebas cURL/Postman |

