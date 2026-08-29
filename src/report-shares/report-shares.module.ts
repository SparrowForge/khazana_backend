import { Module } from '@nestjs/common';
import { ReportSharesController } from './report-shares.controller';
import { ReportSharesService } from './report-shares.service';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [ReportsModule],
  controllers: [ReportSharesController],
  providers: [ReportSharesService],
})
export class ReportSharesModule {}
