import { Type } from 'class-transformer';
import {
  IsString, IsNotEmpty, IsNumber, IsArray, ValidateNested, IsPositive,
  IsOptional, IsIn, Min, IsDateString, ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PosCartItemDto } from './create-pos-sale.dto';

/** One sale that was completed while the terminal was offline. */
export class OfflineSaleDto {
  @ApiProperty({ example: 'MZ01-1782560700-001', description: 'Client-generated invoice number: [UserPrefix]-[UnixTimestamp]-[OfflineSeq]' })
  @IsString()
  @IsNotEmpty()
  invoiceNo: string;

  @ApiProperty({ type: [PosCartItemDto], description: 'Cart items' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosCartItemDto)
  items: PosCartItemDto[];

  @ApiProperty({ example: 500, description: 'Amount tendered by the customer' })
  @IsNumber()
  @Min(0)
  paidAmount: number;

  @ApiProperty({ example: '2026-06-27T05:45:00.000Z', description: 'When the sale was originally saved offline (historical timestamp, ISO 8601)' })
  @IsDateString()
  clientSavedAt: string;

  @ApiPropertyOptional({ example: 'Ahmed', description: 'Staff name — defaults to the syncing user' })
  @IsString()
  @IsOptional()
  servedBy?: string;

  @ApiPropertyOptional({ example: 'Cash', description: 'Cash | Card' })
  @IsString()
  @IsOptional()
  salesType?: string;

  @ApiPropertyOptional({ example: 1, description: 'Branch ID (integer)' })
  @IsNumber()
  @IsOptional()
  branchId?: number;

  @ApiPropertyOptional({ enum: ['fixed', 'percentage'], example: 'fixed' })
  @IsIn(['fixed', 'percentage'])
  @IsOptional()
  discountType?: 'fixed' | 'percentage';

  @ApiPropertyOptional({ example: 50, description: 'Discount value — flat ৳ amount or percentage (0–100)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  discountValue?: number;
}

/** Batch payload uploaded by one cashier session when connectivity is restored. */
export class SyncOfflineDto {
  @ApiProperty({ example: 'df8a8ad7-fdac-45fd-a4ef-3689adc19cca', description: 'User ID that owns these offline orders (must match the authenticated user)' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: 'admin', description: 'Username that owns these offline orders (must match the authenticated user)' })
  @IsString()
  @IsNotEmpty()
  userName: string;

  @ApiProperty({ type: [OfflineSaleDto], description: 'The offline transactions to replay onto the central database' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OfflineSaleDto)
  orders: OfflineSaleDto[];
}
