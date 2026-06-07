import { Type } from 'class-transformer';
import {
  IsString, IsOptional, IsNumber, IsArray, ValidateNested,
  IsDateString, IsPositive, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaleItemDto {
  @ApiProperty({ example: 'uuid-item-id', description: 'Item UUID' })
  @IsString()
  itemId: string;

  @ApiProperty({ example: 2, description: 'Quantity sold (must be > 0)' })
  @IsNumber()
  @IsPositive()
  quantity: number;

  @ApiProperty({ example: 150.00, description: 'Unit price' })
  @IsNumber()
  @Min(0)
  rate: number;

  @ApiPropertyOptional({ example: 10.00, description: 'Discount amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount?: number;

  @ApiPropertyOptional({ example: 5.00, description: 'VAT amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  vat?: number;

  @ApiProperty({ example: 295.00, description: 'Line total (after discount + vat)' })
  @IsNumber()
  total: number;
}

export class CreateCashSaleDto {
  @ApiPropertyOptional({ example: 'INV-2024-001', description: 'Invoice number (auto-generated if omitted)' })
  @IsString()
  @IsOptional()
  invoiceNo?: string;

  @ApiProperty({ example: '2024-01-15', description: 'Invoice date (ISO 8601)' })
  @IsDateString()
  invoiceDate: string;

  @ApiProperty({ example: 1, description: 'Branch ID' })
  @IsNumber()
  branchId: number;

  @ApiProperty({ example: 500.00, description: 'Gross total before discount/VAT' })
  @IsNumber()
  @Min(0)
  totalAmount: number;

  @ApiPropertyOptional({ example: 20.00, description: 'Total discount amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalDiscount?: number;

  @ApiPropertyOptional({ example: 15.00, description: 'Total VAT amount' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalVat?: number;

  @ApiProperty({ example: 495.00, description: 'Net payable amount' })
  @IsNumber()
  netAmount: number;

  @ApiProperty({ example: 500.00, description: 'Amount paid by customer' })
  @IsNumber()
  @Min(0)
  paidAmount: number;

  @ApiProperty({ example: 5.00, description: 'Change returned to customer' })
  @IsNumber()
  @Min(0)
  changeAmount: number;

  @ApiPropertyOptional({ example: 'cash', description: 'Payment method (cash / bank)' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ example: 'uuid-bank-id', description: 'Bank UUID (if bank payment)' })
  @IsString()
  @IsOptional()
  bankId?: string;

  @ApiPropertyOptional({ example: 'Manager approved', description: 'Reason for discount' })
  @IsString()
  @IsOptional()
  discountRemarks?: string;

  @ApiProperty({ type: [SaleItemDto], description: 'Sale line items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items: SaleItemDto[];
}
