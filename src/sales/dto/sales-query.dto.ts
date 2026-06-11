import { IsOptional, IsIn, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto';

export class SalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['cash', 'credit', 'vat-cash', 'vat-credit'], default: 'cash' })
  @IsOptional()
  @IsIn(['cash', 'credit', 'vat-cash', 'vat-credit'])
  type: 'cash' | 'credit' | 'vat-cash' | 'vat-credit' = 'cash';

  @ApiPropertyOptional({ description: 'Filter by branch ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branchId?: number;
}
