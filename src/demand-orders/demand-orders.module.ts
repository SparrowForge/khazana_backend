import { Module } from '@nestjs/common';
import { DemandOrdersController } from './demand-orders.controller';
import { DemandOrdersService } from './demand-orders.service';

@Module({
  controllers: [DemandOrdersController],
  providers: [DemandOrdersService],
  exports: [DemandOrdersService],
})
export class DemandOrdersModule {}
