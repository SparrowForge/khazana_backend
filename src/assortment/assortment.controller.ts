import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AssortmentService, CreateAssortmentDto, UpdateAssortmentDto } from './assortment.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';
import { DateRangeQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Assortment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('assortment')
export class AssortmentController {
  constructor(private assortmentService: AssortmentService) {}

  @Get()
  @ApiOperation({ summary: 'Get all assortment records' })
  @ApiResponse({ status: 200, description: 'Paginated list of assortment records' })
  async findAll(@Query() query: DateRangeQueryDto) {
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
  @RequiredPermission({ control: 'Assortment', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a new assortment record' })
  @ApiResponse({ status: 201, description: 'Assortment created successfully' })
  create(
    @Body() dto: CreateAssortmentDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.assortmentService.create(dto, userName, branchId);
  }

  @Patch(':id')
  @RequiredPermission({ control: 'Assortment', action: 'editAccess' })
  @ApiOperation({ summary: 'Update an assortment record' })
  @ApiParam({ name: 'id', description: 'Assortment UUID' })
  @ApiResponse({ status: 200, description: 'Assortment updated successfully' })
  @ApiResponse({ status: 404, description: 'Assortment not found' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAssortmentDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.assortmentService.update(id, dto, userName, branchId);
  }

  @Delete(':id')
  @RequiredPermission({ control: 'Assortment', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete an assortment (master + details) and restore its deducted stock' })
  @ApiParam({ name: 'id', description: 'Assortment UUID' })
  @ApiResponse({ status: 200, description: 'Assortment deleted successfully' })
  @ApiResponse({ status: 403, description: 'No delete permission for Assortment' })
  @ApiResponse({ status: 404, description: 'Assortment not found' })
  remove(@Param('id') id: string) {
    return this.assortmentService.remove(id);
  }
}
