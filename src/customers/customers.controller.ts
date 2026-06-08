import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CustomersService, CreateCustomerDto } from './customers.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@ApiTags('Customers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'Get all customers' })
  @ApiResponse({ status: 200, description: 'List of customers' })
  findAll() { return this.customersService.findAll(); }

  // NOTE: static 'payments' routes must be declared before ':code' so they are matched first
  @Get('payments')
  @ApiOperation({ summary: 'Get all customer payments (register)' })
  @ApiResponse({ status: 200, description: 'List of all payments' })
  findAllPayments() { return this.customersService.findAllPayments(); }

  @Post('payments')
  @ApiOperation({ summary: 'Record a payment (client code in body)' })
  @ApiResponse({ status: 201, description: 'Payment recorded successfully' })
  createPayment(@Body() body: any) { return this.customersService.addPayment(body); }

  @Get(':code')
  @ApiOperation({ summary: 'Get customer by code' })
  @ApiParam({ name: 'code', description: 'Customer code' })
  @ApiResponse({ status: 200, description: 'Customer found' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  findOne(@Param('code') code: string) { return this.customersService.findOne(code); }

  @Post()
  @ApiOperation({ summary: 'Create a new customer' })
  @ApiResponse({ status: 201, description: 'Customer created successfully' })
  @ApiResponse({ status: 409, description: 'Customer code already exists' })
  create(@Body() dto: CreateCustomerDto) { return this.customersService.create(dto); }

  @Patch(':code')
  @ApiOperation({ summary: 'Update customer by code' })
  @ApiParam({ name: 'code', description: 'Customer code' })
  @ApiResponse({ status: 200, description: 'Customer updated successfully' })
  update(@Param('code') code: string, @Body() dto: Partial<CreateCustomerDto>) {
    return this.customersService.update(code, dto);
  }

  @Get(':code/ledger')
  @ApiOperation({ summary: 'Get customer ledger (all transactions)' })
  @ApiParam({ name: 'code', description: 'Customer code' })
  @ApiResponse({ status: 200, description: 'Customer ledger entries' })
  getLedger(@Param('code') code: string) { return this.customersService.getLedger(code); }

  @Get(':code/balance')
  @ApiOperation({ summary: 'Get customer outstanding balance' })
  @ApiParam({ name: 'code', description: 'Customer code' })
  @ApiResponse({ status: 200, description: 'Customer balance summary' })
  getBalance(@Param('code') code: string) { return this.customersService.getBalance(code); }

  @Post(':code/payments')
  @ApiOperation({ summary: 'Record a payment from customer' })
  @ApiParam({ name: 'code', description: 'Customer code' })
  @ApiResponse({ status: 201, description: 'Payment recorded successfully' })
  addPayment(@Param('code') code: string, @Body() body: any) {
    return this.customersService.addPayment({ ...body, clientCode: code });
  }

  @Get(':code/payments')
  @ApiOperation({ summary: 'Get all payments from customer' })
  @ApiParam({ name: 'code', description: 'Customer code' })
  @ApiResponse({ status: 200, description: 'List of payments' })
  findPayments(@Param('code') code: string) { return this.customersService.findPayments(code); }

  @Delete(':code')
  @ApiOperation({ summary: 'Delete customer by code' })
  @ApiParam({ name: 'code', description: 'Customer code' })
  @ApiResponse({ status: 200, description: 'Customer deleted successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  remove(@Param('code') code: string) { return this.customersService.remove(code); }
}
