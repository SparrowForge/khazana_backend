import { Controller, Get, Post, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { CreateCashSaleDto } from './dto/create-cash-sale.dto';
import { CreateCreditSaleDto } from './dto/create-credit-sale.dto';
import { CreateVatCashSaleDto } from './dto/create-vat-cash-sale.dto';
import { CreateVatCreditSaleDto } from './dto/create-vat-credit-sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Sales')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all sales (filtered by type and branch)' })
  @ApiQuery({ name: 'type', required: false, enum: ['cash', 'credit', 'vat-cash', 'vat-credit'], description: 'Sale type' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'List of sales' })
  findAll(
    @Query('type') type: 'cash' | 'credit' | 'vat-cash' | 'vat-credit' = 'cash',
    @Query('branchId') branchId?: string,
  ) {
    return this.salesService.findAll(type, branchId ? +branchId : undefined);
  }

  @Post('cash')
  @ApiOperation({ summary: 'Create a cash sale' })
  @ApiResponse({ status: 201, description: 'Cash sale created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid sale data' })
  createCashSale(@Body() dto: CreateCashSaleDto, @CurrentUser('userName') userName: string) {
    return this.salesService.createCashSale(dto, userName);
  }

  @Post('credit')
  @ApiOperation({ summary: 'Create a credit sale' })
  @ApiResponse({ status: 201, description: 'Credit sale created successfully' })
  createCreditSale(@Body() dto: CreateCreditSaleDto, @CurrentUser('userName') userName: string) {
    return this.salesService.createCreditSale(dto, userName);
  }

  @Post('vat/cash')
  @ApiOperation({ summary: 'Create a VAT cash sale' })
  @ApiResponse({ status: 201, description: 'VAT cash sale created successfully' })
  createVatCashSale(@Body() dto: CreateVatCashSaleDto, @CurrentUser('userName') userName: string) {
    return this.salesService.createVatCashSale(dto, userName);
  }

  @Post('vat/credit')
  @ApiOperation({ summary: 'Create a VAT credit sale' })
  @ApiResponse({ status: 201, description: 'VAT credit sale created successfully' })
  createVatCreditSale(
    @Body() dto: CreateVatCreditSaleDto,
    @CurrentUser('userName') userName: string,
  ) {
    return this.salesService.createVatCreditSale(dto, userName);
  }
}
