import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { DemandOrdersService, CreateDemandOrderDto } from './demand-orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';
import { BranchPaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Demand Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('demand-orders')
export class DemandOrdersController {
  constructor(private demandOrdersService: DemandOrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Get all demand orders' })
  @ApiResponse({ status: 200, description: 'Paginated list of demand orders' })
  async findAll(@Query() query: BranchPaginationQueryDto, @CurrentUser('branchIds') branchIds: string[]) {
    const { items, meta } = await this.demandOrdersService.findAll(query, branchIds);
    return paginatedResponse(items, meta, 'Demand Order');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get demand order by ID' })
  @ApiParam({ name: 'id', description: 'Demand order UUID' })
  @ApiResponse({ status: 200, description: 'Demand order found' })
  @ApiResponse({ status: 404, description: 'Demand order not found' })
  findOne(@Param('id') id: string, @CurrentUser('branchIds') branchIds: string[]) {
    return this.demandOrdersService.findOne(id, branchIds);
  }

  @Post()
  @RequiredPermission({ control: 'DemandOrders', action: 'addAccess' })
  @ApiOperation({ summary: 'Submit a new demand order to the factory' })
  @ApiResponse({ status: 201, description: 'Demand order created successfully' })
  create(
    @Body() dto: CreateDemandOrderDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.demandOrdersService.create(dto, userName, branchId);
  }

  @Patch(':id')
  @RequiredPermission({ control: 'DemandOrders', action: 'editAccess' })
  @ApiOperation({ summary: 'Update demand order by ID' })
  @ApiParam({ name: 'id', description: 'Demand order UUID' })
  @ApiResponse({ status: 200, description: 'Demand order updated successfully' })
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateDemandOrderDto>,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchIds') branchIds: string[],
  ) {
    return this.demandOrdersService.update(id, dto, userName, branchIds);
  }

  @Delete(':id')
  @RequiredPermission({ control: 'DemandOrders', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete demand order by ID' })
  @ApiParam({ name: 'id', description: 'Demand order UUID' })
  @ApiResponse({ status: 200, description: 'Demand order deleted successfully' })
  @ApiResponse({ status: 404, description: 'Demand order not found' })
  remove(@Param('id') id: string, @CurrentUser('branchIds') branchIds: string[]) {
    return this.demandOrdersService.remove(id, branchIds);
  }
}
