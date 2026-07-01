import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetUserRolesDto, BatchUserPermissionsDto } from './dto/set-user-roles.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  async findAll(@Query() query: PaginationQueryDto) {
    const { items, meta } = await this.usersService.findAll(query);
    return paginatedResponse(items, meta, 'User');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @RequiredPermission({ control: 'Users', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'Username already exists' })
  create(@Body() dto: CreateUserDto, @CurrentUser('userName') userName: string) {
    return this.usersService.create(dto, userName);
  }

  @Patch(':id')
  @RequiredPermission({ control: 'Users', action: 'editAccess' })
  @ApiOperation({ summary: 'Update user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('userName') userName: string,
  ) {
    return this.usersService.update(id, dto, userName);
  }

  @Delete(':id')
  @RequiredPermission({ control: 'Users', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  remove(@Param('id') id: string, @CurrentUser('userName') userName: string) {
    return this.usersService.remove(id, userName);
  }

  @Post(':userName/roles')
  @RequiredPermission({ control: 'UserRoleAssignment', action: 'editAccess' })
  @ApiOperation({ summary: 'Set roles for a user' })
  @ApiParam({ name: 'userName', description: 'Username' })
  @ApiResponse({ status: 201, description: 'Roles assigned successfully' })
  setRoles(@Param('userName') userName: string, @Body() dto: SetUserRolesDto) {
    return this.usersService.setUserRoles(userName, dto);
  }

  @Get(':userName/permissions')
  @ApiOperation({ summary: "Get a user's explicit menu permissions" })
  @ApiParam({ name: 'userName', description: 'Username' })
  @ApiResponse({ status: 200, description: 'User and their t_UserRole permission rows' })
  getUserPermissions(@Param('userName') userName: string) {
    return this.usersService.getUserPermissions(userName);
  }

  @Put(':userName/permissions')
  @RequiredPermission({ control: 'UserMenuPermission', action: 'editAccess' })
  @ApiOperation({ summary: 'Save menu permissions for a user (sync/overwrite — delete-then-insert)' })
  @ApiParam({ name: 'userName', description: 'Username' })
  @ApiResponse({ status: 200, description: 'User permissions updated' })
  setUserPermissions(@Param('userName') userName: string, @Body() dto: SetUserRolesDto) {
    return this.usersService.setUserPermissions(userName, dto);
  }

  @Put('permissions/batch')
  @RequiredPermission({ control: 'UserRoleAssignment', action: 'editAccess' })
  @ApiOperation({ summary: 'Apply one permission grid to many users (sync/overwrite — delete-then-insert)' })
  @ApiResponse({ status: 200, description: 'Permissions updated for all target users' })
  syncBatch(@Body() dto: BatchUserPermissionsDto) {
    return this.usersService.syncPermissionsForUsers(dto);
  }

  @Patch(':id/reset-password')
  @ApiOperation({ summary: 'Reset user password (no Users permission required)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  resetPassword(@Param('id') id: string, @Body('password') password: string) {
    return this.usersService.resetPassword(id, password);
  }
}
