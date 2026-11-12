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

## 3. Semáforo Global (`overallStatus`)

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
    - Estado de revocación no determinable por indisponibilidad de CRL de la CA (`INDETERMINATE`).
- **🔴 `FAILED` (`canIssueInvoices: false`)**:
  - Bloqueo inmediato para prevenir rechazos del SRI:
    - RUC matemáticamente inválido.
    - Contraseña incorrecta del archivo `.p12` o archivo corrupto.
    - Certificado digital caducado (`EXPIRED`) o revocado (`REVOKED`).
    - Discrepancia entre el RUC emisor y el RUC/Cédula del certificado (`CERTIFICATE_RUC_MISMATCH`).
    - Ningún establecimiento ni punto de emisión habilitado.

---

## 4. Catálogo Completo de Códigos de Error y Mensajes Devueltos

Cada problema detectado se reporta dentro del arreglo `issues[]` con una estructura tipada consistente:

```typescript
interface DiagnosticIssueDto {
  code: DiagnosticErrorCode;    // Código único del error (enum)
  message: string;             // Mensaje explicativo en español
  severity: 'ERROR' | 'WARNING'; // ERROR (bloquea) o WARNING (advertencia)
  sriOfficialCode?: number;    // Código numérico oficial del SRI correlacionado
  recommendedAction?: string;  // Acción correctiva recomendada para el usuario
}
```

A continuación se detalla la totalidad de códigos de error generados por el microservicio:

### A. Errores de Validación de RUC
| Código (`code`) | Severidad | Mensaje Exacto Devuelto (`message`) | Acción Recomendada (`recommendedAction`) |
| :--- | :---: | :--- | :--- |
| `INVALID_RUC_LENGTH` | `ERROR` | `El RUC debe tener exactamente 13 dígitos numéricos.` | Asegúrese de ingresar un RUC de 13 dígitos numéricos válidos. |
| `INVALID_RUC_PROVINCE` | `ERROR` | `El código de provincia "{prov}" no es válido en el territorio ecuatoriano (rango válido: 01-24, o 30).` | Corrija los dos primeros dígitos del RUC correspondientes a la provincia. |
| `INVALID_RUC_THIRD_DIGIT` | `ERROR` | `El tercer dígito ({d}) no corresponde a ningún tipo de contribuyente válido del SRI (debe ser 0-5 para personas naturales, 6 para públicas, 9 para privadas).` | Verifique el tercer dígito del RUC. |
| `INVALID_RUC_CHECK_DIGIT` | `ERROR` | `El dígito verificador ({actual}) no coincide con el calculado ({esperado}) según el algoritmo Módulo 10/11.` | Verifique los dígitos base del RUC del contribuyente. |
| `INVALID_RUC_ESTABLISHMENT_SUFFIX` | `ERROR` | `El sufijo de establecimiento (dígitos 11-13 o 10-13) debe ser mayor o igual a "001" o "0001".` | Asegúrese de que el RUC termine en 001 o en el número de sucursal asignado. |

### B. Errores Criptográficos del Certificado Digital `.p12`
| Código (`code`) | Severidad | Mensaje Exacto Devuelto (`message`) | Código SRI | Acción Recomendada (`recommendedAction`) |
| :--- | :---: | :--- | :---: | :--- |
| `CERTIFICATE_EMPTY` | `ERROR` | `El archivo .p12 está vacío o no fue suministrado.` | `40` | Cargue un archivo PKCS#12 (.p12 o .pfx) válido. |
| `CERTIFICATE_INVALID_PASSWORD` | `ERROR` | `No se pudo abrir el archivo .p12 con la contraseña suministrada.` | `40` | Verifique la contraseña de su firma electrónica. |
| `CERTIFICATE_PRIVATE_KEY_NOT_FOUND` | `ERROR` | `No se encontró la clave privada RSA en el archivo .p12.` | `40` | Asegúrese de exportar el certificado con su clave privada. |
| `CERTIFICATE_NOT_FOUND` | `ERROR` | `No se encontró ningún certificado X.509 en el archivo .p12.` | `40` | Exporte un archivo .p12 válido que contenga el certificado X.509. |
| `CERTIFICATE_KEY_MISMATCH` | `ERROR` | `La clave privada y el certificado X.509 no se corresponden criptográficamente.` | `39` | Vuelva a exportar el certificado y la clave privada asociados. |
| `CERTIFICATE_EXPIRED` | `ERROR` | `El certificado caducó el {fecha_iso}.` | `42` | Renueve su firma electrónica con su entidad certificadora. |
| `CERTIFICATE_NOT_YET_VALID` | `ERROR` | `El certificado aún no entra en vigencia ({fecha_iso}).` | `40` | Espere a la fecha de inicio de vigencia del certificado. |
| `CERTIFICATE_EXPIRING_SOON` | `WARNING` | `El certificado caducará pronto (en {dias} días).` | - | Inicie el trámite de renovación de su firma electrónica. |
| `CERTIFICATE_UNRECOGNIZED_CA` | `WARNING` | `La entidad emisora "{issuer}" no está en el listado de CAs acreditadas por ARCOTEL / SRI.` | `40` | Asegúrese de adquirir una firma emitida por una entidad certificadora acreditada en Ecuador. |
| `CERTIFICATE_RUC_MISMATCH` | `ERROR` | `El certificado no coincide con el RUC del emisor ({ruc_esperado}).` | `39` | Cargue el archivo .p12 perteneciente al RUC emisor. |
| `CERTIFICATE_REVOKED` | `ERROR` | `El certificado (serie {serial}) figura como REVOCADO.` | `42` | Adquiera una nueva firma electrónica ya que la actual fue revocada. |
| `CERTIFICATE_REVOCATION_INDETERMINATE` | `WARNING` | `No se pudo comprobar el estado de revocación CRL/OCSP por indisponibilidad de red de la CA.` | - | Se permite la emisión con precaución; valide el estado de la CA. |

### C. Errores de Establecimientos y Puntos de Emisión
| Código (`code`) | Severidad | Mensaje Exacto Devuelto (`message`) | Código SRI | Acción Recomendada (`recommendedAction`) |
| :--- | :---: | :--- | :---: | :--- |
| `ESTABLISHMENT_INVALID_CODE_FORMAT` | `ERROR` | `Código de establecimiento "{codigo}" debe tener exactamente 3 dígitos numéricos.` | - | Ajuste el código de establecimiento a formato de 3 dígitos (ej. 001). |
| `ESTABLISHMENT_INVALID_POINT_FORMAT` | `ERROR` | `Código de punto de emisión "{punto}" debe tener exactamente 3 dígitos numéricos.` | - | Ajuste el punto de emisión a formato de 3 dígitos (ej. 001). |
| `ESTABLISHMENT_CLOSED` | `WARNING` | `El establecimiento {codigo}-{punto} se encuentra marcado como cerrado o inactivo.` | `56` | Reactive la sucursal en el portal del SRI para habilitar la emisión. |
| `ESTABLISHMENT_SHUTDOWN` | `ERROR` | `El establecimiento se encuentra clausurado por la autoridad tributaria.` | `10` | Acuda al SRI para levantar la clausura o cambie de sucursal. |

### D. Errores de Conectividad con el SRI (SOAP)
| Código (`code`) | Severidad | Mensaje Exacto Devuelto (`message`) | Acción Recomendada (`recommendedAction`) |
| :--- | :---: | :--- | :--- |
| `SRI_SOAP_TIMEOUT` | `WARNING` | `Tiempo de espera agotado al conectar con el SRI ({url}) tras {ms}ms.` | Espere unos minutos y reintente; el SRI puede estar experimentando alta concurrencia. |
| `SRI_SOAP_UNREACHABLE` | `WARNING` | `No se pudo establecer conexión con el SRI ({url}): {detalle}` | Verifique si los servicios del SRI se encuentran en mantenimiento programado. |

---

## 5. Matriz de Códigos Oficiales de Rechazo SRI (Ficha Técnica v2.34)

Cuando el SRI procesa un comprobante o se evalúan códigos tributarios oficiales, se devuelven los siguientes identificadores:

| Código SRI | Constante Interna | Mensaje Oficial SRI | Acción Operativa |
| :---: | :--- | :--- | :--- |
| **`2`** | `SRI_OFFICIAL_2_RUC_INACTIVO` | `RUC del emisor se encuentra NO ACTIVO en la base tributaria del SRI.` | Reactivar el RUC en el portal del SRI antes de emitir. |
| **`10`** | `SRI_OFFICIAL_10_ESTABLECIMIENTO_CLAUSURADO` | `El establecimiento del emisor se encuentra CLAUSURADO por el SRI.` | Regularizar la clausura ante el SRI o emitir desde otra serie. |
| **`37`** | `SRI_OFFICIAL_37_RUC_NO_AUTORIZADO` | `El RUC no cuenta con autorización para emitir comprobantes electrónicos.` | Solicitar autorización de facturación electrónica en SRI en Línea. |
| **`39`** | `SRI_OFFICIAL_39_FIRMA_INVALIDA` | `Firma electrónica inválida o no corresponde al estándar XAdES-BES.` | Verificar la integridad del archivo `.p12` y regenerar la firma. |
| **`40`** | `SRI_OFFICIAL_40_ERROR_CERTIFICADO` | `Error en la estructura del certificado digital (no cumple con X.509 estándar).` | Adquirir o renovar el certificado con una CA acreditada. |
| **`42`** | `SRI_OFFICIAL_42_FIRMA_REVOCADA_O_CADUCADA` | `La firma electrónica se encuentra revocada por la CA o ha caducado.` | Renovar la firma electrónica ante una entidad acreditada por ARCOTEL. |
| **`46`** | `SRI_OFFICIAL_46_RUC_NO_EXISTE` | `El número de RUC no consta en el padrón del SRI.` | Verificar los 13 dígitos numéricos otorgados por el SRI. |
| **`56`** | `SRI_OFFICIAL_56_ESTABLECIMIENTO_CERRADO` | `El establecimiento del emisor se encuentra CERRADO o dado de baja.` | Reabrir el establecimiento en SRI en Línea o cambiar de serie. |
| **`63`** | `SRI_OFFICIAL_63_RUC_PASIVO` | `El RUC del emisor se encuentra en estado pasivo o suspendido definitivamente.` | Regularizar obligaciones tributarias para reactivar el RUC. |

---

## 6. Respuestas HTTP Estándar de la API (Errores HTTP)

Además del cuerpo estructurado del diagnóstico (`issues[]`), los endpoints pueden responder con los siguientes códigos de estado HTTP estándar:

| Código HTTP | Causa | Formato del `error.message` |
| :---: | :--- | :--- |
| **`400 Bad Request`** | Parámetros inválidos en el cuerpo (validación de DTO). | `{"statusCode": 400, "message": ["El RUC debe tener exactamente 13 dígitos numéricos."], "error": "Bad Request"}` |
| **`401 Unauthorized`** | Encabezado `Authorization: Bearer <token>` ausente o inválido. | `{"statusCode": 401, "message": "MISSING_API_KEY: Debe proporcionar una API Key válida", "error": "Unauthorized"}` |
| **`403 Forbidden`** | La plataforma SaaS autenticada no tiene acceso al tenant solicitado. | `{"statusCode": 403, "message": "TENANT_ACCESS_DENIED: No tiene permisos sobre este tenant", "error": "Forbidden"}` |
| **`404 Not Found`** | El tenant solicitado no existe bajo la cuenta del cliente SaaS. | `{"statusCode": 404, "message": "Tenant con id \"...\" no encontrado.", "error": "Not Found"}` |
| **`429 Too Many Requests`** | Se excedió el límite de peticiones por segundo (`20 rps`). | `{"statusCode": 429, "message": "ThrottlerException: Too Many Requests", "error": "Too Many Requests"}` |

---

## 7. Ejemplos de Petición y Respuesta

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
