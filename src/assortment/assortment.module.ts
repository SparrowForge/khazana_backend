import { Module } from '@nestjs/common';
import { AssortmentController } from './assortment.controller';
import { AssortmentService } from './assortment.service';

@Module({
  controllers: [AssortmentController],
  providers: [AssortmentService],
  exports: [AssortmentService],
})
export class AssortmentModule {}
