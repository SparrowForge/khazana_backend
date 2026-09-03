import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto';

export class PriceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by item id (Item_Information.ID uuid)' })
  @IsOptional()
  @IsString()
  itemId?: string;

  /** @deprecated Prices key on the item uuid now; a code sent here is resolved to it. */
  @ApiPropertyOptional({ description: 'Filter by item code (legacy — resolved to the item id)' })
  @IsOptional()
  @IsString()
  itemCode?: string;
}
