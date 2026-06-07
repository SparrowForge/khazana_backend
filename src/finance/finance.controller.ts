import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService, CreateMoneyReceiveDto, CreateCashPurchaseDto } from './finance.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Finance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('finance')
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  @Get('money-receive')
  @ApiOperation({ summary: 'Get all money receive records' })
  @ApiResponse({ status: 200, description: 'List of money receive records' })
  findAllMoneyReceive() { return this.financeService.findAllMoneyReceive(); }

  @Post('money-receive')
  @ApiOperation({ summary: 'Record a money receipt from customer' })
  @ApiResponse({ status: 201, description: 'Money receive recorded successfully' })
  createMoneyReceive(@Body() dto: CreateMoneyReceiveDto, @CurrentUser('userName') userName: string) {
    return this.financeService.createMoneyReceive(dto, userName);
  }

  @Get('cash-purchase')
  @ApiOperation({ summary: 'Get all cash purchase records' })
  @ApiResponse({ status: 200, description: 'List of cash purchases' })
  findAllCashPurchases() { return this.financeService.findAllCashPurchases(); }

  @Post('cash-purchase')
  @ApiOperation({ summary: 'Record a cash purchase' })
  @ApiResponse({ status: 201, description: 'Cash purchase recorded successfully' })
  createCashPurchase(@Body() dto: CreateCashPurchaseDto, @CurrentUser('userName') userName: string) {
    return this.financeService.createCashPurchase(dto, userName);
  }
}
