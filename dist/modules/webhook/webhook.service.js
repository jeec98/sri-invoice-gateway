"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var WebhookService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const crypto = __importStar(require("node:crypto"));
let WebhookService = WebhookService_1 = class WebhookService {
    logger = new common_1.Logger(WebhookService_1.name);
    async dispatch(webhookUrl, payload) {
        const bodyString = JSON.stringify(payload);
        const secret = process.env.WEBHOOK_SIGNING_SECRET || 'whsec_sri_gateway_default_secret_key';
        const signature = crypto
            .createHmac('sha256', secret)
            .update(bodyString)
            .digest('hex');
        const timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS || 10000);
        try {
            const response = await axios_1.default.post(webhookUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-SRI-Gateway-Event': payload.event,
                    'X-SRI-Gateway-Signature': `sha256=${signature}`,
                },
                timeout: timeoutMs,
            });
            this.logger.log(`Webhook delivered to ${webhookUrl} for claveAcceso=${payload.claveAcceso} [HTTP ${response.status}]`);
            return {
                delivered: response.status >= 200 && response.status < 300,
                statusCode: response.status,
            };
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Webhook delivery failed to ${webhookUrl} for claveAcceso=${payload.claveAcceso}: ${errMsg}`);
            return {
                delivered: false,
            };
        }
    }
};
exports.WebhookService = WebhookService;
exports.WebhookService = WebhookService = WebhookService_1 = __decorate([
    (0, common_1.Injectable)()
], WebhookService);
//# sourceMappingURL=webhook.service.js.map