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
import { PaginationQueryDto, BranchPaginationQueryDto, DateRangeQueryDto } from '../common/dto';
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

  @Get('items/next-code')
  @ApiOperation({ summary: 'Suggest the next Item Code for a category' })
  @ApiResponse({ status: 200, description: 'Suggested item code' })
  getNextItemCode(@Query('category') category: string) {
    return this.inventoryService.getNextItemCode(category);
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
  @ApiResponse({ status: 400, description: 'No items, or more requested than exists on hand' })
  transferStock(@Body() body: any, @CurrentUser('userName') userName: string) {
    return this.inventoryService.transferStock(body, userName);
  }

  @Get('transfer')
  @ApiOperation({ summary: 'Get paginated stock transfer history' })
  @ApiResponse({ status: 200, description: 'Paginated list of stock transfers' })
  async findAllTransfers(@Query() query: DateRangeQueryDto) {
    const { items, meta } = await this.inventoryService.findTransferHistory(query);
    return paginatedResponse(items, meta, 'Transfer');
  }

  @Get('transfer/:serialNo')
  @ApiOperation({ summary: 'Get a single stock transfer (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Transfer serial number' })
  @ApiResponse({ status: 200, description: 'Transfer found' })
  @ApiResponse({ status: 404, description: 'Transfer not found' })
  findOneTransfer(@Param('serialNo') serialNo: string) {
    return this.inventoryService.findOneTransferBySerial(serialNo);
  }

  @Patch('transfer/:serialNo')
  @RequiredPermission({ control: 'StockTransfer', action: 'editAccess' })
  @ApiOperation({ summary: 'Replace all lines of a stock transfer by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Transfer serial number' })
  @ApiResponse({ status: 200, description: 'Transfer updated successfully' })
  @ApiResponse({ status: 400, description: 'More requested than exists on hand' })
  updateTransfer(@Param('serialNo') serialNo: string, @Body() body: any, @CurrentUser('userName') userName: string) {
    return this.inventoryService.updateTransferBySerial(serialNo, body, userName);
  }

  @Delete('transfer/:serialNo')
  @RequiredPermission({ control: 'StockTransfer', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a stock transfer (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Transfer serial number' })
  @ApiResponse({ status: 200, description: 'Transfer deleted successfully' })
  @ApiResponse({ status: 404, description: 'Transfer not found' })
  removeTransfer(@Param('serialNo') serialNo: string) {
    return this.inventoryService.removeTransferBySerial(serialNo);
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
  @ApiResponse({ status: 400, description: 'No items, or insufficient stock' })
  issueStock(@Body() dto: IssueStockDto, @CurrentUser('userName') userName: string) {
    return this.inventoryService.issueStock(dto, userName);
  }

  @Post('adjust')
  @RequiredPermission({ control: 'StockAdjustment', action: 'addAccess' })
  @ApiOperation({ summary: 'Adjust stock (reject / excess / short / assort)' })
  @ApiResponse({ status: 201, description: 'Stock adjusted successfully' })
  adjustStock(@Body() body: any, @CurrentUser('branchId') branchId: string) {
    return this.inventoryService.adjustStock(body, branchId);
  }

  @Get('adjust/history')
  @ApiOperation({ summary: 'Get paginated stock adjustment history' })
  @ApiResponse({ status: 200, description: 'Paginated list of stock adjustments' })
  async adjustmentHistory(@Query() query: DateRangeQueryDto) {
    const { items, meta } = await this.inventoryService.findAllAdjustments(query);
    return paginatedResponse(items, meta, 'Adjustment');
  }

  @Get('adjust/:invNo')
  @ApiOperation({ summary: 'Get a single stock adjustment (all lines) by reference number' })
  @ApiParam({ name: 'invNo', description: 'Adjustment reference number' })
  @ApiResponse({ status: 200, description: 'Adjustment record found' })
  @ApiResponse({ status: 404, description: 'Adjustment record not found' })
  findOneAdjustment(@Param('invNo') invNo: string) {
    return this.inventoryService.findOneAdjustment(invNo);
  }

  @Patch('adjust/:invNo')
  @RequiredPermission({ control: 'StockAdjustment', action: 'editAccess' })
  @ApiOperation({ summary: 'Replace all lines of a stock adjustment by reference number' })
  @ApiParam({ name: 'invNo', description: 'Adjustment reference number' })
  @ApiResponse({ status: 200, description: 'Adjustment record updated successfully' })
  updateAdjustment(@Param('invNo') invNo: string, @Body() body: any) {
    return this.inventoryService.updateAdjustment(invNo, body);
  }

  @Delete('adjust/:invNo')
  @RequiredPermission({ control: 'StockAdjustment', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a stock adjustment (all lines) by reference number' })
  @ApiParam({ name: 'invNo', description: 'Adjustment reference number' })
  @ApiResponse({ status: 200, description: 'Adjustment record deleted successfully' })
  @ApiResponse({ status: 404, description: 'Adjustment record not found' })
  removeAdjustment(@Param('invNo') invNo: string) {
    return this.inventoryService.removeAdjustment(invNo);
  }

  @Get('receive/history')
  @ApiOperation({ summary: 'Get paginated stock receive history' })
  @ApiResponse({ status: 200, description: 'Paginated list of stock receives' })
  async receiveHistory(@Query() query: DateRangeQueryDto) {
    const { items, meta } = await this.inventoryService.findReceiveHistory(query);
    return paginatedResponse(items, meta, 'Receive');
  }

  // NOTE: these must stay ABOVE `receive/:serialNo`, or 'pending' is captured
  // as a serial number by that route.

  @Get('receive/pending')
  @ApiOperation({ summary: 'Stock issues addressed to the session branch that have not been received yet' })
  @ApiResponse({ status: 200, description: 'Paginated list of pending issues, one row per issue document' })
  async pendingReceives(@Query() query: DateRangeQueryDto, @CurrentUser('branchId') branchId: string) {
    const { items, meta } = await this.inventoryService.findPendingReceives(branchId, query);
    return paginatedResponse(items, meta, 'PendingReceive');
  }

  @Get('receive/pending/:serialNo')
  @ApiOperation({ summary: 'Read-only detail of one pending issue, for the receive confirmation screen' })
  @ApiParam({ name: 'serialNo', description: 'Issue serial number' })
  @ApiResponse({ status: 200, description: 'Issue header plus its read-only item lines' })
  @ApiResponse({ status: 403, description: 'The issue was not sent to the session branch' })
  @ApiResponse({ status: 404, description: 'Issue not found' })
  findPendingReceive(@Param('serialNo') serialNo: string, @CurrentUser('branchId') branchId: string) {
    return this.inventoryService.findPendingReceive(serialNo, branchId);
  }

  @Post('receive/confirm/:serialNo')
  @RequiredPermission({ control: 'StockReceive', action: 'addAccess' })
  @ApiOperation({
    summary: 'Confirm receipt of an issued document',
    description:
      'Writes the Item_Receive leg from the quantities recorded on the issue and marks it received. '
      + 'There is no request body: quantities are read off the issue, so the receiver cannot alter them.',
  })
  @ApiParam({ name: 'serialNo', description: 'Issue serial number to confirm' })
  @ApiResponse({ status: 201, description: 'Receive document created and the issue marked received' })
  @ApiResponse({ status: 403, description: 'The issue was not sent to the session branch' })
  @ApiResponse({ status: 409, description: 'Already received' })
  confirmReceive(
    @Param('serialNo') serialNo: string,
    @CurrentUser('branchId') branchId: string,
    @CurrentUser('userName') userName: string,
  ) {
    return this.inventoryService.confirmReceive(serialNo, branchId, userName);
  }

  @Get('receive/:serialNo')
  @ApiOperation({ summary: 'Get a single stock receive (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Receive serial number' })
  @ApiResponse({ status: 200, description: 'Receive record found' })
  @ApiResponse({ status: 404, description: 'Receive record not found' })
  findOneReceive(@Param('serialNo') serialNo: string) {
    return this.inventoryService.findOneReceive(serialNo);
  }

  @Patch('receive/:serialNo')
  @RequiredPermission({ control: 'StockReceive', action: 'editAccess' })
  @ApiOperation({ summary: 'Replace all lines of a stock receive by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Receive serial number' })
  @ApiResponse({ status: 200, description: 'Receive record updated successfully' })
  updateReceive(
    @Param('serialNo') serialNo: string,
    @Body() dto: UpdateReceiveStockDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.inventoryService.updateReceive(serialNo, dto, userName, branchId);
  }

  @Delete('receive/:serialNo')
  @RequiredPermission({ control: 'StockReceive', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a stock receive (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Receive serial number' })
  @ApiResponse({ status: 200, description: 'Receive record deleted successfully' })
  @ApiResponse({ status: 404, description: 'Receive record not found' })
  removeReceive(@Param('serialNo') serialNo: string) {
    return this.inventoryService.removeReceive(serialNo);
  }

  @Get('issue/history')
  @ApiOperation({ summary: 'Get paginated stock issue history' })
  @ApiResponse({ status: 200, description: 'Paginated list of stock issues' })
  async issueHistory(@Query() query: DateRangeQueryDto) {
    const { items, meta } = await this.inventoryService.findAllIssues(query);
    return paginatedResponse(items, meta, 'Issue');
  }

  @Get('issue/:serialNo')
  @ApiOperation({ summary: 'Get a single stock issue (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Issue serial number' })
  @ApiResponse({ status: 200, description: 'Issue record found' })
  @ApiResponse({ status: 404, description: 'Issue record not found' })
  findOneIssue(@Param('serialNo') serialNo: string) {
    return this.inventoryService.findOneIssue(serialNo);
  }

  @Patch('issue/:serialNo')
  @RequiredPermission({ control: 'StockIssue', action: 'editAccess' })
  @ApiOperation({ summary: 'Replace all lines of a stock issue by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Issue serial number' })
  @ApiResponse({ status: 200, description: 'Issue record updated successfully' })
  @ApiResponse({ status: 400, description: 'A branch transfer, or insufficient stock' })
  updateIssue(@Param('serialNo') serialNo: string, @Body() dto: UpdateIssueStockDto, @CurrentUser('userName') userName: string) {
    return this.inventoryService.updateIssue(serialNo, dto, userName);
  }

  @Delete('issue/:serialNo')
  @RequiredPermission({ control: 'StockIssue', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a stock issue (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Issue serial number' })
  @ApiResponse({ status: 200, description: 'Issue record deleted successfully' })
  @ApiResponse({ status: 404, description: 'Issue record not found' })
  removeIssue(@Param('serialNo') serialNo: string) {
    return this.inventoryService.removeIssue(serialNo);
  }
}
