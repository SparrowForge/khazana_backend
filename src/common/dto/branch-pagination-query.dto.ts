import { IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from './pagination-query.dto';

export class BranchPaginationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by branch ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branchId?: number;
}
