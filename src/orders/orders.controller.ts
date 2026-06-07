import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { OrdersService, CreateOrderDto } from './orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Get all orders' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'List of orders' })
  findAll(@Query('branchId') branchId?: string) {
    return this.ordersService.findAll(branchId ? +branchId : undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Order found' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  findOne(@Param('id') id: string) { return this.ordersService.findOne(id); }

  @Post()
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  create(@Body() dto: CreateOrderDto, @CurrentUser('userName') userName: string) {
    return this.ordersService.create(dto, userName);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update order by ID' })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Order updated successfully' })
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateOrderDto>,
    @CurrentUser('userName') userName: string,
  ) {
    return this.ordersService.update(id, dto, userName);
  }

  @Get('vat/list')
  @ApiOperation({ summary: 'Get all VAT orders' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'List of VAT orders' })
  findAllVat(@Query('branchId') branchId?: string) {
    return this.ordersService.findAllVat(branchId ? +branchId : undefined);
  }

  @Post('vat')
  @ApiOperation({ summary: 'Create a VAT order' })
  @ApiResponse({ status: 201, description: 'VAT order created successfully' })
  createVat(@Body() dto: any, @CurrentUser('userName') userName: string) {
    return this.ordersService.createVat(dto, userName);
  }
}
