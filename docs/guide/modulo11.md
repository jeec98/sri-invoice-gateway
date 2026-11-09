# Algoritmo Módulo 11 y Clave de Acceso SRI

La **Clave de Acceso** es una cadena numérica única de **49 dígitos** que identifica de forma inequívoca cada comprobante electrónico emitido en el Ecuador. Los primeros 48 dígitos codifican la información tributaria y técnica del comprobante, mientras que el dígito 49 es un **dígito verificador** calculado mediante el algoritmo **Módulo 11 con ponderación cíclica**.

---

## Calculadora Interactiva en Vivo

Utilice esta herramienta para verificar claves de 49 dígitos existentes, calcular el dígito verificador a partir de 48 dígitos base, o generar claves de prueba válidas en su navegador:

<ClientOnly>
  <Modulo11Calculator />
</ClientOnly>

---

## Estructura de los 48 Dígitos Base

Los 48 dígitos iniciales se componen de los siguientes campos ordenados estrictamente:

| Posición | Campo | Longitud | Descripción / Formato | Ejemplo |
| :---: | :--- | :---: | :--- | :--- |
| **1 – 8** | `fechaEmision` | 8 | Fecha en formato `ddmmaaaa` | `09112026` |
| **9 – 10** | `tipoComprobante` | 2 | Tipo de documento (`01` = Factura, `04` = Nota de Crédito) | `01` |
| **11 – 23** | `ruc` | 13 | RUC del emisor (13 dígitos numéricos) | `1790011674001` |
| **24** | `tipoAmbiente` | 1 | `1` = Pruebas, `2` = Producción | `1` |
| **25 – 27** | `establecimiento` | 3 | Código del establecimiento emisor (tres dígitos) | `001` |
| **28 – 30** | `puntoEmision` | 3 | Código del punto de emisión (tres dígitos) | `001` |
| **31 – 39** | `secuencial` | 9 | Número correlativo secuencial de 9 dígitos | `000000123` |
| **40 – 47** | `codigoNumerico` | 8 | Código numérico aleatorio de seguridad | `12345678` |
| **48** | `tipoEmision` | 1 | Tipo de emisión (`1` = Normal) | `1` |
| **49** | `digitoVerificador` | 1 | Dígito calculado mediante Módulo 11 | *(Calculado)* |

---

## Derivación Matemática del Módulo 11

El algoritmo oficial especificado en la ficha técnica de comprobantes electrónicos del SRI opera de la siguiente manera:

### Paso 1: Ponderación Cíclica de Derecha a Izquierda

A cada uno de los 48 dígitos se le asigna un factor de ponderación (peso) que sigue la secuencia cíclica `[2, 3, 4, 5, 6, 7]`, comenzando desde el dígito de la derecha (posición 48) hacia el de la izquierda (posición 1):

- Dígito en posición 48: se multiplica por `2`
- Dígito en posición 47: se multiplica por `3`
- Dígito en posición 46: se multiplica por `4`
- Dígito en posición 45: se multiplica por `5`
- Dígito en posición 44: se multiplica por `6`
- Dígito en posición 43: se multiplica por `7`
- Dígito en posición 42: se reinicia el ciclo y se multiplica por `2`, y así sucesivamente hasta la posición 1.

### Paso 2: Suma de Productos

Se calcula la suma algebraica de los 48 productos individuales:

$$\text{Suma} = \sum_{i=1}^{48} (\text{dígito}_i \times \text{peso}_i)$$

### Paso 3: Cálculo del Residuo

Se divide la suma total entre 11 para obtener el residuo:

$$\text{Residuo} = \text{Suma} \pmod{11}$$

### Paso 4: Mapeo de Casos Especiales

El SRI define tres reglas deterministas para calcular el dígito verificador final a partir del residuo:

1. **Si el residuo es `0`**: El dígito verificador es **`0`**.
2. **Si el residuo es `1`**: El dígito verificador es **`1`**.
3. **Cualquier otro residuo (2 al 10)**:
   $$\text{Dígito Verificador} = 11 - \text{Residuo}$$
   - Si el resultado es `10`, el dígito verificador se convierte en **`1`**.
   - Si el resultado es `11`, el dígito verificador se convierte en **`0`**.
   - En cualquier otro caso, se toma el valor directo (del 2 al 9).

---

## Ejemplo Numérico Detallado

Considere los últimos dígitos de una clave:

```text
... 1  2  3  4  5  6  7  8  1
... 4  3  2  7  6  5  4  3  2  (pesos asignados de der a izq)
---------------------------------
... 4  6  6 28 30 30 28 24  2  (productos individuales)
```

Al sumar los 48 productos ponderados, supongamos una suma total acumulada de `487`:

1. `487 / 11 = 44` con residuo `3` ($487 = 44 \times 11 + 3$).
2. Como el residuo no es ni 0 ni 1, aplicamos la resta:
   $$\text{DV} = 11 - 3 = 8$$
3. El dígito verificador resultante es **`8`**.
4. La clave completa de 49 dígitos se forma añadiendo `8` al final de la cadena base de 48 dígitos.
