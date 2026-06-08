import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { PacketsService, CreatePacketDto } from './packets.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators';

@ApiTags('Packets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('packets')
export class PacketsController {
  constructor(private packetsService: PacketsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all packets' })
  @ApiResponse({ status: 200, description: 'List of packets' })
  findAll() { return this.packetsService.findAll(); }

  @Get('stock')
  @ApiOperation({ summary: 'Get packet stock balance' })
  @ApiQuery({ name: 'code', required: false, description: 'Filter by packet code' })
  @ApiResponse({ status: 200, description: 'Packet stock levels' })
  getStock(@Query('code') code?: string) { return this.packetsService.getPacketStock(code); }

  @Get(':code')
  @ApiOperation({ summary: 'Get packet by code' })
  @ApiParam({ name: 'code', description: 'Packet code' })
  @ApiResponse({ status: 200, description: 'Packet found' })
  @ApiResponse({ status: 404, description: 'Packet not found' })
  findOne(@Param('code') code: string) { return this.packetsService.findOne(code); }

  @Post()
  @ApiOperation({ summary: 'Create a new packet' })
  @ApiResponse({ status: 201, description: 'Packet created successfully' })
  create(@Body() dto: CreatePacketDto, @CurrentUser('userName') userName: string) {
    return this.packetsService.create(dto, userName);
  }

  @Patch(':code')
  @ApiOperation({ summary: 'Update packet by code' })
  @ApiParam({ name: 'code', description: 'Packet code' })
  @ApiResponse({ status: 200, description: 'Packet updated successfully' })
  update(@Param('code') code: string, @Body() dto: Partial<CreatePacketDto>, @CurrentUser('userName') userName: string) {
    return this.packetsService.update(code, dto, userName);
  }

  @Delete(':code')
  @ApiOperation({ summary: 'Delete (deactivate) packet by code' })
  @ApiParam({ name: 'code', description: 'Packet code' })
  @ApiResponse({ status: 200, description: 'Packet deleted successfully' })
  @ApiResponse({ status: 404, description: 'Packet not found' })
  remove(@Param('code') code: string, @CurrentUser('userName') userName: string) {
    return this.packetsService.remove(code, userName);
  }

  @Post('receive')
  @ApiOperation({ summary: 'Receive packets into stock' })
  @ApiResponse({ status: 201, description: 'Packets received successfully' })
  receive(@Body() dto: any, @CurrentUser('userName') userName: string) {
    return this.packetsService.receivePacket({ ...dto, createBy: userName });
  }

  @Post('issue')
  @ApiOperation({ summary: 'Issue packets from stock' })
  @ApiResponse({ status: 201, description: 'Packets issued successfully' })
  issue(@Body() dto: any, @CurrentUser('userName') userName: string) {
    return this.packetsService.issuePacket({ ...dto, createBy: userName });
  }
}
