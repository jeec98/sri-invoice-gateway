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
  ruc = '1799988877001',
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
    { name: 'commonName', value: 'E2E TENANT ECUADOR S.A.' },
    { type: '2.5.4.5', shortName: 'SERIALNUMBER', value: `RUC-${ruc}` },
    { name: 'organizationName', value: 'RHINOLABS E2E' },
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

describe('SRI Invoice Gateway (E2E)', () => {
  let app: INestApplication;
  let baseUrl = '';
  let prisma: PrismaServiceType;
  let sriSoapClient: SriSoapClientServiceType;
  let queueConsumer: InvoiceQueueConsumerType;

  const testRuc = '1799988877001';
  const p12Password = 'ClaveE2ESegura_2026!';
  let tenantApiKey = '';
  let webhookServer: http.Server;
  let webhookPort = 0;
  let receivedWebhookBody = '';
  let receivedWebhookSignature = '';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.REDIS_DB = '1';
    process.env.WEBHOOK_SIGNING_SECRET = 'whsec_e2e_test_signing_secret';

    // Start local HTTP receiver to verify real outbound Webhook delivery & HMAC-SHA256
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

    // Clean any previous E2E tenant with testRuc
    await prisma.tenant.deleteMany({ where: { ruc: testRuc } });

    // Speed up 2.5s worker delay for fast E2E execution
    vi.spyOn(
      queueConsumer as unknown as { delay: (ms: number) => Promise<void> },
      'delay',
    ).mockResolvedValue();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.tenant.deleteMany({ where: { ruc: testRuc } });
    }
    if (app) {
      await app.close();
    }
    if (webhookServer) {
      await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
    }
  });

  it('1. POST /v1/tenants — should register a new tenant and reject duplicate RUC (409)', async () => {
    const res = await fetch(`${baseUrl}/tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Tenant Ecuador S.A.',
        ruc: testRuc,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      ruc: string;
      apiKey: string;
    };
    expect(body.success).toBe(true);
    expect(body.ruc).toBe(testRuc);
    expect(body.apiKey).toMatch(/^sri_live_[0-9a-f]{48}$/);
    tenantApiKey = body.apiKey;

    // Duplicate RUC must return 409 Conflict
    const dupRes = await fetch(`${baseUrl}/tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate Tenant S.A.',
        ruc: testRuc,
      }),
    });
    expect(dupRes.status).toBe(409);
  });

  it('2. POST /v1/tenants/certificates — should validate .p12, reject bad password (400), and encrypt with AES-256-GCM (201)', async () => {
    const p12Buffer = createValidTestP12Buffer(p12Password);

    // Wrong password -> 400 Bad Request
    const badForm = new FormData();
    badForm.append('ruc', testRuc);
    badForm.append('password', 'WrongPassword123');
    badForm.append(
      'file',
      new Blob([new Uint8Array(p12Buffer)], { type: 'application/x-pkcs12' }),
      'firma_e2e.p12',
    );

    const badRes = await fetch(`${baseUrl}/tenants/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tenantApiKey}` },
      body: badForm,
    });
    expect(badRes.status).toBe(400);

    // Unrecognized CA -> 400 Bad Request (UNRECOGNIZED_CA_ISSUER)
    const unrecognizedCaP12 = createValidTestP12Buffer(p12Password, testRuc, 'UNKNOWN FAKE CA');
    const badCaForm = new FormData();
    badCaForm.append('ruc', testRuc);
    badCaForm.append('password', p12Password);
    badCaForm.append(
      'file',
      new Blob([new Uint8Array(unrecognizedCaP12)], { type: 'application/x-pkcs12' }),
      'firma_bad_ca.p12',
    );
    const badCaRes = await fetch(`${baseUrl}/tenants/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tenantApiKey}` },
      body: badCaForm,
    });
    expect(badCaRes.status).toBe(400);

    // Certificate belonging to another RUC -> 400 Bad Request (CERTIFICATE_RUC_MISMATCH)
    const otherRucP12 = createValidTestP12Buffer(
      p12Password,
      '0999999999001',
      'SECURITY DATA S.A.',
    );
    const otherRucForm = new FormData();
    otherRucForm.append('ruc', testRuc);
    otherRucForm.append('password', p12Password);
    otherRucForm.append(
      'file',
      new Blob([new Uint8Array(otherRucP12)], { type: 'application/x-pkcs12' }),
      'firma_other_ruc.p12',
    );
    const otherRucRes = await fetch(`${baseUrl}/tenants/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tenantApiKey}` },
      body: otherRucForm,
    });
    expect(otherRucRes.status).toBe(400);

    // Valid password + Accredited CA + Matching RUC -> 201 Created
    const validForm = new FormData();
    validForm.append('ruc', testRuc);
    validForm.append('password', p12Password);
    validForm.append(
      'file',
      new Blob([new Uint8Array(p12Buffer)], { type: 'application/x-pkcs12' }),
      'firma_e2e.p12',
    );

    const res = await fetch(`${baseUrl}/tenants/certificates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tenantApiKey}` },
      body: validForm,
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      success: boolean;
      certificate: { encryptionAlgorithm: string; subject: string; rucVerified: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.certificate.encryptionAlgorithm).toBe('AES-256-GCM');
    expect(body.certificate.rucVerified).toBe(true);
    expect(body.certificate.subject).toContain('CN=E2E TENANT ECUADOR S.A.');

    // Verify in PostgreSQL that both the .p12 binary and password are stored encrypted with AES-256-GCM
    const storedTenant = await prisma.tenant.findUnique({ where: { ruc: testRuc } });
    expect(storedTenant?.p12Binary).toBeDefined();
    const storedBytes = Buffer.from(storedTenant!.p12Binary!);
    expect(storedBytes.subarray(0, 4).toString('ascii')).toBe('AGCM');
    expect(storedBytes.equals(p12Buffer)).toBe(false);
  });

  it('3. POST /v1/invoices -> BullMQ Worker -> XAdES-BES -> SOAP -> Webhook -> GET /v1/invoices/:claveAcceso', async () => {
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
        fechaAutorizacion: '2026-11-07T14:30:00-05:00',
        ambiente: 'PRUEBAS',
        comprobanteXml: capturedSignedXml,
        authorizedXml: `<?xml version="1.0" encoding="UTF-8"?>\n<autorizacion>\n  <estado>AUTORIZADO</estado>\n  <numeroAutorizacion>${claveAcceso}</numeroAutorizacion>\n  <comprobante><![CDATA[${capturedSignedXml}]]></comprobante>\n</autorizacion>`,
        mensajes: [],
        rawXml: '<RespuestaAutorizacionComprobante/>',
      }),
    );

    const invoicePayload = {
      referenceId: 'FAC-E2E-SUITE-0001',
      ambiente: '1',
      webhookUrl: `http://127.0.0.1:${webhookPort}/webhooks/sri`,
      razonSocial: 'E2E TENANT ECUADOR S.A.',
      nombreComercial: 'E2E SAAS',
      ruc: testRuc,
      estab: '001',
      ptoEmi: '001',
      secuencial: '000000001',
      dirMatriz: 'AV. AMAZONAS Y NACIONES UNIDAS, QUITO',
      fechaEmision: '07/11/2026',
      dirEstablecimiento: 'AV. AMAZONAS Y NACIONES UNIDAS, QUITO',
      obligadoContabilidad: 'SI',
      tipoIdentificacionComprador: '04',
      razonSocialComprador: 'CLIENTE E2E S.A.',
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
          codigoPrincipal: 'SRV-E2E-01',
          descripcion: 'Suscripcion Cloud E2E',
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
      infoAdicional: [{ nombre: 'Email', valor: 'e2e@cliente.com.ec' }],
    };

    // 3a. Reject empty detalles array (400 Bad Request via @ArrayMinSize(1))
    const emptyDetallesRes = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tenantApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...invoicePayload, detalles: [] }),
    });
    expect(emptyDetallesRes.status).toBe(400);

    // 3b. Enqueue valid invoice (202 Accepted)
    const postRes = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tenantApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoicePayload),
    });
    expect(postRes.status).toBe(202);

    const postBody = (await postRes.json()) as {
      success: boolean;
      status: string;
      claveAcceso: string;
    };
    expect(postBody.success).toBe(true);
    expect(postBody.status).toBe('QUEUED');
    expect(postBody.claveAcceso).toMatch(/^\d{49}$/);

    const claveAcceso = postBody.claveAcceso;

    // 3c. Reject duplicate referenceId (409 Conflict)
    const dupInvRes = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tenantApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoicePayload),
    });
    expect(dupInvRes.status).toBe(409);

    // 3d. Poll GET /v1/invoices/:claveAcceso until BullMQ worker completes authorization and webhook delivery
    let finalBody: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) {
      const getRes = await fetch(`${baseUrl}/invoices/${claveAcceso}`, {
        headers: { Authorization: `Bearer ${tenantApiKey}` },
      });
      expect(getRes.status).toBe(200);

      finalBody = (await getRes.json()) as Record<string, unknown>;
      if (finalBody.status === 'AUTORIZADO' && finalBody.webhookResponseStatus !== null) {
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    expect(finalBody.status).toBe('AUTORIZADO');
    expect(finalBody.numeroAutorizacion).toBe(claveAcceso);
    expect(finalBody.webhookDelivered).toBe(true);
    expect(finalBody.webhookResponseStatus).toBe(200);
    expect(String(finalBody.authorizedXml)).toContain('<ds:Signature');

    // 3e. Verify HMAC-SHA256 signature received by the SaaS webhook server
    const expectedHmac =
      'sha256=' +
      crypto
        .createHmac('sha256', 'whsec_e2e_test_signing_secret')
        .update(receivedWebhookBody)
        .digest('hex');
    expect(receivedWebhookSignature).toBe(expectedHmac);
  });
});
