<template>
  <div class="m11-calculator" role="region" aria-label="Calculadora SRI Módulo 11">
    <div class="m11-card">
      <div class="m11-header">
        <h3 class="m11-title">Validador y Calculador de Clave de Acceso (Módulo 11)</h3>
        <p class="m11-subtitle">
          Ingrese los 48 dígitos base para derivar el dígito verificador, o pegue una clave completa de 49 dígitos para validar su integridad matemática según la ficha técnica del SRI.
        </p>
      </div>

      <div class="m11-form-group">
        <label for="m11-input" class="m11-label">
          Clave de Acceso (48 o 49 dígitos numéricos):
          <span class="m11-char-count" :class="{ 'count-valid': isLengthValid, 'count-warn': !isLengthValid }">
            {{ cleanDigits.length }} / 49
          </span>
        </label>
        <div class="m11-input-wrapper">
          <input
            id="m11-input"
            v-model="rawInput"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            class="m11-input"
            :class="{ 'is-invalid': hasError, 'is-valid': isInputValid }"
            placeholder="Ej. 071120260117900116740011001001000000123123456781..."
            aria-describedby="m11-feedback"
          />
        </div>
      </div>

      <div class="m11-actions">
        <button
          type="button"
          class="m11-btn m11-btn-primary"
          @click="handleGenerateTestKey"
          aria-label="Generar una clave de acceso sintética válida para pruebas"
        >
          <svg class="m11-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
          Generar Clave de Prueba
        </button>

        <button
          type="button"
          class="m11-btn m11-btn-secondary"
          :disabled="!rawInput"
          @click="handleClear"
          aria-label="Limpiar campo de entrada"
        >
          Limpiar
        </button>

        <button
          v-if="result && result.isValid"
          type="button"
          class="m11-btn m11-btn-copy"
          @click="handleCopyKey"
          :aria-label="copied ? 'Clave copiada al portapapeles' : 'Copiar clave de 49 dígitos'"
        >
          <svg v-if="!copied" class="m11-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <svg v-else class="m11-icon icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {{ copied ? '¡Copiado!' : 'Copiar Clave (49d)' }}
        </button>
      </div>

      <!-- Feedback Banner -->
      <div id="m11-feedback" class="m11-feedback" aria-live="polite">
        <!-- Error State -->
        <div v-if="hasError" class="m11-banner banner-error" role="alert">
          <div class="banner-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div class="banner-content">
            <div class="banner-title">{{ errorTitle }}</div>
            <div class="banner-desc">{{ errorMessage }}</div>
          </div>
        </div>

        <!-- Valid 49-digit state -->
        <div v-else-if="result && result.is49Digits && result.isValid" class="m11-banner banner-success" role="status">
          <div class="banner-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div class="banner-content">
            <div class="banner-title">CLAVE DE ACCESO VÁLIDA (49 DÍGITOS)</div>
            <div class="banner-desc">
              El dígito verificador <strong>{{ result.providedCheckDigit }}</strong> coincide exactamente con el algoritmo Módulo 11 (Suma: {{ result.sum }}, Residuo: {{ result.remainder }}).
            </div>
          </div>
        </div>

        <!-- Computed 48-digit state -->
        <div v-else-if="result && result.is48Digits && result.isValid" class="m11-banner banner-info" role="status">
          <div class="banner-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </div>
          <div class="banner-content">
            <div class="banner-title">DÍGITO VERIFICADOR CALCULADO: {{ result.computedCheckDigit }}</div>
            <div class="banner-desc">
              Clave completa de 49 dígitos resultante:
              <code class="m11-code-result">{{ result.fullAccessKey }}</code>
            </div>
          </div>
        </div>
      </div>

      <!-- Segment Breakdown & Calculation Steps -->
      <div v-if="result && result.isValid && segments" class="m11-segments-section">
        <h4 class="m11-section-title">Estructura Desglosada de la Clave</h4>
        <div class="m11-segments-grid">
          <div class="m11-segment-card">
            <span class="segment-label">Fecha Emisión</span>
            <span class="segment-value">{{ segments.fecha }}</span>
          </div>
          <div class="m11-segment-card">
            <span class="segment-label">Tipo Comprobante</span>
            <span class="segment-value">{{ segments.tipoComprobante }} (Factura)</span>
          </div>
          <div class="m11-segment-card">
            <span class="segment-label">RUC Emisor</span>
            <span class="segment-value">{{ segments.ruc }}</span>
          </div>
          <div class="m11-segment-card">
            <span class="segment-label">Ambiente</span>
            <span class="segment-value">{{ segments.ambiente === '1' ? '1 (Pruebas)' : '2 (Producción)' }}</span>
          </div>
          <div class="m11-segment-card">
            <span class="segment-label">Serie (Estab + Pto)</span>
            <span class="segment-value">{{ segments.serie }}</span>
          </div>
          <div class="m11-segment-card">
            <span class="segment-label">Secuencial</span>
            <span class="segment-value">{{ segments.secuencial }}</span>
          </div>
          <div class="m11-segment-card">
            <span class="segment-label">Código Numérico</span>
            <span class="segment-value">{{ segments.codigoNumerico }}</span>
          </div>
          <div class="m11-segment-card">
            <span class="segment-label">Tipo Emisión</span>
            <span class="segment-value">{{ segments.tipoEmision }} (Normal)</span>
          </div>
          <div class="m11-segment-card segment-highlight">
            <span class="segment-label">Dígito Verificador</span>
            <span class="segment-value">{{ result.computedCheckDigit }}</span>
          </div>
        </div>
      </div>

      <!-- Mathematical Breakdown Table Toggle -->
      <div v-if="result && result.breakdown.length > 0" class="m11-breakdown-section">
        <button
          type="button"
          class="m11-toggle-btn"
          @click="showBreakdown = !showBreakdown"
          :aria-expanded="showBreakdown"
          aria-controls="m11-table-container"
        >
          <span>{{ showBreakdown ? 'Ocultar' : 'Ver' }} Desglose Matemático Ponderado (Pesos 2..7)</span>
          <svg class="m11-toggle-icon" :class="{ 'icon-rotated': showBreakdown }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div v-if="showBreakdown" id="m11-table-container" class="m11-table-container">
          <p class="m11-table-help">
            Los pesos [7, 6, 5, 4, 3, 2] se asignan de derecha a izquierda (desde la posición 48 hacia la 1). Suma acumulada ponderada: <strong>{{ result.sum }}</strong>.
            Fórmula: <code>{{ result.sum }} mod 11 = {{ result.remainder }}</code>.
            {{ result.remainder === 0 ? 'Residuo 0 -> DV 0' : result.remainder === 1 ? 'Residuo 1 -> DV 1' : `11 - ${result.remainder} = ${result.computedCheckDigit}` }}.
          </p>
          <div class="m11-table-scroll">
            <table class="m11-table">
              <thead>
                <tr>
                  <th scope="col">Pos</th>
                  <th scope="col">Dígito</th>
                  <th scope="col">Peso</th>
                  <th scope="col">Producto</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in result.breakdown" :key="row.position">
                  <td>{{ row.position }}</td>
                  <td class="font-mono">{{ row.digit }}</td>
                  <td>&times; {{ row.weight }}</td>
                  <td class="font-mono font-bold">{{ row.product }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th colspan="3" class="text-right">Suma Total:</th>
                  <th class="font-mono">{{ result.sum }}</th>
                </tr>
                <tr>
                  <th colspan="3" class="text-right">Residuo (Suma mod 11):</th>
                  <th class="font-mono">{{ result.remainder }}</th>
                </tr>
                <tr>
                  <th colspan="3" class="text-right">Dígito Verificador:</th>
                  <th class="font-mono font-bold text-brand">{{ result.computedCheckDigit }}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  calculateModulo11,
  verifyModulo11,
  generateTestAccessKey,
  type Modulo11CalculationResult,
} from './utils/modulo11';

const rawInput = ref('');
const copied = ref(false);
const showBreakdown = ref(false);

const cleanDigits = computed(() => {
  return rawInput.value.replace(/\s+/g, '');
});

const isLengthValid = computed(() => {
  return cleanDigits.value.length === 48 || cleanDigits.value.length === 49;
});

const calculation = computed<Modulo11CalculationResult | null>(() => {
  const input = cleanDigits.value;
  if (!input) return null;

  if (input.length === 49) {
    return verifyModulo11(input);
  }
  return calculateModulo11(input);
});

const result = computed(() => calculation.value);

const hasError = computed(() => {
  if (!cleanDigits.value) return false;
  if (!result.value) return false;
  return !result.value.isValid;
});

const isInputValid = computed(() => {
  return result.value ? result.value.isValid : false;
});

const errorTitle = computed(() => {
  if (!result.value) return '';
  if (result.value.is49Digits && !result.value.isValid) {
    return 'DÍGITO VERIFICADOR INVÁLIDO';
  }
  return 'FORMATO DE ENTRADA INVÁLIDO';
});

const errorMessage = computed(() => {
  if (!result.value) return '';
  return result.value.errorMessage || 'Verifique que la clave contenga exactamente 48 o 49 dígitos numéricos.';
});

const segments = computed(() => {
  const d = cleanDigits.value;
  if (d.length < 48) return null;
  return {
    fecha: d.slice(0, 8),
    tipoComprobante: d.slice(8, 10),
    ruc: d.slice(10, 23),
    ambiente: d.slice(23, 24),
    serie: d.slice(24, 30),
    secuencial: d.slice(30, 39),
    codigoNumerico: d.slice(39, 47),
    tipoEmision: d.slice(47, 48),
  };
});

function handleGenerateTestKey() {
  const key = generateTestAccessKey();
  rawInput.value = key;
}

function handleClear() {
  rawInput.value = '';
  copied.value = false;
  showBreakdown.value = false;
}

async function handleCopyKey() {
  if (!result.value || !result.value.fullAccessKey) return;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(result.value.fullAccessKey);
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 2000);
    }
  } catch {
    // Fallback if clipboard API is restricted
    copied.value = false;
  }
}
</script>

<style scoped>
.m11-calculator {
  margin: 1.5rem 0;
  font-family: var(--vp-font-family-base);
}

.m11-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.m11-header {
  margin-bottom: 1.25rem;
}

.m11-title {
  margin: 0 0 0.5rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.m11-subtitle {
  margin: 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.45;
}

.m11-form-group {
  margin-bottom: 1.25rem;
}

.m11-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  margin-bottom: 0.5rem;
}

.m11-char-count {
  font-size: 0.8rem;
  font-family: var(--vp-font-family-mono);
  padding: 0.15rem 0.4rem;
  border-radius: var(--radius-sm);
  background: var(--vp-c-bg-alt);
}

.count-valid {
  color: var(--color-success);
}

.count-warn {
  color: var(--vp-c-text-3);
}

.m11-input-wrapper {
  position: relative;
}

.m11-input {
  width: 100%;
  box-sizing: border-box;
  min-height: var(--touch-target-min);
  padding: 0.75rem 1rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.95rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-md);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.m11-input:hover {
  border-color: var(--vp-c-brand-2);
}

.m11-input:focus {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
  border-color: var(--vp-c-brand-1);
}

.m11-input.is-invalid {
  border-color: var(--color-error);
  background: var(--color-error-bg);
}

.m11-input.is-valid {
  border-color: var(--color-success);
}

.m11-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.m11-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: var(--touch-target-min);
  padding: 0.5rem 1.15rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.m11-btn:active {
  transform: scale(0.98);
}

.m11-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.m11-btn-primary {
  background: var(--vp-c-brand-1);
  color: #ffffff;
  border: 1px solid var(--vp-c-brand-2);
}

.m11-btn-primary:hover {
  background: var(--vp-c-brand-2);
}

.m11-btn-secondary {
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-border);
}

.m11-btn-secondary:hover {
  border-color: var(--vp-c-brand-1);
}

.m11-btn-copy {
  background: var(--color-success-bg);
  color: var(--color-success);
  border: 1px solid var(--color-success-border);
  font-weight: 600;
}

.m11-btn-copy:hover {
  filter: brightness(0.95);
}

.m11-icon {
  width: 1.1rem;
  height: 1.1rem;
}

.icon-success {
  color: var(--color-success);
}

/* Feedback Banners */
.m11-feedback {
  margin-bottom: 1.25rem;
}

.m11-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  padding: 1rem;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
}

.banner-icon svg {
  width: 1.4rem;
  height: 1.4rem;
  flex-shrink: 0;
  margin-top: 0.1rem;
}

.banner-title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
}

.banner-desc {
  font-size: 0.875rem;
  line-height: 1.4;
}

.banner-error {
  background: var(--color-error-bg);
  border-color: var(--color-error-border);
  color: var(--color-error);
}

.banner-success {
  background: var(--color-success-bg);
  border-color: var(--color-success-border);
  color: var(--color-success);
}

.banner-info {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.m11-code-result {
  display: block;
  margin-top: 0.4rem;
  padding: 0.5rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.9rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-sm);
  color: var(--vp-c-text-1);
  word-break: break-all;
}

/* Segments Grid */
.m11-segments-section {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--vp-c-border);
}

.m11-section-title {
  margin: 0 0 0.85rem 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.m11-segments-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.65rem;
}

.m11-segment-card {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-md);
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.m11-segment-card.segment-highlight {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.segment-label {
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
  font-weight: 500;
}

.segment-value {
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  word-break: break-all;
}

/* Breakdown Table */
.m11-breakdown-section {
  margin-top: 1.25rem;
}

.m11-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: var(--touch-target-min);
  padding: 0.6rem 0.85rem;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-md);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
}

.m11-toggle-icon {
  width: 1rem;
  height: 1rem;
  transition: transform 0.2s;
}

.icon-rotated {
  transform: rotate(180deg);
}

.m11-table-container {
  margin-top: 0.75rem;
}

.m11-table-help {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-bottom: 0.75rem;
  line-height: 1.4;
}

.m11-table-scroll {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-md);
}

.m11-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.m11-table th,
.m11-table td {
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--vp-c-border);
  text-align: left;
}

.m11-table thead th {
  position: sticky;
  top: 0;
  background: var(--vp-c-bg-alt);
  z-index: 1;
}

.m11-table tfoot th {
  background: var(--vp-c-bg-alt);
}

.font-mono {
  font-family: var(--vp-font-family-mono);
}

.font-bold {
  font-weight: 700;
}

.text-right {
  text-align: right;
}

.text-brand {
  color: var(--vp-c-brand-1);
}
</style>
