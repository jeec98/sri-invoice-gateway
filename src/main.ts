import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SRI Invoice Gateway API')
    .setDescription(
      'Microservicio Multi-Tenant de Firma Electrónica XAdES-BES y Autorización Asíncrona ante el SRI (Ecuador)',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('API Clients', 'Aprovisionamiento de plataformas SaaS integradoras')
    .addTag(
      'Tenants & Certificates',
      'Gestión de Empresas Emisoras y certificados .p12 cifrados con AES-256-GCM',
    )
    .addTag('Invoices', 'Ingesta asíncrona de facturas (<200ms) y consulta de autorización SRI')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);
  logger.log(`SRI Invoice Gateway running on http://localhost:${port}/v1`);
  logger.log(`Swagger OpenAPI Documentation on http://localhost:${port}/docs`);
}

bootstrap();
