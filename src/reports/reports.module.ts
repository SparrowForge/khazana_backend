import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  // Exported so ReportSharesModule can re-run a shared report through the same
  // service the authenticated route uses — a share must never be a second,
  // divergent implementation of the same sheet.
  exports: [ReportsService],
})
export class ReportsModule {}
