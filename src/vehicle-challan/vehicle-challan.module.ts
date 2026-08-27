import { Module } from '@nestjs/common';
import { VehicleChallanController } from './vehicle-challan.controller';
import { VehicleChallanService } from './vehicle-challan.service';

@Module({
  controllers: [VehicleChallanController],
  providers: [VehicleChallanService],
  exports: [VehicleChallanService],
})
export class VehicleChallanModule {}
