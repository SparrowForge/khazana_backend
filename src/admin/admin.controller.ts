import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { AdminService, CreateBranchDto, UpdateSystemDto } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, Public, RequiredPermission } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Public()
  @Get('branches')
  @ApiOperation({ summary: 'Get all branches' })
  @ApiResponse({ status: 200, description: 'List of branches' })
  async findAllBranches(@Query() query: PaginationQueryDto) {
    const { items, meta } = await this.adminService.findAllBranches(query);
    return paginatedResponse(items, meta, 'Branch');
  }

  @Post('branches')
  @RequiredPermission({ control: 'Branches', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a new branch' })
  @ApiResponse({ status: 201, description: 'Branch created successfully' })
  createBranch(@Body() dto: CreateBranchDto) { return this.adminService.createBranch(dto); }

  @Patch('branches/:id')
  @RequiredPermission({ control: 'Branches', action: 'editAccess' })
  @ApiOperation({ summary: 'Update branch by ID' })
  @ApiParam({ name: 'id', description: 'Branch UUID' })
  @ApiResponse({ status: 200, description: 'Branch updated successfully' })
  updateBranch(@Param('id') id: string, @Body() dto: Partial<CreateBranchDto>) {
    return this.adminService.updateBranch(id, dto);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get system settings' })
  @ApiResponse({ status: 200, description: 'System settings' })
  getSettings() { return this.adminService.getSystemSettings(); }

  @Patch('settings')
  @RequiredPermission({ control: 'SystemSettings', action: 'editAccess' })
  @ApiOperation({ summary: 'Update system settings' })
  @ApiResponse({ status: 200, description: 'Settings updated successfully' })
  updateSettings(@Body() dto: UpdateSystemDto) { return this.adminService.updateSystemSettings(dto); }

  @Get('audit-log')
  @ApiOperation({ summary: 'Get audit log entries' })
  @ApiQuery({ name: 'take', required: false, description: 'Number of records to return (default 200)' })
  @ApiResponse({ status: 200, description: 'Audit log entries' })
  getAuditLog(@Query('take') take?: string) {
    return this.adminService.findAuditLogs(take ? +take : 200);
  }

  @Get('banks')
  @ApiOperation({ summary: 'Get all banks' })
  @ApiResponse({ status: 200, description: 'List of banks' })
  async findAllBanks(@Query() query: PaginationQueryDto) {
    const { items, meta } = await this.adminService.findAllBanks(query);
    return paginatedResponse(items, meta, 'Bank');
  }

  @Post('banks')
  @RequiredPermission({ control: 'Bank', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a new bank' })
  @ApiResponse({ status: 201, description: 'Bank created successfully' })
  createBank(@Body('name') name: string, @CurrentUser('userName') userName: string) {
    return this.adminService.createBank(name, userName);
  }

  @Patch('banks/:id')
  @RequiredPermission({ control: 'Bank', action: 'editAccess' })
  @ApiOperation({ summary: 'Update bank by ID' })
  @ApiParam({ name: 'id', description: 'Bank UUID' })
  @ApiResponse({ status: 200, description: 'Bank updated successfully' })
  @ApiResponse({ status: 404, description: 'Bank not found' })
  updateBank(@Param('id') id: string, @Body('name') name: string) {
    return this.adminService.updateBank(id, name);
  }

  @Delete('banks/:id')
  @RequiredPermission({ control: 'Bank', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete bank by ID' })
  @ApiParam({ name: 'id', description: 'Bank UUID' })
  @ApiResponse({ status: 200, description: 'Bank deleted successfully' })
  @ApiResponse({ status: 404, description: 'Bank not found' })
  @ApiResponse({ status: 409, description: 'Bank is referenced by sales' })
  removeBank(@Param('id') id: string) {
    return this.adminService.removeBank(id);
  }
}
