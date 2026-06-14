import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PosProductsService } from './pos-products.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@ApiTags('POS Products')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('pos/products')
export class PosProductsController {
  constructor(private service: PosProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all items with active prices (for POS terminal)' })
  findAll() {
    return this.service.findAll();
  }
}
