import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PricingService, CreatePriceDto } from './pricing.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Pricing')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('pricing')
export class PricingController {
  constructor(private pricingService: PricingService) {}

  @Get('prices')
  @ApiOperation({ summary: 'Get sale prices (optionally filter by item code)' })
  @ApiQuery({ name: 'itemCode', required: false, description: 'Filter by item code' })
  @ApiResponse({ status: 200, description: 'List of sale prices' })
  findAllPrices(@Query('itemCode') itemCode?: string) {
    return this.pricingService.findAllPrices(itemCode);
  }

  @Get('prices/current')
  @ApiOperation({ summary: 'Get current active price for an item on a given date' })
  @ApiQuery({ name: 'itemCode', required: true, description: 'Item code' })
  @ApiQuery({ name: 'date', required: false, description: 'Date to check price (ISO 8601, defaults to today)' })
  @ApiResponse({ status: 200, description: 'Current price record' })
  getCurrentPrice(@Query('itemCode') itemCode: string, @Query('date') date?: string) {
    return this.pricingService.getCurrentPrice(itemCode, date ? new Date(date) : undefined);
  }

  @Post('prices')
  @ApiOperation({ summary: 'Create a new sale price' })
  @ApiResponse({ status: 201, description: 'Sale price created successfully' })
  createPrice(@Body() dto: CreatePriceDto, @CurrentUser('userName') userName: string) {
    return this.pricingService.createPrice(dto, userName);
  }

  @Get('cost-prices')
  @ApiOperation({ summary: 'Get cost prices (optionally filter by item code)' })
  @ApiQuery({ name: 'itemCode', required: false, description: 'Filter by item code' })
  @ApiResponse({ status: 200, description: 'List of cost prices' })
  findAllCostPrices(@Query('itemCode') itemCode?: string) {
    return this.pricingService.findAllCostPrices(itemCode);
  }

  @Post('cost-prices')
  @ApiOperation({ summary: 'Create a new cost price' })
  @ApiResponse({ status: 201, description: 'Cost price created successfully' })
  createCostPrice(@Body() dto: CreatePriceDto, @CurrentUser('userName') userName: string) {
    return this.pricingService.createCostPrice(dto, userName);
  }
}
