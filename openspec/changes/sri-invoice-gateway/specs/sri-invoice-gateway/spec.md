# Delta Spec: SRI Invoice Gateway

## Context
Microservicio independiente (`sri-invoice-gateway`) que expone una API REST multi-tenant para gestionar certificados de firma electrónica (`.p12`/`.pfx`), generar claves de acceso de 49 dígitos (Módulo 11), construir XML de facturas v1.1.0, aplicar firma electrónica XAdES-BES y tramitar asíncronamente la recepción y autorización en los Web Services SOAP del SRI de Ecuador, notificando el resultado vía Webhook.

## ADDED Requirements

### Requirement: Autenticación Multi-Tenant por API Key y Carga de Certificados
El sistema MUST autenticar todas las peticiones protegidas mediante el header `Authorization: Bearer <API_KEY>`, comparando únicamente el hash SHA-256 contra la base de datos. Asimismo, MUST proveer el endpoint `POST /v1/tenants/certificates` (`multipart/form-data`) para validar, cifrar con AES-256-GCM y almacenar certificados `.p12`/`.pfx`.

#### Scenario: Carga exitosa de certificado válido y vigente
- GIVEN un tenant autenticado con una API Key válida y un archivo `.p12` vigente con su contraseña correcta
- WHEN envía una petición `POST /v1/tenants/certificates` con `ruc`, `file` y `password`
- THEN el sistema abre el contenedor PKCS#12 con `node-forge`, verifica que la fecha de expiración sea posterior a la fecha actual, cifra la contraseña con AES-256-GCM (`ciphertext`, `iv`, `authTag`), almacena el binario del certificado de forma segura y retorna HTTP 201 con metadatos del certificado (emisor, titular, vigencia).

#### Scenario: Rechazo de certificado con contraseña incorrecta o caducado
- GIVEN un tenant autenticado que envía un archivo `.p12` con contraseña inválida o cuya fecha `notAfter` ya expiró
- WHEN envía `POST /v1/tenants/certificates`
- THEN el sistema rechaza la operación sin persistir cambios y retorna HTTP 400 Bad Request detallando el motivo (`INVALID_CERTIFICATE_PASSWORD` o `CERTIFICATE_EXPIRED`).

#### Scenario: Rechazo por API Key inválida o ausente
- GIVEN una petición sin header `Authorization: Bearer <API_KEY>` o con una API Key cuyo SHA-256 no coincide con ningún tenant activo
- WHEN intenta consumir `/v1/tenants/certificates` o `/v1/invoices`
- THEN el sistema retorna HTTP 401 Unauthorized.

---

### Requirement: Generación de Clave de Acceso de 49 Dígitos y Algoritmo Módulo 11
El sistema MUST generar una clave numérica de 49 dígitos con la estructura oficial del SRI y calcular el dígito verificador mediante el algoritmo Módulo 11 con pesos cíclicos `2, 3, 4, 5, 6, 7` de derecha a izquierda.

#### Scenario: Cálculo exacto de Clave de Acceso y Dígito Verificador
- GIVEN los datos tributarios: fecha `07112026`, tipo comprobante `01`, RUC `1790011674001`, ambiente `1`, serie `001001`, secuencial `000000123`, código numérico `12345678`, tipo emisión `1`
- WHEN `AccessKeyService` genera la clave de acceso sobre los primeros 48 dígitos
- THEN calcula la sumatoria ponderada de derecha a izquierda con factores `2..7`, aplica `11 - (suma % 11)` (donde residuo `0 -> 0` y residuo `1 -> 1`) y concatena el dígito verificador produciendo exactamente 49 dígitos numéricos.

---

### Requirement: Construcción Canónica de XML de Factura SRI v1.1.0
El sistema MUST construir el documento XML `<factura id="comprobante" version="1.1.0">` codificado en UTF-8 con las secciones `<infoTributaria>`, `<infoFactura>`, `<detalles>` e `<infoAdicional>`.

#### Scenario: Generación de XML con tarifas IVA 15%, 0%, Exento y No Objeto
- GIVEN un payload de factura con ítems gravados con IVA 15% (código `2`, código porcentaje `4`), IVA 0% (código porcentaje `0`), No Objeto (`6`) y Exento (`7`), más campos de `infoAdicional`
- WHEN `XmlBuilderService` genera el XML de la factura
- THEN produce un XML bien formado con `<infoTributaria>`, `<infoFactura>` (incluyendo `<totalConImpuestos>` agrupado por código y porcentaje, y `<pagos>`), `<detalles>` con los impuestos por línea y `<infoAdicional>`, escapando caracteres especiales XML.

---

### Requirement: Firma Electrónica XAdES-BES compatible con el SRI
El sistema MUST firmar el XML de la factura utilizando el estándar XAdES-BES (`http://uri.etsi.org/01903/v1.3.2#`) con canonicalización C14N (`http://www.w3.org/TR/2001/REC-xml-c14n-20010315`) y algoritmos RSA-SHA1 / SHA-1 requeridos por el validador del SRI.

#### Scenario: Firma XAdES-BES válida sobre nodo `#comprobante`
- GIVEN un XML de factura válido y el par clave privada / certificado X.509 extraídos del `.p12` del tenant
- WHEN `XadesBesSignerService` ejecuta el proceso de firma
- THEN inserta el nodo `<ds:Signature>` al final de `<factura>`, incluyendo:
  1. `<ds:SignedInfo>` con referencias y digests SHA-1 tanto para `#comprobante` (con transformación `enveloped-signature` y C14N) como para `#SignedProperties` y `#Certificate`.
  2. `<ds:SignatureValue>` firmado con RSA-SHA1 sobre el `<ds:SignedInfo>` canonicalizado.
  3. `<ds:KeyInfo>` con el certificado X.509 en Base64 y módulo/exponente RSA.
  4. `<ds:Object>` con `<etsi:QualifyingProperties>` y `<etsi:SignedProperties>` conteniendo `<etsi:SigningTime>` (ISO-8601 con zona horaria), `<etsi:SigningCertificate>` (digest SHA-1 del DER, `X509IssuerName` y `X509SerialNumber`).

---

### Requirement: Cliente SOAP 1.1 Directo para Recepción y Autorización SRI
El sistema MUST comunicarse con los Web Services SOAP 1.1 del SRI (`RecepcionComprobantesOffline` y `AutorizacionComprobantesOffline`) en ambientes de Pruebas (`1`) y Producción (`2`) sin depender de librerías WSDL pesadas.

#### Scenario: Envío a Recepción (`validarComprobante`)
- GIVEN un XML firmado codificado en Base64
- WHEN `SriSoapClientService.validarComprobante` envía el Envelope SOAP al endpoint del ambiente configurado
- THEN parsea la respuesta XML del SRI y retorna el estado `RECIBIDA` o `DEVUELTA` junto con la colección estructurada de mensajes (`identificador`, `mensaje`, `informacionAdicional`, `tipo`).

#### Scenario: Consulta de Autorización (`autorizacionComprobante`)
- GIVEN una clave de acceso de 49 dígitos cuyo comprobante fue recibido por el SRI
- WHEN `SriSoapClientService.autorizacionComprobante` consulta el endpoint de autorización
- THEN extrae y retorna `estado` (`AUTORIZADO`, `NO AUTORIZADO` o `EN PROCESO`), `numeroAutorizacion`, `fechaAutorizacion`, el XML autorizado envuelto en `<autorizacion>` y los mensajes de observación/error.

---

### Requirement: Procesamiento Asíncrono con BullMQ y Notificación Webhook
El sistema MUST encolar la solicitud en `POST /v1/invoices` respondiendo HTTP 202 en menos de 200ms y procesar el ciclo completo en segundo plano, enviando el resultado final mediante HTTP POST al `webhookUrl` del SaaS.

#### Scenario: Encolamiento rápido en `POST /v1/invoices`
- GIVEN un payload JSON válido con datos de factura, `ambiente`, `referenceId` y `webhookUrl`
- WHEN el cliente invoca `POST /v1/invoices`
- THEN el sistema calcula la `claveAcceso` de 49 dígitos, registra el `InvoiceJob` en estado `QUEUED`, publica el trabajo en la cola BullMQ y responde HTTP 202 con `{ "success": true, "jobId": "...", "claveAcceso": "...", "status": "QUEUED" }`.

#### Scenario: Flujo completo Worker -> Recepción -> Autorización -> Webhook
- GIVEN un trabajo encolado en BullMQ
- WHEN `InvoiceQueueConsumer` procesa el trabajo
- THEN desencripta el certificado del tenant, construye y firma el XML, lo envía a Recepción del SRI; si es `RECIBIDA`, espera 2-3 segundos, consulta Autorización (con hasta 3 reintentos y backoff exponencial si responde `EN PROCESO`), actualiza el `InvoiceJob` en base de datos y envía un HTTP POST al `webhookUrl` con el estado final (`AUTORIZADO`, `NO_AUTORIZADO` o `DEVUELTA`), el XML autorizado y/o errores del SRI.

