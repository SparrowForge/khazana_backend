import { IsString, IsOptional, IsObject, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReportShareDto {
  @ApiProperty({ example: 'demand', description: 'Which report to share' })
  @IsString()
  @IsIn(['demand'])
  reportKey: string;

  @ApiPropertyOptional({
    example: { fromDate: '2026-08-01', toDate: '2026-08-31', orderType: 'First' },
    description: "The report's query. Stored as-is and replayed when the link is opened.",
  })
  @IsObject()
  @IsOptional()
  params?: Record<string, unknown>;
}
