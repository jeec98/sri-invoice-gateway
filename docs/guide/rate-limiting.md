# Límites de Velocidad (Rate Limiting)

Para evitar saturar las colas de envío al SRI y asegurar estabilidad para todos los usuarios, cada plataforma SaaS cuenta con un límite estándar de **20 peticiones por segundo (`20 req/s`)**.

---

## Encabezados de Respuesta

En cada respuesta de la API verás cuánta cuota te queda disponible en ese segundo:

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 19
```

| Encabezado | Significado |
| :--- | :--- |
| **`X-RateLimit-Limit`** | Límite máximo permitido por segundo (`20`). |
| **`X-RateLimit-Remaining`** | Peticiones restantes en la ventana actual. |

---

## Qué hacer si recibes `429 Too Many Requests`

Si envías más de 20 peticiones en un mismo segundo, la API responderá temporalmente con el código HTTP `429`:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 1
```

```json
{
  "statusCode": 429,
  "message": "RATE_LIMIT_EXCEEDED: Se ha superado el límite de peticiones por segundo permitido para su plataforma (20 req/s)"
}
```

### Buenas prácticas
* Si recibes `429`, espera el tiempo indicado en **`Retry-After`** (normalmente 1 segundo) antes de reintentar.
* Si vas a emitir lotes grandes de facturas al cierre del día, envíalas de forma espaciada o en pequeños lotes en lugar de todas al mismo milisegundo.
