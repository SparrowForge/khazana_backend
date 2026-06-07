import { Type } from 'class-transformer';
import {
  IsString, IsOptional, IsNumber, IsArray, ValidateNested,
  IsDateString, IsPositive, Min, IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreditSaleItemDto {
  @ApiProperty({ example: 'ITM-001', description: 'Item code' })
  @IsString()
  itemCode: string;

  @ApiProperty({ example: 5, description: 'Quantity (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;

  @ApiProperty({ example: 200.00, description: 'Unit price' })
  @IsNumber()
  @Min(0)
  rate: number;

  @ApiPropertyOptional({ example: 10.00, description: 'Discount amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  disc?: number;

  @ApiPropertyOptional({ example: 5.00, description: 'VAT amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  vat?: number;

  @ApiProperty({ example: 995.00, description: 'Line total' })
  @IsNumber()
  total: number;
}

export class CreateCreditSaleDto {
  @ApiProperty({ example: 'CS-2024-001', description: 'Invoice number' })
  @IsString()
  invNo: string;

  @ApiProperty({ example: '2024-01-15', description: 'Invoice date (ISO 8601)' })
  @IsDateString()
  invDate: string;

  @ApiProperty({ example: 'CUST-001', description: 'Customer code' })
  @IsString()
  clientCode: string;

  @ApiPropertyOptional({ example: 'PO-2024-001', description: 'Purchase order number' })
  @IsString()
  @IsOptional()
  poNo?: string;

  @ApiPropertyOptional({ example: 1, description: 'Branch ID' })
  @IsInt()
  @IsOptional()
  branchId?: number;

  @ApiProperty({ example: 1000.00, description: 'Gross total' })
  @IsNumber()
  @Min(0)
  totalAmount: number;

  @ApiPropertyOptional({ example: 50.00, description: 'Total discount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalDiscount?: number;

  @ApiPropertyOptional({ example: 30.00, description: 'Total VAT' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalVat?: number;

  @ApiPropertyOptional({ example: 'Special client discount', description: 'Discount remarks' })
  @IsString()
  @IsOptional()
  discountRemarks?: string;

  @ApiProperty({ type: [CreditSaleItemDto], description: 'Sale line items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreditSaleItemDto)
  items: CreditSaleItemDto[];
}
