import { Type } from 'class-transformer';
import {
  IsString, IsNumber, IsArray, ValidateNested, IsPositive, Min, IsOptional, IsIn, IsUUID, IsNotEmpty, MaxLength, Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PosCartItemDto {
  @ApiProperty({ example: 'uuid-item-id', description: 'Item_Information UUID' })
  @IsString()
  itemId: string;

  @ApiProperty({ example: 2, description: 'Quantity (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;
}

export class CreatePosSaleDto {
  @ApiProperty({ type: [PosCartItemDto], description: 'Cart items' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosCartItemDto)
  items: PosCartItemDto[];

  @ApiProperty({ example: 500.00, description: 'Amount paid by customer' })
  @IsNumber()
  @Min(0)
  paidAmount: number;

  /** @deprecated Accepted but IGNORED — the sale is always stamped with the
   *  signed-in user's name. Kept only so an offline sale queued before the
   *  Served By field was removed still passes validation on sync instead of
   *  being stranded in the client's queue by a 400. */
  @ApiPropertyOptional({
    example: 'Ahmed',
    deprecated: true,
    description: 'Ignored — the sale is served by, and stamped with, the signed-in user.',
  })
  @IsString()
  @IsOptional()
  servedBy?: string;

  @ApiPropertyOptional({ example: 'Cash', description: 'Payment type: Cash | Card' })
  @IsString()
  @IsOptional()
  salesType?: string;

  @ApiPropertyOptional({
    description: 'Bank UUID for card payments (t_SOMstr.soMstrMBank). Optional; set when salesType is Card.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  bankId?: string;

  @ApiPropertyOptional({
    description: 'Branch UUID for this sale. Optional — defaults to the authenticated session branch.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: 'fixed', description: 'Discount type: fixed | percentage' })
  @IsIn(['fixed', 'percentage'])
  @IsOptional()
  discountType?: 'fixed' | 'percentage';

  @ApiPropertyOptional({ example: 50, description: 'Discount value — flat amount or percentage (0–100)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  discountValue?: number;

  @ApiPropertyOptional({
    description:
      'Customer this sale is billed to (Customer UUID) → t_SOMstr.CustomerID. Omit for a walk-in, which is the default at the till. MANDATORY once a discount is applied: a discount has to be given to somebody, and the sale stamps their name and mobile onto the discount audit columns.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    example: '4321',
    description:
      "Last 4 digits of the card → t_SOMstr.SoMstr_CardNo. Only ever the last 4 — a full card number must not be sent, and is rejected. Ignored (stored NULL) unless salesType is 'Card'.",
  })
  @IsOptional()
  @Matches(/^[0-9]{4}$/, { message: 'cardNo must be exactly the 4 last digits of the card' })
  cardNo?: string;

  /** @deprecated Accepted but IGNORED — the column it was written to
   *  (SoMstr_GuestName) is gone, replaced by `customerId`. Kept in the DTO only
   *  so an offline sale queued before the picker existed still passes validation
   *  on sync instead of being stranded in the client's queue by a 400. */
  @ApiPropertyOptional({
    example: 'Mr. Rahman',
    deprecated: true,
    description:
      'Ignored — superseded by customerId. Accepted so an offline sale queued before the customer picker existed still syncs.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  guestName?: string;

  /** @deprecated Superseded by `customerId` — see `guestName`. */
  @ApiPropertyOptional({
    example: 'Manager Karim',
    deprecated: true,
    description: 'Typed discount authoriser name → t_SOMstr.SoMstr_DiscountRemarks. Superseded by customerId; only used when no customerId is given.',
  })
  @IsString()
  @IsOptional()
  discountRemarks?: string;

  /** @deprecated Superseded by `customerId` — see `guestName`. */
  @ApiPropertyOptional({
    example: '01700000000',
    deprecated: true,
    description: 'Typed discount authoriser contact no → t_SOMstr.SoMstr_DiscountContact. Superseded by customerId; only used when no customerId is given.',
  })
  @IsString()
  @IsOptional()
  discountContact?: string;
}

/** Full-replace edit payload — same shape as create (items are re-priced and the
 *  detail rows are purged & re-inserted). `branchId` is ignored (branch is kept).
 *  A modify reason is mandatory on every update for audit (Sales Correction). */
export class UpdatePosSaleDto extends CreatePosSaleDto {
  @ApiProperty({
    example: 'Customer returned 1 item',
    description: 'Reason for modifying the sale → t_SOMstr.SoMstr_ModifyRemarks. Surfaced in the Daily Final Report Sales Correction breakdown.',
  })
  @IsString()
  @IsNotEmpty()
  modifyRemarks: string;
}
