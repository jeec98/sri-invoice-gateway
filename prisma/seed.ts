import { PrismaClient } from '@prisma/client';
import * as crypto from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const rawApiKey = process.env.SEED_TENANT_API_KEY || 'sri_live_demo_tenant_api_key_2026';
  const apiKeyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');

  const tenant = await prisma.tenant.upsert({
    where: { ruc: '1790011674001' },
    update: {
      apiKeyHash,
      isActive: true,
    },
    create: {
      name: 'Empresa Demo SaaS Ecuador S.A.',
      ruc: '1790011674001',
      apiKeyHash,
      isActive: true,
    },
  });

  console.log('====================================================');
  console.log('Seed completed successfully!');
  console.log(`Tenant ID  : ${tenant.id}`);
  console.log(`Tenant RUC : ${tenant.ruc}`);
  console.log(`API Key    : ${rawApiKey}`);
  console.log(`SHA-256    : ${apiKeyHash}`);
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

