import { Type } from 'class-transformer';
import {
  IsString, IsOptional, IsNumber, IsArray, ValidateNested,
  IsDateString, IsPositive, Min, IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VatCreditItemDto {
  @ApiProperty({ example: 'ITM-001', description: 'Item code' })
  @IsString()
  itemCode: string;

  @ApiProperty({ example: 4, description: 'Quantity (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;

  @ApiProperty({ example: 250.00, description: 'Unit price (excl. VAT)' })
  @IsNumber()
  @Min(0)
  rate: number;

  @ApiPropertyOptional({ example: 0.00, description: 'Discount amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  disc?: number;

  @ApiProperty({ example: 15, description: 'VAT percentage' })
  @IsNumber()
  vatValue: number;

  @ApiProperty({ example: 150.00, description: 'VAT amount (calculated)' })
  @IsNumber()
  vatAmount: number;

  @ApiProperty({ example: 1150.00, description: 'Line total (incl. VAT)' })
  @IsNumber()
  total: number;
}

export class CreateVatCreditSaleDto {
  @ApiProperty({ example: 'CSV-2024-001', description: 'Invoice number' })
  @IsString()
  invNo: string;

  @ApiProperty({ example: '2024-01-15', description: 'Invoice date (ISO 8601)' })
  @IsDateString()
  invDate: string;

  @ApiProperty({ example: 'CUST-001', description: 'Customer code' })
  @IsString()
  clientCode: string;

  @ApiPropertyOptional({ example: 'PO-2024-002', description: 'Purchase order number' })
  @IsString()
  @IsOptional()
  poNo?: string;

  @ApiPropertyOptional({ example: 1, description: 'Branch ID' })
  @IsInt()
  @IsOptional()
  branchId?: number;

  @ApiProperty({ example: 1000.00, description: 'Gross total (excl. VAT)' })
  @IsNumber()
  @Min(0)
  totalAmount: number;

  @ApiPropertyOptional({ example: 0.00, description: 'Total discount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalDiscount?: number;

  @ApiProperty({ example: 150.00, description: 'Total VAT' })
  @IsNumber()
  @Min(0)
  totalVat: number;

  @ApiProperty({ type: [VatCreditItemDto], description: 'Sale line items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VatCreditItemDto)
  items: VatCreditItemDto[];
}
