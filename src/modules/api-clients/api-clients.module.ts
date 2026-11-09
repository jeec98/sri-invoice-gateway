import { Module } from '@nestjs/common';
import { ApiClientsController } from './api-clients.controller';
import { ApiClientsService } from './api-clients.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ApiClientsController],
  providers: [ApiClientsService],
  exports: [ApiClientsService],
})
export class ApiClientsModule {}
