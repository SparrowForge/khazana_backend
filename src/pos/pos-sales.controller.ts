import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PosSalesService } from './pos-sales.service';
import { CreatePosSaleDto } from './dto/create-pos-sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('POS Sales')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('pos/sales')
export class PosSalesController {
  constructor(private service: PosSalesService) {}

  @Post()
  @ApiOperation({ summary: 'Create POS sale — calculates VAT from t_Price, writes t_SOMstr + t_SODet' })
  create(@Body() dto: CreatePosSaleDto, @CurrentUser('userName') userName: string) {
    return this.service.create(dto, userName);
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
}
