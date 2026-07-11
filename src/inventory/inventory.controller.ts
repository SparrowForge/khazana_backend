import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { ReceiveStockDto, UpdateReceiveStockDto } from './dto/receive-stock.dto';
import { IssueStockDto, UpdateIssueStockDto } from './dto/issue-stock.dto';
import { CreateItemDto, UpdateItemDto } from './dto/create-item.dto';
import { ItemQueryDto } from './dto/item-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';
import { PaginationQueryDto, BranchPaginationQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

@ApiTags('Inventory')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
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
  async findAllItems(@Query() query: ItemQueryDto) {
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
  @RequiredPermission({ control: 'Items', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a new item' })
  @ApiResponse({ status: 201, description: 'Item created successfully' })
  @ApiResponse({ status: 403, description: 'No create permission for Items' })
  @ApiResponse({ status: 409, description: 'Item code already exists' })
  createItem(@Body() dto: CreateItemDto) {
    return this.inventoryService.createItem(dto);
  }

  @Patch('items/:id')
  @RequiredPermission({ control: 'Items', action: 'editAccess' })
  @ApiOperation({ summary: 'Update item by ID' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  @ApiResponse({ status: 200, description: 'Item updated successfully' })
  @ApiResponse({ status: 403, description: 'No edit permission for Items' })
  updateItem(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.inventoryService.updateItem(id, dto);
  }

  @Delete('items/:id')
  @RequiredPermission({ control: 'Items', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete (deactivate) item by ID' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  @ApiResponse({ status: 200, description: 'Item deleted successfully' })
  @ApiResponse({ status: 403, description: 'No delete permission for Items' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  deleteItem(@Param('id') id: string) {
    return this.inventoryService.deleteItem(id);
  }

  @Post('transfer')
  @RequiredPermission({ control: 'StockTransfer', action: 'addAccess' })
  @ApiOperation({ summary: 'Transfer stock between branches' })
  @ApiResponse({ status: 201, description: 'Stock transferred successfully' })
  transferStock(@Body() body: any, @CurrentUser('userName') userName: string) {
    return this.inventoryService.transferStock(body, userName);
  }

  @Get('transfer')
  @ApiOperation({ summary: 'Get paginated stock transfer history' })
  @ApiResponse({ status: 200, description: 'Paginated list of stock transfers' })
  async findAllTransfers(@Query() query: BranchPaginationQueryDto) {
    const { items, meta } = await this.inventoryService.findTransferHistory(query);
    return paginatedResponse(items, meta, 'Transfer');
  }

  @Get('transfer/:id')
  @ApiOperation({ summary: 'Get a single stock transfer by ID' })
  @ApiParam({ name: 'id', description: 'Transfer (Item_Issue) UUID' })
  @ApiResponse({ status: 200, description: 'Transfer found' })
  @ApiResponse({ status: 404, description: 'Transfer not found' })
  findOneTransfer(@Param('id') id: string) {
    return this.inventoryService.findOneTransfer(id);
  }

  @Patch('transfer/:id')
  @RequiredPermission({ control: 'StockTransfer', action: 'editAccess' })
  @ApiOperation({ summary: 'Update a stock transfer by ID' })
  @ApiParam({ name: 'id', description: 'Transfer (Item_Issue) UUID' })
  @ApiResponse({ status: 200, description: 'Transfer updated successfully' })
  updateTransfer(@Param('id') id: string, @Body() body: any, @CurrentUser('userName') userName: string) {
    return this.inventoryService.updateTransfer(id, body, userName);
  }

  @Delete('transfer/:id')
  @RequiredPermission({ control: 'StockTransfer', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a stock transfer by ID' })
  @ApiParam({ name: 'id', description: 'Transfer (Item_Issue) UUID' })
  @ApiResponse({ status: 200, description: 'Transfer deleted successfully' })
  @ApiResponse({ status: 404, description: 'Transfer not found' })
  removeTransfer(@Param('id') id: string) {
    return this.inventoryService.removeTransfer(id);
  }

  @Get('stock/:itemCode')
  @ApiOperation({ summary: 'Get stock balance for an item' })
  @ApiParam({ name: 'itemCode', description: 'Item code' })
  @ApiResponse({ status: 200, description: 'Stock balance' })
  findOne(@Param('itemCode') itemCode: string) {
    return this.inventoryService.findOne(itemCode);
  }

  @Post('receive')
  @RequiredPermission({ control: 'StockReceive', action: 'addAccess' })
  @ApiOperation({ summary: 'Receive stock (goods inward)' })
  @ApiResponse({ status: 201, description: 'Stock received successfully' })
  receiveStock(
    @Body() dto: ReceiveStockDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.inventoryService.receiveStock(dto, userName, branchId);
  }

  @Post('issue')
  @RequiredPermission({ control: 'StockIssue', action: 'addAccess' })
  @ApiOperation({ summary: 'Issue stock (transfer out)' })
  @ApiResponse({ status: 201, description: 'Stock issued successfully' })
  issueStock(@Body() dto: IssueStockDto, @CurrentUser('userName') userName: string) {
    return this.inventoryService.issueStock(dto, userName);
  }

  @Post('adjust')
  @RequiredPermission({ control: 'StockAdjustment', action: 'addAccess' })
  @ApiOperation({ summary: 'Adjust stock (reject / excess / short / assort)' })
  @ApiResponse({ status: 201, description: 'Stock adjusted successfully' })
  adjustStock(@Body() body: any) {
    return this.inventoryService.adjustStock(body);
  }

  @Get('adjust/history')
  @ApiOperation({ summary: 'Get paginated stock adjustment history' })
  @ApiResponse({ status: 200, description: 'Paginated list of stock adjustments' })
  async adjustmentHistory(@Query() query: BranchPaginationQueryDto) {
    const { items, meta } = await this.inventoryService.findAllAdjustments(query);
    return paginatedResponse(items, meta, 'Adjustment');
  }

  @Get('adjust/:id')
  @ApiOperation({ summary: 'Get a single stock adjustment by ID' })
  @ApiParam({ name: 'id', description: 'ItemReject UUID' })
  @ApiResponse({ status: 200, description: 'Adjustment record found' })
  @ApiResponse({ status: 404, description: 'Adjustment record not found' })
  findOneAdjustment(@Param('id') id: string) {
    return this.inventoryService.findOneAdjustment(id);
  }

  @Patch('adjust/:id')
  @RequiredPermission({ control: 'StockAdjustment', action: 'editAccess' })
  @ApiOperation({ summary: 'Update a stock adjustment by ID' })
  @ApiParam({ name: 'id', description: 'ItemReject UUID' })
  @ApiResponse({ status: 200, description: 'Adjustment record updated successfully' })
  updateAdjustment(@Param('id') id: string, @Body() body: any) {
    return this.inventoryService.updateAdjustment(id, body);
  }

  @Delete('adjust/:id')
  @RequiredPermission({ control: 'StockAdjustment', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a stock adjustment by ID' })
  @ApiParam({ name: 'id', description: 'ItemReject UUID' })
  @ApiResponse({ status: 200, description: 'Adjustment record deleted successfully' })
  @ApiResponse({ status: 404, description: 'Adjustment record not found' })
  removeAdjustment(@Param('id') id: string) {
    return this.inventoryService.removeAdjustment(id);
  }

  @Get('receive/history')
  @ApiOperation({ summary: 'Get paginated stock receive history' })
  @ApiResponse({ status: 200, description: 'Paginated list of stock receives' })
  async receiveHistory(@Query() query: BranchPaginationQueryDto) {
    const { items, meta } = await this.inventoryService.findReceiveHistory(query);
    return paginatedResponse(items, meta, 'Receive');
  }

  @Get('receive/:id')
  @ApiOperation({ summary: 'Get a single stock receive by ID' })
  @ApiParam({ name: 'id', description: 'Item_Receive UUID' })
  @ApiResponse({ status: 200, description: 'Receive record found' })
  @ApiResponse({ status: 404, description: 'Receive record not found' })
  findOneReceive(@Param('id') id: string) {
    return this.inventoryService.findOneReceive(id);
  }

  @Patch('receive/:id')
  @RequiredPermission({ control: 'StockReceive', action: 'editAccess' })
  @ApiOperation({ summary: 'Update a stock receive by ID' })
  @ApiParam({ name: 'id', description: 'Item_Receive UUID' })
  @ApiResponse({ status: 200, description: 'Receive record updated successfully' })
  updateReceive(@Param('id') id: string, @Body() dto: UpdateReceiveStockDto, @CurrentUser('userName') userName: string) {
    return this.inventoryService.updateReceive(id, dto, userName);
  }

  @Delete('receive/:id')
  @RequiredPermission({ control: 'StockReceive', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a stock receive by ID' })
  @ApiParam({ name: 'id', description: 'Item_Receive UUID' })
  @ApiResponse({ status: 200, description: 'Receive record deleted successfully' })
  @ApiResponse({ status: 404, description: 'Receive record not found' })
  removeReceive(@Param('id') id: string) {
    return this.inventoryService.removeReceive(id);
  }

  @Get('issue/history')
  @ApiOperation({ summary: 'Get paginated stock issue history' })
  @ApiResponse({ status: 200, description: 'Paginated list of stock issues' })
  async issueHistory(@Query() query: BranchPaginationQueryDto) {
    const { items, meta } = await this.inventoryService.findAllIssues(query);
    return paginatedResponse(items, meta, 'Issue');
  }

  @Get('issue/:id')
  @ApiOperation({ summary: 'Get a single stock issue by ID' })
  @ApiParam({ name: 'id', description: 'Item_Issue UUID' })
  @ApiResponse({ status: 200, description: 'Issue record found' })
  @ApiResponse({ status: 404, description: 'Issue record not found' })
  findOneIssue(@Param('id') id: string) {
    return this.inventoryService.findOneIssue(id);
  }

  @Patch('issue/:id')
  @RequiredPermission({ control: 'StockIssue', action: 'editAccess' })
  @ApiOperation({ summary: 'Update a stock issue by ID' })
  @ApiParam({ name: 'id', description: 'Item_Issue UUID' })
  @ApiResponse({ status: 200, description: 'Issue record updated successfully' })
  updateIssue(@Param('id') id: string, @Body() dto: UpdateIssueStockDto, @CurrentUser('userName') userName: string) {
    return this.inventoryService.updateIssue(id, dto, userName);
  }

  @Delete('issue/:id')
  @RequiredPermission({ control: 'StockIssue', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a stock issue by ID' })
  @ApiParam({ name: 'id', description: 'Item_Issue UUID' })
  @ApiResponse({ status: 200, description: 'Issue record deleted successfully' })
  @ApiResponse({ status: 404, description: 'Issue record not found' })
  removeIssue(@Param('id') id: string) {
    return this.inventoryService.removeIssue(id);
  }
}
