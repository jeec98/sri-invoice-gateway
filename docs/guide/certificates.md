# Certificados Digitales y Criptografía XAdES-BES

Para firmar comprobantes electrónicos que sean aceptados por el Servicio de Rentas Internas (SRI), cada empresa emisora (**Tenant**) debe disponer de un certificado digital de firma electrónica válido en formato estándar **PKCS#12** (`.p12` o `.pfx`).

---

## Carga del Certificado Digital

La carga se efectúa mediante una petición HTTP con codificación `multipart/form-data`:

```http
POST /v1/tenants/e2a3c4b5-6789-0123-abcd-ef0123456789/certificates HTTP/1.1
Host: api.gateway.com
Authorization: Bearer sri_live_...
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW

------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="file"; filename="firma_electronica.p12"
Content-Type: application/x-pkcs12

<archivo_binario_p12>
------WebKitFormBoundary7MA4YWxkTrZu0gW
Content-Disposition: form-data; name="password"

MiContrasenaSegura2026!
------WebKitFormBoundary7MA4YWxkTrZu0gW--
```

### Respuesta de Registro (HTTP 201 Created)

```json
{
  "success": true,
  "certificate": {
    "id": "c1d2e3f4-5678-90ab-cdef-1234567890ab",
    "tenantId": "e2a3c4b5-6789-0123-abcd-ef0123456789",
    "issuer": "SECURITY DATA SEGURIDAD EN DATOS Y FIRMA DIGITAL S.A.",
    "subject": "CN=JUAN PEREZ,SERIALNUMBER=1790011674001,C=EC",
    "validFrom": "2025-06-01T00:00:00.000Z",
    "validTo": "2027-06-01T23:59:59.000Z",
    "status": "ACTIVE",
    "createdAt": "2026-11-09T18:45:00.000Z"
  }
}
```

---

## Validación de Entidades Emisoras Acreditadas (ARCOTEL)

Durante el procesamiento de la carga, el módulo `P12ParserService` extrae la cadena de certificación X.509 y verifica de manera estricta que la Autoridad Certificadora (CA) emisora se encuentre acreditada por la Agencia de Regulación y Control de las Telecomunicaciones (**ARCOTEL**):

- **Banco Central del Ecuador (BCE)**
- **Security Data Seguridad en Datos y Firma Digital S.A.**
- **Uanataca Ecuador**
- **ANF Autoridad de Certificación Ecuador**
- **Consejo de la Judicatura (ICERT / DNP)**

::: danger ERROR: ENTIDAD NO RECONOCIDA
Si el certificado fue emitido por una CA autofirmada (self-signed) o una entidad no acreditada por ARCOTEL, la petición es rechazada de inmediato con `400 Bad Request` (`UNRECOGNIZED_CA`), evitando que el SRI invalide comprobantes en producción.
:::

---

## Verificación de Identidad del RUC (Subject Matching)

El gateway valida que el RUC inscrito en los campos X.509 del certificado coincida con el RUC de la empresa emisora:

1. El parser examina los atributos `serialNumber`, `description`, o las extensiones de identificación de la persona jurídica/natural.
2. Si el RUC extraído no concuerda con el `tenant.ruc`, se rechaza con `400 Bad Request` (`CERTIFICATE_RUC_MISMATCH`).
3. Se verifica que la fecha actual se encuentre dentro de la ventana de validez (`validFrom <= now <= validTo`). Si el certificado expiró, se rechaza con `400 Bad Request` (`CERTIFICATE_EXPIRED`).

---

## Arquitectura de Cifrado en Reposo (AES-256-GCM)

Para cumplir con los más altos estándares de protección criptográfica:

```
[ Contraseña en texto plano ] 
              │
              ▼
   AES-256-GCM Engine (node:crypto)
   - Clave Maestra derivada de ENCRYPTION_KEY (32 bytes)
   - IV (Vector de Inicialización) único de 12 bytes por operación
              │
              ├──► [ IV: 12 bytes ]
              ├──► [ Ciphertext cifrado ]
              └──► [ Auth Tag: 16 bytes (Integridad GCM) ]
```

1. **Sin Almacenamiento en Texto Plano**: La contraseña del certificado jamás se almacena en texto plano en la base de datos.
2. **IV Único y Tag de Autenticación**: Se genera un nuevo vector de inicialización de 12 bytes por cada cifrado. Al descifrar en memoria durante la emisión, se verifica el `authTag` de 16 bytes para prevenir ataques de manipulación de texto cifrado.
3. **Permisos de Archivo Restrictivos (`0o600`)**: Los archivos de respaldo temporal `.p12` se guardan en el sistema de archivos local con permisos POSIX `0o600` (lectura y escritura únicamente para el usuario propietario del proceso).
4. **Ciclo de Vida Efímero en Memoria**: La clave privada RSA y la contraseña desencriptada solo existen durante los microsegundos requeridos para aplicar la firma digital XAdES-BES en el worker BullMQ, siendo liberadas para recolección de basura inmediatamente después.
