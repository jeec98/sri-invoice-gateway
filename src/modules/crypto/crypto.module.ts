import { Module } from '@nestjs/common';
import { AesGcmService } from './aes-gcm.service';
import { P12ParserService } from './p12-parser.service';
import { XadesBesSignerService } from './xades-bes-signer.service';

@Module({
  providers: [AesGcmService, P12ParserService, XadesBesSignerService],
  exports: [AesGcmService, P12ParserService, XadesBesSignerService],
})
export class CryptoModule {}

