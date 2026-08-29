import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { VehicleChallanService } from './vehicle-challan.service';
import { CreateVehicleChallanDto, UpdateVehicleChallanDto, VehicleChallanQueryDto } from './dto/vehicle-challan.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Vehicle Challan')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('vehicle-challans')
export class VehicleChallanController {
  constructor(private vehicleChallanService: VehicleChallanService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated vehicle challans (one row per serial number)' })
  @ApiResponse({ status: 200, description: 'Paginated list of vehicle challans' })
  async findAll(@Query() query: VehicleChallanQueryDto) {
    const { items, meta } = await this.vehicleChallanService.findAll(query);
    return paginatedResponse(items, meta, 'VehicleChallan');
  }

  @Get(':serialNo')
  @ApiOperation({ summary: 'Get a single vehicle challan (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Vehicle challan serial number' })
  @ApiResponse({ status: 200, description: 'Vehicle challan found' })
  @ApiResponse({ status: 404, description: 'Vehicle challan not found' })
  findOne(@Param('serialNo') serialNo: string) {
    return this.vehicleChallanService.findOne(serialNo);
  }

  @Post()
  @RequiredPermission({ control: 'VehicleChallan', action: 'addAccess' })
  @ApiOperation({ summary: 'Raise a vehicle challan (gate pass only — does NOT move stock)' })
  @ApiResponse({ status: 201, description: 'Vehicle challan saved successfully' })
  @ApiResponse({ status: 400, description: 'No items, or an unknown item id' })
  @ApiResponse({ status: 403, description: 'Session branch is not the Factory, or no create permission' })
  create(
    @Body() dto: CreateVehicleChallanDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.vehicleChallanService.create(dto, userName, branchId);
  }

  @Patch(':serialNo')
  @RequiredPermission({ control: 'VehicleChallan', action: 'editAccess' })
  @ApiOperation({ summary: 'Replace all lines of a vehicle challan by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Vehicle challan serial number' })
  @ApiResponse({ status: 200, description: 'Vehicle challan updated successfully' })
  @ApiResponse({ status: 403, description: 'Session branch is not the Factory, or no edit permission' })
  @ApiResponse({ status: 404, description: 'Vehicle challan not found' })
  update(
    @Param('serialNo') serialNo: string,
    @Body() dto: UpdateVehicleChallanDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.vehicleChallanService.update(serialNo, dto, userName, branchId);
  }

  @Delete(':serialNo')
  @RequiredPermission({ control: 'VehicleChallan', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a whole vehicle challan by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Vehicle challan serial number' })
  @ApiResponse({ status: 200, description: 'Vehicle challan deleted successfully' })
  @ApiResponse({ status: 403, description: 'Session branch is not the Factory, or no delete permission' })
  @ApiResponse({ status: 404, description: 'Vehicle challan not found' })
  remove(@Param('serialNo') serialNo: string, @CurrentUser('branchId') branchId: string) {
    return this.vehicleChallanService.remove(serialNo, branchId);
  }
}
