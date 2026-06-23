import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import {
  PermissionsService,
  UpsertPermissionDto,
  SyncPermissionsDto,
} from './permissions.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@ApiTags('Permissions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private permissionsService: PermissionsService) {}

  @Get()
  @ApiOperation({ summary: 'List all permissions' })
  @ApiResponse({ status: 200, description: 'All permission rows with menu and role' })
  findAll() {
    return this.permissionsService.findAll();
  }

  @Get('role/:roleId')
  @ApiOperation({ summary: 'Get all permissions for a role' })
  @ApiParam({ name: 'roleId', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'List of permissions for the role' })
  findByRole(@Param('roleId') roleId: string) {
    return this.permissionsService.findByRole(roleId);
  }

  /** Canonical save — deletes all existing entries for the role then batch-inserts the new set. */
  @Put('role/:roleId')
  @ApiOperation({ summary: 'Save permissions for a role (sync/overwrite — delete-then-insert)' })
  @ApiParam({ name: 'roleId', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Role permissions replaced successfully' })
  syncByRole(@Param('roleId') roleId: string, @Body() dto: SyncPermissionsDto) {
    return this.permissionsService.syncByRole(roleId, dto.permissions);
  }

  @Delete('role/:roleId')
  @ApiOperation({ summary: 'Delete all permissions for a role' })
  @ApiParam({ name: 'roleId', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'All permissions for the role deleted' })
  removeByRole(@Param('roleId') roleId: string) {
    return this.permissionsService.removeByRole(roleId);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update a single permission' })
  @ApiResponse({ status: 201, description: 'Permission upserted successfully' })
  upsert(@Body() dto: UpsertPermissionDto) {
    return this.permissionsService.upsert(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a single permission by ID' })
  @ApiParam({ name: 'id', description: 'Permission UUID' })
  @ApiResponse({ status: 200, description: 'Permission deleted' })
  remove(@Param('id') id: string) {
    return this.permissionsService.remove(id);
  }
}
