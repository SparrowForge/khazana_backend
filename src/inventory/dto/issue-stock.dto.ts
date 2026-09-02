import { IsString, IsNumber, IsPositive, IsOptional, IsDateString, IsUUID, IsArray, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IssueStockLineDto {
  @ApiProperty({ format: 'uuid', description: 'Item_Information UUID' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ example: 10, description: 'Quantity to issue (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;

  /** Required in practice: a line with no rate (or a zero one) is refused by
   *  InventoryService#assertLinesHaveRate. Left optional on the DTO so the
   *  failure reads as "enter a rate for <item>" rather than a field-level
   *  validation error that does not say which line is at fault. */
  @ApiPropertyOptional({
    example: 120.0,
    description:
      'VAT-EXCLUSIVE unit rate stored on the issue line. Must be > 0 — an item with no active '
      + 'price row is issued at the rate the operator types on the entry screen.',
  })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @ApiPropertyOptional({
    example: true,
    default: false,
    description:
      'Also record this line as Production (same item and qty). Factory branch only — a non-factory session is refused.',
  })
  @IsBoolean()
  @IsOptional()
  isProduction?: boolean;
}

export class IssueStockDto {
  @ApiPropertyOptional({ example: 'ISS-001', description: 'Serial number' })
  @IsString()
  @IsOptional()
  serialNo?: string;

  @ApiPropertyOptional({ example: 'VCHR-001', description: 'Voucher number' })
  @IsString()
  @IsOptional()
  voucherNo?: string;

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
  @ApiPropertyOptional({ example: 'VCHR-001' })
  @IsString()
  @IsOptional()
  voucherNo?: string;

  @ApiProperty({ example: '2024-01-15', description: 'Issue date (ISO 8601)' })
  @IsDateString()
  issueDate: string;

  @ApiProperty({ format: 'uuid', description: 'Branch UUID issuing the stock' })
  @IsUUID()
  issueBranchId: string;

  @ApiProperty({ format: 'uuid', description: 'Branch UUID receiving the issued stock' })
  @IsUUID()
  receiveBranchId: string;

  @ApiProperty({ type: [IssueStockLineDto], description: 'Full replacement set of lines for this serial number' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IssueStockLineDto)
  items: IssueStockLineDto[];
}
