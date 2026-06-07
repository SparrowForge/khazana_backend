import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { AssortmentService, CreateAssortmentDto } from './assortment.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Assortment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('assortment')
export class AssortmentController {
  constructor(private assortmentService: AssortmentService) {}

  @Get()
  @ApiOperation({ summary: 'Get all assortment records' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'List of assortment records' })
  findAll(@Query('branchId') branchId?: string) {
    return this.assortmentService.findAll(branchId ? +branchId : undefined);
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
