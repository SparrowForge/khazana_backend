import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { PosSalesService } from './pos-sales.service';
import { CreatePosSaleDto, UpdatePosSaleDto } from './dto/create-pos-sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';

@ApiTags('POS Sales')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pos/sales')
export class PosSalesController {
  constructor(private service: PosSalesService) {}

  @Post()
  @RequiredPermission({ control: 'POSTerminal', action: 'addAccess' })
  @ApiOperation({ summary: 'Create POS sale — calculates VAT from t_Price, writes t_SOMstr + t_SODet' })
  create(
    @Body() dto: CreatePosSaleDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.service.create(dto, userName, branchId);
  }

  @Get()
  @ApiOperation({ summary: 'List all POS sales (DS- prefix invoices)' })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a POS sale by ID for invoice print' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequiredPermission({ control: 'POSSales', action: 'editAccess' })
  @ApiOperation({ summary: 'Edit a POS sale (purge-replace lines, re-price, delta-adjust stock)' })
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
