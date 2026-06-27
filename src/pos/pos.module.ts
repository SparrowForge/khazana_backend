import { Module } from '@nestjs/common';
import { PosProductsController } from './pos-products.controller';
import { PosProductsService } from './pos-products.service';
import { PosSalesController } from './pos-sales.controller';
import { PosSalesService } from './pos-sales.service';
import { PosSyncController } from './pos-sync.controller';
import { PosSyncService } from './pos-sync.service';

@Module({
  controllers: [PosProductsController, PosSalesController, PosSyncController],
  providers: [PosProductsService, PosSalesService, PosSyncService],
})
export class PosModule {}
