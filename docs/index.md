---
layout: home

hero:
  name: "SRI Invoice Gateway"
  text: "Microservicio Asíncrono de Alta Concurrencia para Facturación Electrónica SRI Ecuador"
  tagline: "Arquitectura B2B2B multi-tenant, firma digital XAdES-BES C14N 1.0, ingesta ultrarrápida < 200ms y entrega garantizada con BullMQ."
  image:
    src: /logo.svg
    alt: SRI Invoice Gateway Logo
  actions:
    - theme: brand
      text: Comenzar
      link: /guide/quickstart
    - theme: alt
      text: Ver API
      link: /api/endpoints

features:
  - icon: 🏢
    title: Multi-Tenant B2B2B
    details: Doble cerradura de seguridad (ApiKeyGuard + TenantAccessGuard) con aislamiento estricto de RUCs, certificados .p12 y clientes SaaS.
  - icon: 🔐
    title: Firma XAdES-BES
    details: Firma criptográfica XML con canonicalización C14N 1.0, RSA-SHA1 y validación de CAs acreditadas por ARCOTEL (BCE, Security Data, Uanataca, ANF).
  - icon: ⚡
    title: Ingesta Ultrarrápida <200ms
    details: Respuesta HTTP 202 Accepted inmediata con clave de acceso precomputada y desacoplamiento asíncrono hacia colas BullMQ / Redis.
  - icon: 🪝
    title: Webhooks HMAC-SHA256
    details: Notificaciones asíncronas con firma criptográfica X-SRI-Gateway-Signature, protección SSRF contra IPs privadas y reintentos automáticos.
---

## Arquitectura de Integración 2-Tier

```mermaid
graph LR
    SaaS[SaaS Integrator / saas-api] -->|POST /v1/tenants/:id/invoices\nHTTP 202 <200ms| GW[SRI Invoice Gateway]
    GW -->|Enqueue Job| Redis[(BullMQ / Redis)]
    Redis -->|Process Job| Worker[Background Worker]
    Worker -->|Sign XAdES-BES| Cert[Certificado .p12 AES-256]
    Worker -->|SOAP 1.1 Recepcion & Autorizacion| SRI[SRI Web Services]
    Worker -->|POST webhook + HMAC-SHA256| SaaSListener[SaaS Webhook Endpoint]
```

### ¿Por qué SRI Invoice Gateway?

El SRI de Ecuador impone estrictos requisitos para la emisión de comprobantes electrónicos offline:
- **XML Canónico y XAdES-BES**: Requiere firma digital RSA-SHA1 con digest value sobre el comprobante y el certificado digital `.p12`.
- **Clave de Acceso de 49 Dígitos**: Cálculo ponderado con algoritmo Módulo 11 (pesos cíclicos 2..7 de derecha a izquierda).
- **Desacoplamiento Asíncrono**: Los servicios SOAP del SRI pueden presentar intermitencia o latencias superiores a 5 segundos; el gateway responde en menos de 200 ms y gestiona reintentos exponenciales en segundo plano.
- **Seguridad Multi-Tenant B2B2B**: Gestión centralizada de múltiples empresas emisoras bajo una misma plataforma SaaS con encriptación AES-256-GCM para llaves privadas.
