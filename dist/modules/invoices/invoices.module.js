"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoicesModule = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const tenants_module_1 = require("../tenants/tenants.module");
const access_key_service_1 = require("./services/access-key.service");
const xml_builder_service_1 = require("./services/xml-builder.service");
const invoices_service_1 = require("./invoices.service");
const invoices_controller_1 = require("./invoices.controller");
const invoices_constants_1 = require("./invoices.constants");
let InvoicesModule = class InvoicesModule {
};
exports.InvoicesModule = InvoicesModule;
exports.InvoicesModule = InvoicesModule = __decorate([
    (0, common_1.Module)({
        imports: [
            tenants_module_1.TenantsModule,
            bullmq_1.BullModule.registerQueue({
                name: invoices_constants_1.SRI_INVOICE_QUEUE,
            }),
        ],
        controllers: [invoices_controller_1.InvoicesController],
        providers: [access_key_service_1.AccessKeyService, xml_builder_service_1.XmlBuilderService, invoices_service_1.InvoicesService],
        exports: [access_key_service_1.AccessKeyService, xml_builder_service_1.XmlBuilderService, invoices_service_1.InvoicesService],
    })
], InvoicesModule);
//# sourceMappingURL=invoices.module.js.map