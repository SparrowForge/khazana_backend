import { IsString, IsNumber, IsPositive, IsOptional, IsDateString, IsUUID, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReceiveStockLineDto {
  @ApiProperty({ format: 'uuid', description: 'Item_Information UUID' })
  @IsUUID()
  itemId: string;

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

  @ApiPropertyOptional({ format: 'uuid', description: 'Receiving branch UUID — defaults to the authenticated user\'s (login) branch' })
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Source branch UUID the stock is received FROM' })
  @IsUUID()
  @IsOptional()
  fromBranchId?: string;

  @ApiProperty({ type: [ReceiveStockLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockLineDto)
  items: ReceiveStockLineDto[];
}

export class UpdateReceiveStockDto {
  @ApiPropertyOptional({ example: 'VCHR-001' })
  @IsString()
  @IsOptional()
  voucherNo?: string;

  @ApiProperty({ example: '2024-01-15' })
  @IsDateString()
  purDate: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Receiving branch UUID' })
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Source branch UUID the stock is received FROM' })
  @IsUUID()
  @IsOptional()
  fromBranchId?: string;

  @ApiProperty({ type: [ReceiveStockLineDto], description: 'Full replacement set of lines for this serial number' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockLineDto)
  items: ReceiveStockLineDto[];
}
