export interface WebhookVerificationResult {
  isValid: boolean;
  computedSignature: string; // "sha256=<64_hex_digits>"
  providedSignature?: string;
  match: boolean;
  error?: string;
}

export interface JsonPayloadValidation {
  isValidJson: boolean;
  error?: string;
}

const encoder = new TextEncoder();

/**
 * Validates whether a raw string is syntactically valid JSON.
 */
export function validateJsonPayload(payload: string): JsonPayloadValidation {
  const clean = (payload || '').trim();
  if (!clean) {
    return {
      isValidJson: false,
      error: 'El payload está vacío.',
    };
  }
  try {
    JSON.parse(clean);
    return { isValidJson: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isValidJson: false,
      error: `Error de sintaxis JSON: ${message}`,
    };
  }
}

/**
 * Computes HMAC-SHA256 digest of raw payload using Web Crypto API.
 * Returns formatted header value: "sha256=<hex>"
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export async function computeHmacSha256(
  payload: string,
  secret: string,
): Promise<string> {
  if (!secret) {
    throw new Error('El secreto del webhook es obligatorio para calcular la firma HMAC.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload),
  );

  return `sha256=${bufferToHex(signatureBuffer)}`;
}

/**
 * Constant-time string equality check to mitigate timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifyWebhookSignature(
  payload: string,
  secret: string,
  signatureHeader: string,
): Promise<WebhookVerificationResult> {
  const cleanHeader = (signatureHeader || '').trim();

  if (!secret) {
    return {
      isValid: false,
      computedSignature: '',
      providedSignature: cleanHeader,
      match: false,
      error: 'El secreto del webhook es obligatorio para calcular la firma HMAC.',
    };
  }

  try {
    const computedSignature = await computeHmacSha256(payload, secret);
    const match = timingSafeEqual(computedSignature, cleanHeader);

    return {
      isValid: match,
      computedSignature,
      providedSignature: cleanHeader,
      match,
      error: match
        ? undefined
        : 'Discrepancia detectada: La firma provista no coincide con el resumen HMAC-SHA256 calculado.',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isValid: false,
      computedSignature: '',
      providedSignature: cleanHeader,
      match: false,
      error: message,
    };
  }
}
