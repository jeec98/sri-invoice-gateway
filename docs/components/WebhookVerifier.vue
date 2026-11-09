<template>
  <div class="wh-verifier" role="region" aria-label="Validador de Firmas Webhook HMAC-SHA256">
    <div class="wh-card">
      <div class="wh-header">
        <h3 class="wh-title">Validador de Firmas HMAC-SHA256 para Webhooks</h3>
        <p class="wh-subtitle">
          Verifique la autenticidad del encabezado <code>X-SRI-Gateway-Signature</code> utilizando la Web Crypto API del navegador. La firma se calcula sobre los bytes exactos del cuerpo recibido utilizando su secreto de webhook.
        </p>
      </div>

      <!-- Quick sample loader buttons -->
      <div class="wh-sample-bar">
        <span class="wh-sample-label">Ejemplos predefinidos:</span>
        <button
          type="button"
          class="wh-sample-btn"
          @click="loadSample('AUTORIZADO')"
          aria-label="Cargar payload de factura autorizada"
        >
          Factura Autorizada
        </button>
        <button
          type="button"
          class="wh-sample-btn"
          @click="loadSample('DEVUELTA')"
          aria-label="Cargar payload de factura devuelta con error"
        >
          Factura Devuelta (Error SRI)
        </button>
      </div>

      <div class="wh-grid">
        <!-- Secret Input -->
        <div class="wh-form-group">
          <label for="wh-secret" class="wh-label">
            Secreto de Firma Webhook (Shared Secret):
            <span class="wh-req">*obligatorio</span>
          </label>
          <div class="wh-input-wrapper">
            <input
              id="wh-secret"
              v-model="secret"
              :type="showSecret ? 'text' : 'password'"
              autocomplete="off"
              spellcheck="false"
              class="wh-input font-mono"
              :class="{ 'is-invalid': !secret && submitted }"
              placeholder="whsec_test_secret_..."
            />
            <button
              type="button"
              class="wh-eye-btn"
              @click="showSecret = !showSecret"
              :aria-label="showSecret ? 'Ocultar secreto' : 'Mostrar secreto'"
            >
              <svg v-if="!showSecret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Provided Signature Header Input -->
        <div class="wh-form-group">
          <label for="wh-header" class="wh-label">
            Encabezado X-SRI-Gateway-Signature Recibido (opcional para comparar):
          </label>
          <input
            id="wh-header"
            v-model="providedHeader"
            type="text"
            autocomplete="off"
            spellcheck="false"
            class="wh-input font-mono"
            placeholder="sha256=a89f4b3c..."
          />
        </div>
      </div>

      <!-- Payload Textarea -->
      <div class="wh-form-group">
        <div class="wh-label-row">
          <label for="wh-payload" class="wh-label">
            Cuerpo del Payload (Raw JSON String):
          </label>
          <span
            v-if="payload"
            class="wh-json-badge"
            :class="jsonValidation.isValidJson ? 'badge-json-ok' : 'badge-json-err'"
          >
            {{ jsonValidation.isValidJson ? 'JSON Válido' : 'JSON Inválido' }}
          </span>
        </div>

        <!-- JSON Warning if malformed -->
        <div v-if="payload && !jsonValidation.isValidJson" class="wh-syntax-alert" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{{ jsonValidation.error }} (Nota: Verifique la firma contra los bytes brutos sin formatear recibidos por HTTP).</span>
        </div>

        <textarea
          id="wh-payload"
          v-model="payload"
          rows="8"
          spellcheck="false"
          class="wh-textarea font-mono"
          placeholder='{"event":"sri.invoice.completed", ...}'
        ></textarea>
      </div>

      <!-- Actions -->
      <div class="wh-actions">
        <button
          type="button"
          class="wh-btn wh-btn-primary"
          :disabled="isCalculating"
          @click="handleCalculate"
          aria-label="Calcular firma HMAC-SHA256"
        >
          <svg v-if="!isCalculating" class="wh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span v-else class="wh-spinner"></span>
          {{ isCalculating ? 'Calculando...' : 'Calcular Firma HMAC' }}
        </button>

        <button
          type="button"
          class="wh-btn wh-btn-secondary"
          @click="handleClear"
          aria-label="Limpiar campos"
        >
          Limpiar
        </button>

        <button
          v-if="computedSignature"
          type="button"
          class="wh-btn wh-btn-copy"
          @click="handleCopySignature"
          :aria-label="copied ? 'Firma copiada' : 'Copiar firma calculada'"
        >
          <svg v-if="!copied" class="wh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <svg v-else class="wh-icon icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {{ copied ? '¡Firma Copiada!' : 'Copiar Firma' }}
        </button>
      </div>

      <!-- Result Section -->
      <div v-if="computedSignature || verificationError" class="wh-results" aria-live="polite">
        <!-- Missing Secret Alert -->
        <div v-if="verificationError" class="wh-banner banner-error" role="alert">
          <div class="banner-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div class="banner-content">
            <div class="banner-title">Error de Validación</div>
            <div class="banner-desc">{{ verificationError }}</div>
          </div>
        </div>

        <!-- Signature Output Display -->
        <div v-if="computedSignature" class="wh-sig-box">
          <div class="sig-label">Firma HMAC-SHA256 Calculada:</div>
          <code class="sig-value">{{ computedSignature }}</code>
        </div>

        <!-- Verification Match Status when header provided -->
        <div v-if="computedSignature && providedHeader.trim()" class="wh-comparison">
          <!-- Match Success -->
          <div v-if="isMatch" class="wh-banner banner-success" role="status">
            <div class="banner-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div class="banner-content">
              <div class="banner-title">FIRMA VÁLIDA — AUTENTICIDAD CONFIRMADA</div>
              <div class="banner-desc">
                El encabezado recibido coincide exactamente en tiempo constante con el resumen HMAC generado. El mensaje proviene legítimamente de SRI Invoice Gateway.
              </div>
            </div>
          </div>

          <!-- Match Failure -->
          <div v-else class="wh-banner banner-error" role="alert">
            <div class="banner-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <div class="banner-content">
              <div class="banner-title">FIRMA INVÁLIDA — DISCREPANCIA DETECTADA</div>
              <div class="banner-desc">
                La firma provista no coincide. Causas comunes:
                <ul class="wh-causes-list">
                  <li>El secreto configurado en el receptor difiere del configurado en el gateway.</li>
                  <li>El cuerpo HTTP fue alterado por un proxy o middleware (espacios en blanco, saltos de línea).</li>
                  <li>Falta el prefijo obligatorio <code>sha256=</code>.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  computeHmacSha256,
  verifyWebhookSignature,
  validateJsonPayload,
} from './utils/webhook-crypto';

const secret = ref('whsec_test_secret_123');
const showSecret = ref(false);
const providedHeader = ref('');
const payload = ref('');
const computedSignature = ref('');
const isMatch = ref(false);
const verificationError = ref('');
const isCalculating = ref(false);
const copied = ref(false);
const submitted = ref(false);

const jsonValidation = computed(() => {
  return validateJsonPayload(payload.value);
});

const samplePayloads: Record<string, object> = {
  AUTORIZADO: {
    event: 'sri.invoice.completed',
    jobId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    referenceId: 'order_ref_982341',
    claveAcceso: '0711202601179001167400110010010000001231234567818',
    ambiente: '1',
    status: 'AUTORIZADO',
    numeroAutorizacion: '0711202601179001167400110010010000001231234567818',
    fechaAutorizacion: '2026-11-07T14:32:15.000Z',
    authorizedXml: '<?xml version="1.0" encoding="UTF-8"?><autorizacion>...</autorizacion>',
    sriMessages: [],
    timestamp: '2026-11-07T14:32:16.120Z',
  },
  DEVUELTA: {
    event: 'sri.invoice.completed',
    jobId: '8a2b3c4d-1122-3344-5566-778899aabbcc',
    referenceId: 'order_ref_982342',
    claveAcceso: '0711202601179001167400110010010000001231234567818',
    ambiente: '1',
    status: 'DEVUELTA',
    numeroAutorizacion: null,
    fechaAutorizacion: null,
    authorizedXml: null,
    sriMessages: [
      {
        identificador: '43',
        mensaje: 'CLAVE ACCESO REGISTRADA',
        informacionAdicional: 'El comprobante ya fue emitido previamente con la misma clave.',
        tipo: 'ERROR',
      },
    ],
    timestamp: '2026-11-07T14:35:10.000Z',
  },
};

function loadSample(statusKey: 'AUTORIZADO' | 'DEVUELTA') {
  const sampleObj = samplePayloads[statusKey];
  if (sampleObj) {
    payload.value = JSON.stringify(sampleObj, null, 2);
    // Auto-calculate with current secret
    handleCalculate();
  }
}

async function handleCalculate() {
  submitted.value = true;
  verificationError.value = '';
  computedSignature.value = '';

  const cleanSecret = secret.value.trim();
  if (!cleanSecret) {
    verificationError.value = 'El secreto del webhook es obligatorio para calcular la firma HMAC.';
    return;
  }

  isCalculating.value = true;
  try {
    const rawPayload = payload.value;
    const sig = await computeHmacSha256(rawPayload, cleanSecret);
    computedSignature.value = sig;

    if (providedHeader.value.trim()) {
      const res = await verifyWebhookSignature(rawPayload, cleanSecret, providedHeader.value);
      isMatch.value = res.match;
    } else {
      isMatch.value = false;
    }
  } catch (err: unknown) {
    verificationError.value = err instanceof Error ? err.message : String(err);
  } finally {
    isCalculating.value = false;
  }
}

function handleClear() {
  payload.value = '';
  providedHeader.value = '';
  computedSignature.value = '';
  verificationError.value = '';
  isMatch.value = false;
  submitted.value = false;
  copied.value = false;
}

async function handleCopySignature() {
  if (!computedSignature.value) return;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(computedSignature.value);
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 2000);
    }
  } catch {
    copied.value = false;
  }
}
</script>

<style scoped>
.wh-verifier {
  margin: 1.5rem 0;
  font-family: var(--vp-font-family-base);
}

.wh-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.wh-header {
  margin-bottom: 1.25rem;
}

.wh-title {
  margin: 0 0 0.5rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.wh-subtitle {
  margin: 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.45;
}

.wh-sample-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
  padding: 0.65rem 0.85rem;
  background: var(--vp-c-bg-alt);
  border-radius: var(--radius-md);
}

.wh-sample-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--vp-c-text-3);
}

.wh-sample-btn {
  min-height: 36px;
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s;
}

.wh-sample-btn:hover {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
}

.wh-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

@media (min-width: 768px) {
  .wh-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.wh-form-group {
  margin-bottom: 1.25rem;
}

.wh-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  margin-bottom: 0.5rem;
}

.wh-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.wh-req {
  font-size: 0.75rem;
  color: var(--color-error);
  font-weight: normal;
  margin-left: 0.25rem;
}

.wh-json-badge {
  font-size: 0.75rem;
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-sm);
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
}

.badge-json-ok {
  background: var(--color-success-bg);
  color: var(--color-success);
  border: 1px solid var(--color-success-border);
}

.badge-json-err {
  background: var(--color-warning-bg);
  color: var(--color-warning);
  border: 1px solid var(--color-warning-border);
}

.wh-syntax-alert {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
  border-radius: var(--radius-sm);
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  color: var(--color-warning);
}

.wh-syntax-alert svg {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

.wh-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.wh-input,
.wh-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0.75rem 1rem;
  font-size: 0.9rem;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-md);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.wh-input {
  min-height: var(--touch-target-min);
  padding-right: 2.75rem;
}

.wh-input:hover,
.wh-textarea:hover {
  border-color: var(--vp-c-brand-2);
}

.wh-input:focus,
.wh-textarea:focus {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
  border-color: var(--vp-c-brand-1);
}

.wh-input.is-invalid {
  border-color: var(--color-error);
  background: var(--color-error-bg);
}

.wh-eye-btn {
  position: absolute;
  right: 0.5rem;
  min-width: 36px;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--vp-c-text-3);
  cursor: pointer;
  border-radius: var(--radius-sm);
}

.wh-eye-btn:hover {
  color: var(--vp-c-text-1);
}

.wh-eye-btn svg {
  width: 1.15rem;
  height: 1.15rem;
}

.wh-textarea {
  line-height: 1.45;
  resize: vertical;
}

.wh-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.wh-btn {
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

.wh-btn:active {
  transform: scale(0.98);
}

.wh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.wh-btn-primary {
  background: var(--vp-c-brand-1);
  color: #ffffff;
  border: 1px solid var(--vp-c-brand-2);
}

.wh-btn-primary:hover {
  background: var(--vp-c-brand-2);
}

.wh-btn-secondary {
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  border: 1px solid var(--vp-c-border);
}

.wh-btn-secondary:hover {
  border-color: var(--vp-c-brand-1);
}

.wh-btn-copy {
  background: var(--color-success-bg);
  color: var(--color-success);
  border: 1px solid var(--color-success-border);
  font-weight: 600;
}

.wh-btn-copy:hover {
  filter: brightness(0.95);
}

.wh-icon {
  width: 1.1rem;
  height: 1.1rem;
}

.icon-success {
  color: var(--color-success);
}

.wh-spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid #ffffff;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Results Section */
.wh-results {
  margin-top: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.wh-sig-box {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-md);
  padding: 1rem;
}

.sig-label {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  font-weight: 500;
  margin-bottom: 0.35rem;
}

.sig-value {
  display: block;
  font-family: var(--vp-font-family-mono);
  font-size: 0.9rem;
  color: var(--vp-c-brand-1);
  word-break: break-all;
}

.wh-banner {
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

.wh-causes-list {
  margin: 0.5rem 0 0 1.25rem;
  padding: 0;
}

.wh-causes-list li {
  margin-bottom: 0.25rem;
}

.font-mono {
  font-family: var(--vp-font-family-mono);
}
</style>
