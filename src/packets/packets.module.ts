import { Module } from '@nestjs/common';
import { PacketsController } from './packets.controller';
import { PacketsService } from './packets.service';

@Module({
  controllers: [PacketsController],
  providers: [PacketsService],
  exports: [PacketsService],
})
export class PacketsModule {}
