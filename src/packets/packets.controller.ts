import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { PacketsService, CreatePacketDto, UpdatePacketDto } from './packets.service';
import {
  CreatePacketReceiveDto, UpdatePacketReceiveDto,
  CreatePacketIssueDto, UpdatePacketIssueDto,
  PacketStockQueryDto,
} from './dto/packet-document.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';
import { PaginationQueryDto, DateRangeQueryDto } from '../common/dto';
import { paginatedResponse } from '../common/helpers';

/**
 * ROUTE ORDER MATTERS HERE. Nest matches in declaration order, and `:code` is a
 * single-segment wildcard — so `GET /packets/stock` would be answered by
 * `findOne('stock')` if the literal route came second. Every literal path
 * (`stock`, `next-code`, `receive`, `issue`) is therefore declared BEFORE the
 * `:code` routes for its verb. The two-segment document routes
 * (`receive/:serialNo`) can't collide with `:code`, but are kept together with
 * their siblings so the grouping stays obvious.
 */
@ApiTags('Packets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('packets')
export class PacketsController {
  constructor(private packetsService: PacketsService) {}

  // ── Packet Receive ────────────────────────────────────────────

  @Get('receive')
  @ApiOperation({ summary: 'Get paginated packet receive entries (one row per serial number)' })
  @ApiResponse({ status: 200, description: 'Paginated list of packet receive entries' })
  async findAllReceives(@Query() query: DateRangeQueryDto, @CurrentUser('branchIds') branchIds: string[]) {
    const { items, meta } = await this.packetsService.findAllReceives(query, branchIds);
    return paginatedResponse(items, meta, 'Packet receive');
  }

  @Get('receive/:serialNo')
  @ApiOperation({ summary: 'Get one packet receive entry (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Packet receive serial number' })
  @ApiResponse({ status: 200, description: 'Packet receive entry found' })
  @ApiResponse({ status: 404, description: 'Packet receive entry not found' })
  findOneReceive(@Param('serialNo') serialNo: string, @CurrentUser('branchIds') branchIds: string[]) {
    return this.packetsService.findOneReceive(serialNo, branchIds);
  }

  @Post('receive')
  @RequiredPermission({ control: 'Packets', action: 'addAccess' })
  @ApiOperation({ summary: 'Receive packets into the session branch' })
  @ApiResponse({ status: 201, description: 'Packets received successfully' })
  @ApiResponse({ status: 400, description: 'No lines, or an unknown packet code' })
  createReceive(
    @Body() dto: CreatePacketReceiveDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.packetsService.createReceive(dto, userName, branchId);
  }

  @Patch('receive/:serialNo')
  @RequiredPermission({ control: 'Packets', action: 'editAccess' })
  @ApiOperation({ summary: 'Replace all lines of a packet receive entry' })
  @ApiParam({ name: 'serialNo', description: 'Packet receive serial number' })
  @ApiResponse({ status: 200, description: 'Packet receive entry updated successfully' })
  @ApiResponse({ status: 400, description: 'Reducing the receipt would drive the packet balance negative' })
  updateReceive(
    @Param('serialNo') serialNo: string,
    @Body() dto: UpdatePacketReceiveDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
    @CurrentUser('branchIds') branchIds: string[],
  ) {
    return this.packetsService.updateReceive(serialNo, dto, userName, branchId, branchIds);
  }

  @Delete('receive/:serialNo')
  @RequiredPermission({ control: 'Packets', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a packet receive entry (all lines)' })
  @ApiParam({ name: 'serialNo', description: 'Packet receive serial number' })
  @ApiResponse({ status: 200, description: 'Packet receive entry deleted successfully' })
  @ApiResponse({ status: 400, description: 'The received packets have already been issued' })
  removeReceive(@Param('serialNo') serialNo: string, @CurrentUser('branchIds') branchIds: string[]) {
    return this.packetsService.removeReceive(serialNo, branchIds);
  }

  // ── Packet Issue ──────────────────────────────────────────────

  @Get('issue')
  @ApiOperation({ summary: 'Get paginated packet issue entries (one row per serial number)' })
  @ApiResponse({ status: 200, description: 'Paginated list of packet issue entries' })
  async findAllIssues(@Query() query: DateRangeQueryDto, @CurrentUser('branchIds') branchIds: string[]) {
    const { items, meta } = await this.packetsService.findAllIssues(query, branchIds);
    return paginatedResponse(items, meta, 'Packet issue');
  }

  @Get('issue/:serialNo')
  @ApiOperation({ summary: 'Get one packet issue entry (all lines) by serial number' })
  @ApiParam({ name: 'serialNo', description: 'Packet issue serial number' })
  @ApiResponse({ status: 200, description: 'Packet issue entry found' })
  @ApiResponse({ status: 404, description: 'Packet issue entry not found' })
  findOneIssue(@Param('serialNo') serialNo: string, @CurrentUser('branchIds') branchIds: string[]) {
    return this.packetsService.findOneIssue(serialNo, branchIds);
  }

  @Post('issue')
  @RequiredPermission({ control: 'Packets', action: 'addAccess' })
  @ApiOperation({ summary: 'Issue packets out of the session branch' })
  @ApiResponse({ status: 201, description: 'Packets issued successfully' })
  @ApiResponse({ status: 400, description: 'No lines, an unknown packet code, or not enough packet stock' })
  createIssue(
    @Body() dto: CreatePacketIssueDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.packetsService.createIssue(dto, userName, branchId);
  }

  @Patch('issue/:serialNo')
  @RequiredPermission({ control: 'Packets', action: 'editAccess' })
  @ApiOperation({ summary: 'Replace all lines of a packet issue entry' })
  @ApiParam({ name: 'serialNo', description: 'Packet issue serial number' })
  @ApiResponse({ status: 200, description: 'Packet issue entry updated successfully' })
  @ApiResponse({ status: 400, description: 'The new lines would drive the packet balance negative' })
  updateIssue(
    @Param('serialNo') serialNo: string,
    @Body() dto: UpdatePacketIssueDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
    @CurrentUser('branchIds') branchIds: string[],
  ) {
    return this.packetsService.updateIssue(serialNo, dto, userName, branchId, branchIds);
  }

  @Delete('issue/:serialNo')
  @RequiredPermission({ control: 'Packets', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete a packet issue entry (all lines)' })
  @ApiParam({ name: 'serialNo', description: 'Packet issue serial number' })
  @ApiResponse({ status: 200, description: 'Packet issue entry deleted successfully' })
  removeIssue(@Param('serialNo') serialNo: string, @CurrentUser('branchIds') branchIds: string[]) {
    return this.packetsService.removeIssue(serialNo, branchIds);
  }

  // ── Packet Stock ──────────────────────────────────────────────

  @Get('stock')
  @ApiOperation({ summary: 'Packet stock register: opening / received / issued / balance for a branch and date window' })
  @ApiResponse({ status: 200, description: 'Packet stock levels' })
  getStock(@Query() query: PacketStockQueryDto, @CurrentUser('branchIds') branchIds: string[]) {
    return this.packetsService.getPacketStock(query, branchIds);
  }

  // ── PacketInfo catalogue ──────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Get all packets' })
  @ApiResponse({ status: 200, description: 'List of packets' })
  async findAll(@Query() query: PaginationQueryDto) {
    const { items, meta } = await this.packetsService.findAll(query);
    return paginatedResponse(items, meta, 'Packet');
  }

  @Get('next-code')
  @ApiOperation({ summary: 'Suggest the next packet code (P001, P002, ...)' })
  @ApiResponse({ status: 200, description: 'Suggested packet code' })
  getNextCode() { return this.packetsService.getNextCode(); }

  @Get(':code')
  @ApiOperation({ summary: 'Get packet by code' })
  @ApiParam({ name: 'code', description: 'Packet code' })
  @ApiResponse({ status: 200, description: 'Packet found' })
  @ApiResponse({ status: 404, description: 'Packet not found' })
  findOne(@Param('code') code: string) { return this.packetsService.findOne(code); }

  @Post()
  @RequiredPermission({ control: 'Packets', action: 'addAccess' })
  @ApiOperation({ summary: 'Create a new packet' })
  @ApiResponse({ status: 201, description: 'Packet created successfully' })
  create(@Body() dto: CreatePacketDto, @CurrentUser('userName') userName: string) {
    return this.packetsService.create(dto, userName);
  }

  @Patch(':code')
  @RequiredPermission({ control: 'Packets', action: 'editAccess' })
  @ApiOperation({ summary: 'Update packet by code' })
  @ApiParam({ name: 'code', description: 'Packet code' })
  @ApiResponse({ status: 200, description: 'Packet updated successfully' })
  update(@Param('code') code: string, @Body() dto: UpdatePacketDto, @CurrentUser('userName') userName: string) {
    return this.packetsService.update(code, dto, userName);
  }

  @Delete(':code')
  @RequiredPermission({ control: 'Packets', action: 'deleteAccess' })
  @ApiOperation({ summary: 'Delete (deactivate) packet by code' })
  @ApiParam({ name: 'code', description: 'Packet code' })
  @ApiResponse({ status: 200, description: 'Packet deleted successfully' })
  @ApiResponse({ status: 404, description: 'Packet not found' })
  remove(@Param('code') code: string, @CurrentUser('userName') userName: string) {
    return this.packetsService.remove(code, userName);
  }
}
