import { IsString, IsNumber, IsPositive, IsOptional, IsDateString, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReceiveStockDto {
  @ApiPropertyOptional({ example: 'GRN-001', description: 'Serial / GRN number' })
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

  @ApiPropertyOptional({ example: 'Widget A', description: 'Item name (for reference)' })
  @IsString()
  @IsOptional()
  itemName?: string;

  @ApiProperty({ example: 50, description: 'Quantity received (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;

  @ApiProperty({ example: '2024-01-15', description: 'Purchase / receive date (ISO 8601)' })
  @IsDateString()
  purDate: string;

  @ApiProperty({ example: 1, description: 'Branch receiving the stock' })
  @IsInt()
  branchId: number;

  @ApiPropertyOptional({ example: 2, description: 'Receiving sub-branch ID (if different)' })
  @IsInt()
  @IsOptional()
  receiveBranchID?: number;
}
