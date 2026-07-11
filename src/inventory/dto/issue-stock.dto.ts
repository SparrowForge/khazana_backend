import { IsString, IsNumber, IsPositive, IsOptional, IsDateString, IsUUID, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IssueStockLineDto {
  @ApiProperty({ example: 'ITM-001', description: 'Item code' })
  @IsString()
  itemCode: string;

  @ApiProperty({ example: 10, description: 'Quantity to issue (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;

  @ApiPropertyOptional({ example: 120.0, description: 'Unit cost price' })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;
}

export class IssueStockDto {
  @ApiPropertyOptional({ example: 'ISS-001', description: 'Serial number' })
  @IsString()
  @IsOptional()
  serialNo?: string;

  @ApiPropertyOptional({ example: 'VCHR-001', description: 'Voucher number' })
  @IsString()
  @IsOptional()
  voucharNo?: string;

  @ApiProperty({ example: '2024-01-15', description: 'Issue date (ISO 8601)' })
  @IsDateString()
  issueDate: string;

  @ApiProperty({ format: 'uuid', description: 'Branch UUID issuing the stock' })
  @IsUUID()
  issueBranchId: string;

  @ApiProperty({ format: 'uuid', description: 'Branch UUID receiving the issued stock' })
  @IsUUID()
  receiveBranchId: string;

  @ApiProperty({ type: [IssueStockLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IssueStockLineDto)
  items: IssueStockLineDto[];
}

export class UpdateIssueStockDto {
  @ApiPropertyOptional({ example: 'ISS-001' })
  @IsString()
  @IsOptional()
  serialNo?: string;

  @ApiPropertyOptional({ example: 'VCHR-001' })
  @IsString()
  @IsOptional()
  voucherNo?: string;

  @ApiPropertyOptional({ example: 'ITM-001' })
  @IsString()
  @IsOptional()
  itemCode?: string;

  @ApiPropertyOptional({ example: 10 })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  qty?: number;

  @ApiPropertyOptional({ example: 120.0 })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @ApiPropertyOptional({ example: '2024-01-15' })
  @IsDateString()
  @IsOptional()
  issueDate?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  issueBranchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  receiveBranchId?: string;
}
