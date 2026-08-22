import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';

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
  @ApiOperation({ summary: 'Get the per-item Stock Analysis report for a branch + date range' })
  @ApiQuery({ name: 'fromDate', required: false, description: 'Range start date (ISO 8601). Falls back to legacy `date`.' })
  @ApiQuery({ name: 'toDate', required: false, description: 'Range end date, inclusive (ISO 8601); defaults to fromDate' })
  @ApiQuery({ name: 'date', required: false, description: 'Legacy single-day param (ISO 8601); used when fromDate/toDate are absent' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch ID — omit to aggregate all branches' })
  @ApiResponse({ status: 200, description: 'Stock analysis rows + sales summary footer' })
  getStockAnalysis(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('date') date: string,
    @Query('branchId') branchId?: string,
  ) {
    // Backward compatible: accept the legacy single-day `date` param.
    return this.reportsService.getStockAnalysis(fromDate || date, toDate || date, branchId || undefined);
  }

  @Get('production-delivery')
  @ApiOperation({ summary: 'Factory-only Production & Delivery report for a date range' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: false, description: 'Range end date, inclusive (ISO 8601); defaults to fromDate' })
  @ApiResponse({ status: 200, description: 'Per-item Qty/Tk rows plus column totals' })
  @ApiResponse({ status: 403, description: 'Session branch is not the Factory' })
  getProductionDeliveryReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    // Factory-only, and always scoped to the session branch — there is no
    // branchId query param to widen it. The service verifies the branch.
    return this.reportsService.getProductionDeliveryReport(fromDate, toDate, branchId);
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

  @Get('sales-history')
  @ApiOperation({ summary: 'Get sales history summary with line-item details and payment method breakdown' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'End date (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch ID — omit to aggregate all branches' })
  @ApiResponse({ status: 200, description: 'Sales history rows with payment breakdown and daily subtotals' })
  getSalesHistory(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getSalesHistory({ fromDate, toDate, branchId: branchId || undefined });
  }

  @Get('item-receive')
  @ApiOperation({ summary: 'Get the datewise Item Receive report (items × date, current VAT-inclusive price)' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'Range end date, inclusive (ISO 8601)' })
  @ApiQuery({ name: 'receiveBranchId', required: false, description: 'Branch the goods were received INTO — omit to aggregate all branches' })
  @ApiQuery({ name: 'fromBranchId', required: false, description: 'Branch the goods were received FROM — omit to include every source' })
  @ApiResponse({ status: 200, description: 'Datewise item receive rows with current VAT-inclusive price' })
  getItemReceiveReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('receiveBranchId') receiveBranchId?: string,
    @Query('fromBranchId') fromBranchId?: string,
  ) {
    return this.reportsService.getItemReceiveReport({
      fromDate,
      toDate,
      receiveBranchId: receiveBranchId || undefined,
      fromBranchId: fromBranchId || undefined,
    });
  }

  @Get('item-reject')
  @ApiOperation({ summary: 'Get the datewise Item Reject report (items × date, current VAT-inclusive price)' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'Range end date, inclusive (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch the rejects were recorded at — omit to aggregate all branches' })
  @ApiResponse({ status: 200, description: 'Datewise item reject rows with current VAT-inclusive price' })
  getItemRejectReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getItemRejectReport({ fromDate, toDate, branchId: branchId || undefined });
  }

  @Get('nc')
  @ApiOperation({ summary: 'Get the NC (non-charge) report: a flat list of NC lines with VAT-inclusive amounts' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'Range end date, inclusive (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch (Outlet) — omit to aggregate all branches' })
  @ApiResponse({ status: 200, description: 'NC line rows with attribution (Name/Reference) and VAT-inclusive amount' })
  getNCReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getNCReport({ fromDate, toDate, branchId: branchId || undefined });
  }

  @Get('discount-summary')
  @ApiOperation({ summary: 'Get the Discount Summary report: one row per discounted sale invoice across all sale ledgers' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'Range end date, inclusive (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch (Outlet) — omit to aggregate all branches' })
  @ApiResponse({ status: 200, description: 'Discounted invoices with pre-discount amount, rate, discount and authoriser' })
  getDiscountSummary(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getDiscountSummary({ fromDate, toDate, branchId: branchId || undefined });
  }
}
