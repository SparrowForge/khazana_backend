import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiredPermission } from '../common/decorators';
import { PaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Categories')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all item categories' })
  @ApiResponse({ status: 200, description: 'List of categories' })
  async findAll(@Query() query: PaginationQueryDto) {
    const { items, meta } = await this.categoriesService.findAll(query);
    return paginatedResponse(items, meta, 'Category');
  }

  @Post()
  @RequiredPermission({ control: 'Categories', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a new category' })
  @ApiResponse({ status: 201, description: 'Category created successfully' })
  @ApiResponse({ status: 409, description: 'Category code already exists' })
  create(@Body() body: any) { return this.categoriesService.create(body); }

  @Patch(':id')
  @RequiredPermission({ control: 'Categories', action: 'editAccess' })
  @ApiOperation({ summary: 'Update category by ID' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category updated successfully' })
  update(@Param('id') id: string, @Body() body: any) { return this.categoriesService.update(id, body); }

  @Delete(':id')
  @RequiredPermission({ control: 'Categories', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete category by ID' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category deleted successfully' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  remove(@Param('id') id: string) { return this.categoriesService.remove(id); }
}
