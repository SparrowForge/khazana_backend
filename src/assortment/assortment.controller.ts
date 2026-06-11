import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { AssortmentService, CreateAssortmentDto } from './assortment.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';
import { BranchPaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Assortment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('assortment')
export class AssortmentController {
  constructor(private assortmentService: AssortmentService) {}

  @Get()
  @ApiOperation({ summary: 'Get all assortment records' })
  @ApiResponse({ status: 200, description: 'Paginated list of assortment records' })
  async findAll(@Query() query: BranchPaginationQueryDto) {
    const { items, meta } = await this.assortmentService.findAll(query);
    return paginatedResponse(items, meta, 'Assortment');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get assortment by ID' })
  @ApiParam({ name: 'id', description: 'Assortment UUID' })
  @ApiResponse({ status: 200, description: 'Assortment found' })
  @ApiResponse({ status: 404, description: 'Assortment not found' })
  findOne(@Param('id') id: string) { return this.assortmentService.findOne(id); }

  @Post()
  @ApiOperation({ summary: 'Create a new assortment record' })
  @ApiResponse({ status: 201, description: 'Assortment created successfully' })
  create(@Body() dto: CreateAssortmentDto, @CurrentUser('userName') userName: string) {
    return this.assortmentService.create(dto, userName);
  }
}
