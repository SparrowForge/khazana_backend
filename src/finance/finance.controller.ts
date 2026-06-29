import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService, CreateCashPurchaseDto } from './finance.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Finance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance')
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  @Get('cash-purchase')
  @ApiOperation({ summary: 'Get all cash purchase records' })
  @ApiResponse({ status: 200, description: 'List of cash purchases' })
  async findAllCashPurchases(@Query() query: PaginationQueryDto) {
    const { items, meta } = await this.financeService.findAllCashPurchases(query);
    return paginatedResponse(items, meta, 'Cash Purchase');
  }

  @Post('cash-purchase')
  @RequiredPermission({ control: 'Finance', action: 'addAccess' })
  @ApiOperation({ summary: 'Record a cash purchase' })
  @ApiResponse({ status: 201, description: 'Cash purchase recorded successfully' })
  createCashPurchase(@Body() dto: CreateCashPurchaseDto, @CurrentUser('userName') userName: string) {
    return this.financeService.createCashPurchase(dto, userName);
  }
}
