import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { PosSalesService } from './pos-sales.service';
import { CreatePosSaleDto, UpdatePosSaleDto } from './dto/create-pos-sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';
import { PosSalesQueryDto } from './dto/pos-sales-query.dto';

@ApiTags('POS Sales')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pos/sales')
export class PosSalesController {
  constructor(private service: PosSalesService) {}

  @Post()
  @RequiredPermission({ control: 'POSTerminal', action: 'addAccess' })
  @ApiOperation({ summary: 'Create POS sale — calculates VAT from t_Price, writes t_SOMstr + t_SODet' })
  @ApiResponse({ status: 400, description: 'Cart empty, bad discount/payment, or insufficient stock' })
  create(
    @Body() dto: CreatePosSaleDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
    @CurrentUser('name') name: string,
  ) {
    // Who served the sale is the signed-in user, never a value from the body —
    // the terminal has no field for it.
    return this.service.create(dto, userName, branchId, name);
  }

  @Get()
  @ApiOperation({ summary: 'List POS sales (DS- prefix invoices), optionally within a date range' })
  findAll(@Query() query: PosSalesQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a POS sale by ID for invoice print' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequiredPermission({ control: 'POSSales', action: 'editAccess' })
  @ApiOperation({ summary: 'Edit a POS sale (purge-replace lines, re-price, delta-adjust stock)' })
  @ApiResponse({ status: 400, description: 'Cart empty, bad discount/payment, or insufficient stock' })
  @ApiResponse({ status: 403, description: 'No edit permission for POS Sales' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePosSaleDto,
    @CurrentUser('userName') userName: string,
  ) {
    return this.service.update(id, dto, userName);
  }

  @Delete(':id')
  @RequiredPermission({ control: 'POSSales', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a POS sale (cascade master + details, restore stock)' })
  @ApiResponse({ status: 403, description: 'No delete permission for POS Sales' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
