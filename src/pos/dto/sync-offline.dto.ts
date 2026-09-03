import { Type } from 'class-transformer';
import {
  IsString, IsNotEmpty, IsNumber, IsArray, ValidateNested,
  IsOptional, IsIn, Min, IsDateString, ArrayMinSize, IsUUID, MaxLength, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PosCartItemDto, SalePaymentDto } from './create-pos-sale.dto';

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

  @ApiPropertyOptional({
    description: 'Customer this sale was billed to, captured at sale time → t_SOMstr.CustomerID. Absent for a walk-in.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: '4321', description: "Last 4 digits of the card → SoMstr_CardNo. Stored only when salesType is 'Card'." })
  @IsOptional()
  @Matches(/^[0-9]{4}$/, { message: 'cardNo must be exactly the 4 last digits of the card' })
  cardNo?: string;

  @ApiPropertyOptional({
    type: [SalePaymentDto],
    description:
      'Split payment recorded at the till while offline, one entry per tender. Omit for a single-payment sale. Carried through sync so a bill split offline arrives split, rather than collapsing to one mode.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  @IsOptional()
  payments?: SalePaymentDto[];

  /** @deprecated Accepted but IGNORED — the column it was written to is gone,
   *  replaced by `customerId`. Kept so a sale queued before the picker existed
   *  syncs rather than 400-ing. */
  @ApiPropertyOptional({ example: 'Mr. Rahman', deprecated: true, description: 'Ignored — superseded by customerId. Accepted so a pre-picker offline sale still syncs.' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  guestName?: string;

  /** @deprecated Superseded by `customerId` — see `guestName`. */
  @ApiPropertyOptional({ example: 'Manager Karim', deprecated: true, description: 'Typed discount authoriser name → SoMstr_DiscountRemarks. Superseded by customerId.' })
  @IsString()
  @IsOptional()
  discountRemarks?: string;

  /** @deprecated Superseded by `customerId` — see `guestName`. */
  @ApiPropertyOptional({ example: '01700000000', deprecated: true, description: 'Typed discount authoriser contact no → SoMstr_DiscountContact. Superseded by customerId.' })
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
