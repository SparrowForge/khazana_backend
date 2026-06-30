import { Type } from 'class-transformer';
import {
  IsString, IsNumber, IsArray, ValidateNested, IsPositive, Min, IsOptional, IsIn, IsUUID, IsNotEmpty,
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

  @ApiPropertyOptional({ example: 'Ahmed', description: 'Staff name (defaults to logged-in user)' })
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
    example: 'Manager Karim',
    description: 'Discount authoriser name → t_SOMstr.SoMstr_DiscountRemarks. Mandatory (UI) when a discount is applied.',
  })
  @IsString()
  @IsOptional()
  discountRemarks?: string;

  @ApiPropertyOptional({
    example: '01700000000',
    description: 'Discount authoriser contact no → t_SOMstr.SoMstr_DiscountContact.',
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
