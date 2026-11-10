<template>
  <div class="sr-container" role="region" aria-label="Formulario de Registro de Plataforma SaaS">
    <div class="sr-card">
      <div class="sr-header">
        <div class="sr-badge">Registro En Vivo · POST /v1/api-clients</div>
        <h3 class="sr-title">Registrar Plataforma SaaS y Obtener API Key</h3>
        <p class="sr-subtitle">
          Completa este formulario para aprovisionar tu plataforma integradora directamente en el microservicio.
          Recuerda que <strong>solo puedes registrar cada RUC una única vez</strong> y que la <code>apiKey</code> generada no volverá a mostrarse.
        </p>
      </div>

      <form v-if="!createdClient" class="sr-form" @submit.prevent="handleSubmit" novalidate>
        <div class="sr-grid-2">
          <!-- Name -->
          <div class="sr-field">
            <label for="sr-name" class="sr-label">
              Nombre de la Plataforma SaaS <span class="sr-required">*</span>
            </label>
            <input
              id="sr-name"
              v-model="form.name"
              type="text"
              class="sr-input"
              :class="{ 'is-invalid': fieldErrors.name }"
              placeholder="Ej. FacturaCloud ERP SaaS"
            />
            <p class="sr-hint">Nombre comercial o identificador interno de tu plataforma.</p>
            <p v-if="fieldErrors.name" class="sr-error-text" role="alert">
              {{ fieldErrors.name }}
            </p>
          </div>

          <!-- RUC -->
          <div class="sr-field">
            <label for="sr-ruc" class="sr-label">
              RUC del Proveedor de Software (13 dígitos) <span class="sr-required">*</span>
            </label>
            <input
              id="sr-ruc"
              v-model="form.ruc"
              type="text"
              inputmode="numeric"
              maxlength="13"
              class="sr-input sr-mono"
              :class="{ 'is-invalid': fieldErrors.ruc }"
              placeholder="1790011674001"
            />
            <p class="sr-hint">
              Único por cuenta. Se inyectará automáticamente en <code>&lt;campoAdicional nombre="RUC Proveedor"&gt;</code> de cada XML (Res. NAC-DGERCGC26-00000027).
            </p>
            <p v-if="fieldErrors.ruc" class="sr-error-text" role="alert">
              {{ fieldErrors.ruc }}
            </p>
          </div>
        </div>

        <!-- Webhook URL -->
        <div class="sr-field">
          <label for="sr-webhook" class="sr-label">
            Webhook URL por Defecto <span class="sr-optional">(Opcional)</span>
          </label>
          <input
            id="sr-webhook"
            v-model="form.webhookUrl"
            type="url"
            class="sr-input sr-mono"
            :class="{ 'is-invalid': fieldErrors.webhookUrl }"
            placeholder="https://api.tusaas.com/webhooks/sri"
          />
          <p class="sr-hint">
            <strong>¿Para qué sirve?</strong> Es la URL HTTPS de tu servidor SaaS donde el gateway enviará automáticamente (vía POST firmado con HMAC-SHA256) el resultado del SRI (<code>AUTORIZADO</code>, <code>DEVUELTA</code>, etc.) sin tener que hacer consultas repetitivas.
          </p>
          <p v-if="fieldErrors.webhookUrl" class="sr-error-text" role="alert">
            {{ fieldErrors.webhookUrl }}
          </p>
        </div>

        <!-- Unified Plan Summary -->
        <div class="sr-quota-box">
          <div class="sr-quota-title">Esquema Único de Servicio Incluido</div>
          <ul class="sr-quota-list">
            <li>
              <strong>Multi-Tenant sin tope de negocios</strong>: Registra todos los negocios emisores (<code>Tenants</code>) y certificados <code>.p12</code> de tu SaaS.
            </li>
            <li>
              <strong>Tasa controlada</strong>: Cuota unificada de <strong>{{ UNIFIED_PLAN_LIMITS.rateLimitRps }} req/s</strong> en Redis por plataforma para proteger las colas del SRI.
            </li>
            <li>
              Incluye firma digital <strong>XAdES-BES</strong>, envío asíncrono al <strong>SRI</strong>, inyección automática de <code>RUC Proveedor</code> y <strong>Webhooks HMAC-SHA256</strong>.
            </li>
          </ul>
        </div>

        <!-- API Error Banner -->
        <div v-if="serverError" class="sr-banner sr-banner-error" role="alert">
          <div class="sr-banner-title">{{ serverError.title }}</div>
          <div class="sr-banner-desc">{{ serverError.detail }}</div>
        </div>

        <!-- Actions -->
        <div class="sr-actions">
          <button type="submit" class="sr-btn sr-btn-primary" :disabled="submitting">
            <span v-if="submitting">Registrando plataforma SaaS...</span>
            <span v-else>Registrar SaaS y Generar API Key</span>
          </button>
          <button
            type="button"
            class="sr-btn sr-btn-secondary"
            :disabled="submitting"
            @click="resetForm"
          >
            Limpiar
          </button>
        </div>
      </form>

      <!-- Success State -->
      <div v-else class="sr-success-panel" aria-live="polite">
        <div class="sr-banner sr-banner-warning" role="alert">
          <div class="sr-banner-title">COPIA TU API KEY AHORA MISMO — NO VOLVERÁ A MOSTRARSE</div>
          <div class="sr-banner-desc">
            Por seguridad, el gateway solo almacena el hash SHA-256 de esta clave en PostgreSQL. Si cierras esta vista sin copiarla, no podrás recuperarla.
          </div>
        </div>

        <div class="sr-key-box">
          <div class="sr-key-label">Tu Master API Key:</div>
          <div class="sr-key-row">
            <code class="sr-key-value">{{ createdClient.apiKey }}</code>
            <button type="button" class="sr-btn sr-btn-copy" @click="copyApiKey">
              {{ copiedKey ? '¡Copiada!' : 'Copiar API Key' }}
            </button>
          </div>
        </div>

        <div class="sr-summary-grid">
          <div class="sr-summary-item">
            <span class="sr-summary-label">Client ID</span>
            <code class="sr-summary-val">{{ createdClient.id }}</code>
          </div>
          <div class="sr-summary-item">
            <span class="sr-summary-label">Plataforma</span>
            <span class="sr-summary-val">{{ createdClient.name }}</span>
          </div>
          <div class="sr-summary-item">
            <span class="sr-summary-label">RUC Proveedor</span>
            <code class="sr-summary-val">{{ createdClient.ruc }}</code>
          </div>
          <div class="sr-summary-item">
            <span class="sr-summary-label">Rate Limit Asignado</span>
            <span class="sr-summary-val">
              {{ UNIFIED_PLAN_LIMITS.rateLimitRps }} req/s (Redis)
            </span>
          </div>
        </div>

        <div class="sr-next-step">
          <div class="sr-key-label">Siguiente paso: Registra tu primer negocio emisor (Tenant)</div>
          <pre class="sr-code-block"><code>curl -X POST {{ cleanBaseForSnippet }}/v1/tenants \
  -H "Authorization: Bearer {{ createdClient.apiKey }}" \
  -H "Content-Type: application/json" \
  -d '{
    "businessName": "Mi Empresa Emisora S.A.",
    "ruc": "1790011674001"
  }'</code></pre>
        </div>

        <div class="sr-actions">
          <button type="button" class="sr-btn sr-btn-secondary" @click="handleStartAnother">
            Registrar otro SaaS distinto
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  buildRegistrationEndpoint,
  buildRegistrationPayload,
  normalizeBaseUrl,
  SaasFormInput,
  UNIFIED_PLAN_LIMITS,
  validateSaasForm,
} from './utils/saas-registration';

interface CreatedApiClientResponse {
  id: string;
  name: string;
  ruc: string | null;
  apiKey: string;
  webhookUrl: string | null;
  status: string;
}

const configuredApiUrl =
  typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL
    ? normalizeBaseUrl(String(import.meta.env.VITE_API_BASE_URL))
    : '';

const form = reactive<SaasFormInput>({
  name: '',
  ruc: '',
  webhookUrl: '',
});

const fieldErrors = ref<Partial<Record<keyof SaasFormInput, string>>>({});
const serverError = ref<{ title: string; detail: string } | null>(null);
const submitting = ref(false);
const createdClient = ref<CreatedApiClientResponse | null>(null);
const copiedKey = ref(false);

const resolvedApiBaseUrl = computed(() => {
  if (configuredApiUrl) {
    return configuredApiUrl;
  }
  if (
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ) {
    return 'http://localhost:3000';
  }
  return '';
});

const cleanBaseForSnippet = computed(() => {
  const base = resolvedApiBaseUrl.value || 'https://api.tu-dominio.com';
  return base.endsWith('/v1') ? base.slice(0, -3) : base;
});

function resetForm() {
  form.name = '';
  form.ruc = '';
  form.webhookUrl = '';
  fieldErrors.value = {};
  serverError.value = null;
}

function handleStartAnother() {
  createdClient.value = null;
  copiedKey.value = false;
  resetForm();
}

async function copyApiKey() {
  if (!createdClient.value || typeof navigator === 'undefined' || !navigator.clipboard) {
    return;
  }
  await navigator.clipboard.writeText(createdClient.value.apiKey);
  copiedKey.value = true;
  setTimeout(() => {
    copiedKey.value = false;
  }, 2500);
}

async function handleSubmit() {
  serverError.value = null;
  const validation = validateSaasForm(form);
  fieldErrors.value = validation.errors;

  if (!validation.valid) {
    return;
  }

  if (!resolvedApiBaseUrl.value) {
    serverError.value = {
      title: 'Endpoint de API no configurado',
      detail:
        'Falta configurar la variable de entorno VITE_API_BASE_URL en Cloudflare Pages (.env) con la URL de tu microservicio.',
    };
    return;
  }

  const endpoint = buildRegistrationEndpoint(resolvedApiBaseUrl.value);
  const payload = buildRegistrationPayload(form);

  submitting.value = true;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const rawMessage = Array.isArray(data?.message)
        ? data.message.join(' | ')
        : String(data?.message || response.statusText);

      if (response.status === 409) {
        serverError.value = {
          title: 'RUC ya registrado (409 Conflict)',
          detail:
            rawMessage ||
            'Ya existe una plataforma SaaS registrada con este RUC. Recuerda que solo se permite 1 registro por RUC.',
        };
      } else {
        serverError.value = {
          title: `Error HTTP ${response.status}`,
          detail: rawMessage,
        };
      }
      return;
    }

    createdClient.value = data as CreatedApiClientResponse;
  } catch (err) {
    serverError.value = {
      title: 'No se pudo conectar con el microservicio',
      detail: `Verifica que el servidor esté activo y con CORS habilitado. Detalle: ${(err as Error)?.message || 'Error de red'}`,
    };
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.sr-container {
  margin: 1.5rem 0;
}

.sr-card {
  background-color: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-lg, 12px);
  padding: 1.5rem;
}

.sr-header {
  margin-bottom: 1.5rem;
}

.sr-badge {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-brand-1);
  background-color: var(--vp-c-brand-soft);
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  margin-bottom: 0.5rem;
}

.sr-title {
  margin: 0 0 0.4rem 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.sr-subtitle {
  margin: 0;
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

.sr-form {
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}

.sr-grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}

.sr-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.sr-label {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.sr-required {
  color: var(--color-error, #ef4444);
}

.sr-optional {
  font-weight: 400;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
}

.sr-input {
  width: 100%;
  min-height: 44px;
  padding: 0.6rem 0.85rem;
  font-size: 0.95rem;
  color: var(--vp-c-text-1);
  background-color: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-md, 8px);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.sr-mono {
  font-family: var(--vp-font-family-mono);
}

.sr-input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft);
}

.sr-input.is-invalid {
  border-color: var(--color-error, #ef4444);
}

.sr-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  line-height: 1.45;
}

.sr-error-text {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--color-error, #ef4444);
}

.sr-quota-box {
  background-color: var(--vp-c-bg);
  border: 1px solid var(--vp-c-brand-1);
  border-radius: var(--radius-md, 8px);
  padding: 0.95rem 1.1rem;
}

.sr-quota-title {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--vp-c-brand-1);
  margin-bottom: 0.45rem;
}

.sr-quota-list {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.84rem;
  color: var(--vp-c-text-2);
  line-height: 1.55;
}

.sr-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.35rem;
}

.sr-btn {
  min-height: 44px;
  padding: 0.6rem 1.2rem;
  font-size: 0.92rem;
  font-weight: 600;
  border-radius: var(--radius-md, 8px);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color 0.2s, opacity 0.2s;
}

.sr-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sr-btn-primary {
  background-color: var(--vp-c-brand-1);
  color: #ffffff;
}

.sr-btn-primary:hover:not(:disabled) {
  background-color: var(--vp-c-brand-2);
}

.sr-btn-secondary {
  background-color: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-border);
}

.sr-btn-secondary:hover:not(:disabled) {
  background-color: var(--vp-c-bg-alt);
}

.sr-btn-copy {
  background-color: var(--color-success, #10b981);
  color: #ffffff;
  flex-shrink: 0;
}

.sr-banner {
  padding: 1rem;
  border-radius: var(--radius-md, 8px);
  border: 1px solid;
}

.sr-banner-error {
  background-color: var(--color-error-bg, #fef2f2);
  border-color: var(--color-error-border, #fecaca);
  color: var(--vp-c-text-1);
}

.sr-banner-warning {
  background-color: var(--color-warning-bg, #fffbeb);
  border-color: var(--color-warning-border, #fde68a);
  color: var(--vp-c-text-1);
}

.sr-banner-title {
  font-weight: 700;
  font-size: 0.92rem;
  margin-bottom: 0.25rem;
}

.sr-banner-desc {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  line-height: 1.45;
}

.sr-success-panel {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.sr-key-box {
  background-color: var(--vp-c-bg);
  border: 1px solid var(--color-success-border, #a7f3d0);
  border-radius: var(--radius-md, 8px);
  padding: 1rem;
}

.sr-key-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  margin-bottom: 0.5rem;
}

.sr-key-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.sr-key-value {
  flex: 1;
  min-width: 220px;
  padding: 0.65rem 0.85rem;
  background-color: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-sm, 4px);
  font-family: var(--vp-font-family-mono);
  font-size: 0.88rem;
  word-break: break-all;
}

.sr-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
}

.sr-summary-item {
  background-color: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-md, 8px);
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.sr-summary-label {
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
}

.sr-summary-val {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  word-break: break-all;
}

.sr-code-block {
  margin: 0;
  padding: 0.9rem;
  background-color: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--radius-md, 8px);
  overflow-x: auto;
  font-size: 0.82rem;
  font-family: var(--vp-font-family-mono);
}
</style>
