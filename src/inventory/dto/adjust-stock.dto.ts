import { IsString, IsNumber, IsOptional, IsDateString, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdjustStockDto {
  @ApiPropertyOptional({ example: 'ADJ-001', description: 'Adjustment invoice number' })
  @IsString()
  @IsOptional()
  invNo?: string;

  @ApiProperty({ example: 'uuid-item-id', description: 'Item UUID' })
  @IsString()
  itmOId: string;

  @ApiPropertyOptional({ example: 2, description: 'Rejected quantity' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  reject?: number;

  @ApiPropertyOptional({ example: 1, description: 'Excess quantity found' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  excess?: number;

  @ApiPropertyOptional({ example: 0, description: 'Short quantity found' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  short?: number;

  @ApiPropertyOptional({ example: 5, description: 'Assorted quantity' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  assort?: number;

  @ApiProperty({ example: '2024-01-15', description: 'Adjustment date (ISO 8601)' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ example: 1, description: 'Branch ID' })
  @IsInt()
  @IsOptional()
  branchId?: number;
}
