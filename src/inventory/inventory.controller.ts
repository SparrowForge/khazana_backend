import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { IssueStockDto } from './dto/issue-stock.dto';
import { CreateItemDto, UpdateItemDto } from './dto/create-item.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';
import { PaginationQueryDto, BranchPaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Inventory')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'Get current stock levels' })
  @ApiResponse({ status: 200, description: 'Paginated stock summary' })
  async findAll(@Query() query: BranchPaginationQueryDto) {
    const { items, meta } = await this.inventoryService.findAll(query);
    return paginatedResponse(items, meta, 'Inventory');
  }

  @Get('items')
  @ApiOperation({ summary: 'Get all items' })
  @ApiResponse({ status: 200, description: 'Paginated list of all items' })
  async findAllItems(@Query() query: PaginationQueryDto) {
    const { items, meta } = await this.inventoryService.findAllItems(query);
    return paginatedResponse(items, meta, 'Item');
  }

  @Get('items/:id')
  @ApiOperation({ summary: 'Get item by ID' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  @ApiResponse({ status: 200, description: 'Item found' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  findItem(@Param('id') id: string) {
    return this.inventoryService.findItem(id);
  }

  @Post('items')
  @ApiOperation({ summary: 'Create a new item' })
  @ApiResponse({ status: 201, description: 'Item created successfully' })
  @ApiResponse({ status: 409, description: 'Item code already exists' })
  createItem(@Body() dto: CreateItemDto) {
    return this.inventoryService.createItem(dto);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Update item by ID' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  @ApiResponse({ status: 200, description: 'Item updated successfully' })
  updateItem(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.inventoryService.updateItem(id, dto);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Delete (deactivate) item by ID' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  @ApiResponse({ status: 200, description: 'Item deleted successfully' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  deleteItem(@Param('id') id: string) {
    return this.inventoryService.deleteItem(id);
  }

  @Post('transfer')
  @ApiOperation({ summary: 'Transfer stock between branches' })
  @ApiResponse({ status: 201, description: 'Stock transferred successfully' })
  transferStock(@Body() body: any, @CurrentUser('userName') userName: string) {
    return this.inventoryService.transferStock(body, userName);
  }

  @Get('stock/:itemCode')
  @ApiOperation({ summary: 'Get stock balance for an item' })
  @ApiParam({ name: 'itemCode', description: 'Item code' })
  @ApiResponse({ status: 200, description: 'Stock balance' })
  findOne(@Param('itemCode') itemCode: string) {
    return this.inventoryService.findOne(itemCode);
  }

  @Post('receive')
  @ApiOperation({ summary: 'Receive stock (goods inward)' })
  @ApiResponse({ status: 201, description: 'Stock received successfully' })
  receiveStock(@Body() dto: ReceiveStockDto, @CurrentUser('userName') userName: string) {
    return this.inventoryService.receiveStock(dto, userName);
  }

  @Post('issue')
  @ApiOperation({ summary: 'Issue stock (transfer out)' })
  @ApiResponse({ status: 201, description: 'Stock issued successfully' })
  issueStock(@Body() dto: IssueStockDto, @CurrentUser('userName') userName: string) {
    return this.inventoryService.issueStock(dto, userName);
  }

  @Post('adjust')
  @ApiOperation({ summary: 'Adjust stock (reject / excess / short / assort)' })
  @ApiResponse({ status: 201, description: 'Stock adjusted successfully' })
  adjustStock(@Body() body: any) {
    return this.inventoryService.adjustStock(body);
  }

  @Get('receive/history')
  @ApiOperation({ summary: 'Get stock receive history' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'Receive history' })
  receiveHistory(@Query('branchId') branchId?: string) {
    return this.inventoryService.findReceiveHistory(branchId ? +branchId : undefined);
  }

  @Get('issue/history')
  @ApiOperation({ summary: 'Get stock issue history' })
  @ApiQuery({ name: 'branchId', required: false, description: 'Filter by branch ID' })
  @ApiResponse({ status: 200, description: 'Issue history' })
  issueHistory(@Query('branchId') branchId?: string) {
    return this.inventoryService.findIssueHistory(branchId ? +branchId : undefined);
  }
}
