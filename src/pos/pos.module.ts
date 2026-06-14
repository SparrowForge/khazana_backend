import { Module } from '@nestjs/common';
import { PosProductsController } from './pos-products.controller';
import { PosProductsService } from './pos-products.service';
import { PosSalesController } from './pos-sales.controller';
import { PosSalesService } from './pos-sales.service';

@Module({
  controllers: [PosProductsController, PosSalesController],
  providers: [PosProductsService, PosSalesService],
})
export class PosModule {}
