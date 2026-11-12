# Diagnóstico & Salud SRI (RUC, Firma, Establecimientos y Web Services)

El motor de diagnóstico de **SRI Invoice Gateway** permite a cualquier frontend, ERP o plataforma SaaS verificar preventivamente antes de emitir comprobantes electrónicos:

1. **Validez algorítmica del RUC** (Módulo 10 y Módulo 11 según Ficha Técnica SRI v2.34).
2. **Salud e integridad del certificado `.p12` / `.pfx`** (contraseña, vigencia, par RSA, CAs autorizadas por ARCOTEL y coincidencia con el RUC emisor).
3. **Matriz de establecimientos y puntos de emisión** (`estab` y `ptoEmi`), determinando qué locales están habilitados para facturar vs. cerrados o clausurados.
4. **Disponibilidad en tiempo real de los Web Services del SRI** (`celcer.sri.gob.ec` y `cel.sri.gob.ec`).

---

## 1. Arquitectura del Diagnóstico

El microservicio ofrece dos modalidades complementarias:

- **Modo Pre-vuelo Stateless (`POST /v1/diagnostics/verify-setup`)**: Valida en memoria (Buffer) sin guardar datos en base de datos ni crear archivos temporales en disco. Ideal para asistentes de onboarding o modales de configuración de empresa.
- **Modo Auditoría Stateful (`GET /v1/tenants/:id/diagnostics`)**: Descifra con AES-256-GCM las credenciales guardadas del tenant y audita su estado actual.
- **Resumen Ejecutivo de Elegibilidad (`GET /v1/tenants/:id/eligibility`)**: Devuelve un booleano `canIssueInvoices: boolean`, semáforo global y lista de motivos bloqueantes.

```mermaid
sequenceDiagram
    autonumber
    actor Frontend as Frontend / SaaS
    participant Gateway as sri-invoice-gateway
    participant SRI as Web Services SRI (SOAP)

    Frontend->>Gateway: POST /v1/diagnostics/verify-setup (RUC, .p12, pass, estabs)
    
    rect rgb(240, 248, 255)
        Note over Gateway: 1. RucValidatorService (Módulo 10/11)<br/>2. P12ParserService.inspectCertificate (RSA, Vigencia, CA)<br/>3. Matriz de Establecimientos (canInvoice)
    end
    
    Gateway->>SRI: Ping SOAP WSDL (Pruebas y Producción) con timeout 3.5s
    SRI-->>Gateway: Conectividad OK (HTTP 200)
    
    Gateway-->>Frontend: JSON con semáforo global (READY | DEGRADED | FAILED)
```

---

## 2. Reglas Matemáticas de Validación de RUC (Ficha Técnica SRI v2.34)

Ecuador clasifica los números de RUC en tres tipos a partir de su tercer dígito:

| Tipo de Contribuyente | 3er Dígito | Algoritmo | Coeficientes / Pesos | Verificador | Sufijo Sucursal |
| :--- | :---: | :--- | :--- | :---: | :---: |
| **Persona Natural** | `0` a `5` | Módulo 10 | `[2, 1, 2, 1, 2, 1, 2, 1, 2]` | 10mo dígito | `>= 001` (dígitos 11-13) |
| **Sociedad Privada / Extranjera** | `9` | Módulo 11 | `[4, 3, 2, 7, 6, 5, 4, 3, 2]` | 10mo dígito | `>= 001` (dígitos 11-13) |
| **Entidad Pública** | `6` | Módulo 11 | `[3, 2, 7, 6, 5, 4, 3, 2]` | 9no dígito (10mo es 0) | `>= 0001` (dígitos 10-13) |

> **Provincias Válidas**: Primeros 2 dígitos entre `01` y `24`, o código especial `30` (Ecuatorianos en el Exterior). Cualquier otro código es rechazado con `INVALID_RUC_PROVINCE`.

---

## 3. Matriz de Códigos Oficiales del SRI para RUC y Establecimientos

El Gateway mapea formalmente los códigos de rechazo descritos en las páginas 36 a 39 de la Ficha Técnica SRI v2.34:

| Código SRI | Mensaje Oficial SRI | Causa en Negocio | Acción Recomendada al Usuario |
| :---: | :--- | :--- | :--- |
| **`2`** | `RUC del emisor no se encuentra activo` | Contribuyente suspendido o pasivo | Reactivar el RUC en el portal del SRI. |
| **`10`** | `Establecimiento del emisor clausurado` | Sucursal con sello de clausura del SRI | Regularizar situación del local en el SRI o emitir desde otra serie. |
| **`37`** | `RUC sin autorización de emisión` | No ha tramitado autorización electrónica | Solicitar autorización de comprobantes electrónicos en SRI en Línea. |
| **`39`** | `Firma electrónica inválida` | Archivo corrupto o alteración del XML | Regenerar la firma electrónica o revisar integridad del archivo `.p12`. |
| **`40`** | `Error en el certificado digital` | No cumple estándar X.509 | Adquirir un certificado con una CA acreditada por ARCOTEL. |
| **`42`** | `Firma revocada o caducada` | Certificado venció o fue anulado | Renovar la firma electrónica ante la entidad certificadora. |
| **`46`** | `RUC no consta en el padrón del SRI` | RUC inexistente o mal digitado | Verificar los 13 dígitos numéricos del RUC. |
| **`56`** | `Establecimiento cerrado` | Sucursal dada de baja por el emisor | Reabrir el establecimiento en SRI en Línea o cambiar de serie. |
| **`63`** | `RUC en estado pasivo` | RUC cancelado definitivamente | Consultar obligaciones pendientes ante el SRI. |

---

## 4. Semáforo Global (`overallStatus`)

El diagnóstico evalúa conjuntamente todos los subsistemas y clasifica el estado en:

- **🟢 `READY` (`canIssueInvoices: true`)**:
  - RUC matemáticamente válido.
  - Firma descifrada correctamente, vigente (>30 días restantes), emitida por CA acreditada y coincidente con el RUC.
  - Al menos un establecimiento habilitado para facturar (`canInvoice: true`).
  - Web Services del SRI respondiendo con normalidad.
- **🟡 `DEGRADED` (`canIssueInvoices: true`)**:
  - El contribuyente puede emitir comprobantes, pero existen advertencias no críticas:
    - Certificado próximo a caducar en $\le 30$ días (`EXPIRING_SOON`).
    - Uno o más establecimientos están cerrados, pero existe al menos uno activo.
    - Intermitencia temporal o timeout en el ping SOAP del SRI (las colas reintentarán asíncronamente).
- **🔴 `FAILED` (`canIssueInvoices: false`)**:
  - Bloqueo inmediato:
    - RUC matemáticamente inválido.
    - Contraseña incorrecta del archivo `.p12` o archivo corrupto.
    - Certificado digital caducado (`EXPIRED`) o revocado (`REVOKED`).
    - Discrepancia entre el RUC emisor y el RUC/Cédula del certificado (`CERTIFICATE_RUC_MISMATCH`).
    - Ningún establecimiento ni punto de emisión habilitado.

---

## 5. Ejemplos de Petición y Respuesta

### Petición Pre-vuelo (Stateless JSON)
```bash
curl -X POST https://sri-gateway.tu-dominio.com/v1/diagnostics/verify-setup \
  -H "Authorization: Bearer saas_live_abcdef123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "ruc": "1790016919001",
    "password": "MiClaveSegura2026*",
    "p12Base64": "MIIJyQIBAzCCCU8GCSqGSIb3DQEHAa...",
    "ambiente": "1",
    "establishments": [
      { "codigo": "001", "puntoEmision": "001", "nombre": "Matriz Centro", "activo": true },
      { "codigo": "002", "puntoEmision": "001", "nombre": "Sucursal Norte", "activo": false }
    ]
  }'
```

### Respuesta JSON
```json
{
  "overallStatus": "DEGRADED",
  "canIssueInvoices": true,
  "evaluatedAt": "2026-11-12T21:00:00.000Z",
  "ruc": {
    "ruc": "1790016919001",
    "isValid": true,
    "type": "SOCIEDAD_PRIVADA",
    "provinceCode": "17",
    "provinceName": "Pichincha",
    "issues": []
  },
  "certificate": {
    "isValid": true,
    "status": "VALID",
    "subject": "CN=JUAN PEREZ (RUC 1790016919001), O=SECURITY DATA S.A.",
    "representativeName": "JUAN PEREZ",
    "isLegalRepresentative": true,
    "subjectRuc": "1790016919001",
    "issuer": "SECURITY DATA S.A. 2",
    "isAccreditedCa": true,
    "validFrom": "2025-01-10T00:00:00.000Z",
    "validTo": "2027-01-10T00:00:00.000Z",
    "daysRemaining": 423,
    "matchesIssuerRuc": true,
    "revocationStatus": "ACTIVE",
    "issues": []
  },
  "establishments": [
    {
      "codigo": "001",
      "puntoEmision": "001",
      "nombre": "Matriz Centro",
      "canInvoice": true,
      "status": "ACTIVO",
      "issues": []
    },
    {
      "codigo": "002",
      "puntoEmision": "001",
      "nombre": "Sucursal Norte",
      "canInvoice": false,
      "status": "CERRADO",
      "issues": [
        {
          "code": "ESTABLISHMENT_CLOSED",
          "message": "El establecimiento 002-001 se encuentra marcado como cerrado o inactivo.",
          "severity": "WARNING",
          "sriOfficialCode": 56,
          "recommendedAction": "Reactive la sucursal en el portal del SRI para habilitar la emisión."
        }
      ]
    }
  ],
  "sriConnectivity": {
    "ambientePruebas": {
      "isReachable": true,
      "latencyMs": 142,
      "url": "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl",
      "details": "HTTP 200 OK",
      "issues": []
    },
    "ambienteProduccion": {
      "isReachable": true,
      "latencyMs": 158,
      "url": "https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl",
      "details": "HTTP 200 OK",
      "issues": []
    }
  },
  "summaryIssues": [
    {
      "code": "ESTABLISHMENT_CLOSED",
      "message": "El establecimiento 002-001 se encuentra marcado como cerrado o inactivo.",
      "severity": "WARNING",
      "sriOfficialCode": 56,
      "recommendedAction": "Reactive la sucursal en el portal del SRI para habilitar la emisión."
    }
  ]
}
```

