import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import * as forge from 'node-forge';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { PrismaService as PrismaServiceType } from '../src/prisma/prisma.service';
import type { SriSoapClientService as SriSoapClientServiceType } from '../src/modules/sri-soap/sri-soap-client.service';
import type { InvoiceQueueConsumer as InvoiceQueueConsumerType } from '../src/modules/queue/invoice-queue.consumer';

const requireCjs = createRequire(__filename);
const { NestFactory } = requireCjs('@nestjs/core');
const { AppModule } = requireCjs('../dist/app.module.js');
const { PrismaService } = requireCjs('../dist/prisma/prisma.service.js');
const { SriSoapClientService } = requireCjs('../dist/modules/sri-soap/sri-soap-client.service.js');
const { InvoiceQueueConsumer } = requireCjs('../dist/modules/queue/invoice-queue.consumer.js');

function createValidTestP12Buffer(
  password: string,
  ruc = '1790011674001',
  issuerOrg = 'SECURITY DATA S.A.',
): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01020304050607';
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 86400 * 1000);
  cert.validity.notAfter = new Date(now.getTime() + 365 * 86400 * 1000);

  const subjectAttrs: forge.pki.CertificateField[] = [
    { name: 'commonName', value: `EMPRESA PRUEBA RUC ${ruc}` },
    { type: '2.5.4.5', shortName: 'SERIALNUMBER', value: `RUC-${ruc}` },
    { name: 'organizationName', value: 'DEMO MULTI-SAAS E2E' },
    { name: 'countryName', value: 'EC' },
  ];
  const issuerAttrs: forge.pki.CertificateField[] = [
    { name: 'commonName', value: `AUTORIDAD DE CERTIFICACION ${issuerOrg}` },
    { name: 'organizationName', value: issuerOrg },
    { name: 'countryName', value: 'EC' },
  ];
  cert.setSubject(subjectAttrs);
  cert.setIssuer(issuerAttrs);
  cert.sign(keys.privateKey, forge.md.sha1.create());

  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des',
  });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

describe('SRI Invoice Gateway — 2-Tier Multi-SaaS E2E Suite', () => {
  let app: INestApplication;
  let baseUrl = '';
  let prisma: PrismaServiceType;
  let sriSoapClient: SriSoapClientServiceType;
  let queueConsumer: InvoiceQueueConsumerType;

  // Platform Integrators (SaaS Clients)
  const clientARuc = '1791111111001';
  const clientBRuc = '1792222222001';
  const throttledClientRuc = '1793333333001';
  let apiKeyClientA = '';
  let clientAId = '';
  let apiKeyClientB = '';
  let clientBId = '';

  // Tenants (Empresas Emisoras)
  const testRucA = '1790011674001';
  const p12PasswordA = 'ClaveAlpha_2026!';
  let tenantAId = '';

  const testRucB = '1792288339001';
  const p12PasswordB = 'ClaveBeta_2026!';
  let tenantBId = '';

  // Webhook Receiver
  let webhookServer: http.Server;
  let webhookPort = 0;
  let receivedWebhookBody = '';
  let receivedWebhookSignature = '';

  // Invoiced Clave de Acceso
  let createdClaveAcceso = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.REDIS_DB = '1';
    process.env.WEBHOOK_SIGNING_SECRET = 'whsec_e2e_test_signing_secret';

    // Start local HTTP receiver to verify outbound HMAC-SHA256 webhooks
    webhookServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        receivedWebhookBody = Buffer.concat(chunks).toString('utf8');
        receivedWebhookSignature = String(req.headers['x-sri-gateway-signature'] || '');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      });
    });

    await new Promise<void>((resolve) => {
      webhookServer.listen(0, '127.0.0.1', () => {
        const addr = webhookServer.address();
        if (addr && typeof addr === 'object') {
          webhookPort = addr.port;
        }
        resolve();
      });
    });

    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.listen(0, '127.0.0.1');
    const serverAddr = app.getHttpServer().address();
    const appPort = typeof serverAddr === 'object' && serverAddr ? serverAddr.port : 3000;
    baseUrl = `http://127.0.0.1:${appPort}/v1`;

    prisma = app.get(PrismaService);
    sriSoapClient = app.get(SriSoapClientService);
    queueConsumer = app.get(InvoiceQueueConsumer);

    // Initial database cleanup (by name and RUC to guarantee idempotency across CI runs)
    await prisma.apiClient.deleteMany({
      where: {
        OR: [
          {
            name: {
              in: [
                'E2E SaaS Alpha Platform',
                'E2E SaaS Beta Platform',
                'E2E SaaS Throttled Platform',
              ],
            },
          },
          {
            ruc: {
              in: [clientARuc, clientBRuc, throttledClientRuc],
            },
          },
        ],
      },
    });

    // Speed up worker delay for fast E2E execution
    vi.spyOn(
      queueConsumer as unknown as { delay: (ms: number) => Promise<void> },
      'delay',
    ).mockResolvedValue();

    // Mock SRI SOAP client for async worker processing
    let capturedSignedXml = '';
    vi.spyOn(sriSoapClient, 'validarComprobante').mockImplementation(async (signedXml: string) => {
      capturedSignedXml = signedXml;
      return {
        estado: 'RECIBIDA',
        mensajes: [],
        rawXml:
          '<RespuestaRecepcionComprobante><estado>RECIBIDA</estado></RespuestaRecepcionComprobante>',
      };
    });

    vi.spyOn(sriSoapClient, 'autorizacionComprobante').mockImplementation(
      async (claveAcceso: string) => ({
        estado: 'AUTORIZADO',
        numeroAutorizacion: claveAcceso,
        fechaAutorizacion: '2026-11-09T14:30:00-05:00',
        ambiente: 'PRUEBAS',
        comprobanteXml: capturedSignedXml,
        authorizedXml: `<?xml version="1.0" encoding="UTF-8"?>\n<autorizacion>\n  <estado>AUTORIZADO</estado>\n  <numeroAutorizacion>${claveAcceso}</numeroAutorizacion>\n  <comprobante><![CDATA[${capturedSignedXml}]]></comprobante>\n</autorizacion>`,
        mensajes: [],
        rawXml: '<RespuestaAutorizacionComprobante/>',
      }),
    );
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.apiClient.deleteMany({
        where: {
          OR: [
            {
              name: {
                in: [
                  'E2E SaaS Alpha Platform',
                  'E2E SaaS Beta Platform',
                  'E2E SaaS Throttled Platform',
                ],
              },
            },
            {
              ruc: {
                in: [clientARuc, clientBRuc, throttledClientRuc],
              },
            },
          ],
        },
      });
    }
    if (app) {
      await app.close();
    }
    if (webhookServer) {
      await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
    }
  });

  it('Step 1: POST /v1/api-clients — Provision SaaS Client A and SaaS Client B', async () => {
    // 1a. Provision SaaS Client A (High throughput, default webhook URL)
    const resA = await fetch(`${baseUrl}/api-clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E SaaS Alpha Platform',
        ruc: clientARuc,
        webhookUrl: `http://127.0.0.1:${webhookPort}/webhooks/sri`,
        plan: 'PRO',
        rateLimitRps: 100,
      }),
    });

    expect(resA.status).toBe(201);
    const bodyA = (await resA.json()) as {
      id: string;
      name: string;
      plan: string;
      rateLimitRps: number;
      apiKey: string;
    };
    expect(bodyA.name).toBe('E2E SaaS Alpha Platform');
    expect(bodyA.plan).toBe('PRO');
    expect(bodyA.rateLimitRps).toBe(100);
    expect(bodyA.apiKey).toMatch(/^sri_live_[0-9a-f]{48}$/);
    apiKeyClientA = bodyA.apiKey;
    clientAId = bodyA.id;

    // 1b. Provision SaaS Client B (Multi-SaaS isolation peer)
    const resB = await fetch(`${baseUrl}/api-clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E SaaS Beta Platform',
        ruc: clientBRuc,
        plan: 'STANDARD',
        rateLimitRps: 100,
      }),
    });

    expect(resB.status).toBe(201);
    const bodyB = (await resB.json()) as {
      id: string;
      name: string;
      plan: string;
      rateLimitRps: number;
      apiKey: string;
    };
    expect(bodyB.name).toBe('E2E SaaS Beta Platform');
    expect(bodyB.rateLimitRps).toBe(100);
    expect(bodyB.apiKey).toMatch(/^sri_live_[0-9a-f]{48}$/);
    apiKeyClientB = bodyB.apiKey;
    clientBId = bodyB.id;

    // Verify SHA-256 persistence: raw API key must not exist in database
    const expectedHashA = crypto.createHash('sha256').update(apiKeyClientA).digest('hex');
    const storedClientA = await prisma.apiClient.findUnique({
      where: { apiKeyHash: expectedHashA },
    });
    expect(storedClientA).toBeDefined();
    expect(storedClientA?.id).toBe(clientAId);
    expect(storedClientA?.ruc).toBe(clientARuc);

    // 1c. Reject duplicate SaaS RUC registration (409 API_CLIENT_RUC_EXISTS)
    const duplicateRes = await fetch(`${baseUrl}/api-clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E SaaS Duplicate RUC',
        ruc: clientARuc,
      }),
    });
    expect(duplicateRes.status).toBe(409);
  });

  it('Step 2: POST /v1/tenants — Register Tenant A under Client A and Tenant B under Client B', async () => {
    // 2a. Register Tenant A under Client A
    const resA = await fetch(`${baseUrl}/tenants`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        businessName: 'Empresa Emisora Alpha S.A.',
        ruc: testRucA,
      }),
    });

    expect(resA.status).toBe(201);
    const bodyA = (await resA.json()) as {
      id: string;
      ruc: string;
      businessName: string;
      apiClientId: string;
    };
    expect(bodyA.id).toBeDefined();
    expect(bodyA.ruc).toBe(testRucA);
    expect(bodyA.apiClientId).toBe(clientAId);
    tenantAId = bodyA.id;

    // 2b. Register Tenant B under Client B
    const resB = await fetch(`${baseUrl}/tenants`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientB}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        businessName: 'Empresa Emisora Beta S.A.',
        ruc: testRucB,
      }),
    });

    expect(resB.status).toBe(201);
    const bodyB = (await resB.json()) as {
      id: string;
      ruc: string;
      businessName: string;
      apiClientId: string;
    };
    expect(bodyB.id).toBeDefined();
    expect(bodyB.ruc).toBe(testRucB);
    expect(bodyB.apiClientId).toBe(clientBId);
    tenantBId = bodyB.id;

    // 2c. Reject duplicate RUC under the same SaaS client (409 Conflict)
    const dupRes = await fetch(`${baseUrl}/tenants`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        businessName: 'Duplicated RUC Under Same SaaS',
        ruc: testRucA,
      }),
    });
    expect(dupRes.status).toBe(409);

    // 2d. Verify GET /v1/tenants scoped strictly to authenticated SaaS
    const listA = await fetch(`${baseUrl}/tenants`, {
      headers: { Authorization: `Bearer ${apiKeyClientA}` },
    });
    const listABody = (await listA.json()) as {
      items: Array<{ id: string; ruc: string }>;
      total: number;
    };
    expect(listABody.total).toBe(1);
    expect(listABody.items[0].id).toBe(tenantAId);
  });

  it('Step 3: POST /v1/tenants/:tenantId/certificates — Upload and validate certificates with AES-256-GCM encryption', async () => {
    const p12BufferA = createValidTestP12Buffer(p12PasswordA, testRucA);
    const p12BufferB = createValidTestP12Buffer(p12PasswordB, testRucB);

    // 3a. Reject wrong password (400 Bad Request)
    const badPassForm = new FormData();
    badPassForm.append('ruc', testRucA);
    badPassForm.append('password', 'ClaveIncorrecta_999');
    badPassForm.append(
      'file',
      new Blob([new Uint8Array(p12BufferA)], { type: 'application/x-pkcs12' }),
      'cert_alpha.p12',
    );
    const badPassRes = await fetch(`${baseUrl}/tenants/${tenantAId}/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKeyClientA}` },
      body: badPassForm,
    });
    expect(badPassRes.status).toBe(400);

    // 3b. Reject unrecognized CA (400 Bad Request)
    const unrecognizedCaP12 = createValidTestP12Buffer(
      p12PasswordA,
      testRucA,
      'FAKE UNACCREDITED CA',
    );
    const badCaForm = new FormData();
    badCaForm.append('ruc', testRucA);
    badCaForm.append('password', p12PasswordA);
    badCaForm.append(
      'file',
      new Blob([new Uint8Array(unrecognizedCaP12)], { type: 'application/x-pkcs12' }),
      'cert_fake_ca.p12',
    );
    const badCaRes = await fetch(`${baseUrl}/tenants/${tenantAId}/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKeyClientA}` },
      body: badCaForm,
    });
    expect(badCaRes.status).toBe(400);

    // 3c. Reject certificate with RUC mismatching tenant RUC (400 Bad Request)
    const mismatchRucP12 = createValidTestP12Buffer(p12PasswordA, '0999999999001');
    const mismatchForm = new FormData();
    mismatchForm.append('ruc', testRucA);
    mismatchForm.append('password', p12PasswordA);
    mismatchForm.append(
      'file',
      new Blob([new Uint8Array(mismatchRucP12)], { type: 'application/x-pkcs12' }),
      'cert_mismatch.p12',
    );
    const mismatchRes = await fetch(`${baseUrl}/tenants/${tenantAId}/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKeyClientA}` },
      body: mismatchForm,
    });
    expect(mismatchRes.status).toBe(400);

    // 3d. Upload valid certificate for Tenant A (201 Created)
    const validFormA = new FormData();
    validFormA.append('ruc', testRucA);
    validFormA.append('password', p12PasswordA);
    validFormA.append(
      'file',
      new Blob([new Uint8Array(p12BufferA)], { type: 'application/x-pkcs12' }),
      'cert_alpha.p12',
    );
    const resA = await fetch(`${baseUrl}/tenants/${tenantAId}/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKeyClientA}` },
      body: validFormA,
    });
    expect(resA.status).toBe(201);
    const bodyA = (await resA.json()) as {
      success: boolean;
      certificate: { encryptionAlgorithm: string; rucVerified: boolean; isActive: boolean };
    };
    expect(bodyA.success).toBe(true);
    expect(bodyA.certificate.encryptionAlgorithm).toBe('AES-256-GCM');
    expect(bodyA.certificate.rucVerified).toBe(true);
    expect(bodyA.certificate.isActive).toBe(true);

    // 3e. Upload valid certificate for Tenant B (201 Created)
    const validFormB = new FormData();
    validFormB.append('ruc', testRucB);
    validFormB.append('password', p12PasswordB);
    validFormB.append(
      'file',
      new Blob([new Uint8Array(p12BufferB)], { type: 'application/x-pkcs12' }),
      'cert_beta.p12',
    );
    const resB = await fetch(`${baseUrl}/tenants/${tenantBId}/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKeyClientB}` },
      body: validFormB,
    });
    expect(resB.status).toBe(201);

    // 3f. Verify encrypted persistence in PostgreSQL
    const storedCertA = await prisma.certificate.findFirst({
      where: { tenantId: tenantAId, isActive: true },
    });
    expect(storedCertA).toBeDefined();
    expect(storedCertA?.passwordCiphertext).toBeDefined();
    expect(storedCertA?.passwordIv).toBeDefined();
    expect(storedCertA?.passwordAuthTag).toBeDefined();
    expect(storedCertA?.p12Binary).toBeDefined();
    const storedBytes = Buffer.from(storedCertA!.p12Binary!);
    expect(storedBytes.subarray(0, 4).toString('ascii')).toBe('AGCM');
    expect(storedBytes.equals(p12BufferA)).toBe(false);
  });

  it('Step 4: POST /v1/tenants/:tenantId/invoices — Double-Lock isolation: Client B accessing Tenant A is rejected (403 TENANT_ACCESS_DENIED)', async () => {
    // Client B attempts to ingest invoice for Tenant A (owned by Client A)
    const crossRes = await fetch(`${baseUrl}/tenants/${tenantAId}/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientB}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        referenceId: 'INV-CROSS-ATTACK-001',
        ambiente: '1',
        razonSocial: 'Alpha Emisora S.A.',
        ruc: testRucA,
        estab: '001',
        ptoEmi: '001',
        secuencial: '000000001',
        dirMatriz: 'QUITO',
        fechaEmision: '09/11/2026',
        dirEstablecimiento: 'QUITO',
        tipoIdentificacionComprador: '04',
        razonSocialComprador: 'CLIENTE PRUEBA',
        identificacionComprador: '1790011674001',
        totalSinImpuestos: 100.0,
        totalDescuento: 0.0,
        importeTotal: 115.0,
        pagos: [{ formaPago: '20', total: 115.0 }],
        detalles: [
          {
            codigoPrincipal: 'SRV-01',
            descripcion: 'Servicio',
            cantidad: 1,
            precioUnitario: 100.0,
            descuento: 0.0,
            precioTotalSinImpuesto: 100.0,
            impuestos: [
              { codigo: '2', codigoPorcentaje: '4', tarifa: 15, baseImponible: 100.0, valor: 15.0 },
            ],
          },
        ],
      }),
    });

    expect(crossRes.status).toBe(403);
    const body = (await crossRes.json()) as { message: string };
    expect(body.message).toContain('TENANT_ACCESS_DENIED');
  });

  it('Step 5: POST /v1/tenants/:tenantId/invoices — Taxpayer Invariant Violation rejected (403 RUC_MISMATCH)', async () => {
    // Client A submits invoice for Tenant A, but payload RUC belongs to Tenant B
    const mismatchRes = await fetch(`${baseUrl}/tenants/${tenantAId}/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        referenceId: 'INV-RUC-MISMATCH-001',
        ambiente: '1',
        razonSocial: 'Empresa Emisora Alpha S.A.',
        ruc: testRucB, // Mismatched RUC!
        estab: '001',
        ptoEmi: '001',
        secuencial: '000000002',
        dirMatriz: 'QUITO',
        fechaEmision: '09/11/2026',
        dirEstablecimiento: 'QUITO',
        tipoIdentificacionComprador: '04',
        razonSocialComprador: 'CLIENTE PRUEBA',
        identificacionComprador: '1790011674001',
        totalSinImpuestos: 100.0,
        totalDescuento: 0.0,
        importeTotal: 115.0,
        pagos: [{ formaPago: '20', total: 115.0 }],
        detalles: [
          {
            codigoPrincipal: 'SRV-01',
            descripcion: 'Servicio',
            cantidad: 1,
            precioUnitario: 100.0,
            descuento: 0.0,
            precioTotalSinImpuesto: 100.0,
            impuestos: [
              { codigo: '2', codigoPorcentaje: '4', tarifa: 15, baseImponible: 100.0, valor: 15.0 },
            ],
          },
        ],
      }),
    });

    expect(mismatchRes.status).toBe(403);
    const body = (await mismatchRes.json()) as { message: string };
    expect(body.message).toContain('RUC_MISMATCH');
  });

  it('Step 6: POST /v1/tenants/:tenantId/invoices — Ingest Factura v1.1.0 in <200ms with 49-digit Clave de Acceso', async () => {
    const validInvoicePayload = {
      referenceId: 'FAC-E2E-ALPHA-0001',
      ambiente: '1',
      webhookUrl: `http://127.0.0.1:${webhookPort}/webhooks/sri`,
      razonSocial: 'Empresa Emisora Alpha S.A.',
      nombreComercial: 'Alpha Cloud',
      ruc: testRucA,
      estab: '001',
      ptoEmi: '001',
      secuencial: '000000001',
      dirMatriz: 'AV. AMAZONAS Y NACIONES UNIDAS, QUITO',
      fechaEmision: '09/11/2026',
      dirEstablecimiento: 'AV. AMAZONAS Y NACIONES UNIDAS, QUITO',
      obligadoContabilidad: 'SI',
      tipoIdentificacionComprador: '04',
      razonSocialComprador: 'CLIENTE CORP ECUADOR S.A.',
      identificacionComprador: '0991234567001',
      direccionComprador: 'GUAYAQUIL',
      totalSinImpuestos: 100.0,
      totalDescuento: 0.0,
      propina: 0.0,
      importeTotal: 115.0,
      moneda: 'DOLAR',
      pagos: [
        {
          formaPago: '20',
          total: 115.0,
          plazo: '30',
          unidadTiempo: 'dias',
        },
      ],
      detalles: [
        {
          codigoPrincipal: 'SRV-CLOUD-01',
          descripcion: 'Licencia Software Cloud Multi-Tenant',
          cantidad: 1,
          precioUnitario: 100.0,
          descuento: 0.0,
          precioTotalSinImpuesto: 100.0,
          impuestos: [
            {
              codigo: '2',
              codigoPorcentaje: '4',
              tarifa: 15,
              baseImponible: 100.0,
              valor: 15.0,
            },
          ],
        },
      ],
      infoAdicional: [{ nombre: 'Email', valor: 'facturacion@corp.com.ec' }],
    };

    // 6a. Reject empty detalles array (400 Bad Request)
    const emptyDetallesRes = await fetch(`${baseUrl}/tenants/${tenantAId}/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...validInvoicePayload, detalles: [] }),
    });
    expect(emptyDetallesRes.status).toBe(400);

    // 6b. Ingest valid invoice and assert response time < 200ms
    const t0 = performance.now();
    const postRes = await fetch(`${baseUrl}/tenants/${tenantAId}/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validInvoicePayload),
    });
    const duration = performance.now() - t0;

    expect(postRes.status).toBe(202);
    expect(duration).toBeLessThan(200);

    const postBody = (await postRes.json()) as {
      success: boolean;
      status: string;
      claveAcceso: string;
      referenceId: string;
    };
    expect(postBody.success).toBe(true);
    expect(postBody.status).toBe('QUEUED');
    expect(postBody.referenceId).toBe('FAC-E2E-ALPHA-0001');
    expect(postBody.claveAcceso).toMatch(/^\d{49}$/);

    createdClaveAcceso = postBody.claveAcceso;

    // 6c. Reject duplicate referenceId (409 Conflict)
    const dupRes = await fetch(`${baseUrl}/tenants/${tenantAId}/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyClientA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validInvoicePayload),
    });
    expect(dupRes.status).toBe(409);
  });

  it('Step 7: GET /v1/tenants/:tenantId/invoices/:claveAcceso — Query isolation, worker processing, and HMAC Webhook', async () => {
    // 7a. Cross-SaaS: Client B trying to query Tenant A route receives 403 TENANT_ACCESS_DENIED
    const crossRes = await fetch(`${baseUrl}/tenants/${tenantAId}/invoices/${createdClaveAcceso}`, {
      headers: { Authorization: `Bearer ${apiKeyClientB}` },
    });
    expect(crossRes.status).toBe(403);

    // 7b. Cross-Tenant: Client B querying the same claveAcceso under Tenant B route receives 404 INVOICE_NOT_FOUND
    const notFoundRes = await fetch(
      `${baseUrl}/tenants/${tenantBId}/invoices/${createdClaveAcceso}`,
      {
        headers: { Authorization: `Bearer ${apiKeyClientB}` },
      },
    );
    expect(notFoundRes.status).toBe(404);

    // 7c. Malformed claveAcceso returns 400 Bad Request
    const badClaveRes = await fetch(`${baseUrl}/tenants/${tenantAId}/invoices/123456789`, {
      headers: { Authorization: `Bearer ${apiKeyClientA}` },
    });
    expect(badClaveRes.status).toBe(400);

    // 7d. Poll GET /v1/tenants/:tenantA/invoices/:claveAcceso until BullMQ completes
    let finalBody: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) {
      const getRes = await fetch(`${baseUrl}/tenants/${tenantAId}/invoices/${createdClaveAcceso}`, {
        headers: { Authorization: `Bearer ${apiKeyClientA}` },
      });
      expect(getRes.status).toBe(200);

      finalBody = (await getRes.json()) as Record<string, unknown>;
      if (finalBody.status === 'AUTORIZADO' && finalBody.webhookResponseStatus !== null) {
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    expect(finalBody.status).toBe('AUTORIZADO');
    expect(finalBody.numeroAutorizacion).toBe(createdClaveAcceso);
    expect(finalBody.webhookDelivered).toBe(true);
    expect(finalBody.webhookResponseStatus).toBe(200);
    expect(String(finalBody.authorizedXml)).toContain('<ds:Signature');
    expect(String(finalBody.authorizedXml)).toContain(
      `<campoAdicional nombre="RUC Proveedor">${clientARuc}</campoAdicional>`,
    );

    // 7e. Verify HMAC-SHA256 signature received by SaaS Webhook receiver
    const expectedHmac =
      'sha256=' +
      crypto
        .createHmac('sha256', 'whsec_e2e_test_signing_secret')
        .update(receivedWebhookBody)
        .digest('hex');
    expect(receivedWebhookSignature).toBe(expectedHmac);
  });

  it('Step 8: Rate Limiting — Exceeding rateLimitRps returns 429 Too Many Requests with Retry-After: 1', async () => {
    // Provision a dedicated SaaS client with rateLimitRps = 2
    const resThrottled = await fetch(`${baseUrl}/api-clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E SaaS Throttled Platform',
        ruc: throttledClientRuc,
        plan: 'STANDARD',
        rateLimitRps: 2,
      }),
    });
    expect(resThrottled.status).toBe(201);
    const throttledBody = (await resThrottled.json()) as { apiKey: string };
    const throttledApiKey = throttledBody.apiKey;

    // Send 4 rapid requests to trigger 429
    const requests = Array.from({ length: 4 }, () =>
      fetch(`${baseUrl}/tenants`, {
        headers: { Authorization: `Bearer ${throttledApiKey}` },
      }),
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);

    expect(statuses).toContain(429);

    const rateLimitedRes = responses.find((r) => r.status === 429);
    expect(rateLimitedRes).toBeDefined();
    expect(rateLimitedRes?.headers.get('retry-after')).toBe('1');
    expect(rateLimitedRes?.headers.get('x-ratelimit-limit')).toBe('2');
    expect(rateLimitedRes?.headers.get('x-ratelimit-remaining')).toBe('0');

    const errorBody = (await rateLimitedRes?.json()) as { message: string };
    expect(errorBody.message).toContain('RATE_LIMIT_EXCEEDED');
  });
});
