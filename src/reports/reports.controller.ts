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
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch ID — omit to aggregate every branch the caller may see' })
  @ApiResponse({ status: 200, description: 'Stock analysis rows + sales summary footer' })
  getStockAnalysis(
    @CurrentUser('branchIds') branchIds: string[],
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('date') date: string,
    @Query('branchId') branchId?: string,
  ) {
    // Backward compatible: accept the legacy single-day `date` param.
    return this.reportsService.getStockAnalysis(fromDate || date, toDate || date, branchId || undefined, branchIds);
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
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch ID — omit to aggregate every branch the caller may see' })
  @ApiQuery({
    name: 'payMethod',
    required: false,
    description:
      "Filter by how the bill was paid: one of the report's payment columns (cash, bkash, nagad, brac, ucb, city, ebl, fpanda, pathao, foodi, credit), or omit / 'all' for every method. A split bill matches every method it was settled with, showing that method's portion.",
  })
  @ApiResponse({ status: 200, description: 'Sales history rows with payment breakdown and daily subtotals' })
  getSalesHistory(
    @CurrentUser('branchIds') branchIds: string[],
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
    @Query('payMethod') payMethod?: string,
  ) {
    return this.reportsService.getSalesHistory(
      { fromDate, toDate, branchId: branchId || undefined, payMethod: payMethod || undefined },
      branchIds,
    );
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
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch the rejects were recorded at — omit to aggregate every branch the caller may see' })
  @ApiResponse({ status: 200, description: 'Datewise item reject rows with current VAT-inclusive price' })
  getItemRejectReport(
    @CurrentUser('branchIds') branchIds: string[],
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getItemRejectReport(
      { fromDate, toDate, branchId: branchId || undefined },
      branchIds,
    );
  }

  // The 80mm counter print of the same ItemReject data `item-reject` pivots
  // for A4 — grouped by day with a Sub Total per day and a Grand Total.
  @Get('reject-pos')
  @ApiOperation({ summary: 'Get the Reject Report (POS): rejects grouped by date with per-day sub totals, for the 80mm roll' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'Range end date, inclusive (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch the rejects were recorded at — omit to aggregate every branch the caller may see' })
  @ApiResponse({ status: 200, description: 'Date-grouped reject lines with sub totals, grand total and the branch header block' })
  getRejectReportPos(
    @CurrentUser('branchIds') branchIds: string[],
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getRejectReportPos(
      { fromDate, toDate, branchId: branchId || undefined },
      branchIds,
    );
  }

  // The Excess twin of `reject-pos` — the other column of the same ItemReject
  // row, on the same form.
  @Get('excess-pos')
  @ApiOperation({ summary: 'Get the Excess Report (POS): excess grouped by date with per-day sub totals, for the 80mm roll' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'Range end date, inclusive (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch the excess was recorded at — omit to aggregate every branch the caller may see' })
  @ApiResponse({ status: 200, description: 'Date-grouped excess lines with sub totals, grand total and the branch header block' })
  getExcessReportPos(
    @CurrentUser('branchIds') branchIds: string[],
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getExcessReportPos(
      { fromDate, toDate, branchId: branchId || undefined },
      branchIds,
    );
  }

  // The Short twin of `reject-pos` / `excess-pos` — the third column of the
  // same ItemReject row, on the same form.
  @Get('short-pos')
  @ApiOperation({ summary: 'Get the Short Report (POS): shortages grouped by date with per-day sub totals, for the 80mm roll' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'Range end date, inclusive (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch the shortage was recorded at — omit to aggregate every branch the caller may see' })
  @ApiResponse({ status: 200, description: 'Date-grouped short lines with sub totals, grand total and the branch header block' })
  getShortReportPos(
    @CurrentUser('branchIds') branchIds: string[],
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getShortReportPos(
      { fromDate, toDate, branchId: branchId || undefined },
      branchIds,
    );
  }

  @Get('nc')
  @ApiOperation({ summary: 'Get the NC (non-charge) report: a flat list of NC lines with VAT-inclusive amounts' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'Range end date, inclusive (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch (Outlet) — omit to aggregate every branch the caller may see' })
  @ApiQuery({ name: 'customerId', required: false, description: 'Customer the NCs were issued to (Customer.id) — omit for every customer' })
  @ApiResponse({ status: 200, description: 'NC line rows with attribution (Name/Reference) and VAT-inclusive amount' })
  getNCReport(
    @CurrentUser('branchIds') branchIds: string[],
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.reportsService.getNCReport(
      { fromDate, toDate, branchId: branchId || undefined, customerId: customerId || undefined },
      branchIds,
    );
  }

  @Get('discount-summary')
  @ApiOperation({ summary: 'Get the Discount Summary report: one row per discounted sale invoice across all sale ledgers' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: true, description: 'Range end date, inclusive (ISO 8601)' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch (Outlet) — omit to aggregate every branch the caller may see' })
  @ApiResponse({ status: 200, description: 'Discounted invoices with pre-discount amount, rate, discount and authoriser' })
  getDiscountSummary(
    @CurrentUser('branchIds') branchIds: string[],
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getDiscountSummary(
      { fromDate, toDate, branchId: branchId || undefined },
      branchIds,
    );
  }

  @Get('branchwise-delivery')
  @ApiOperation({ summary: 'Factory-only Branchwise Delivery report: per-item, per-day issue quantities out of one branch' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: false, description: 'Range end date, inclusive (ISO 8601); defaults to fromDate' })
  @ApiQuery({ name: 'issueBranchId', required: false, description: 'Issuing branch; defaults to the session branch' })
  @ApiQuery({ name: 'receiveBranchId', required: false, description: 'Receiving branch — omit for all branches' })
  @ApiResponse({ status: 200, description: 'Per-item rows with a qty column per day, plus total qty and amount' })
  @ApiResponse({ status: 403, description: 'Session branch is not the Factory' })
  getBranchwiseDeliveryReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @CurrentUser('branchId') sessionBranchId: string,
    @Query('issueBranchId') issueBranchId?: string,
    @Query('receiveBranchId') receiveBranchId?: string,
  ) {
    return this.reportsService.getBranchwiseDeliveryReport({
      fromDate,
      toDate: toDate || fromDate,
      // The issuing branch defaults to the branch the user logged in at; the
      // report page sends it explicitly once the user picks a different one.
      issueBranchId: issueBranchId || sessionBranchId,
      receiveBranchId: receiveBranchId || undefined,
      sessionBranchId,
    });
  }

  @Get('daily-sales')
  @ApiOperation({
    summary:
      'Factory-only Daily Sales Report: total sale and invoice count per branch, with the Food Panda / Foodi online slice, plus outlet / factory / MTD totals',
  })
  @ApiQuery({ name: 'fromDate', required: false, description: 'Range start date (ISO 8601); defaults to today' })
  @ApiQuery({ name: 'toDate', required: false, description: 'Range end date, inclusive; defaults to fromDate' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Branch — omit for every branch' })
  @ApiResponse({ status: 200, description: 'Per-branch sale/invoice/online figures and the report totals' })
  @ApiResponse({ status: 403, description: 'Session branch is not the Factory' })
  getDailySalesReport(
    @CurrentUser('branchId') sessionBranchId: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('branchId') branchId?: string,
  ) {
    // The report is run for "today" more often than for anything else, so an
    // omitted range means today rather than a 400.
    const today = new Date().toISOString().split('T')[0];
    const start = fromDate || today;
    return this.reportsService.getDailySalesReport({
      fromDate: start,
      toDate: toDate || start,
      branchId: branchId || undefined,
      sessionBranchId,
    });
  }

  @Get('demand')
  @ApiOperation({ summary: 'Factory-only Demand Report: every item down the side, one column per demanding branch' })
  @ApiQuery({ name: 'fromDate', required: true, description: 'Range start date (ISO 8601)' })
  @ApiQuery({ name: 'toDate', required: false, description: 'Range end date, inclusive; defaults to fromDate' })
  @ApiQuery({ name: 'fromBranchId', required: false, description: 'Demanding branch — omit for all branches (one column each)' })
  @ApiQuery({ name: 'toBranchId', required: false, description: 'Branch the demand was raised on; defaults to the session branch' })
  @ApiQuery({ name: 'orderType', required: false, description: "Demand round: 'First' | 'Second' | 'Special'; omit for every round" })
  @ApiResponse({ status: 200, description: 'Per-item rows with a qty column per branch, plus totals' })
  @ApiResponse({ status: 403, description: 'Session branch is not the Factory' })
  getDemandReport(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @CurrentUser('branchId') sessionBranchId: string,
    @Query('fromBranchId') fromBranchId?: string,
    @Query('toBranchId') toBranchId?: string,
    @Query('orderType') orderType?: string,
  ) {
    return this.reportsService.getDemandReport({
      fromDate,
      toDate: toDate || fromDate,
      fromBranchId: fromBranchId || undefined,
      toBranchId: toBranchId || sessionBranchId,
      orderType: orderType || undefined,
      sessionBranchId,
    });
  }
}
