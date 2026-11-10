# Certificados Digitales (`.p12` / `.pfx`)

Para que un negocio pueda emitir facturas válidas ante el SRI, primero debes subir su firma electrónica en formato `.p12` o `.pfx` junto con su contraseña.

---

## Subir un Certificado (`POST /v1/tenants/:tenantId/certificates`)

Envía el archivo mediante `multipart/form-data` usando tu `apiKey` como **Bearer Token**:

```bash
curl -X POST https://tu-api.up.railway.app/v1/tenants/TENANT_ID/certificates \
  -H "Authorization: Bearer sri_live_tu_api_key" \
  -F "file=@/ruta/a/firma_electronica.p12" \
  -F "password=TuPasswordDeFirma"
```

### Respuesta (HTTP 201 Created)

```json
{
  "success": true,
  "certificateId": "c1d2e3f4-5678-90ab-cdef-1234567890ab",
  "tenantId": "e2a3c4b5-6789-0123-abcd-ef0123456789",
  "certIssuer": "SECURITY DATA SEGURIDAD EN DATOS Y FIRMA DIGITAL S.A.",
  "certSubject": "CN=JUAN PEREZ,SERIALNUMBER=1790011674001,C=EC",
  "validFrom": "2025-06-01T00:00:00.000Z",
  "validTo": "2027-06-01T23:59:59.000Z",
  "isActive": true
}
```

---

## ¿Qué valida automáticamente el servicio?

Al subir el archivo, la API revisa cuatro cosas antes de aceptarlo:

1. **Contraseña correcta**: Comprueba que la contraseña abra el archivo `.p12`.
2. **Entidad certificadora autorizada en Ecuador**: Verifica que la firma haya sido emitida por una entidad acreditada por ARCOTEL:
   * Banco Central del Ecuador (BCE)
   * Security Data S.A.
   * Uanataca Ecuador
   * ANF Autoridad de Certificación
   * Consejo de la Judicatura
3. **Coincidencia de RUC**: Verifica que el RUC dentro del certificado corresponda al RUC del negocio (`Tenant`).
4. **Vigencia y revocación**: Comprueba que el certificado no esté caducado ni revocado.

::: info Seguridad de tus firmas
Tanto el archivo `.p12` como su contraseña se guardan **cifrados (AES-256-GCM)** en la base de datos. Nunca se guardan contraseñas en texto plano ni se imprimen en logs.
:::
