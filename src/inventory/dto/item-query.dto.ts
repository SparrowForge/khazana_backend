import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto';

export class ItemQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by active status (Y or N)' })
  @IsOptional()
  @IsString()
  isActive?: string;

  @ApiPropertyOptional({
    description:
      'Type-ahead filter on item code or name (case-insensitive, contains). Lets a picker fetch a handful of matches instead of walking the whole catalogue.',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
