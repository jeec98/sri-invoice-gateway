"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateTenantDto = exports.UploadCertificateDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class UploadCertificateDto {
    ruc;
    password;
}
exports.UploadCertificateDto = UploadCertificateDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'RUC de 13 dígitos del emisor (debe coincidir con el RUC del tenant o registrarse)',
        example: '1790011674001',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Length)(13, 13, { message: 'El RUC debe tener exactamente 13 dígitos.' }),
    (0, class_validator_1.Matches)(/^\d{13}$/, { message: 'El RUC debe contener únicamente dígitos numéricos.' }),
    __metadata("design:type", String)
], UploadCertificateDto.prototype, "ruc", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Contraseña del archivo de firma electrónica (.p12 / .pfx)',
        example: 'MiClaveSeguraP12_2026',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'La contraseña del certificado (.p12) es obligatoria.' }),
    __metadata("design:type", String)
], UploadCertificateDto.prototype, "password", void 0);
class CreateTenantDto {
    name;
    ruc;
}
exports.CreateTenantDto = CreateTenantDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'Razón social o nombre comercial del Tenant',
        example: 'Importadora Tecnológica del Ecuador S.A.',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateTenantDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        description: 'RUC de 13 dígitos del contribuyente',
        example: '1790011674001',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(13, 13),
    (0, class_validator_1.Matches)(/^\d{13}$/),
    __metadata("design:type", String)
], CreateTenantDto.prototype, "ruc", void 0);
//# sourceMappingURL=upload-certificate.dto.js.map