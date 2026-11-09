# Límites de Tasa (Rate Limiting) y Ventana Deslizante

Para proteger la disponibilidad del clúster y evitar la saturación abusiva de las colas de procesamiento, `sri-invoice-gateway` implementa un mecanismo de limitación de tasa por cliente (**Per-Client Sliding Window Rate Limiting**) respaldado por memoria Redis.

---

## Mecanismo de Ventana Deslizante en Redis

A diferencia de una ventana fija (que permite ráfagas repentinas en los bordes de cada minuto), el algoritmo de **ventana deslizante** calcula la tasa exacta de llamadas en los últimos 60 segundos móviles:

```
Tiempo (segundos)  ----[ 10s ]----[ 20s ]----[ 40s ]----[ 55s ]----► [ AHORA ]
                       |                                    |
                       └──────── Ventana de 60s ────────────┘
                         Conteo de llamadas activas en Redis ZSET
```

1. **Estructura Redis**: Se utiliza un Sorted Set (`ZSET`) por cada `apiClientId`, donde el `score` y el valor corresponden a la marca de tiempo en milisegundos de cada petición.
2. **Purgado Atómico**: En cada llamada, se eliminan los registros con antigüedad superior a 60 segundos (`ZREMRANGEBYSCORE`).
3. **Evaluación de Concurrencia**: Se evalúa la cardinalidad del conjunto (`ZCARD`). Si el número de peticiones excede el límite contratado (`rateLimitPerMinute`), se rechaza la solicitud antes de tocar la base de datos o encolar trabajos.
4. **Resiliencia (Fail-Open)**: En caso fortuito de interrupción temporal de la conexión con Redis, el guardián de tasa (`RateLimitGuard`) opera bajo una política *fail-open* registrando una alerta en logs para no interrumpir la facturación crítica de los clientes.

---

## Encabezados de Respuesta HTTP

Todas las peticiones autenticadas devuelven en sus encabezados el estado de cuota del integrador:

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 115
X-RateLimit-Reset: 1731174660
```

| Encabezado | Descripción |
| :--- | :--- |
| **`X-RateLimit-Limit`** | Número máximo de peticiones permitidas en la ventana móvil de un minuto para este integrador SaaS. |
| **`X-RateLimit-Remaining`** | Número de peticiones restantes disponibles en la ventana actual antes de ser bloqueado. |
| **`X-RateLimit-Reset`** | Marca de tiempo Unix (en segundos) en la cual se liberará cuota disponible. |

---

## Manejo del Error HTTP 429 Too Many Requests

Cuando un cliente supera su límite asignado, el gateway responde inmediatamente con el código `429`:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 15
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1731174675

{
  "statusCode": 429,
  "message": "RATE_LIMIT_EXCEEDED: Se ha superado el límite de 120 peticiones por minuto para su cuenta. Por favor intente nuevamente en 15 segundos.",
  "error": "Too Many Requests"
}
```

### Encabezado `Retry-After`

El encabezado `Retry-After` indica el tiempo exacto en segundos que el cliente debe suspender el envío de nuevas peticiones para recuperar capacidad en la ventana deslizante.

---

## Recomendaciones para Clientes Integradores

1. **Respetar el Encabezado `Retry-After`**: Si su aplicación recibe un código `429`, suspenda inmediatamente las peticiones automáticas durante los segundos señalados en `Retry-After`.
2. **Implementar Retroceso Exponencial con Jitter**:
   $$\text{Espera} = \min(\text{maxBackoff}, \text{base} \times 2^{\text{intento}}) + \text{randomJitter}$$
   El componente aleatorio (*jitter*) evita el problema del "efecto manada" (*thundering herd*) donde múltiples hilos de su sistema despiertan e impactan la API exactamente al mismo instante.
3. **Separación de Tráfico**: Aísle las llamadas de facturación transaccional urgente de las consultas masivas de reportería o reconciliación de estados para no agotar la cuota disponible.
