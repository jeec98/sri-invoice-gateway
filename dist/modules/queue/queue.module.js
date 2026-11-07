"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueModule = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const crypto_module_1 = require("../crypto/crypto.module");
const invoices_module_1 = require("../invoices/invoices.module");
const invoices_constants_1 = require("../invoices/invoices.constants");
const sri_soap_module_1 = require("../sri-soap/sri-soap.module");
const webhook_module_1 = require("../webhook/webhook.module");
const invoice_queue_consumer_1 = require("./invoice-queue.consumer");
let QueueModule = class QueueModule {
};
exports.QueueModule = QueueModule;
exports.QueueModule = QueueModule = __decorate([
    (0, common_1.Module)({
        imports: [
            bullmq_1.BullModule.registerQueue({
                name: invoices_constants_1.SRI_INVOICE_QUEUE,
            }),
            crypto_module_1.CryptoModule,
            invoices_module_1.InvoicesModule,
            sri_soap_module_1.SriSoapModule,
            webhook_module_1.WebhookModule,
        ],
        providers: [invoice_queue_consumer_1.InvoiceQueueConsumer],
        exports: [invoice_queue_consumer_1.InvoiceQueueConsumer],
    })
], QueueModule);
//# sourceMappingURL=queue.module.js.map