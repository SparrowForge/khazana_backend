import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  // The frontend sends `from`/`to` (and `customerCode`); the original API
  // documented `fromDate`/`toDate` (and `clientCode`). Accept both so the
  // contract is resilient regardless of which the caller uses.
  private range(from?: string, fromDate?: string, to?: string, toDate?: string) {
    return { fromDate: from ?? fromDate, toDate: to ?? toDate };
  }

  @Get('sales')
  @ApiOperation({ summary: 'Get sales report for a date range' })
  @ApiQuery({ name: 'from', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'to', required: true, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'Sales report rows' })
  getSalesReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getSalesReport({
      ...this.range(from, fromDate, to, toDate),
      branchId: branchId || undefined,
    });
  }

  @Get('daily')
  @ApiOperation({ summary: 'Get daily sales summary' })
  @ApiQuery({ name: 'date', required: true, description: 'Date (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'Daily summary data' })
  getDailySummary(@Query('date') date: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getDailySummary(date, branchId || undefined);
  }

  @Get('daily-final')
  @ApiOperation({ summary: 'Get the full end-of-day "Daily Final Report" for a branch' })
  @ApiQuery({ name: 'date', required: true, description: 'Date (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: true, description: 'Branch ID' })
  @ApiResponse({ status: 200, description: 'Daily final report (categories, payments, breakdowns, hourwise)' })
  getDailyFinalReport(@Query('date') date: string, @Query('branchId') branchId: string) {
    return this.reportsService.getDailyFinalReport(date, branchId);
  }

  @Get('stock')
  @ApiOperation({ summary: 'Get current stock report for all items' })
  @ApiResponse({ status: 200, description: 'Stock levels for all items' })
  getStockReport() { return this.reportsService.getStockReport(); }

  @Get('stock-analysis')
  @ApiOperation({ summary: 'Get the per-item Stock Analysis report for a branch + day' })
  @ApiQuery({ name: 'date', required: true, description: 'Date (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch ID — omit to aggregate all branches' })
  @ApiResponse({ status: 200, description: 'Stock analysis rows + sales summary footer' })
  getStockAnalysis(@Query('date') date: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getStockAnalysis(date, branchId || undefined);
  }

  @Get('item-sales')
  @ApiOperation({ summary: 'Get item-wise sales report for a date range' })
  @ApiQuery({ name: 'from', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'to', required: true, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'Item-wise sales rows' })
  getItemSalesReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getItemSalesReport({
      ...this.range(from, fromDate, to, toDate),
      branchId: branchId || undefined,
    });
  }

  @Get('customer-statement')
  @ApiOperation({ summary: 'Get customer statement for a date range' })
  @ApiQuery({ name: 'customerCode', required: true, description: 'Customer code' })
  @ApiQuery({ name: 'from', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'to', required: true, description: 'End date (ISO 8601)' })
  @ApiResponse({ status: 200, description: 'Customer statement rows' })
  getCustomerStatement(
    @Query('customerCode') customerCode?: string,
    @Query('clientCode') clientCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.reportsService.getCustomerStatement(customerCode ?? clientCode, this.range(from, fromDate, to, toDate));
  }

  @Get('packet')
  @ApiOperation({ summary: 'Get packet analysis report for a date range' })
  @ApiQuery({ name: 'from', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'to', required: true, description: 'End date (ISO 8601)' })
  @ApiResponse({ status: 200, description: 'Packet analysis rows' })
  getPacketAnalysis(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.reportsService.getPacketAnalysis(this.range(from, fromDate, to, toDate));
  }
}
