import { Type } from 'class-transformer';
import {
  IsString, IsNumber, IsArray, ValidateNested, IsPositive, Min, IsOptional, IsIn, IsUUID, IsNotEmpty, MaxLength, Matches, IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Shared with the offline sync DTO, so the terminal and the queue that syncs
 *  behind it document the same two fields the same way. */
export const GUEST_NAME_DESC =
  "The walk-in customer's name, typed at the till for somebody with no Customer record → t_SOMstr.SoMstr_GuestName. IGNORED when the sale names a real (non walk-in) customer: that customer IS the answer, and a typed name beside them would contradict it. With guestContact, this is also what lets a walk-in bill be discounted — the discount audit asks who the discount was given to, and this answers it.";

export const GUEST_CONTACT_DESC =
  "The walk-in customer's contact no, typed at the till → t_SOMstr.SoMstr_GuestContact. Same rule as guestName, and required alongside it to discount a walk-in sale.";

export class PosCartItemDto {
  @ApiProperty({ example: 'uuid-item-id', description: 'Item_Information UUID' })
  @IsString()
  itemId: string;

  @ApiProperty({ example: 2, description: 'Quantity (must be > 0)' })
  @IsNumber()
  @IsPositive()
  qty: number;
}


/**
 * One tender against a bill. Several of these are a "payment split": a 2000
 * bill settled as 1500 Cash + 500 Card is two entries.
 *
 * Amounts are what each tender puts AGAINST THE BILL, not what the customer
 * handed over — the entries must add up to the payable exactly (cash overtender
 * and its change stay the single-payment story they always were).
 */
export class SalePaymentDto {
  @ApiProperty({ example: 'Cash', description: "Payment method — 'Cash', 'Card', 'Bkash', 'Nagad', ..." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  method: string;

  @ApiProperty({ example: 1500.0, description: 'Amount settled by this tender. Must be greater than zero.' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ format: 'uuid', description: "Bank UUID — only kept when `method` is 'Card'." })
  @IsUUID()
  @IsOptional()
  bankId?: string;

  @ApiPropertyOptional({ example: '4321', description: "Last 4 digits of the card. Only ever the last 4. Kept only when `method` is 'Card'." })
  @IsString()
  @IsOptional()
  @Matches(/^[0-9]{4}$/, { message: 'cardNo must be exactly the 4 last digits of the card' })
  cardNo?: string;

  @ApiPropertyOptional({ example: 'TRX8H2KD91', description: 'MFS/card reference — bKash trxID, terminal approval code, etc.' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  transactionRef?: string;
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

  /** Who a walk-in sale is for. See SoMstr_GuestName in the schema for why the
   *  picker alone was not enough: most counter trade has no Customer record and
   *  will not stand at the till while one is created. */
  @ApiPropertyOptional({
    example: 'Mr. Rahman',
    description: GUEST_NAME_DESC,
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  guestName?: string;

  @ApiPropertyOptional({
    example: '01700000000',
    description: GUEST_CONTACT_DESC,
  })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  guestContact?: string;

  /** @deprecated Superseded by `customerId` and `guestName`. */
  @ApiPropertyOptional({
    example: 'Manager Karim',
    deprecated: true,
    description: 'Typed discount authoriser name → t_SOMstr.SoMstr_DiscountRemarks. Superseded by customerId/guestName; only used when neither is given.',
  })
  @IsString()
  @IsOptional()
  discountRemarks?: string;

  /** @deprecated Superseded by `customerId` and `guestContact`. */
  @ApiPropertyOptional({
    example: '01700000000',
    deprecated: true,
    description: 'Typed discount authoriser contact no → t_SOMstr.SoMstr_DiscountContact. Superseded by customerId/guestContact; only used when neither is given.',
  })
  @IsString()
  @IsOptional()
  discountContact?: string;

  @ApiPropertyOptional({
    type: [SalePaymentDto],
    description:
      'Split payment: how the bill was settled, one entry per tender. OMIT for an ordinary single-payment sale — salesType/bankId/cardNo then describe the one tender, exactly as before. When supplied the entries must sum to the payable and salesType is ignored (the mode is derived: one entry names itself, several store "Multiple").',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  @IsOptional()
  payments?: SalePaymentDto[];

  @ApiPropertyOptional({
    example: false,
    description:
      'Accept a `payments` total below the payable and record the remainder as due. Defaults to false — a short split is a keying mistake far more often than an intended part-payment.',
  })
  @IsBoolean()
  @IsOptional()
  allowPartial?: boolean;
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
