import { Type } from 'class-transformer';
import {
  IsString, IsOptional, IsNumber, IsArray, ValidateNested,
  IsDateString, IsPositive, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VatSaleItemDto {
  @ApiProperty({ example: 'uuid-item-id', description: 'Item UUID' })
  @IsString()
  itemId: string;

  @ApiProperty({ example: 3, description: 'Quantity (must be > 0)' })
  @IsNumber()
  @IsPositive()
  quantity: number;

  @ApiProperty({ example: 100.00, description: 'Unit price (excl. VAT)' })
  @IsNumber()
  @Min(0)
  rate: number;

  @ApiPropertyOptional({ example: 5.00, description: 'Discount amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount?: number;

  @ApiProperty({ example: 15, description: 'VAT percentage' })
  @IsNumber()
  @Min(0)
  vatValue: number;

  @ApiProperty({ example: 45.00, description: 'VAT amount (calculated)' })
  @IsNumber()
  vatAmount: number;

  @ApiProperty({ example: 345.00, description: 'Net amount (incl. VAT, after discount)' })
  @IsNumber()
  netAmount: number;
}

export class CreateVatCashSaleDto {
  @ApiPropertyOptional({ example: 'VAT-2024-001', description: 'Invoice number' })
  @IsString()
  @IsOptional()
  invoiceNo?: string;

  @ApiProperty({ example: '2024-01-15', description: 'Invoice date (ISO 8601)' })
  @IsDateString()
  invoiceDate: string;

  @ApiProperty({ example: 1, description: 'Branch ID' })
  @IsNumber()
  branchId: number;

  @ApiPropertyOptional({ example: 'VAT-CLN-001', description: 'VAT client number' })
  @IsString()
  @IsOptional()
  vatClnNo?: string;

  @ApiProperty({ example: 300.00, description: 'Gross total (excl. VAT)' })
  @IsNumber()
  @Min(0)
  totalAmount: number;

  @ApiPropertyOptional({ example: 15.00, description: 'Total discount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalDiscount?: number;

  @ApiProperty({ example: 45.00, description: 'Total VAT' })
  @IsNumber()
  @Min(0)
  totalVat: number;

  @ApiProperty({ example: 330.00, description: 'Net payable (incl. VAT)' })
  @IsNumber()
  netAmount: number;

  @ApiProperty({ example: 350.00, description: 'Amount paid by customer' })
  @IsNumber()
  paidAmount: number;

  @ApiProperty({ example: 20.00, description: 'Change returned' })
  @IsNumber()
  changeAmount: number;

  @ApiPropertyOptional({ example: 'bank', description: 'Payment method' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiProperty({ type: [VatSaleItemDto], description: 'Sale line items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VatSaleItemDto)
  items: VatSaleItemDto[];
}
