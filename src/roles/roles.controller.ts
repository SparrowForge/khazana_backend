import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { RolesService, CreateRoleDto } from './roles.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@ApiTags('Roles')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('roles')
export class RolesController {
  constructor(private rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all roles with permissions' })
  @ApiResponse({ status: 200, description: 'List of roles' })
  findAll() { return this.rolesService.findAll(); }

  @Get(':id')
  @ApiOperation({ summary: 'Get role by ID' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Role found' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  findOne(@Param('id') id: string) { return this.rolesService.findOne(id); }

  @Post()
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  create(@Body() dto: CreateRoleDto) { return this.rolesService.create(dto); }

  @Patch(':id')
  @ApiOperation({ summary: 'Update role by ID' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateRoleDto>) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete role by ID' })
  @ApiParam({ name: 'id', description: 'Role UUID' })
  @ApiResponse({ status: 200, description: 'Role deleted successfully' })
  remove(@Param('id') id: string) { return this.rolesService.remove(id); }
}
