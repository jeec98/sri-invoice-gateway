# Emisión Asíncrona de Facturas Electrónicas

El endpoint `POST /v1/tenants/:tenantId/invoices` implementa el patrón de ingestión asíncrona de alta concurrencia. Valida los datos estructurales del comprobante, genera la Clave de Acceso de 49 dígitos, persiste el registro del trabajo y responde en **menos de 200 ms** con el estado HTTP `202 Accepted`.

---

## Contrato de Respuesta Síncrona (<200ms)

Para evitar bloqueos causados por la congestión de los servidores SOAP del SRI, el gateway nunca espera la autorización síncrona en la petición HTTP inicial:

```http
POST /v1/tenants/e2a3c4b5-6789-0123-abcd-ef0123456789/invoices HTTP/1.1
Host: api.gateway.com
Authorization: Bearer sri_live_...
Content-Type: application/json

{
  "referenceId": "order_uuid_100234",
  "ambiente": "1",
  "tipoEmision": "1",
  "infoTributaria": {
    "razonSocial": "Corporación Andina de Alimentos S.A.",
    "ruc": "1790011674001",
    "codDoc": "01",
    "estab": "001",
    "ptoEmi": "001",
    "secuencial": "000000123",
    "dirMatriz": "Av. República de El Salvador 890, Quito"
  },
  "infoFactura": {
    "fechaEmision": "09/11/2026",
    "dirEstablecimiento": "Av. República de El Salvador 890, Quito",
    "obligadoContabilidad": "SI",
    "tipoIdentificacionComprador": "04",
    "razonSocialComprador": "Consumidor Final S.A.",
    "identificacionComprador": "1792146739001",
    "totalSinImpuestos": 100.00,
    "totalDescuento": 0.00,
    "totalConImpuestos": [
      {
        "codigo": "2",
        "codigoPorcentaje": "4",
        "baseImponible": 100.00,
        "valor": 15.00
      }
    ],
    "propina": 0.00,
    "importeTotal": 115.00,
    "moneda": "DOLAR",
    "pagos": [
      {
        "formaPago": "20",
        "total": 115.00,
        "plazo": 30,
        "unidadTiempo": "DIAS"
      }
    ]
  },
  "detalles": [
    {
      "codigoPrincipal": "SERV-001",
      "descripcion": "Suscripción Cloud Enterprise Plan",
      "cantidad": 1.00,
      "precioUnitario": 100.00,
      "descuento": 0.00,
      "precioTotalSinImpuesto": 100.00,
      "impuestos": [
        {
          "codigo": "2",
          "codigoPorcentaje": "4",
          "tarifa": 15.00,
          "baseImponible": 100.00,
          "valor": 15.00
        }
      ]
    }
  ]
}
```

### Respuesta HTTP 202 Accepted

```json
{
  "success": true,
  "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "referenceId": "order_uuid_100234",
  "claveAcceso": "0911202601179001167400110010010000001231234567812",
  "status": "QUEUED",
  "createdAt": "2026-11-09T18:50:00.000Z"
}
```

---

## Tabla de Impuestos SRI (Factura v1.1.0)

Para el impuesto al valor agregado (IVA), el SRI especifica el código de impuesto `"2"` con los siguientes códigos de porcentaje:

| Código Porcentaje (`codigoPorcentaje`) | Descripción del Porcentaje | Tarifa Aplicable | Base Legal / Vigencia |
| :--- | :--- | :--- | :--- |
| **`4`** | **IVA 15%** | `15.00%` | Tarifa general vigente (Ley para Enfrentar el Conflicto Armado Interno). |
| **`5`** | **IVA 5%** | `5.00%` | Materiales de construcción calificados por el SRI. |
| **`0`** | **IVA 0%** | `0.00%` | Productos de la canasta básica, medicinas y servicios exentos. |
| **`6`** | **No Objeto de Impuesto** | `0.00%` | Operaciones fuera del hecho generador del IVA. |
| **`7`** | **Exento de IVA** | `0.00%` | Transferencias legalmente exoneradas. |

---

## Catálogo de Formas de Pago

El campo `formaPago` dentro de `infoFactura.pagos` debe utilizar los códigos oficiales de la tabla 24 del SRI:

| Código | Descripción de la Forma de Pago |
| :--- | :--- |
| **`01`** | Sin utilización del sistema financiero (Efectivo / Canje) |
| **`16`** | Tarjeta de débito |
| **`19`** | Tarjeta de crédito |
| **`20`** | Otros con utilización del sistema financiero (Transferencia bancaria, QR, pasarela digital) |
| **`15`** | Compensación de deudas |
| **`17`** | Dinero electrónico / Billetera móvil |

---

## Ciclo de Vida del Trabajo en BullMQ

1. **Encolamiento**: El gateway inserta el registro `InvoiceJob` con estado `QUEUED` y emite el evento en Redis bajo la cola `sri-invoice-queue`.
2. **Construcción y Firma XML**: El worker construye el XML canónico (`C14N 1.0`), incorpora los datos fiscales y aplica la firma digital `XAdES-BES` utilizando la clave privada RSA-SHA1 del tenant.
3. **Recepción en SRI**: El XML firmado se envía al servicio SOAP `RecepcionComprobantesOffline`. Si es aceptado, pasa al estado `RECIBIDA`.
4. **Consulta de Autorización**: Mediante sondeo con retroceso exponencial, se consulta `AutorizacionComprobantesOffline` hasta obtener `AUTORIZADO` o `DEVUELTA`.
5. **Notificación Webhook**: El resultado final se notifica de inmediato a la URL de webhook registrada por el integrador.
