"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const logger = new common_1.Logger('Bootstrap');
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
            enableImplicitConversion: true,
        },
    }));
    const swaggerConfig = new swagger_1.DocumentBuilder()
        .setTitle('SRI Invoice Gateway API')
        .setDescription('Microservicio Multi-Tenant de Firma Electrónica XAdES-BES y Autorización Asíncrona ante el SRI (Ecuador)')
        .setVersion('1.0.0')
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
    swagger_1.SwaggerModule.setup('docs', app, document);
    const port = Number(process.env.PORT || 3000);
    await app.listen(port);
    logger.log(`SRI Invoice Gateway running on http://localhost:${port}/v1`);
    logger.log(`Swagger OpenAPI Documentation on http://localhost:${port}/docs`);
}
bootstrap();
//# sourceMappingURL=main.js.map