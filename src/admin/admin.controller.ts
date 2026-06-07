import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { AdminService, CreateBranchDto, UpdateSystemDto } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('branches')
  @ApiOperation({ summary: 'Get all branches' })
  @ApiResponse({ status: 200, description: 'List of branches' })
  findAllBranches() { return this.adminService.findAllBranches(); }

  @Post('branches')
  @ApiOperation({ summary: 'Create a new branch' })
  @ApiResponse({ status: 201, description: 'Branch created successfully' })
  createBranch(@Body() dto: CreateBranchDto) { return this.adminService.createBranch(dto); }

  @Patch('branches/:id')
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
  findAllBanks() { return this.adminService.findAllBanks(); }

  @Post('banks')
  @ApiOperation({ summary: 'Create a new bank' })
  @ApiResponse({ status: 201, description: 'Bank created successfully' })
  createBank(@Body('name') name: string, @CurrentUser('userName') userName: string) {
    return this.adminService.createBank(name, userName);
  }
}
