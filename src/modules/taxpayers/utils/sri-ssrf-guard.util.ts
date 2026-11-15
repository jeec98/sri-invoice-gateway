const ALLOWED_SRI_HOSTS = new Set([
  'datosabiertos.gob.ec',
  'www.datosabiertos.gob.ec',
  'declaraciones.sri.gob.ec',
  'srienlinea.sri.gob.ec',
]);

/**
 * Validates that an outbound URL targets an official HTTPS SRI / Datos Abiertos host
 * to prevent SSRF attacks via compromised CKAN metadata or redirect injection.
 */
export function assertSafeSriUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`SSRF_BLOCKED_URL: Invalid URL "${rawUrl}"`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`SSRF_BLOCKED_URL: Non-HTTPS scheme blocked for "${rawUrl}"`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_SRI_HOSTS.has(hostname)) {
    throw new Error(`SSRF_BLOCKED_URL: Disallowed host "${hostname}"`);
  }

  return parsed;
}
