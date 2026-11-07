import { Module } from '@nestjs/common';
import { SriSoapClientService } from './sri-soap-client.service';

@Module({
  providers: [SriSoapClientService],
  exports: [SriSoapClientService],
})
export class SriSoapModule {}
