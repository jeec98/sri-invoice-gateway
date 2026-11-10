# Emisión de Facturas Electrónicas

El endpoint `POST /v1/tenants/:tenantId/invoices` recibe los datos de la factura en JSON, valida la información, genera automáticamente la **Clave de Acceso de 49 dígitos** y responde en milisegundos con estado `QUEUED`.

Mientras tu app sigue operando normalmente, nuestro servicio se encarga en segundo plano de armar el XML, firmarlo con el `.p12` del negocio, enviarlo al SRI y avisarte por Webhook cuando sea autorizado.

---

## Enviar una Factura (`POST /v1/tenants/:tenantId/invoices`)

Recuerda enviar tu `apiKey` como **Bearer Token** en el encabezado `Authorization`:

```bash
curl -X POST https://tu-api.up.railway.app/v1/tenants/TENANT_ID/invoices \
  -H "Authorization: Bearer sri_live_tu_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "referenceId": "FAC-2026-100234",
    "ambiente": "1",
    "webhookUrl": "https://api.tusaas.com/webhooks/sri",
    "razonSocial": "Corporación Andina de Alimentos S.A.",
    "nombreComercial": "Andina Market",
    "ruc": "1790011674001",
    "estab": "001",
    "ptoEmi": "001",
    "secuencial": "000000123",
    "dirMatriz": "Av. República de El Salvador 890, Quito",
    "fechaEmision": "10/11/2026",
    "dirEstablecimiento": "Av. República de El Salvador 890, Quito",
    "obligadoContabilidad": "SI",
    "tipoIdentificacionComprador": "04",
    "razonSocialComprador": "Cliente Ejemplo S.A.",
    "identificacionComprador": "1792146739001",
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
        "codigoPrincipal": "SERV-001",
        "descripcion": "Suscripción Mensual Software",
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
    ]
  }'
```

### Respuesta Inmediata (HTTP 202 Accepted)

```json
{
  "success": true,
  "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "referenceId": "FAC-2026-100234",
  "claveAcceso": "1011202601179001167400110010010000001231234567812",
  "status": "QUEUED"
}
```

> **Cumplimiento automático SRI (`NAC-DGERCGC26-00000027`)**: No necesitas agregar manualmente tu RUC de proveedor de software en `infoAdicional`. El gateway inyecta automáticamente `<campoAdicional nombre="RUC Proveedor">` con el RUC con el que registraste tu SaaS.

---

## Ambientes del SRI

| Valor de `ambiente` | Entorno SRI | Cuándo usarlo |
| :--- | :--- | :--- |
| **`"1"`** | **Pruebas (Certificación)** | Desarrollo, pruebas con tu SaaS y verificación de XMLs sin validez tributaria. |
| **`"2"`** | **Producción** | Emisión real de facturas electrónicas válidas ante el SRI. |

---

## Códigos de Impuestos IVA (`codigo: "2"`)

| `codigoPorcentaje` | Tarifa | Descripción |
| :--- | :--- | :--- |
| **`4`** | `15` | **IVA 15%** (tarifa general vigente) |
| **`5`** | `5` | **IVA 5%** (materiales de construcción) |
| **`0`** | `0` | **IVA 0%** (canasta básica, medicinas, servicios exentos) |
| **`6`** | `0` | No Objeto de Impuesto |
| **`7`** | `0` | Exento de IVA |

---

## Formas de Pago (`formaPago`)

| Código | Descripción |
| :--- | :--- |
| **`01`** | Sin utilización del sistema financiero (Efectivo) |
| **`16`** | Tarjeta de débito |
| **`19`** | Tarjeta de crédito |
| **`20`** | Otros con utilización del sistema financiero (Transferencia, depósito, pasarela) |
| **`15`** | Compensación de deudas |
| **`17`** | Dinero electrónico |

---

## ¿Cómo consultar el estado manualmente?

Además de recibir el resultado automático en tu Webhook, puedes consultar cualquier factura por su `claveAcceso`:

```bash
curl https://tu-api.up.railway.app/v1/tenants/TENANT_ID/invoices/CLAVE_ACCESO_49_DIGITOS \
  -H "Authorization: Bearer sri_live_tu_api_key"
```
