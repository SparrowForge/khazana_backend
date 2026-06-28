import { Type } from 'class-transformer';
import {
  IsString, IsNumber, IsArray, ValidateNested, IsPositive, Min, IsOptional, IsIn, IsUUID,
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
}
