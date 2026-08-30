import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PosSyncService } from './pos-sync.service';
import { SyncOfflineDto } from './dto/sync-offline.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser, RequiredPermission } from '../common/decorators';

@ApiTags('POS Sales')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pos')
export class PosSyncController {
  constructor(private service: PosSyncService) {}

  @Post('sync-offline')
  @RequiredPermission({ control: 'POSTerminal', action: 'addAccess' })
  @ApiOperation({
    summary: 'Batch-replay offline POS sales onto the central DB',
    description:
      'Uploaded by a cashier session on reconnect. Idempotent (skips invoice numbers that already exist), per-order isolated, and preserves each sale’s original offline timestamp. The payload userId/userName must match the authenticated user.',
  })
  @ApiResponse({ status: 201, description: 'Per-order sync results (synced / skipped / failed)' })
  @ApiResponse({ status: 403, description: 'Batch owner does not match the authenticated user' })
  syncOffline(
    @Body() dto: SyncOfflineDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('userName') userName: string,
    @CurrentUser('name') name: string,
  ) {
    return this.service.syncOffline(dto, userId, userName, name);
  }
}
