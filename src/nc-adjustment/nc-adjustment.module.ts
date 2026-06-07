import { Module } from '@nestjs/common';
import { NcAdjustmentController } from './nc-adjustment.controller';
import { NcAdjustmentService } from './nc-adjustment.service';

@Module({
  controllers: [NcAdjustmentController],
  providers: [NcAdjustmentService],
  exports: [NcAdjustmentService],
})
export class NcAdjustmentModule {}
