import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { CreateCreditSaleDto } from './dto/create-credit-sale.dto';
import { CreateVatCashSaleDto } from './dto/create-vat-cash-sale.dto';
import { CreateVatCreditSaleDto } from './dto/create-vat-credit-sale.dto';
import { SalesQueryDto } from './dto/sales-query.dto';
import { UpdateSalesDto } from './dto/update-sales.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, Public, RequiredPermission } from '../common/decorators';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Sales')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sales')
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all sales (filtered by type and branch)' })
  @ApiQuery({ name: 'type', required: false, enum: ['cash', 'credit', 'vat-cash', 'vat-credit'], description: 'Sale type' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'List of sales' })
  async findAll(@Query() query: SalesQueryDto, @CurrentUser('branchIds') branchIds: string[]) {
    const { items, meta } = await this.salesService.findAll(query, branchIds);
    return paginatedResponse(items, meta, 'Sale');
  }

  @Post('credit')
  @RequiredPermission({ control: 'CreditSales', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a credit sale — deducts stock like a cash sale' })
  @ApiResponse({ status: 201, description: 'Credit sale created successfully' })
  @ApiResponse({ status: 400, description: 'Duplicate invoice number or insufficient stock' })
  createCreditSale(
    @Body() dto: CreateCreditSaleDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.salesService.createCreditSale(dto, userName, branchId);
  }

  @Post('vat/cash')
  @RequiredPermission({ control: 'VatCashSales', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a VAT cash sale' })
  @ApiResponse({ status: 201, description: 'VAT cash sale created successfully' })
  createVatCashSale(
    @Body() dto: CreateVatCashSaleDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.salesService.createVatCashSale(dto, userName, branchId);
  }

  @Post('vat/credit')
  @RequiredPermission({ control: 'VatCreditSales', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a VAT credit sale' })
  @ApiResponse({ status: 201, description: 'VAT credit sale created successfully' })
  createVatCreditSale(
    @Body() dto: CreateVatCreditSaleDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.salesService.createVatCreditSale(dto, userName, branchId);
  }

  // ── Credit sale edit / delete ─────────────────────────────────
  @Get('credit/:id')
  @RequiredPermission({ control: 'CreditSales', action: 'editAccess' })
  @ApiOperation({ summary: 'Get a single credit sale (prefill the edit form)' })
  @ApiResponse({ status: 404, description: 'Credit sale not found' })
  getCreditSale(@Param('id') id: string) {
    return this.salesService.getCreditSale(id);
  }

  // Read-only, for printing. Deliberately not behind editAccess — a cashier who
  // can raise a credit sale must be able to print its invoice without also
  // holding edit rights (the guard only models add/edit/delete).
  @Get('credit/:id/invoice')
  @ApiOperation({ summary: 'Get a credit sale with customer + branch details, for printing' })
  @ApiResponse({ status: 404, description: 'Credit sale not found' })
  getCreditSaleInvoice(@Param('id') id: string) {
    return this.salesService.getCreditSaleInvoice(id);
  }

  // UNAUTHENTICATED — this is the link a customer is sent, so it answers anyone
  // on the internet who has the URL.
  //
  // The sale's UUID is the whole of the access control: 122 random bits, so it
  // can't be guessed or walked, but equally it can't be revoked once sent and it
  // never expires. That makes the id a bearer token, which is why this is a
  // separate route from the staff one above rather than `@Public()` bolted onto
  // it — the two must be able to return different things, and the trimming below
  // must never silently follow a change made for staff.
  @Public()
  @Get('public/credit/:id/invoice')
  @ApiOperation({ summary: 'PUBLIC: a credit sale invoice, for the share link sent to the customer' })
  @ApiResponse({ status: 404, description: 'Credit sale not found' })
  getPublicCreditSaleInvoice(@Param('id') id: string) {
    return this.salesService.getPublicCreditSaleInvoice(id);
  }

  @Patch('credit/:id')
  @RequiredPermission({ control: 'CreditSales', action: 'editAccess' })
  @ApiOperation({ summary: 'Edit a credit sale (purge-replace lines, delta-adjust stock)' })
  @ApiResponse({ status: 400, description: 'Credit sale not found, no items, or insufficient stock' })
  @ApiResponse({ status: 403, description: 'No edit permission for Credit Sales' })
  updateCreditSale(@Param('id') id: string, @Body() dto: UpdateSalesDto) {
    return this.salesService.updateCreditSale(id, dto);
  }

  @Delete('credit/:id')
  @RequiredPermission({ control: 'CreditSales', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a credit sale (cascade master + details, restore stock)' })
  @ApiResponse({ status: 403, description: 'No delete permission for Credit Sales' })
  removeCreditSale(@Param('id') id: string) {
    return this.salesService.removeCreditSale(id);
  }

  // Read-only, for printing — same rationale as the credit sale invoice route above.
  @Get('vat/credit/:id/invoice')
  @ApiOperation({ summary: 'Get a VAT credit sale with customer + branch details, for printing' })
  @ApiResponse({ status: 404, description: 'VAT credit sale not found' })
  getVatCreditSaleInvoice(@Param('id') id: string) {
    return this.salesService.getVatCreditSaleInvoice(id);
  }
}
