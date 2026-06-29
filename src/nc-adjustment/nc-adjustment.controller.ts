import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { NcAdjustmentService, CreateNcAdjustmentDto, UpdateNcAdjustmentDto } from './nc-adjustment.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';
import { BranchPaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('NC Adjustment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
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
  @RequiredPermission({ control: 'NCAdjustment', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a new NC adjustment' })
  @ApiResponse({ status: 201, description: 'NC adjustment created successfully' })
  create(@Body() dto: CreateNcAdjustmentDto, @CurrentUser('userName') userName: string) {
    return this.ncService.create(dto, userName);
  }

  @Patch(':id')
  @RequiredPermission({ control: 'NCAdjustment', action: 'editAccess' })
  @ApiOperation({ summary: 'Update an NC adjustment (header, or replace lines + re-reconcile stock)' })
  @ApiParam({ name: 'id', description: 'NC adjustment UUID' })
  @ApiResponse({ status: 200, description: 'NC adjustment updated successfully' })
  @ApiResponse({ status: 403, description: 'No edit permission for NC Adjustment' })
  @ApiResponse({ status: 404, description: 'NC adjustment not found' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNcAdjustmentDto,
    @CurrentUser('userName') userName: string,
  ) {
    return this.ncService.update(id, dto, userName);
  }

  @Delete(':id')
  @RequiredPermission({ control: 'NCAdjustment', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete an NC adjustment (master + details) and reverse its stock additions' })
  @ApiParam({ name: 'id', description: 'NC adjustment UUID' })
  @ApiResponse({ status: 200, description: 'NC adjustment deleted successfully' })
  @ApiResponse({ status: 403, description: 'No delete permission for NC Adjustment' })
  @ApiResponse({ status: 404, description: 'NC adjustment not found' })
  remove(@Param('id') id: string) {
    return this.ncService.remove(id);
  }
}
