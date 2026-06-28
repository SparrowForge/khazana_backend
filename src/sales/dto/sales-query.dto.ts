import { IsOptional, IsIn, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto';

export class SalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'cash', 'credit', 'vat-cash', 'vat-credit', 'nc'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'cash', 'credit', 'vat-cash', 'vat-credit', 'nc'])
  type: 'all' | 'cash' | 'credit' | 'vat-cash' | 'vat-credit' | 'nc' = 'all';

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by branch UUID' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
