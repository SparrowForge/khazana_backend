import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { MenusService, CreateMenuDto } from './menus.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiredPermission } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Menus')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('menus')
export class MenusController {
  constructor(private menusService: MenusService) {}

  @Get()
  @ApiOperation({ summary: 'Get all menu items' })
  @ApiResponse({ status: 200, description: 'List of menus' })
  async findAll(@Query() query: PaginationQueryDto) {
    const { items, meta } = await this.menusService.findAll(query);
    return paginatedResponse(items, meta, 'Menu');
  }

  // NOTE: static 'nav' route must precede ':id' so it is matched first
  @Get('nav')
  @ApiOperation({ summary: 'Get full ordered menu list for navigation tree' })
  @ApiResponse({ status: 200, description: 'All active menus (non-paginated)' })
  nav() { return this.menusService.findNav(); }

  @Get(':id')
  @ApiOperation({ summary: 'Get menu by ID' })
  @ApiParam({ name: 'id', description: 'Menu UUID' })
  @ApiResponse({ status: 200, description: 'Menu found' })
  @ApiResponse({ status: 404, description: 'Menu not found' })
  findOne(@Param('id') id: string) { return this.menusService.findOne(id); }

  @Post()
  @RequiredPermission({ control: 'Admin', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a new menu item' })
  @ApiResponse({ status: 201, description: 'Menu created successfully' })
  create(@Body() dto: CreateMenuDto) { return this.menusService.create(dto); }

  @Patch(':id')
  @RequiredPermission({ control: 'Admin', action: 'editAccess' })
  @ApiOperation({ summary: 'Update menu by ID' })
  @ApiParam({ name: 'id', description: 'Menu UUID' })
  @ApiResponse({ status: 200, description: 'Menu updated successfully' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateMenuDto>) {
    return this.menusService.update(id, dto);
  }

  @Delete(':id')
  @RequiredPermission({ control: 'Admin', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete menu by ID' })
  @ApiParam({ name: 'id', description: 'Menu UUID' })
  @ApiResponse({ status: 200, description: 'Menu deleted successfully' })
  remove(@Param('id') id: string) { return this.menusService.remove(id); }
}
