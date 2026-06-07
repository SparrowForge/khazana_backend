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

  @Get('sales')
  @ApiOperation({ summary: 'Get sales report for a date range' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'Sales report data' })
  getSalesReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getSalesReport({ fromDate, toDate, branchId: branchId ? +branchId : undefined });
  }

  @Get('daily')
  @ApiOperation({ summary: 'Get daily sales summary' })
  @ApiQuery({ name: 'date', required: true, description: 'Date (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'Daily summary data' })
  getDailySummary(@Query('date') date: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getDailySummary(date, branchId ? +branchId : undefined);
  }

  @Get('stock')
  @ApiOperation({ summary: 'Get current stock report for all items' })
  @ApiResponse({ status: 200, description: 'Stock levels for all items' })
  getStockReport() { return this.reportsService.getStockReport(); }

  @Get('item-sales')
  @ApiOperation({ summary: 'Get item-wise sales report for a date range' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'Item-wise sales data' })
  getItemSalesReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getItemSalesReport({ fromDate, toDate, branchId: branchId ? +branchId : undefined });
  }

  @Get('customer-statement')
  @ApiOperation({ summary: 'Get customer statement for a date range' })
  @ApiQuery({ name: 'clientCode', required: true, description: 'Customer code' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'End date (ISO 8601)' })
  @ApiResponse({ status: 200, description: 'Customer statement data' })
  getCustomerStatement(
    @Query('clientCode') clientCode: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reportsService.getCustomerStatement(clientCode, { fromDate, toDate });
  }

  @Get('packet')
  @ApiOperation({ summary: 'Get packet analysis report for a date range' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'End date (ISO 8601)' })
  @ApiResponse({ status: 200, description: 'Packet analysis data' })
  getPacketAnalysis(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reportsService.getPacketAnalysis({ fromDate, toDate });
  }
}
