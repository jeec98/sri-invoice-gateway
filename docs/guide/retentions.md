# Emisión de Comprobantes de Retención (`codDoc: 07`)

El microservicio permite emitir **Comprobantes de Retención Electrónicos versión 2.0.0** conforme a la Ficha Técnica del SRI (Esquema ATS / Sustento Tributario).

La emisión es completamente asíncrona: el endpoint valida el esquema, genera la Clave de Acceso de 49 dígitos con código de documento `07`, persiste el comprobante y lo encola en Redis/BullMQ para su firmado XAdES-BES y envío al SRI, respondiendo en **menos de 200 ms**.

---

## 1. Flujo de Emisión de Retenciones

```mermaid
sequenceDiagram
    autonumber
    actor SaaS as Plataforma SaaS / ERP
    participant Gateway as sri-invoice-gateway
    participant Redis as Cola BullMQ (Redis)
    participant SRI as SRI Recepción / Autorización

    SaaS->>Gateway: POST /v1/tenants/:id/retentions (JSON)
    Note over Gateway: 1. Valida certificado activo del tenant<br/>2. Genera Clave de Acceso (codDoc=07)<br/>3. Guarda InvoiceJob (QUEUED)
    Gateway->>Redis: Encola trabajo de retención
    Gateway-->>SaaS: HTTP 202 Accepted { claveAcceso, jobId, status: "QUEUED" }
    
    rect rgb(240, 248, 255)
        Note over Redis,SRI: Proceso Asíncrono en Background Worker
        Redis->>Gateway: Worker consume trabajo
        Gateway->>Gateway: Construye XML v2.0.0 + Inyecta RUC Proveedor + Firma XAdES-BES
        Gateway->>SRI: SOAP validarComprobante & autorizacionComprobante
        SRI-->>Gateway: HTTP 200 (AUTORIZADO / DEVUELTA)
    end
    
    Gateway->>SaaS: POST Webhook (HMAC-SHA256) con estado final y XML autorizado
```

---

## 2. Estructura del Comprobante de Retención v2.0.0

A diferencia de la versión 1.0.0 legacy, la versión 2.0.0 del SRI organiza las retenciones por **Documento de Sustento** (`docsSustento`):

1. **Documento de Sustento (`docSustento`)**:
   - `codSustento`: Código de sustento tributario (ej. `'01'` Crédito Tributario).
   - `codDocSustento`: Tipo de comprobante retenido (ej. `'01'` Factura).
   - `numDocSustento`: Serie y secuencial del comprobante retenido (`001-001-000012345`).
   - `fechaEmisionDocSustento`: Fecha del comprobante retenido (`dd/mm/yyyy`).
   - `totalSinImpuestos` e `importeTotal`.
2. **Impuestos del Documento de Sustento (`impuestosDocSustento`)**:
   - IVA o ICE gravado en la factura que da origen a la retención.
3. **Detalle de Retenciones (`retenciones`)**:
   - `codigo`: `'1'` (Impuesto a la Renta) o `'2'` (IVA).
   - `codigoRetencion`: Código oficial SRI (ej. `'312'` para transferencia de bienes muebles 1.75%, `'1'` para retención de IVA 30%, `'2'` para retención de IVA 70%, etc.).
   - `baseImponible`, `porcentajeRetener` y `valorRetenido`.
4. **Formas de Pago (`pagos`)**:
   - Forma de pago aplicada al documento de sustento (ej. `'20'` Otros con utilización del sistema financiero).
5. **Inyección Automática de RUC Proveedor (Anexo 26)**:
   - El microservicio inyecta automáticamente el campo `<campoAdicional nombre="RUC Proveedor">` en `infoAdicional` con el RUC de tu plataforma SaaS registrada, dando cumplimiento estricto a la Resolución SRI **NAC-DGERCGC26-00000027**.

---

## 3. Ejemplo de Emisión (`POST /v1/tenants/:tenantId/retentions`)

### Petición HTTP
```bash
curl -X POST https://sri-gateway.tu-dominio.com/v1/tenants/TENANT_UUID/retentions \
  -H "Authorization: Bearer sri_live_abcdef123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "referenceId": "RET-2026-0001",
    "ambiente": "1",
    "webhookUrl": "https://mi-erp.com/api/sri/webhook",
    "razonSocial": "TECNOLOGIA & SOLUCIONES S.A.",
    "ruc": "1790011674001",
    "estab": "001",
    "ptoEmi": "001",
    "secuencial": "000000001",
    "dirMatriz": "AV. AMAZONAS N24-196 Y LUIS CORDERO",
    "fechaEmision": "12/11/2026",
    "dirEstablecimiento": "AV. AMAZONAS N24-196 Y LUIS CORDERO",
    "obligadoContabilidad": "SI",
    "tipoIdentificacionSujetoRetenido": "04",
    "parteRel": "NO",
    "razonSocialSujetoRetenido": "PROVEEDOR INDUSTRIAL S.A.",
    "identificacionSujetoRetenido": "1792147820001",
    "periodoFiscal": "11/2026",
    "docsSustento": [
      {
        "codSustento": "01",
        "codDocSustento": "01",
        "numDocSustento": "001-001-000054321",
        "fechaEmisionDocSustento": "10/11/2026",
        "fechaRegistroContable": "10/11/2026",
        "numAutDocSustento": "1011202601179214782000110010010000543211234567812",
        "pagoLocExt": "01",
        "totalSinImpuestos": 1000.00,
        "importeTotal": 1150.00,
        "impuestosDocSustento": [
          {
            "codImpuestoDocSustento": "2",
            "codigoPorcentaje": "4",
            "baseImponible": 1000.00,
            "tarifa": 15,
            "valorImpuesto": 150.00
          }
        ],
        "retenciones": [
          {
            "codigo": "1",
            "codigoRetencion": "312",
            "baseImponible": 1000.00,
            "porcentajeRetener": 1.75,
            "valorRetenido": 17.50
          },
          {
            "codigo": "2",
            "codigoRetencion": "1",
            "baseImponible": 150.00,
            "porcentajeRetener": 30.00,
            "valorRetenido": 45.00
          }
        ],
        "pagos": [
          {
            "formaPago": "20",
            "total": 1087.50
          }
        ]
      }
    ],
    "infoAdicional": [
      { "nombre": "Email", "valor": "contabilidad@proveedor.com" }
    ]
  }'
```

### Respuesta Inmediata (`202 Accepted`)
```json
{
  "success": true,
  "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "referenceId": "RET-2026-0001",
  "claveAcceso": "1211202607179001167400110010010000000011234567819",
  "ambiente": "1",
  "status": "QUEUED",
  "queuePosition": 1,
  "createdAt": "2026-11-12T21:15:00.000Z"
}
```

---

## 4. Consulta del Estado de la Retención

Puedes consultar el estado en cualquier momento con la Clave de Acceso generada:

```bash
curl -X GET https://sri-gateway.tu-dominio.com/v1/tenants/TENANT_UUID/invoices/1211202607179001167400110010010000000011234567819 \
  -H "Authorization: Bearer sri_live_abcdef123456789"
```

O esperar la notificación automática del Webhook firmado cuando el SRI responda con `AUTORIZADO`.
