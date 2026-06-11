import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { NcAdjustmentService, CreateNcAdjustmentDto } from './nc-adjustment.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';
import { BranchPaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('NC Adjustment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('nc-adjustment')
export class NcAdjustmentController {
  constructor(private ncService: NcAdjustmentService) {}

  @Get()
  @ApiOperation({ summary: 'Get all NC adjustments' })
  @ApiResponse({ status: 200, description: 'Paginated list of NC adjustments' })
  async findAll(@Query() query: BranchPaginationQueryDto) {
    const { items, meta } = await this.ncService.findAll(query);
    return paginatedResponse(items, meta, 'NC Adjustment');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get NC adjustment by ID' })
  @ApiParam({ name: 'id', description: 'NC adjustment UUID' })
  @ApiResponse({ status: 200, description: 'NC adjustment found' })
  @ApiResponse({ status: 404, description: 'NC adjustment not found' })
  findOne(@Param('id') id: string) { return this.ncService.findOne(id); }

  @Post()
  @ApiOperation({ summary: 'Create a new NC adjustment' })
  @ApiResponse({ status: 201, description: 'NC adjustment created successfully' })
  create(@Body() dto: CreateNcAdjustmentDto, @CurrentUser('userName') userName: string) {
    return this.ncService.create(dto, userName);
  }
}
