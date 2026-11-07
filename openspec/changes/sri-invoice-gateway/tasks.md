# Tasks: sri-invoice-gateway

## Phase 1: Project Scaffolding, Docker & Prisma Infrastructure
- [x] 1.1 Create `sri-invoice-gateway/package.json`, `tsconfig.json`, `nest-cli.json`, and `.env.example` with NestJS, BullMQ, Prisma, `node-forge`, `@xmldom/xmldom`, `xpath`, `axios`, `class-validator`, and `class-transformer`.
- [x] 1.2 Create `sri-invoice-gateway/prisma/schema.prisma` with `Tenant` and `InvoiceJob` models and `sri-invoice-gateway/prisma/seed.ts`.
- [x] 1.3 Create `sri-invoice-gateway/Dockerfile` and `sri-invoice-gateway/docker-compose.yml` (`api`, `postgres`, `redis`).
- [x] 1.4 Implement `PrismaModule` and `PrismaService` in `sri-invoice-gateway/src/prisma/`.

## Phase 2: Cryptography, PKI & XAdES-BES Engine (`crypto` module)
- [x] 2.1 [TDD] Write unit tests for `AesGcmService` (`aes-gcm.service.spec.ts`) and `P12ParserService` (`p12-parser.service.spec.ts`).
- [x] 2.2 Implement `AesGcmService` in `sri-invoice-gateway/src/modules/crypto/aes-gcm.service.ts` for AES-256-GCM encryption/decryption (`ciphertext`, `iv`, `authTag`).
- [x] 2.3 Implement `P12ParserService` in `sri-invoice-gateway/src/modules/crypto/p12-parser.service.ts` using `node-forge` to extract `KeyBag`/`CertBag`, validate expiration dates, and export DER/Base64 X.509 metadata.
- [x] 2.4 [TDD] Write unit tests for `XadesBesSignerService` (`xades-bes-signer.service.spec.ts`) verifying `<ds:Signature>`, `<etsi:SignedProperties>`, C14N digests, and RSA-SHA1 signature generation.
- [x] 2.5 Implement `XadesBesSignerService` in `sri-invoice-gateway/src/modules/crypto/xades-bes-signer.service.ts` and register `CryptoModule`.

## Phase 3: Multi-Tenancy & Certificate Management (`tenants` module)
- [x] 3.1 Implement `ApiKeyGuard` (`sri-invoice-gateway/src/modules/tenants/guards/api-key.guard.ts`) validating `Authorization: Bearer <API_KEY>` via SHA-256 hash lookup, plus `@CurrentTenant()` decorator.
- [x] 3.2 Implement `TenantsService` and `TenantsController` (`POST /v1/tenants` to provision API keys and `POST /v1/tenants/certificates` via `multipart/form-data` to validate, encrypt password with AES-256-GCM, and store `.p12`).

## Phase 4: Access Key (Modulo 11) & Canonical XML Builder (`invoices` module)
- [x] 4.1 [TDD] Write unit tests for `AccessKeyService` (`access-key.service.spec.ts`) covering 49-digit structure and Modulo 11 edge cases (remainder 0 -> 0, remainder 1 -> 1, 11 - remainder).
- [x] 4.2 Implement `AccessKeyService` in `sri-invoice-gateway/src/modules/invoices/services/access-key.service.ts`.
- [x] 4.3 [TDD] Write unit tests for `XmlBuilderService` (`xml-builder.service.spec.ts`) verifying `<factura id="comprobante" version="1.1.0">`, IVA 15% (code 2, percentage 4), 0%, exempt, not subject, `<detalles>`, and `<infoAdicional>`.
- [x] 4.4 Implement `XmlBuilderService` in `sri-invoice-gateway/src/modules/invoices/services/xml-builder.service.ts`.
- [x] 4.5 Implement strict NestJS DTOs (`create-invoice.dto.ts`), `InvoicesService`, and `InvoicesController` (`POST /v1/invoices` returning HTTP 202 in <200ms, plus `GET /v1/invoices/:claveAcceso`).

## Phase 5: Direct SRI SOAP 1.1 Client (`sri-soap` module)
- [x] 5.1 [TDD] Write unit tests for `SriSoapClientService` (`sri-soap-client.service.spec.ts`) testing SOAP 1.1 envelope construction and XML response parsing for `RECIBIDA`, `DEVUELTA`, `AUTORIZADO`, `NO AUTORIZADO`, and `EN PROCESO`.
- [x] 5.2 Implement `SriSoapClientService` in `sri-invoice-gateway/src/modules/sri-soap/sri-soap-client.service.ts` supporting Test (`1`) and Production (`2`) SRI endpoints.

## Phase 6: Asynchronous Queue Worker & Webhook Dispatcher (`queue` & `webhook` modules)
- [x] 6.1 Implement `WebhookService` in `sri-invoice-gateway/src/modules/webhook/webhook.service.ts` to dispatch HTTP POST notifications with final authorization status, XML, and SRI messages.
- [x] 6.2 Implement `InvoiceQueueConsumer` in `sri-invoice-gateway/src/modules/queue/invoice-queue.consumer.ts` orchestrating decryption, XML generation, XAdES-BES signing, SRI Reception, 2-3s delay, SRI Authorization with exponential backoff (up to 3 retries for `EN PROCESO`), and Webhook delivery.
- [x] 6.3 Wire all modules in `AppModule` (`sri-invoice-gateway/src/app.module.ts`) and configure `main.ts`.

## Phase 7: Verification & Documentation
- [x] 7.1 Install dependencies, generate Prisma Client, run TypeScript build and unit test suite (`AccessKeyService`, `XmlBuilderService`, `XadesBesSignerService`, `SriSoapClientService`, `AesGcmService`).
- [x] 7.2 Create comprehensive `sri-invoice-gateway/README.md` with architecture overview, local setup, Docker Compose instructions, Prisma migrations, and step-by-step cURL/Postman testing guide.

