import { Type } from 'class-transformer';
import {
  IsString, IsNotEmpty, IsNumber, IsArray, ValidateNested,
  IsOptional, IsIn, Min, IsDateString, ArrayMinSize, IsUUID, MaxLength,
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

  /** @deprecated Accepted but IGNORED — the sale is stamped with the syncing
   *  user's name, who is the only person able to upload this queue. Kept so an
   *  order queued before the Served By field was removed still validates. */
  @ApiPropertyOptional({
    example: 'Ahmed',
    deprecated: true,
    description: 'Ignored — the sale is served by, and stamped with, the syncing user.',
  })
  @IsString()
  @IsOptional()
  servedBy?: string;

  @ApiPropertyOptional({ example: 'Cash', description: 'Cash | Card' })
  @IsString()
  @IsOptional()
  salesType?: string;

  @ApiPropertyOptional({ description: 'Bank UUID for card payments, captured at sale time.', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  bankId?: string;

  @ApiPropertyOptional({
    description: 'Originating branch UUID captured at sale time.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: ['fixed', 'percentage'], example: 'fixed' })
  @IsIn(['fixed', 'percentage'])
  @IsOptional()
  discountType?: 'fixed' | 'percentage';

  @ApiPropertyOptional({ example: 50, description: 'Discount value — flat ৳ amount or percentage (0–100)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  discountValue?: number;

  @ApiPropertyOptional({ example: 'Mr. Rahman', description: "Walk-in customer's name → SoMstr_GuestName. Optional, and unrelated to the discount authoriser below." })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  guestName?: string;

  @ApiPropertyOptional({ example: 'Manager Karim', description: 'Discount authoriser name → SoMstr_DiscountRemarks.' })
  @IsString()
  @IsOptional()
  discountRemarks?: string;

  @ApiPropertyOptional({ example: '01700000000', description: 'Discount authoriser contact no → SoMstr_DiscountContact.' })
  @IsString()
  @IsOptional()
  discountContact?: string;
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
