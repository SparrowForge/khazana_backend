import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One replacement line. Cash sales key by `itemId` (t_SODet), credit sales by
 *  `itemCode` (cSDetail) — supply whichever the target module uses. */
export class UpdateSalesItemDto {
  @ApiPropertyOptional({ description: 'Item UUID (cash/POS sales)' })
  @IsString()
  @IsOptional()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Item code (credit sales)' })
  @IsString()
  @IsOptional()
  itemCode?: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0)
  qty: number;

  @ApiPropertyOptional({ example: 150 })
  @IsNumber()
  @IsOptional()
  rate?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber()
  @IsOptional()
  discount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber()
  @IsOptional()
  vat?: number;

  @ApiPropertyOptional({ example: 300 })
  @IsNumber()
  @IsOptional()
  total?: number;
}

/** Unified edit payload for cash & credit sales (purge-and-replace). */
export class UpdateSalesDto {
  @ApiPropertyOptional({ example: '2026-06-29' })
  @IsDateString()
  @IsOptional()
  invoiceDate?: string;

  @ApiPropertyOptional({ description: 'Customer UUID (credit sales)' })
  @IsString()
  @IsOptional()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Purchase order number (credit sales)' })
  @IsString()
  @IsOptional()
  poNo?: string;

  @ApiPropertyOptional({ example: 'Cash' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsNumber()
  @IsOptional()
  totalAmount?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsNumber()
  @IsOptional()
  totalDiscount?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsNumber()
  @IsOptional()
  totalVat?: number;

  @ApiPropertyOptional({ example: 980 })
  @IsNumber()
  @IsOptional()
  netAmount?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsNumber()
  @IsOptional()
  paidAmount?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsNumber()
  @IsOptional()
  changeAmount?: number;

  @ApiProperty({ type: [UpdateSalesItemDto], description: 'Replacement line items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSalesItemDto)
  items: UpdateSalesItemDto[];
}
