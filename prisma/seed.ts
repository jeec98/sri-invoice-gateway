import { PrismaClient } from '@prisma/client';
import * as crypto from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const rawApiKey =
    process.env.SEED_API_KEY ||
    'sri_live_dev_test_master_key_000000000000000000000000';
  const apiKeyHash = crypto
    .createHash('sha256')
    .update(rawApiKey)
    .digest('hex');

  // 1. Upsert default development ApiClient (SaaS Integrator)
  const apiClient = await prisma.apiClient.upsert({
    where: { apiKeyHash },
    update: {
      name: 'Development Platform SaaS',
      ruc: '1799999999001',
      plan: 'STANDARD',
      rateLimitRps: 100,
      status: 'ACTIVE',
    },
    create: {
      name: 'Development Platform SaaS',
      ruc: '1799999999001',
      apiKeyHash,
      plan: 'STANDARD',
      rateLimitRps: 100,
      status: 'ACTIVE',
    },
  });

  // 2. Upsert default Tenant (Empresa Emisora) linked to apiClientId
  const tenant = await prisma.tenant.upsert({
    where: {
      apiClientId_ruc: {
        apiClientId: apiClient.id,
        ruc: '1790011674001',
      },
    },
    update: {
      businessName: 'Empresa Demo S.A.',
      status: 'ACTIVE',
    },
    create: {
      apiClientId: apiClient.id,
      businessName: 'Empresa Demo S.A.',
      ruc: '1790011674001',
      status: 'ACTIVE',
    },
  });

  // 3. Insert active seed Certificate linked to tenantId
  const now = new Date();
  const validFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  const validTo = new Date(now.getTime() + 335 * 24 * 60 * 60 * 1000); // ~11 months ahead

  let cert = await prisma.certificate.findFirst({
    where: { tenantId: tenant.id, isActive: true },
  });

  if (!cert) {
    cert = await prisma.certificate.create({
      data: {
        tenantId: tenant.id,
        passwordCiphertext: 'mock_aes_gcm_ciphertext_hex_seed',
        passwordIv: '0123456789abcdef01234567',
        passwordAuthTag: '0123456789abcdef0123456789abcdef',
        validFrom,
        validTo,
        certSubject:
          'CN=Empresa Demo S.A.,OID.2.5.4.97=VATS-1790011674001,C=EC',
        certIssuer:
          'CN=AUTORIDAD DE CERTIFICACION SECURITY DATA,OU=ENTIDAD DE CERTIFICACION,O=SECURITY DATA S.A.,C=EC',
        serialNumber: '1234567890abcdef',
        isActive: true,
      },
    });
  }

  console.log('====================================================');
  console.log('Multi-Tenant Seed completed successfully!');
  console.log(`ApiClient ID   : ${apiClient.id}`);
  console.log(`ApiClient Name : ${apiClient.name}`);
  console.log(`Raw API Key    : ${rawApiKey}`);
  console.log(`API Key Hash   : ${apiKeyHash}`);
  console.log(`Tenant ID      : ${tenant.id}`);
  console.log(`Tenant Name    : ${tenant.businessName}`);
  console.log(`Tenant RUC     : ${tenant.ruc}`);
  console.log(`Certificate ID : ${cert.id}`);
  console.log('====================================================');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
