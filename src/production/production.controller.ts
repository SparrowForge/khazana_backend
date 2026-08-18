import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ProductionService } from './production.service';
import { CreateProductionDto, UpdateProductionDto } from './dto/production.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';
import { DateRangeQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Production')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('production')
export class ProductionController {
  constructor(private productionService: ProductionService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated production entries (one row per serial number)' })
  @ApiResponse({ status: 200, description: 'Paginated list of production entries' })
  async findAll(@Query() query: DateRangeQueryDto) {
    const { items, meta } = await this.productionService.findAll(query);
    return paginatedResponse(items, meta, 'Production');
  }

  @Get(':serialNo')
  @ApiOperation({ summary: 'Get a single production entry (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Production serial number' })
  @ApiResponse({ status: 200, description: 'Production entry found' })
  @ApiResponse({ status: 404, description: 'Production entry not found' })
  findOne(@Param('serialNo') serialNo: string) {
    return this.productionService.findOne(serialNo);
  }

  @Post()
  @RequiredPermission({ control: 'ProductionEntry', action: 'addAccess' })
  @ApiOperation({ summary: 'Record production output (increases stock)' })
  @ApiResponse({ status: 201, description: 'Production entry saved successfully' })
  @ApiResponse({ status: 400, description: 'No items, or an unknown item id' })
  @ApiResponse({ status: 403, description: 'Session branch is not the Factory, or no create permission' })
  create(
    @Body() dto: CreateProductionDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.productionService.create(dto, userName, branchId);
  }

  @Patch(':serialNo')
  @RequiredPermission({ control: 'ProductionEntry', action: 'editAccess' })
  @ApiOperation({ summary: 'Replace all lines of a production entry by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Production serial number' })
  @ApiResponse({ status: 200, description: 'Production entry updated successfully' })
  @ApiResponse({ status: 400, description: 'Reversing the previous lines would drive stock negative' })
  @ApiResponse({ status: 403, description: 'Session branch is not the Factory, or no edit permission' })
  update(
    @Param('serialNo') serialNo: string,
    @Body() dto: UpdateProductionDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.productionService.update(serialNo, dto, userName, branchId);
  }

  @Delete(':serialNo')
  @RequiredPermission({ control: 'ProductionEntry', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a production entry (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Production serial number' })
  @ApiResponse({ status: 200, description: 'Production entry deleted successfully' })
  @ApiResponse({ status: 400, description: 'Reversing the entry would drive stock negative' })
  @ApiResponse({ status: 403, description: 'Session branch is not the Factory, or no delete permission' })
  @ApiResponse({ status: 404, description: 'Production entry not found' })
  remove(@Param('serialNo') serialNo: string, @CurrentUser('branchId') branchId: string) {
    return this.productionService.remove(serialNo, branchId);
  }
}
