# Proposal: sri-invoice-gateway (Microservicio de Facturación Electrónica SRI Ecuador)

## Intent
Proveer un microservicio desacoplado, modular, de alta disponibilidad y listo para producción (`sri-invoice-gateway`) que permita a sistemas SaaS emitir facturas electrónicas ecuatorianas cumpliendo la ficha técnica y requerimientos vigentes del SRI (Servicio de Rentas Internas de Ecuador).

El microservicio asume la responsabilidad completa de:
1. Gestión de tenants y certificados digitales PKCS#12 (`.p12`/`.pfx`) con almacenamiento y cifrado AES-256-GCM.
2. Cálculo de Clave de Acceso oficial (49 dígitos) con algoritmo Módulo 11 exacto.
3. Construcción del XML canónico SRI v1.1.0 para facturas con desglose de impuestos (incluyendo IVA 15%).
4. Firma digital XAdES-BES nativa en Node.js/TypeScript sin dependencias externas pesadas.
5. Comunicación directa SOAP 1.1 con los web services offline del SRI (Recepción y Autorización) para ambientes de Pruebas y Producción.
6. Procesamiento asíncrono no bloqueante vía BullMQ / Redis con respuesta inmediata (<200ms) y notificación final vía Webhooks.

## Scope

### In Scope
- **NestJS Modular Architecture**: Estructura modular limpia (`tenants`, `invoices`, `sri-soap`, `crypto`, `queue`, `webhook`).
- **Prisma ORM**: Modelos `Tenant` e `InvoiceJob` con migraciones automáticas.
- **Seguridad**:
  - Autenticación por `Authorization: Bearer <API_KEY>` con validación contra hash SHA-256 en base de datos.
  - Endpoint `POST /v1/tenants/certificates` para carga y validación de certificados `.p12`.
  - Cifrado AES-256-GCM para llaves y contraseñas.
- **Generación de Clave de Acceso**:
  - `AccessKeyService` con formato de 49 dígitos y Módulo 11 cíclico (factores 2 a 7).
- **Generación de XML Factura**:
  - `XmlBuilderService` con formato UTF-8 para `<factura id="comprobante" version="1.1.0">`.
  - Soporte de IVA 15% (código 2, porcentaje 4), 0%, exento y no objeto.
- **Motor de Firma XAdES-BES**:
  - `XadesBesSignerService` con `node-forge`, `@xmldom/xmldom` y `xpath`.
  - Canonicalización C14N y digest SHA-1 para comprobante y SignedProperties.
- **Cliente SOAP SRI**:
  - `SriSoapClientService` enviando payloads SOAP 1.1 a `RecepcionComprobantesOffline` y `AutorizacionComprobantesOffline`.
- **Procesamiento Asíncrono & Webhooks**:
  - Endpoint `POST /v1/invoices` con respuesta 202 Accepted inmediata.
  - BullMQ Worker con reintentos con backoff para estado `EN PROCESO`.
  - Despacho de Webhook a la URL configurada por el SaaS.
- **Despliegue & DevOps**:
  - `docker-compose.yml` orquestando `api`, `postgres` y `redis`.
  - `Dockerfile` multi-stage optimizado para NestJS.
  - `README.md` con manual paso a paso y ejemplos de cURL.

### Out of Scope
- Interfaz gráfica / UI (microservicio 100% headless API REST).
- Otros tipos de comprobantes electrónicos (retenciones, guías de remisión, notas de crédito) quedan reservados para fases futuras del gateway.

## Approach
Se implementará el microservicio en el directorio `./sri-invoice-gateway` dentro del entorno de trabajo, configurado con:
- TypeScript en modo estricto.
- NestJS con Fastify o Express.
- Prisma ORM conectado a PostgreSQL.
- BullMQ respaldado por Redis.
- Suite de pruebas unitarias para validación del algoritmo Módulo 11, firma XAdES-BES y parseo de respuestas SOAP.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `sri-invoice-gateway/src/modules/tenants` | New | Módulo de tenants, autenticación API Key y gestión de certificados PKCS#12 |
| `sri-invoice-gateway/src/modules/crypto` | New | Cifrado AES-256-GCM y motor de firma XAdES-BES C14N |
| `sri-invoice-gateway/src/modules/invoices` | New | Generación de clave de acceso Módulo 11, XML SRI v1.1.0 y controlador REST |
| `sri-invoice-gateway/src/modules/sri-soap` | New | Cliente SOAP 1.1 directo para Recepción y Autorización SRI |
| `sri-invoice-gateway/src/modules/queue` | New | Worker BullMQ para pipeline asíncrono |
| `sri-invoice-gateway/src/modules/webhook` | New | Servicio de notificación HTTP POST Webhook |
| `sri-invoice-gateway/prisma` | New | Esquema Prisma (`Tenant`, `InvoiceJob`) |
| `sri-invoice-gateway/docker-compose.yml` | New | Orquestación Docker para API + PostgreSQL + Redis |
| `sri-invoice-gateway/README.md` | New | Documentación técnica de despliegue y pruebas |

