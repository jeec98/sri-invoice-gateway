# Notificaciones Asíncronas vía Webhooks

Cuando un comprobante alcanza un estado terminal (`AUTORIZADO`, `DEVUELTA`, `NO_AUTORIZADO` o `FAILED`), `sri-invoice-gateway` envía una notificación HTTP `POST` a la URL de webhook configurada por el integrador SaaS.

---

## Cómo Configurar tu Webhook para que Funcione {#como-configurar-tu-webhook}

Para que tu servidor SaaS reciba correctamente las notificaciones del SRI sin errores de entrega, sigue estos **4 pasos**:

### 1. Crea un endpoint `POST` público que cumpla estas reglas
Tu plataforma SaaS debe exponer una ruta (por ejemplo `https://api.tusaas.com/webhooks/sri`) que cumpla **estrictamente** con lo siguiente:

* **URL Pública HTTPS (sin `localhost` en producción)**: Por protección SSRF, en producción el gateway bloquea `localhost`, `127.0.0.1` e IPs privadas (`192.168.x.x`, `10.x.x.x`).
* **Sin redirecciones (`301` / `302`)**: El gateway envía el `POST` con `maxRedirects: 0`. Si tu dominio redirige (por ejemplo de `http://` a `https://`, o de `tusaas.com` a `www.tusaas.com`, o quita/agrega `/` al final), **la entrega fallará**. Usa la URL exacta final del endpoint.
* **Responde rápido (`HTTP 200` en menos de 10 segundos)**: El timeout máximo del gateway es `10,000 ms`. Tu endpoint debe recibir el JSON, guardar/encolar la actualización en tu sistema y responder `200 OK` de inmediato.
* **No exijas `Authorization: Bearer`**: El gateway autenticará la petición usando la firma criptográfica `X-SRI-Gateway-Signature` (HMAC-SHA256), no con token de usuario.

### 2. Configura tu URL en el Gateway (2 formas)
* **Opción A — Global para todo tu SaaS**: Ingresa `webhookUrl` al registrar tu plataforma en el [formulario de registro](/guide/provisioning#formulario-de-registro) (`POST /v1/api-clients`). Todas las facturas usarán esa URL por defecto.
* **Opción B — Por factura individual**: Envía `webhookUrl` dentro del body de `POST /v1/tenants/:tenantId/invoices`. Si la envías ahí, sobrescribe la URL global para esa factura puntual.

### 3. Verifica la firma de seguridad (`WEBHOOK_SIGNING_SECRET`)
Cada notificación llega firmada con la variable `WEBHOOK_SIGNING_SECRET` configurada en el servidor del gateway (Railway). Tu backend receptor debe comparar esa firma usando el algoritmo **HMAC-SHA256** (ver ejemplos abajo en Node.js y Python).

### 4. ¿Cómo probarlo rápido antes de programar?
1. Entra a **[webhook.site](https://webhook.site)** y copia la URL única HTTPS que te genera gratis (ej. `https://webhook.site/xxxxxxxx-...`).
2. Pégala como tu `webhookUrl` al registrar el SaaS o al emitir una factura de prueba.
3. En cuanto el SRI procese la factura, verás en vivo el JSON completo y los headers `X-SRI-Gateway-Signature` y `X-SRI-Gateway-Event` llegando a esa pantalla.
*(Si quieres probar contra tu PC local, expón tu puerto local con `ngrok http 3000` y usa la URL `https://xxxx.ngrok-free.app/webhooks/sri`)*.

---

## Validador de Firmas en Vivo

Utilice la siguiente herramienta para verificar firmas HMAC-SHA256, inspeccionar payloads reales o depurar discrepancias criptográficas:

<ClientOnly>
  <WebhookVerifier />
</ClientOnly>

---

## Especificación del Encabezado de Firma (HMAC-SHA256)

Cada llamada saliente del gateway incluye dos encabezados HTTP de verificación:

| Encabezado | Descripción | Ejemplo de Valor |
| :--- | :--- | :--- |
| **`X-SRI-Gateway-Signature`** | Firma criptográfica HMAC-SHA256 del cuerpo bruto en formato hexadecimal precedida por `sha256=`. | `sha256=a89f4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5` |
| **`X-SRI-Gateway-Event`** | Nombre canónico del evento emitido. | `sri.invoice.completed` |

::: danger VERIFICACIÓN SOBRE EL CUERPO BRUTO (RAW BYTES)
Debe calcular la firma HMAC utilizando los **bytes exactos sin procesar** (`rawBody`) recibidos en la petición HTTP. Nunca recalcule el hash a partir de un objeto JSON re-serializado (`JSON.stringify(req.body)`), ya que cualquier cambio en espacios en blanco o el orden de las propiedades invalidará la firma.
:::

---

## Estructura del Payload Notificado

```json
{
  "event": "sri.invoice.completed",
  "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "referenceId": "order_uuid_100234",
  "claveAcceso": "0911202601179001167400110010010000001231234567812",
  "ambiente": "1",
  "status": "AUTORIZADO",
  "numeroAutorizacion": "0911202601179001167400110010010000001231234567812",
  "fechaAutorizacion": "2026-11-09T18:50:05.000Z",
  "authorizedXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><autorizacion>...</autorizacion>",
  "sriMessages": [],
  "timestamp": "2026-11-09T18:50:06.120Z"
}
```

---

## Implementación de Receptores de Webhooks

::: code-group

```typescript [Node.js (Express)]
import express from 'express';
import crypto from 'node:crypto';

const app = express();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'whsec_tu_secreto_configurado';

// IMPORTANTE: Capturar el raw body como Buffer antes de que Express lo parsee
app.post(
  '/webhooks/sri',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const signatureHeader = req.headers['x-sri-gateway-signature'];
    if (!signatureHeader || typeof signatureHeader !== 'string') {
      return res.status(401).send('Firma de webhook ausente');
    }

    // Calcular HMAC-SHA256 con el raw buffer
    const computedSignature = `sha256=${crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex')}`;

    // Comparación en tiempo constante para mitigar ataques de temporización
    const match = crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(computedSignature)
    );

    if (!match) {
      console.error('Firma de webhook inválida');
      return res.status(401).send('Firma no autorizada');
    }

    // Parsear el JSON seguro tras verificar autenticidad
    const payload = JSON.parse(req.body.toString('utf-8'));
    console.log(`Comprobante ${payload.claveAcceso} procesado: ${payload.status}`);

    // Responder 200 OK inmediatamente
    res.status(200).json({ received: true });
  }
);

app.listen(3000, () => console.log('Listener escuchando en puerto 3000'));
```

```python [Python (FastAPI)]
from fastapi import FastAPI, Request, HTTPException, status
import hmac
import hashlib
import json
import os

app = FastAPI()
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "whsec_tu_secreto_configurado").encode("utf-8")

@app.post("/webhooks/sri")
async def handle_sri_webhook(request: Request):
    signature_header = request.headers.get("x-sri-gateway-signature")
    if not signature_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Firma de webhook ausente"
        )

    # Leer los bytes exactos sin procesar
    raw_body = await request.body()
    
    # Calcular resumen HMAC-SHA256
    computed_digest = hmac.new(WEBHOOK_SECRET, raw_body, hashlib.sha256).hexdigest()
    expected_header = f"sha256={computed_digest}"

    # Comparación segura en tiempo constante
    if not hmac.compare_digest(signature_header, expected_header):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Firma de webhook inválida"
        )

    payload = json.loads(raw_body.decode("utf-8"))
    print(f"Comprobante {payload.get('claveAcceso')}: {payload.get('status')}")

    return {"received": True}
```

:::

---

## Mitigación de Vulnerabilidades SSRF y Replay Attacks

Para blindar la infraestructura frente a vectores de ataque comunes:

### 1. Protección contra SSRF (Server-Side Request Forgery)

El servicio `WebhookService` analiza la URL de destino configurada por el SaaS antes de disparar la conexión HTTP saliente:
- **Metadatos de Nube Bloqueados**: Se rechazan de forma irrefutable destinos que apunten a direcciones de metadatos de proveedores cloud (ej. `169.254.169.254`, `metadata.google.internal`).
- **Bloqueo de Loopback / Redes Privadas**: En entornos de producción (`NODE_ENV === 'production'`), se bloquean direcciones de loopback (`127.0.0.1`, `localhost`) y rangos RFC 1918 (`10.0.0.0/8`, `192.168.0.0/16`, etc.).
- **Prohibición de Redirecciones**: Se configura de manera explícita `maxRedirects: 0` en el cliente HTTP para evitar que un atacante sortee los filtros mediante saltos `301/302`.
- **Límites de Timeout**: Timeout máximo de `10,000 ms` por intento de entrega para evitar la retención de sockets.

### 2. Prevención de Ataques de Repetición (Replay Attacks)

Cada notificación incluye una marca de tiempo ISO 8601 (`timestamp`) y un identificador único de trabajo (`jobId`):
- Los receptores deben verificar que el campo `timestamp` se encuentre dentro de una tolerancia razonable (ej. no mayor a 5 minutos respecto a la hora del servidor receptor).
- Los receptores pueden utilizar el `jobId` para registrar entregas previas en una caché de idempotencia (ej. Redis `SET key value EX 86400 NX`).
