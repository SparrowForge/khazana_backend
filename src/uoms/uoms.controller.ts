import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UomsService } from './uoms.service';
import { CreateUomDto, UpdateUomDto } from './dto/uom.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiredPermission } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('UOM')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('uoms')
export class UomsController {
  constructor(private uomsService: UomsService) {}

  // No @RequiredPermission on the read: every item form needs this list to fill
  // its UOM dropdown, so gating it behind the UOM screen's own permission would
  // empty the dropdown for anyone who cannot administer units.
  @Get()
  @ApiOperation({ summary: 'Get all units of measure' })
  @ApiResponse({ status: 200, description: 'List of UOMs' })
  async findAll(@Query() query: PaginationQueryDto) {
    const { items, meta } = await this.uomsService.findAll(query);
    return paginatedResponse(items, meta, 'UOM');
  }

  @Post()
  @RequiredPermission({ control: 'UOM', action: 'addAccess' })
  @ApiOperation({ summary: 'Add a unit of measure' })
  @ApiResponse({ status: 201, description: 'UOM created successfully' })
  @ApiResponse({ status: 409, description: 'UOM code already exists' })
  create(@Body() dto: CreateUomDto) {
    return this.uomsService.create(dto);
  }

  @Patch(':id')
  @RequiredPermission({ control: 'UOM', action: 'editAccess' })
  @ApiOperation({ summary: 'Update a unit of measure (name/remarks only — the code is fixed)' })
  @ApiParam({ name: 'id', description: 'UOM UUID' })
  @ApiResponse({ status: 200, description: 'UOM updated successfully' })
  @ApiResponse({ status: 404, description: 'UOM not found' })
  update(@Param('id') id: string, @Body() dto: UpdateUomDto) {
    return this.uomsService.update(id, dto);
  }

  @Delete(':id')
  @RequiredPermission({ control: 'UOM', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a unit of measure' })
  @ApiParam({ name: 'id', description: 'UOM UUID' })
  @ApiResponse({ status: 200, description: 'UOM deleted successfully' })
  @ApiResponse({ status: 404, description: 'UOM not found' })
  @ApiResponse({ status: 409, description: 'UOM is in use by one or more items' })
  remove(@Param('id') id: string) {
    return this.uomsService.remove(id);
  }
}
