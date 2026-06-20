import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto';

export class ItemQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by active status (Y or N)' })
  @IsOptional()
  @IsString()
  isActive?: string;
}
