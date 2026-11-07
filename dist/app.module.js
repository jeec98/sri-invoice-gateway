"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("@nestjs/bullmq");
const prisma_module_1 = require("./prisma/prisma.module");
const crypto_module_1 = require("./modules/crypto/crypto.module");
const tenants_module_1 = require("./modules/tenants/tenants.module");
const invoices_module_1 = require("./modules/invoices/invoices.module");
const sri_soap_module_1 = require("./modules/sri-soap/sri-soap.module");
const webhook_module_1 = require("./modules/webhook/webhook.module");
const queue_module_1 = require("./modules/queue/queue.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
            }),
            bullmq_1.BullModule.forRootAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (configService) => ({
                    connection: {
                        host: configService.get('REDIS_HOST', 'localhost'),
                        port: configService.get('REDIS_PORT', 6379),
                        password: configService.get('REDIS_PASSWORD') || undefined,
                    },
                }),
            }),
            prisma_module_1.PrismaModule,
            crypto_module_1.CryptoModule,
            tenants_module_1.TenantsModule,
            invoices_module_1.InvoicesModule,
            sri_soap_module_1.SriSoapModule,
            webhook_module_1.WebhookModule,
            queue_module_1.QueueModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map