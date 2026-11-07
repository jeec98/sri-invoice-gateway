# Exploration: SRI Invoice Gateway Microservice

## Context & Objectives
- **Project Name**: `sri-invoice-gateway`
- **Goal**: Create a production-ready, asynchronous, multi-tenant microservice in NestJS/TypeScript to handle digital signing (XAdES-BES) and SRI (Ecuador) authorization of electronic invoices.
- **Scope Classification**: **Backend Only** (Microservice REST + Background Workers + SOAP SRI Clients).

## Architectural Investigation & Findings

### 1. Multi-Tenancy & Security
- **Authentication**: API Keys provided via `Authorization: Bearer <API_KEY>`. Stored only as SHA-256 hashes in database (`Tenant.apiKeyHash`).
- **Certificate Handling**: Endpoints receive PKCS#12 (`.p12` / `.pfx`) binary files and private key passwords.
- **Symmetric Encryption**: Passwords must be encrypted using AES-256-GCM (`ciphertext`, `iv`, `authTag`), utilizing an application-level master encryption secret (`ENCRYPTION_KEY`).
- **Certificate Storage**: Stored as protected binaries (filesystem or base64 byte storage) with validation of expiry dates and passphrase correctness using `node-forge` before persistence.

### 2. SRI Electronic Invoice Specifications
- **Clave de Acceso (49 Digits)**:
  - Format: `[ddmmaaaa(8)][tipoComprobante:01(2)][ruc(13)][ambiente:1|2(1)][serie:estab+ptoEmi(6)][secuencial(9)][codigoNumerico(8)][tipoEmision:1(1)][digitoVerificador(1)]`
  - Check Digit: Modulo 11 with weights 2..7 cyclic right-to-left. Modulo 11 remainder rule: `rem == 0 -> 0`, `rem == 1 -> 1`, else `11 - rem`.
- **XML Structure**: Official SRI `<factura id="comprobante" version="1.1.0">`:
  - `<infoTributaria>`
  - `<infoFactura>` (supporting current IVA rate 15% code 2 percentage 4, 0%, exempt, not subject to VAT)
  - `<detalles>` and itemized `<impuestos>`
  - `<infoAdicional>` for SaaS custom metadata

### 3. Cryptography & XAdES-BES Digital Signature Engine
- Pure Node.js implementation without external heavy binaries (Java or C# wrappers), using:
  - `node-forge` for PKCS#12 decoding, cert parsing, RSA signing.
  - `@xmldom/xmldom` & `xpath` for XML DOM manipulation and node references.
  - XML Canonicalization (C14N: `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`).
  - Strict SRI XAdES-BES compliance:
    - Root signature `<ds:Signature Id="Signature...">`
    - Document reference `URI="#comprobante"` with SHA-1 digest
    - Object `<etsi:QualifyingProperties Target="#Signature...">` -> `<etsi:SignedProperties Id="SignedProperties...">` with `<etsi:SigningTime>` and `<etsi:SigningCertificate>`
    - Reference to `SignedProperties` within `<ds:SignedInfo>`
    - RSA-SHA1 `<ds:SignatureValue>`
    - `<ds:KeyInfo>` containing DER X.509 Base64 certificate

### 4. SOAP SRI Offline Web Services
- Direct HTTP POST with SOAP 1.1 envelopes without heavy WSDL libraries.
- **Environments**:
  - Test (1): `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/...`
  - Production (2): `https://cel.sri.gob.ec/comprobantes-electronicos-ws/...`
- **Operations**:
  - `RecepcionComprobantesOffline` (`validarComprobante`): Sends base64-encoded signed XML. Evaluates `RECIBIDA` vs `DEVUELTA`.
  - `AutorizacionComprobantesOffline` (`autorizacionComprobante`): Queries by `claveAcceso`. Evaluates `AUTORIZADO`, `NO AUTORIZADO`, or `EN PROCESO`.

### 5. Asynchronous Queue & Webhook Lifecycle
- Ingestion endpoint `POST /v1/invoices` validates payload via DTOs, generates `claveAcceso`, creates database record in status `QUEUED`, enqueues BullMQ job, and responds with HTTP 202 (`<200ms`).
- BullMQ worker processes job:
  1. Decrypts certificate and key.
  2. Generates canonical XML.
  3. Signs XML via XAdES-BES.
  4. Dispatches to SRI Reception.
  5. If `RECIBIDA`, waits 2-3s delay and queries Authorization (retrying with exponential backoff if `EN PROCESO`).
  6. Dispatches webhook notification with payload and authorization metadata.

## Decision Points & Alternatives

| Decision Point | Option A (Recommended) | Option B |
|---|---|---|
| **Location in Workspace** | Autonomous subfolder `./sri-invoice-gateway` within repo, ready to run standalone or as separate repo. | In-place in repository root (overwriting saas-api). |
| **ORM / Data Access** | **Prisma ORM** with PostgreSQL as requested by user. | TypeORM or Knex/Drizzle. |
| **Execution Flow** | Fast-forward to `sdd-spec` and `sdd-design` then `sdd-tasks` and `sdd-apply`. | Step-by-step interactive approvals per phase. |

