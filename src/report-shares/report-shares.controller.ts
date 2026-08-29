import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ReportSharesService } from './report-shares.service';
import { CreateReportShareDto } from './dto/report-share.dto';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CurrentUser, Public } from '../common/decorators';

@ApiTags('Report Shares')
@Controller('report-shares')
export class ReportSharesController {
  constructor(private shares: ReportSharesService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @Post()
  @ApiOperation({ summary: 'Create a public share link for a generated report' })
  @ApiResponse({ status: 201, description: 'Share token created' })
  @ApiResponse({ status: 400, description: 'Report is not shareable, or its query is invalid' })
  @ApiResponse({ status: 403, description: 'The report itself refused this session (e.g. not the Factory)' })
  create(
    @Body() dto: CreateReportShareDto,
    @CurrentUser('userName') userName: string,
    @CurrentUser('branchId') branchId: string,
  ) {
    return this.shares.create(dto.reportKey, dto.params ?? {}, userName, branchId);
  }

  // UNAUTHENTICATED — this is the link that gets sent out, so it answers anyone
  // on the internet holding the token. The token IS the access control; see the
  // note on Report_Share in schema.prisma.
  @Public()
  @Get('public/:token')
  @ApiOperation({ summary: 'PUBLIC: the report behind a share link' })
  @ApiParam({ name: 'token', description: 'Share token (the Report_Share UUID)' })
  @ApiResponse({ status: 404, description: 'Link is not valid' })
  resolve(@Param('token') token: string) {
    return this.shares.resolve(token);
  }
}
