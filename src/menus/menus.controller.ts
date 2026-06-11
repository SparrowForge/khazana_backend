import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { MenusService, CreateMenuDto } from './menus.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Menus')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
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

  @Get(':id')
  @ApiOperation({ summary: 'Get menu by ID' })
  @ApiParam({ name: 'id', description: 'Menu UUID' })
  @ApiResponse({ status: 200, description: 'Menu found' })
  @ApiResponse({ status: 404, description: 'Menu not found' })
  findOne(@Param('id') id: string) { return this.menusService.findOne(id); }

  @Post()
  @ApiOperation({ summary: 'Create a new menu item' })
  @ApiResponse({ status: 201, description: 'Menu created successfully' })
  create(@Body() dto: CreateMenuDto) { return this.menusService.create(dto); }

  @Patch(':id')
  @ApiOperation({ summary: 'Update menu by ID' })
  @ApiParam({ name: 'id', description: 'Menu UUID' })
  @ApiResponse({ status: 200, description: 'Menu updated successfully' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateMenuDto>) {
    return this.menusService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete menu by ID' })
  @ApiParam({ name: 'id', description: 'Menu UUID' })
  @ApiResponse({ status: 200, description: 'Menu deleted successfully' })
  remove(@Param('id') id: string) { return this.menusService.remove(id); }
}
