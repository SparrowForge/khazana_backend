import { IsString, IsNumber, IsPositive, IsOptional, IsDateString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class IssueStockDto {
  @ApiPropertyOptional({ example: 'ISS-001', description: 'Serial number' })
  @IsString()
  @IsOptional()
  serialNo?: string;

  @ApiPropertyOptional({ example: 'VCHR-001', description: 'Voucher number' })
  @IsString()
  @IsOptional()
  voucharNo?: string;

  @ApiProperty({ example: 'ITM-001', description: 'Item code' })
  @IsString()
  itemCode: string;

  @ApiProperty({ example: 10, description: 'Quantity to issue (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;

  @ApiPropertyOptional({ example: 120.00, description: 'Unit cost price' })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;

  @ApiProperty({ example: '2024-01-15', description: 'Issue date (ISO 8601)' })
  @IsDateString()
  issueDate: string;

  @ApiProperty({ format: 'uuid', description: 'Branch UUID issuing the stock' })
  @IsUUID()
  issueBranchId: string;

  @ApiProperty({ format: 'uuid', description: 'Branch UUID receiving the issued stock' })
  @IsUUID()
  receiveBranchId: string;
}
