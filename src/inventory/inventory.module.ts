import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ProductionModule } from '../production/production.module';

@Module({
  // Stock Issue lines flagged `isProduction` write to Production through
  // ProductionService, so its rules live in one place for both entry points.
  imports: [ProductionModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
