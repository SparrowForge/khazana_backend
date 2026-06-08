import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
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
  createPrice(@Body() body: any, @CurrentUser('userName') userName: string) {
    return this.pricingService.createPrice(body, userName);
  }

  @Patch('prices/:id')
  @ApiOperation({ summary: 'Update a sale price by ID' })
  @ApiParam({ name: 'id', description: 'Price record UUID' })
  @ApiResponse({ status: 200, description: 'Sale price updated successfully' })
  updatePrice(@Param('id') id: string, @Body() body: any, @CurrentUser('userName') userName: string) {
    return this.pricingService.updatePrice(id, body, userName);
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
  createCostPrice(@Body() body: any, @CurrentUser('userName') userName: string) {
    return this.pricingService.createCostPrice(body, userName);
  }

  @Patch('cost-prices/:id')
  @ApiOperation({ summary: 'Update a cost price by ID' })
  @ApiParam({ name: 'id', description: 'Cost price record UUID' })
  @ApiResponse({ status: 200, description: 'Cost price updated successfully' })
  updateCostPrice(@Param('id') id: string, @Body() body: any, @CurrentUser('userName') userName: string) {
    return this.pricingService.updateCostPrice(id, body, userName);
  }
}
