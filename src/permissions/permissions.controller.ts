import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { PermissionsService, UpsertPermissionDto } from './permissions.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@ApiTags('Permissions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private permissionsService: PermissionsService) {}

  @Get('role/:roleId')
  @ApiOperation({ summary: 'Get all permissions for a role' })
  @ApiParam({ name: 'roleId', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'List of permissions for the role' })
  findByRole(@Param('roleId') roleId: string) {
    return this.permissionsService.findByRole(roleId);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update a single permission' })
  @ApiResponse({ status: 201, description: 'Permission upserted successfully' })
  upsert(@Body() dto: UpsertPermissionDto) {
    return this.permissionsService.upsert(dto);
  }

  @Post('role/:roleId/bulk')
  @ApiOperation({ summary: 'Bulk create/update permissions for a role' })
  @ApiParam({ name: 'roleId', description: 'Role UUID' })
  @ApiResponse({ status: 201, description: 'Permissions bulk updated successfully' })
  bulkUpsert(
    @Param('roleId') roleId: string,
    @Body() body: { permissions: Omit<UpsertPermissionDto, 'roleId'>[] },
  ) {
    return this.permissionsService.bulkUpsert(roleId, body.permissions);
  }
}
