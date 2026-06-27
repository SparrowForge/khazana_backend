import { IsString, IsNumber, IsPositive, IsOptional, IsDateString, IsInt, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReceiveStockLineDto {
  @ApiProperty({ example: 'ITM-001' })
  @IsString()
  itemCode: string;

  @ApiPropertyOptional({ example: 'Widget A' })
  @IsString()
  @IsOptional()
  itemName?: string;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @IsPositive()
  qty: number;
}

export class ReceiveStockDto {
  @ApiPropertyOptional({ example: 'GRN-001' })
  @IsString()
  @IsOptional()
  serialNo?: string;

  @ApiPropertyOptional({ example: 'VCHR-001' })
  @IsString()
  @IsOptional()
  voucherNo?: string;

  @ApiProperty({ example: '2024-01-15' })
  @IsDateString()
  purDate: string;

  @ApiPropertyOptional({ example: 1, description: 'Receiving branch — defaults to the authenticated user\'s (login) branch' })
  @IsInt()
  @IsOptional()
  branchId?: number;

  @ApiPropertyOptional({ description: 'Source branch the stock is received FROM (branch id/code)' })
  @IsString()
  @IsOptional()
  fromBranchId?: string;

  @ApiProperty({ type: [ReceiveStockLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockLineDto)
  items: ReceiveStockLineDto[];
}
