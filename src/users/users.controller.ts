import {
  Controller,
  Get,
  Post,
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
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
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
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 409, description: 'Username already exists' })
  create(@Body() dto: CreateUserDto, @CurrentUser('userName') userName: string) {
    return this.usersService.create(dto, userName);
  }

  @Patch(':id')
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
  @ApiOperation({ summary: 'Delete user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  remove(@Param('id') id: string, @CurrentUser('userName') userName: string) {
    return this.usersService.remove(id, userName);
  }

  @Post(':userName/roles')
  @ApiOperation({ summary: 'Set roles for a user' })
  @ApiParam({ name: 'userName', description: 'Username' })
  @ApiResponse({ status: 201, description: 'Roles assigned successfully' })
  setRoles(@Param('userName') userName: string, @Body() dto: SetUserRolesDto) {
    return this.usersService.setUserRoles(userName, dto);
  }

  @Patch(':id/reset-password')
  @ApiOperation({ summary: 'Reset user password' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  resetPassword(@Param('id') id: string, @Body('password') password: string) {
    return this.usersService.resetPassword(id, password);
  }
}
