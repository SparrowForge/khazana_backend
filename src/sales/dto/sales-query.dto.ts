import { IsOptional, IsIn, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto';

export class SalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'cash', 'credit', 'vat-cash', 'vat-credit', 'nc'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'cash', 'credit', 'vat-cash', 'vat-credit', 'nc'])
  type: 'all' | 'cash' | 'credit' | 'vat-cash' | 'vat-credit' | 'nc' = 'all';

  @ApiPropertyOptional({ description: 'Filter by branch ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branchId?: number;
}
